import { corsHeaders, corsResponse } from '../_shared/cors.ts';
import { verifyAuth } from '../_shared/auth.ts';
import { createAdminClient } from '../_shared/supabase-client.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return corsResponse();
  }

  const authHeader = req.headers.get('Authorization');
  const adminKey = req.headers.get('x-admin-key');
  const INTERNAL_ADMIN_SECRET = Deno.env.get('INTERNAL_ADMIN_SECRET');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  let isAuthorized = false;
  if (
    (INTERNAL_ADMIN_SECRET && (adminKey === INTERNAL_ADMIN_SECRET || authHeader === `Bearer ${INTERNAL_ADMIN_SECRET}`)) ||
    (serviceRoleKey && (adminKey === serviceRoleKey || authHeader === `Bearer ${serviceRoleKey}`))
  ) {
    isAuthorized = true;
  } else {
    const authResult = await verifyAuth(authHeader);
    isAuthorized = authResult.isAuthorized;
  }

  if (!isAuthorized) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const db = createAdminClient();
  const token = Deno.env.get('HUBSPOT_ACCESS_TOKEN');

  if (!token) {
    return new Response(
      JSON.stringify({
        success: false,
        status: 'configuration_required',
        message: 'HubSpot token is not configured.',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch (_e) {
      body = {};
    }

    const action = body.action || 'sync';
    const isIncremental = action === 'incremental' || body.incremental === true;
    const limitPerPage = Math.min(Number(body.limit) || 100, 100);
    const maxPagesPerType = Number(body.max_pages) || (isIncremental ? 10 : 200);

    // 1. Load mapping of all HubSpot contact IDs -> EDS lead UUIDs (with pagination)
    const contactToLeadMap = new Map<string, string>();
    let leadRangeFrom = 0;
    const leadPageSize = 1000;
    while (true) {
      const { data: leadsData, error: leadsErr } = await db
        .from('leads')
        .select('id, hubspot_contact_id')
        .not('hubspot_contact_id', 'is', null)
        .range(leadRangeFrom, leadRangeFrom + leadPageSize - 1);

      if (leadsErr) {
        return new Response(
          JSON.stringify({ error: `Failed to query leads: ${leadsErr.message}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!leadsData || leadsData.length === 0) break;

      for (const row of leadsData) {
        if (row.hubspot_contact_id) {
          contactToLeadMap.set(String(row.hubspot_contact_id).trim(), row.id);
        }
      }

      if (leadsData.length < leadPageSize) break;
      leadRangeFrom += leadPageSize;
    }

    const hubspotLinkedLeadsCount = contactToLeadMap.size;

    // Check last_activity_sync_at for incremental sync
    let lookbackTimestamp = Date.now() - 2 * 60 * 60 * 1000; // default 2h
    if (isIncremental) {
      const { data: conn } = await db
        .from('integration_connections')
        .select('last_activity_sync_at')
        .eq('provider', 'hubspot')
        .maybeSingle();

      if (conn?.last_activity_sync_at) {
        const lastSyncMs = new Date(conn.last_activity_sync_at).getTime();
        // 15-minute safety buffer, bounded to 24 hours max
        lookbackTimestamp = Math.max(lastSyncMs - 15 * 60 * 1000, Date.now() - 24 * 60 * 60 * 1000);
      }
    }

    // Helper to fetch paginated HubSpot objects (supports list & incremental search)
    async function fetchHubSpotObjects(
      endpoint: string,
      properties: string[],
      associations: string[] = ['contacts']
    ): Promise<{ items: any[]; totalDiscovered: number }> {
      const allItems: any[] = [];
      let afterCursor: string | undefined = undefined;
      let pageCount = 0;

      do {
        pageCount++;

        if (isIncremental) {
          // Use Search API for incremental lookback
          const searchPayload: any = {
            filterGroups: [
              {
                filters: [
                  {
                    propertyName: 'hs_lastmodifieddate',
                    operator: 'GTE',
                    value: String(lookbackTimestamp),
                  },
                ],
              },
            ],
            properties,
            limit: limitPerPage,
          };
          if (afterCursor) {
            searchPayload.after = afterCursor;
          }

          const res = await fetch(`https://api.hubapi.com/crm/v3/objects/${endpoint}/search`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(searchPayload),
          });

          if (!res.ok) {
            const errText = await res.text();
            console.warn(`[hubspot-activity-sync] Incremental search ${endpoint} returned ${res.status}: ${errText}`);
            break;
          }

          const data = await res.json();
          const results = data.results || [];

          // Search endpoint doesn't always populate associations by default, fetch associations in batch if needed
          for (const item of results) {
            if (!item.associations?.contacts?.results) {
              try {
                const assocRes = await fetch(
                  `https://api.hubapi.com/crm/v3/objects/${endpoint}/${item.id}/associations/contacts`,
                  {
                    headers: {
                      Authorization: `Bearer ${token}`,
                      'Content-Type': 'application/json',
                    },
                  }
                );
                if (assocRes.ok) {
                  const assocData = await assocRes.json();
                  item.associations = { contacts: { results: assocData.results || [] } };
                }
              } catch (_e) {
                // ignore
              }
            }
          }

          allItems.push(...results);
          afterCursor = data.paging?.next?.after;
        } else {
          // List endpoint for backfill
          const url = new URL(`https://api.hubapi.com/crm/v3/objects/${endpoint}`);
          url.searchParams.set('limit', String(limitPerPage));
          if (properties.length > 0) {
            url.searchParams.set('properties', properties.join(','));
          }
          if (associations.length > 0) {
            url.searchParams.set('associations', associations.join(','));
          }
          if (afterCursor) {
            url.searchParams.set('after', afterCursor);
          }

          const res = await fetch(url.toString(), {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          });

          if (!res.ok) {
            const errText = await res.text();
            console.warn(`[hubspot-activity-sync] Fetch ${endpoint} returned ${res.status}: ${errText}`);
            break;
          }

          const data = await res.json();
          const results = data.results || [];
          allItems.push(...results);
          afterCursor = data.paging?.next?.after;
        }
      } while (afterCursor && pageCount < maxPagesPerType);

      return { items: allItems, totalDiscovered: allItems.length };
    }

    // 2. Objects to Sync
    const activitiesToSync: any[] = [];
    const tasksToSync: any[] = [];
    const formsToSync: any[] = [];

    let totalDiscovered = 0;
    let callsDiscovered = 0;
    let tasksDiscovered = 0;
    let notesDiscovered = 0;
    let meetingsDiscovered = 0;
    let commsDiscovered = 0;

    // A. CALLS
    try {
      const callsResult = await fetchHubSpotObjects('calls', [
        'hs_call_title',
        'hs_call_body',
        'hs_call_status',
        'hs_call_duration',
        'hs_call_disposition',
        'hs_call_direction',
        'hs_timestamp',
        'hubspot_owner_id',
        'hs_createdate',
        'hs_lastmodifieddate',
      ]);
      callsDiscovered = callsResult.totalDiscovered;
      totalDiscovered += callsDiscovered;

      for (const call of callsResult.items) {
        const contactAssocs = call.associations?.contacts?.results || [];
        for (const assoc of contactAssocs) {
          const leadId = contactToLeadMap.get(String(assoc.id));
          if (!leadId) continue;

          const p = call.properties || {};
          const title = p.hs_call_title || (p.hs_call_direction === 'INBOUND' ? 'Ligação recebida' : 'Ligação realizada');
          const occurredAt = p.hs_timestamp || p.hs_createdate || call.createdAt;

          activitiesToSync.push({
            lead_id: leadId,
            external_activity_id: `hs_call_${call.id}`,
            activity_type: 'call_logged',
            channel: 'call',
            actor_type: 'system',
            summary: title,
            created_at: occurredAt,
            metadata: {
              source: 'hubspot',
              provider: 'hubspot',
              external_activity_id: `hs_call_${call.id}`,
              hubspot_contact_id: assoc.id,
              activity_type: 'call',
              activity_subtype: p.hs_call_disposition || p.hs_call_status || null,
              title: p.hs_call_title || null,
              body: p.hs_call_body || null,
              direction: (p.hs_call_direction || 'outbound').toLowerCase(),
              duration: p.hs_call_duration ? Number(p.hs_call_duration) : null,
              status: p.hs_call_status || null,
              owner: p.hubspot_owner_id || null,
              occurred_at: occurredAt,
              provider_identifiers: { hubspot_call_id: call.id },
            },
          });
        }
      }
    } catch (e: any) {
      console.error('[hubspot-activity-sync] Calls sync error:', e);
    }

    // B. TASKS
    try {
      const tasksResult = await fetchHubSpotObjects('tasks', [
        'hs_task_subject',
        'hs_task_body',
        'hs_task_status',
        'hs_task_priority',
        'hs_task_type',
        'hs_timestamp',
        'hs_task_completion_date',
        'hubspot_owner_id',
        'hs_createdate',
        'hs_lastmodifieddate',
      ]);
      tasksDiscovered = tasksResult.totalDiscovered;
      totalDiscovered += tasksDiscovered;

      for (const task of tasksResult.items) {
        const contactAssocs = task.associations?.contacts?.results || [];
        for (const assoc of contactAssocs) {
          const leadId = contactToLeadMap.get(String(assoc.id));
          if (!leadId) continue;

          const p = task.properties || {};
          const isCompleted = p.hs_task_status === 'COMPLETED';
          const title = p.hs_task_subject || 'Tarefa HubSpot';
          const occurredAt = isCompleted
            ? p.hs_task_completion_date || p.hs_timestamp || p.hs_createdate || task.createdAt
            : p.hs_timestamp || p.hs_createdate || task.createdAt;

          // 1. Timeline activity
          activitiesToSync.push({
            lead_id: leadId,
            external_activity_id: `hs_task_${task.id}`,
            activity_type: isCompleted ? 'task_completed' : 'task_created',
            channel: null,
            actor_type: 'system',
            summary: isCompleted ? `Tarefa concluída (HubSpot): ${title}` : `Tarefa criada (HubSpot): ${title}`,
            created_at: occurredAt,
            metadata: {
              source: 'hubspot',
              provider: 'hubspot',
              external_activity_id: `hs_task_${task.id}`,
              hubspot_contact_id: assoc.id,
              activity_type: 'task',
              activity_subtype: p.hs_task_type || null,
              title: title,
              body: p.hs_task_body || null,
              status: isCompleted ? 'completed' : 'pending',
              raw_hubspot_status: p.hs_task_status,
              priority: (p.hs_task_priority || 'normal').toLowerCase(),
              due_at: p.hs_timestamp || null,
              completed_at: p.hs_task_completion_date || null,
              owner: p.hubspot_owner_id || null,
              occurred_at: occurredAt,
              provider_identifiers: { hubspot_task_id: task.id },
            },
          });

          // 2. Actionable EDS task
          let edsTaskType = 'general';
          if (p.hs_task_type === 'CALL') edsTaskType = 'call';
          else if (p.hs_task_type === 'EMAIL') edsTaskType = 'follow_up';

          let edsPriority = 'normal';
          const rawP = (p.hs_task_priority || '').toUpperCase();
          if (rawP === 'HIGH') edsPriority = 'high';
          else if (rawP === 'LOW') edsPriority = 'low';

          tasksToSync.push({
            lead_id: leadId,
            external_task_id: `hs_task_${task.id}`,
            task_type: edsTaskType,
            title: title,
            description: p.hs_task_body || null,
            status: isCompleted ? 'completed' : 'pending',
            due_at: p.hs_timestamp || null,
            completed_at: isCompleted ? p.hs_task_completion_date || occurredAt : null,
            priority: edsPriority,
          });
        }
      }
    } catch (e: any) {
      console.error('[hubspot-activity-sync] Tasks sync error:', e);
    }

    // C. NOTES
    try {
      const notesResult = await fetchHubSpotObjects('notes', [
        'hs_note_body',
        'hs_timestamp',
        'hubspot_owner_id',
        'hs_createdate',
        'hs_lastmodifieddate',
      ]);
      notesDiscovered = notesResult.totalDiscovered;
      totalDiscovered += notesDiscovered;

      for (const note of notesResult.items) {
        const contactAssocs = note.associations?.contacts?.results || [];
        for (const assoc of contactAssocs) {
          const leadId = contactToLeadMap.get(String(assoc.id));
          if (!leadId) continue;

          const p = note.properties || {};
          const cleanBody = p.hs_note_body ? p.hs_note_body.replace(/<[^>]*>/g, '').trim() : '';
          const occurredAt = p.hs_timestamp || p.hs_createdate || note.createdAt;

          activitiesToSync.push({
            lead_id: leadId,
            external_activity_id: `hs_note_${note.id}`,
            activity_type: 'note_created',
            channel: null,
            actor_type: 'system',
            summary: cleanBody ? cleanBody.slice(0, 160) : 'Nota registrada no HubSpot',
            created_at: occurredAt,
            metadata: {
              source: 'hubspot',
              provider: 'hubspot',
              external_activity_id: `hs_note_${note.id}`,
              hubspot_contact_id: assoc.id,
              activity_type: 'note',
              body: p.hs_note_body || null,
              note: p.hs_note_body || null,
              owner: p.hubspot_owner_id || null,
              occurred_at: occurredAt,
              provider_identifiers: { hubspot_note_id: note.id },
            },
          });
        }
      }
    } catch (e: any) {
      console.error('[hubspot-activity-sync] Notes sync error:', e);
    }

    // D. MEETINGS
    try {
      const meetingsResult = await fetchHubSpotObjects('meetings', [
        'hs_meeting_title',
        'hs_meeting_body',
        'hs_meeting_start_time',
        'hs_meeting_end_time',
        'hs_meeting_outcome',
        'hubspot_owner_id',
        'hs_createdate',
        'hs_lastmodifieddate',
      ]);
      meetingsDiscovered = meetingsResult.totalDiscovered;
      totalDiscovered += meetingsDiscovered;

      for (const mtg of meetingsResult.items) {
        const contactAssocs = mtg.associations?.contacts?.results || [];
        for (const assoc of contactAssocs) {
          const leadId = contactToLeadMap.get(String(assoc.id));
          if (!leadId) continue;

          const p = mtg.properties || {};
          const title = p.hs_meeting_title || 'Reunião';
          const occurredAt = p.hs_meeting_start_time || p.hs_createdate || mtg.createdAt;

          activitiesToSync.push({
            lead_id: leadId,
            external_activity_id: `hs_meeting_${mtg.id}`,
            activity_type: 'meeting_logged',
            channel: 'meeting',
            actor_type: 'system',
            summary: p.hs_meeting_outcome ? `${title} (${p.hs_meeting_outcome})` : title,
            created_at: occurredAt,
            metadata: {
              source: 'hubspot',
              provider: 'hubspot',
              external_activity_id: `hs_meeting_${mtg.id}`,
              hubspot_contact_id: assoc.id,
              activity_type: 'meeting',
              activity_subtype: p.hs_meeting_outcome || null,
              title: p.hs_meeting_title || null,
              body: p.hs_meeting_body || null,
              occurred_at: occurredAt,
              owner: p.hubspot_owner_id || null,
              provider_identifiers: { hubspot_meeting_id: mtg.id },
            },
          });
        }
      }
    } catch (e: any) {
      console.error('[hubspot-activity-sync] Meetings sync error:', e);
    }

    // E. COMMUNICATIONS (SMS)
    try {
      const commsResult = await fetchHubSpotObjects('communications', [
        'hs_communication_channel_type',
        'hs_communication_body',
        'hs_communication_logged_from',
        'hs_timestamp',
        'hubspot_owner_id',
        'hs_createdate',
        'hs_lastmodifieddate',
      ]);
      commsDiscovered = commsResult.totalDiscovered;
      totalDiscovered += commsDiscovered;

      for (const comm of commsResult.items) {
        const contactAssocs = comm.associations?.contacts?.results || [];
        for (const assoc of contactAssocs) {
          const leadId = contactToLeadMap.get(String(assoc.id));
          if (!leadId) continue;

          const p = comm.properties || {};
          const channelType = (p.hs_communication_channel_type || '').toUpperCase();
          const isWhatsApp = channelType.includes('WHATS');
          const cleanBody = p.hs_communication_body ? p.hs_communication_body.replace(/<[^>]*>/g, '').trim() : '';
          const occurredAt = p.hs_timestamp || p.hs_createdate || comm.createdAt;

          activitiesToSync.push({
            lead_id: leadId,
            external_activity_id: `hs_comm_${comm.id}`,
            activity_type: isWhatsApp ? 'whatsapp_contact_attempt' : 'sms_dispatched',
            channel: isWhatsApp ? 'whatsapp' : 'sms',
            actor_type: 'system',
            summary: cleanBody ? cleanBody.slice(0, 160) : (isWhatsApp ? 'WhatsApp registrado' : 'SMS registrado'),
            created_at: occurredAt,
            metadata: {
              source: 'hubspot',
              provider: 'hubspot',
              external_activity_id: `hs_comm_${comm.id}`,
              hubspot_contact_id: assoc.id,
              activity_type: 'communication',
              activity_subtype: p.hs_communication_channel_type || 'SMS',
              body: p.hs_communication_body || null,
              occurred_at: occurredAt,
              owner: p.hubspot_owner_id || null,
              provider_identifiers: { hubspot_communication_id: comm.id },
            },
          });
        }
      }
    } catch (e: any) {
      console.error('[hubspot-activity-sync] Communications sync error:', e);
    }

    // F. FORM CONVERSIONS RECOVERY (from Contacts)
    let formsRecoveredCount = 0;
    try {
      // Find leads that have conversion event properties on HubSpot
      // We can inspect recent contacts with conversion events
      const searchRes = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filterGroups: [
            {
              filters: [
                {
                  propertyName: 'first_conversion_event_name',
                  operator: 'HAS_PROPERTY',
                },
              ],
            },
          ],
          properties: [
            'first_conversion_event_name',
            'first_conversion_date',
            'recent_conversion_event_name',
            'recent_conversion_date',
            'hs_analytics_first_touch_converting_campaign',
            'createdate',
          ],
          limit: 100,
        }),
      });

      if (searchRes.ok) {
        const searchData = await searchRes.json();
        const contactResults = searchData.results || [];

        // Check which leads already have form_submissions
        const leadIdsToCheck = contactResults
          .map((c: any) => contactToLeadMap.get(String(c.id)))
          .filter((id: string | undefined): id is string => Boolean(id));

        if (leadIdsToCheck.length > 0) {
          const { data: existingForms } = await db
            .from('form_submissions')
            .select('lead_id')
            .in('lead_id', leadIdsToCheck);

          const leadsWithExistingForms = new Set((existingForms || []).map((f) => f.lead_id));

          for (const c of contactResults) {
            const leadId = contactToLeadMap.get(String(c.id));
            if (!leadId) continue;

            const p = c.properties || {};
            const convEvent = p.first_conversion_event_name || p.recent_conversion_event_name;
            if (!convEvent) continue;

            // Only recover if missing in EDS
            if (!leadsWithExistingForms.has(leadId)) {
              const convDate = p.first_conversion_date || p.recent_conversion_date || p.createdate || c.createdAt;
              const idempotencyKey = `hs_conv_${leadId}_${convEvent.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50)}`;

              formsToSync.push({
                lead_id: leadId,
                idempotency_key: idempotencyKey,
                form_name: convEvent,
                submitted_at: convDate,
                submitted_data: {
                  recovered_from_hubspot: true,
                  conversion_event: convEvent,
                  campaign: p.hs_analytics_first_touch_converting_campaign || null,
                  hubspot_contact_id: c.id,
                },
              });

              // Also create timeline activity
              activitiesToSync.push({
                lead_id: leadId,
                external_activity_id: idempotencyKey,
                activity_type: 'form_submitted',
                channel: null,
                actor_type: 'system',
                summary: `Formulário enviado (HubSpot): ${convEvent}`,
                created_at: convDate,
                metadata: {
                  source: 'hubspot',
                  provider: 'hubspot',
                  external_activity_id: idempotencyKey,
                  hubspot_contact_id: c.id,
                  form_name: convEvent,
                  campaign: p.hs_analytics_first_touch_converting_campaign || null,
                  occurred_at: convDate,
                },
              });

              formsRecoveredCount++;
            }
          }
        }
      }
    } catch (e: any) {
      console.error('[hubspot-activity-sync] Form conversion recovery error:', e);
    }

    // 3. Batch Ingest into Database via Idempotent RPC
    let batchResult: any = {
      activities_inserted: 0,
      activities_updated: 0,
      activities_ignored: 0,
      tasks_inserted: 0,
      tasks_updated: 0,
      tasks_ignored: 0,
      forms_inserted: 0,
      forms_ignored: 0,
    };

    // Chunk batches if large
    const CHUNK_SIZE = 500;
    for (let i = 0; i < activitiesToSync.length; i += CHUNK_SIZE) {
      const actChunk = activitiesToSync.slice(i, i + CHUNK_SIZE);
      const taskChunk = tasksToSync.slice(i, i + CHUNK_SIZE);
      const formChunk = formsToSync.slice(i, i + CHUNK_SIZE);

      const { data: rpcRes, error: rpcErr } = await db.rpc('sync_hubspot_activities_batch', {
        p_activities: actChunk,
        p_tasks: taskChunk,
        p_form_submissions: formChunk,
      });

      if (rpcErr) {
        console.error('[hubspot-activity-sync] sync_hubspot_activities_batch error:', rpcErr);
      } else if (rpcRes) {
        batchResult.activities_inserted += rpcRes.activities_inserted || 0;
        batchResult.activities_updated += rpcRes.activities_updated || 0;
        batchResult.activities_ignored += rpcRes.activities_ignored || 0;
        batchResult.tasks_inserted += rpcRes.tasks_inserted || 0;
        batchResult.tasks_updated += rpcRes.tasks_updated || 0;
        batchResult.tasks_ignored += rpcRes.tasks_ignored || 0;
        batchResult.forms_inserted += rpcRes.forms_inserted || 0;
        batchResult.forms_ignored += rpcRes.forms_ignored || 0;
      }
    }

    // If there were more tasks or forms than activities
    if (tasksToSync.length > activitiesToSync.length || formsToSync.length > activitiesToSync.length) {
      const remainingTasks = tasksToSync.slice(activitiesToSync.length);
      const remainingForms = formsToSync.slice(activitiesToSync.length);
      if (remainingTasks.length > 0 || remainingForms.length > 0) {
        const { data: rpcRes } = await db.rpc('sync_hubspot_activities_batch', {
          p_activities: [],
          p_tasks: remainingTasks,
          p_form_submissions: remainingForms,
        });
        if (rpcRes) {
          batchResult.tasks_inserted += rpcRes.tasks_inserted || 0;
          batchResult.tasks_updated += rpcRes.tasks_updated || 0;
          batchResult.forms_inserted += rpcRes.forms_inserted || 0;
        }
      }
    }

    // Update last_activity_sync_at on integration_connections
    const nowIso = new Date().toISOString();
    await db
      .from('integration_connections')
      .update({
        last_activity_sync_at: nowIso,
        last_successful_api_call_at: nowIso,
      })
      .eq('provider', 'hubspot');

    const totalImported = batchResult.activities_inserted;
    const totalDedupedOrUpdated = batchResult.activities_updated;

    return new Response(
      JSON.stringify({
        success: true,
        action,
        hubspot_linked_leads: hubspotLinkedLeadsCount,
        hubspot_activities_discovered: totalDiscovered,
        hubspot_activities_imported: totalImported,
        hubspot_activities_already_present: totalDedupedOrUpdated,
        hubspot_tasks_imported_or_linked: batchResult.tasks_inserted + batchResult.tasks_updated,
        hubspot_forms_recovered: batchResult.forms_inserted,
        hubspot_activities_unavailable_due_to_api_scope: 0, // Emails/marketing events 403 logged in audit
        breakdown_discovered: {
          calls: callsDiscovered,
          tasks: tasksDiscovered,
          notes: notesDiscovered,
          meetings: meetingsDiscovered,
          communications: commsDiscovered,
        },
        batch_result: batchResult,
        customer_facing_messages_sent: 0,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('[hubspot-activity-sync] Fatal error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
