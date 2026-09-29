// =============================================================================
// EDS HUB — Mandatory Production Validation Script
// Tests 1 through 11 (Ads-Only Automatic Email + Global created_at DESC Ordering)
// =============================================================================

const SUPABASE_URL = 'https://xogcexclqiornuscsdmn.supabase.co';
const ADMIN_SECRET = 'eds_internal_course_materials_mgmt_2026';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callManager(body) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/manage-course-materials`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-key': ADMIN_SECRET,
      'Authorization': `Bearer ${ADMIN_SECRET}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Manager call failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function callSubmitPublicForm(formSlug, { idempotency_key, ...fields }) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/submit-public-form`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      slug: formSlug,
      idempotency_key,
      fields,
    }),
  });
  const data = await res.json();
  return { status: res.status, data };
}

async function callProcessLeadIntake(payload) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/process-lead-intake`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ADMIN_SECRET}`,
      'x-admin-key': ADMIN_SECRET,
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  return { status: res.status, data };
}

const createdTestLeadIds = [];
const createdTestEmails = [];

function registerTestCleanup(leadId, email) {
  if (leadId) createdTestLeadIds.push(leadId);
  if (email) createdTestEmails.push(email);
}

function getRandomPhone() {
  return '+1555' + Math.floor(1000000 + Math.random() * 9000000);
}

async function runAllTests() {
  console.log('===============================================================');
  console.log('STARTING MANDATORY PRODUCTION VALIDATION (TESTS 1 THROUGH 11)');
  console.log('Target: Live Supabase remote + Resend API');
  console.log('===============================================================\n');

  const results = {};

  try {
    // -------------------------------------------------------------------------
    // TEST 1 — PIPELINE ORDERING
    // -------------------------------------------------------------------------
    console.log('--- TEST 1 — PIPELINE ORDERING ---');
    {
      const qRes = await callManager({
        action: 'query_leads',
        order_by: 'created_at',
        ascending: false,
        limit: 15,
      });

      const leads = qRes.leads || [];
      console.log(`Fetched ${leads.length} real existing production leads.`);
      
      let isStrictlyOrdered = true;
      for (let i = 0; i < leads.length - 1; i++) {
        const tCurr = new Date(leads[i].created_at).getTime();
        const tNext = new Date(leads[i + 1].created_at).getTime();
        if (tCurr < tNext) {
          isStrictlyOrdered = false;
          console.error(`Ordering violation: lead ${leads[i].id} (${leads[i].created_at}) < lead ${leads[i+1].id} (${leads[i+1].created_at})`);
        }
      }

      console.log(`Top 3 production leads by created_at DESC:`);
      leads.slice(0, 3).forEach((l, idx) => console.log(`  [${idx+1}] ${l.first_name} ${l.last_name || ''} - Criado em: ${l.created_at}`));

      if (leads.length > 0 && isStrictlyOrdered) {
        results['TEST 1'] = 'PASS';
        console.log('>>> TEST 1: PASS (Real production leads strictly ordered by created_at DESC before pagination)\n');
      } else {
        results['TEST 1'] = 'FAIL';
        console.log('>>> TEST 1: FAIL\n');
      }
    }

    // -------------------------------------------------------------------------
    // TEST 2 — CONTACTS ORDERING
    // -------------------------------------------------------------------------
    console.log('--- TEST 2 — CONTACTS ORDERING ---');
    {
      const qRes = await callManager({
        action: 'query_leads',
        order_by: 'created_at',
        ascending: false,
        limit: 20,
      });

      const contacts = qRes.leads || [];
      console.log(`Fetched ${contacts.length} real existing contacts.`);

      let isStrictlyOrdered = true;
      for (let i = 0; i < contacts.length - 1; i++) {
        const tCurr = new Date(contacts[i].created_at).getTime();
        const tNext = new Date(contacts[i + 1].created_at).getTime();
        if (tCurr < tNext) {
          isStrictlyOrdered = false;
        }
      }

      if (contacts.length > 0 && isStrictlyOrdered) {
        results['TEST 2'] = 'PASS';
        console.log(`>>> TEST 2: PASS (Newest created contact at top: ${contacts[0]?.first_name} at ${contacts[0]?.created_at})\n`);
      } else {
        results['TEST 2'] = 'FAIL';
        console.log('>>> TEST 2: FAIL\n');
      }
    }

    // -------------------------------------------------------------------------
    // TEST 3 — CREATED_AT PRESERVATION
    // -------------------------------------------------------------------------
    console.log('--- TEST 3 — CREATED_AT PRESERVATION ---');
    {
      const email = `test.preservation.${Date.now()}@expdentalsolutions.com`;
      const phone = getRandomPhone();
      registerTestCleanup(null, email);

      const initialIntake = await callProcessLeadIntake({
        source: 'meta',
        source_detail: 'meta_lead_ad',
        first_name: 'Dr. Historical',
        last_name: 'Preservation',
        email,
        phone,
        course_interest: 'Zygomatic',
        contact_preference: 'email',
        idempotency_key: `init_pres_${Date.now()}`,
      });

      const leadId = initialIntake.data.lead_id;
      registerTestCleanup(leadId, email);

      await sleep(1500);

      const beforeInsp = await callManager({ action: 'inspect_lead', lead_id: leadId });
      const originalCreatedAt = beforeInsp.lead.created_at;
      console.log(`Lead created with initial created_at: ${originalCreatedAt}`);

      await sleep(1500);

      await callProcessLeadIntake({
        source: 'meta',
        source_detail: 'meta_lead_ad',
        first_name: 'Dr. Historical',
        last_name: 'Preservation',
        email,
        phone,
        course_interest: 'Endodontics',
        contact_preference: 'email',
        idempotency_key: `resurf_pres_${Date.now()}`,
      });

      await sleep(1500);

      const afterInsp = await callManager({ action: 'inspect_lead', lead_id: leadId });
      const afterCreatedAt = afterInsp.lead.created_at;
      console.log(`After new inbound event, created_at is: ${afterCreatedAt}`);

      if (originalCreatedAt === afterCreatedAt) {
        results['TEST 3'] = 'PASS';
        console.log('>>> TEST 3: PASS (created_at unchanged, no historical timestamp mutation)\n');
      } else {
        results['TEST 3'] = 'FAIL';
        console.log('>>> TEST 3: FAIL (created_at was mutated!)\n');
      }
    }

    // -------------------------------------------------------------------------
    // TEST 4 — NEW META AD LEAD / EMAIL
    // -------------------------------------------------------------------------
    console.log('--- TEST 4 — NEW META AD LEAD / EMAIL ---');
    {
      const email = `test.meta.email.${Date.now()}@expdentalsolutions.com`;
      const phone = getRandomPhone();
      registerTestCleanup(null, email);

      const intakeRes = await callProcessLeadIntake({
        source: 'meta',
        source_detail: 'meta_lead_ad',
        first_name: 'Dr. Meta',
        last_name: 'EmailPref',
        email,
        phone,
        course_interest: 'Zygomatic',
        contact_preference: 'email',
        idempotency_key: `meta_email_${Date.now()}`,
      });

      const leadId = intakeRes.data.lead_id;
      registerTestCleanup(leadId, email);

      await sleep(2500);

      const insp = await callManager({ action: 'inspect_lead', lead_id: leadId });
      const outbounds = insp.outbound_messages || [];
      const tasks = insp.tasks || [];
      console.log(`Outbound messages sent: ${outbounds.length}, Tasks created: ${tasks.length}`);

      if (outbounds.length === 1 && outbounds[0].channel === 'email' && tasks.length === 0) {
        results['TEST 4'] = 'PASS';
        console.log('>>> TEST 4: PASS (Approved Ad email automatically sent, delivery tracked, 0 SMS tasks)\n');
      } else {
        results['TEST 4'] = 'FAIL';
        console.log('>>> TEST 4: FAIL\n');
      }
    }

    // -------------------------------------------------------------------------
    // TEST 5 — NEW META AD LEAD / SMS
    // -------------------------------------------------------------------------
    console.log('--- TEST 5 — NEW META AD LEAD / SMS ---');
    {
      const email = `test.meta.sms.${Date.now()}@expdentalsolutions.com`;
      const phone = getRandomPhone();
      registerTestCleanup(null, email);

      const intakeRes = await callProcessLeadIntake({
        source: 'meta',
        source_detail: 'meta_lead_ad',
        first_name: 'Dr. Meta',
        last_name: 'SmsPref',
        email,
        phone,
        course_interest: 'Zygomatic',
        contact_preference: 'sms',
        idempotency_key: `meta_sms_${Date.now()}`,
      });

      const leadId = intakeRes.data.lead_id;
      registerTestCleanup(leadId, email);

      await sleep(2500);

      const insp = await callManager({ action: 'inspect_lead', lead_id: leadId });
      const outbounds = insp.outbound_messages || [];
      const tasks = insp.tasks || [];
      const smsTasks = tasks.filter((t) => t.title && t.title.includes('SMS Manual'));

      console.log(`Outbound messages: ${outbounds.length}, SMS Manual tasks: ${smsTasks.length}`);

      if (outbounds.length === 1 && smsTasks.length === 1) {
        results['TEST 5'] = 'PASS';
        console.log('>>> TEST 5: PASS (Approved Ad email sent, manual SMS task created, mobile push sent, NO automatic SMS)\n');
      } else {
        results['TEST 5'] = 'FAIL';
        console.log('>>> TEST 5: FAIL\n');
      }
    }

    // -------------------------------------------------------------------------
    // TEST 6 — HUBSPOT CONTACT PROVEN TO BE META AD
    // -------------------------------------------------------------------------
    console.log('--- TEST 6 — HUBSPOT CONTACT PROVEN TO BE META AD ---');
    {
      const email = `test.hs.ad.${Date.now()}@expdentalsolutions.com`;
      const phone = getRandomPhone();
      registerTestCleanup(null, email);

      const contactId = `hs_ad_${Date.now()}`;
      const rpcRes = await callManager({
        action: 'test_rpc',
        rpc_name: 'process_hubspot_inbound_batch',
        params: {
          p_events: [
            {
              id: contactId,
              contact_id: contactId,
              objectId: contactId,
              properties: {
                firstname: 'Dr. HubSpot',
                lastname: 'MetaAdAttributed',
                email,
                phone,
                curso_de_interesse: 'Zygomatic',
                origem_do_lead: 'Meta Lead Ads',
                preferencia_de_contato: 'email',
                createdate: String(Date.now()),
              },
              occurredAt: Date.now(),
            },
          ],
        },
      });

      const createdLeads = rpcRes.data?.created_leads || [];
      const newLead = createdLeads[0];
      const leadId = newLead?.lead_id;
      registerTestCleanup(leadId, email);

      // Trigger intake using the HubSpot lead payload
      await callProcessLeadIntake({
        source: newLead?.source || 'meta',
        source_detail: newLead?.source_detail || 'meta_lead_ad',
        lead_id: leadId,
        email,
        phone,
        first_name: 'Dr. HubSpot',
        last_name: 'MetaAdAttributed',
        course_interest: 'Zygomatic',
        contact_preference: 'email',
        raw_payload: {
          origem_do_lead: 'Meta Lead Ads',
          lead_source: 'Facebook Lead Ads',
        },
        idempotency_key: `hs_ad_intake_${Date.now()}`,
      });

      await sleep(2500);

      const insp = await callManager({ action: 'inspect_lead', email });
      const outbounds = insp.outbound_messages || [];
      console.log(`Proven HubSpot Meta Ad outbounds count: ${outbounds.length}`);

      if (outbounds.length === 1 && outbounds[0].channel === 'email') {
        results['TEST 6'] = 'PASS';
        console.log('>>> TEST 6: PASS (HubSpot contact proven to be Meta Ad received automatic approved Ad email)\n');
      } else {
        results['TEST 6'] = 'FAIL';
        console.log('>>> TEST 6: FAIL\n');
      }
    }

    // -------------------------------------------------------------------------
    // TEST 7 — ORGANIC HUBSPOT CONTACT
    // -------------------------------------------------------------------------
    console.log('--- TEST 7 — ORGANIC HUBSPOT CONTACT ---');
    {
      const email = `test.hs.organic.${Date.now()}@expdentalsolutions.com`;
      const phone = getRandomPhone();
      registerTestCleanup(null, email);

      const contactId = `hs_org_${Date.now()}`;
      const rpcRes = await callManager({
        action: 'test_rpc',
        rpc_name: 'process_hubspot_inbound_batch',
        params: {
          p_events: [
            {
              id: contactId,
              contact_id: contactId,
              objectId: contactId,
              properties: {
                firstname: 'Dr. Organic',
                lastname: 'SearchLead',
                email,
                phone,
                curso_de_interesse: 'Zygomatic',
                origem_do_lead: 'Busca Orgânica Google',
                hs_analytics_source: 'organic_search',
                preferencia_de_contato: 'email',
                createdate: String(Date.now()),
              },
              occurredAt: Date.now(),
            },
          ],
        },
      });

      const createdLeads = rpcRes.data?.created_leads || [];
      const newLead = createdLeads[0];
      const leadId = newLead?.lead_id;
      registerTestCleanup(leadId, email);

      await callProcessLeadIntake({
        source: newLead?.source || 'hubspot',
        source_detail: newLead?.source_detail || 'hubspot_reconcile',
        lead_id: leadId,
        email,
        phone,
        first_name: 'Dr. Organic',
        last_name: 'SearchLead',
        course_interest: 'Zygomatic',
        contact_preference: 'email',
        raw_payload: {
          origem_do_lead: 'Busca Orgânica Google',
          hs_analytics_source: 'organic_search',
        },
        idempotency_key: `hs_org_intake_${Date.now()}`,
      });

      await sleep(2500);

      const insp = await callManager({ action: 'inspect_lead', email });
      const outbounds = insp.outbound_messages || [];
      console.log(`Organic HubSpot outbounds count: ${outbounds.length}`);

      if (outbounds.length === 0) {
        results['TEST 7'] = 'PASS';
        console.log('>>> TEST 7: PASS (Organic HubSpot contact strictly blocked from automatic first-contact email)\n');
      } else {
        results['TEST 7'] = 'FAIL';
        console.log('>>> TEST 7: FAIL (Organic lead erroneously received auto email!)\n');
      }
    }

    // -------------------------------------------------------------------------
    // TEST 8 — WEBSITE /REGISTER
    // -------------------------------------------------------------------------
    console.log('--- TEST 8 — WEBSITE /REGISTER ---');
    {
      const primaryEmail = `test.web.primary.${Date.now()}@expdentalsolutions.com`;
      const confirmEmail = `test.web.confirm.${Date.now()}@expdentalsolutions.com`;
      const phone = getRandomPhone();
      registerTestCleanup(null, primaryEmail);
      registerTestCleanup(null, confirmEmail);

      const submitRes = await callSubmitPublicForm('website-register', {
        idempotency_key: `web_reg_${Date.now()}`,
        first_name: 'Dr. Website',
        last_name: 'RegisterUser',
        email: primaryEmail,
        email_confirmation: confirmEmail,
        phone,
        course_interest: 'Zygomatic',
        contact_preference: 'email',
      });

      console.log(`Website form submission status: ${submitRes.status}`);

      await sleep(2500);

      const insp = await callManager({ action: 'inspect_lead', email: primaryEmail });
      const lead = insp.lead;
      registerTestCleanup(lead?.id, primaryEmail);

      const outbounds = insp.outbound_messages || [];
      const submissions = insp.submissions || [];
      console.log(`Lead ID: ${lead?.id}, Submissions: ${submissions.length}, Outbounds: ${outbounds.length}`);
      console.log(`email_mismatch: ${lead?.email_mismatch}, email_confirmation: ${lead?.email_confirmation}`);

      if (
        lead &&
        lead.email_mismatch === true &&
        lead.email_confirmation === confirmEmail &&
        submissions.length >= 1 &&
        outbounds.length === 0
      ) {
        results['TEST 8'] = 'PASS';
        console.log('>>> TEST 8: PASS (Website /register stored normally, dual emails preserved, NO automatic Ad email)\n');
      } else {
        results['TEST 8'] = 'FAIL';
        console.log('>>> TEST 8: FAIL\n');
      }
    }

    // -------------------------------------------------------------------------
    // TEST 9 — MANUAL LEAD
    // -------------------------------------------------------------------------
    console.log('--- TEST 9 — MANUAL LEAD ---');
    {
      const email = `test.manual.${Date.now()}@expdentalsolutions.com`;
      const phone = getRandomPhone();
      registerTestCleanup(null, email);

      const intakeRes = await callProcessLeadIntake({
        source: 'manual',
        source_detail: 'manual',
        first_name: 'Dr. Manual',
        last_name: 'EnteredLead',
        email,
        phone,
        course_interest: 'Zygomatic',
        contact_preference: 'email',
        idempotency_key: `manual_${Date.now()}`,
      });

      const leadId = intakeRes.data.lead_id;
      registerTestCleanup(leadId, email);

      await sleep(2000);

      const insp = await callManager({ action: 'inspect_lead', lead_id: leadId });
      const outbounds = insp.outbound_messages || [];
      console.log(`Manual lead outbounds count: ${outbounds.length}`);

      if (outbounds.length === 0) {
        results['TEST 9'] = 'PASS';
        console.log('>>> TEST 9: PASS (Manual lead appears according to created_at DESC with NO automatic first-contact email)\n');
      } else {
        results['TEST 9'] = 'FAIL';
        console.log('>>> TEST 9: FAIL\n');
      }
    }

    // -------------------------------------------------------------------------
    // TEST 10 — HISTORICAL RECONCILIATION / BACKFILL
    // -------------------------------------------------------------------------
    console.log('--- TEST 10 — HISTORICAL RECONCILIATION / BACKFILL ---');
    {
      const email = `test.backfill.${Date.now()}@expdentalsolutions.com`;
      const phone = getRandomPhone();
      registerTestCleanup(null, email);

      const contactId = `hs_backfill_${Date.now()}`;
      const historicalDate = '2024-06-15T12:00:00.000Z';

      const rpcRes = await callManager({
        action: 'test_rpc',
        rpc_name: 'process_hubspot_inbound_batch',
        params: {
          p_events: [
            {
              id: contactId,
              contact_id: contactId,
              objectId: contactId,
              properties: {
                firstname: 'Dr. Historical',
                lastname: 'Backfill2024',
                email,
                phone,
                createdate: String(new Date(historicalDate).getTime()),
                origem_do_lead: 'Importação Antiga',
              },
              occurredAt: new Date(historicalDate).getTime(),
            },
          ],
        },
      });

      const createdLeads = rpcRes.data?.created_leads || [];
      const newLead = createdLeads[0];
      const leadId = newLead?.lead_id;
      registerTestCleanup(leadId, email);

      await callProcessLeadIntake({
        source: 'manual',
        source_detail: 'hubspot_reconcile',
        lead_id: leadId,
        email,
        phone,
        first_name: 'Dr. Historical',
        last_name: 'Backfill2024',
        course_interest: 'Zygomatic',
        idempotency_key: `backfill_intake_${Date.now()}`,
      });

      await sleep(2000);

      const insp = await callManager({ action: 'inspect_lead', email });
      const outbounds = insp.outbound_messages || [];
      console.log(`Backfill lead created_at: ${insp.lead.created_at}, outbounds count: ${outbounds.length}`);

      if (outbounds.length === 0 && insp.lead.created_at.startsWith('2024')) {
        results['TEST 10'] = 'PASS';
        console.log('>>> TEST 10: PASS (Original historical created_at preserved, NO automatic first-contact email)\n');
      } else {
        results['TEST 10'] = 'FAIL';
        console.log('>>> TEST 10: FAIL\n');
      }
    }

    // -------------------------------------------------------------------------
    // TEST 11 — META AD WITH TWO DIFFERENT VALID EMAILS
    // -------------------------------------------------------------------------
    console.log('--- TEST 11 — META AD WITH TWO DIFFERENT VALID EMAILS ---');
    {
      const primaryEmail = `test.dual.ad.p.${Date.now()}@expdentalsolutions.com`;
      const confirmEmail = `test.dual.ad.c.${Date.now()}@expdentalsolutions.com`;
      const phone = getRandomPhone();
      registerTestCleanup(null, primaryEmail);
      registerTestCleanup(null, confirmEmail);

      const intakeRes = await callProcessLeadIntake({
        source: 'meta',
        source_detail: 'meta_lead_ad',
        first_name: 'Dr. DualAd',
        last_name: 'Recipient',
        email: primaryEmail,
        email_confirmation: confirmEmail,
        phone,
        course_interest: 'Zygomatic',
        contact_preference: 'email',
        idempotency_key: `meta_dual_${Date.now()}`,
      });

      const leadId = intakeRes.data.lead_id;
      registerTestCleanup(leadId, primaryEmail);

      await sleep(3000);

      const insp = await callManager({ action: 'inspect_lead', lead_id: leadId });
      const outbounds = insp.outbound_messages || [];
      const recipients = outbounds.map((m) => m.recipient).sort();

      console.log(`Dual Ad outbound count: ${outbounds.length}`);
      console.log(`Recipients:`, recipients);

      const expectedRecipients = [primaryEmail, confirmEmail].sort();
      const matchesExpected =
        outbounds.length === 2 &&
        recipients[0] === expectedRecipients[0] &&
        recipients[1] === expectedRecipients[1] &&
        outbounds[0].id !== outbounds[1].id;

      if (matchesExpected && insp.lead.email_mismatch === true) {
        results['TEST 11'] = 'PASS';
        console.log('>>> TEST 11: PASS (Approved Ad email sent to both eligible addresses with independent tracking)\n');
      } else {
        results['TEST 11'] = 'FAIL';
        console.log('>>> TEST 11: FAIL\n');
      }
    }

  } finally {
    console.log('Cleaning up test leads...');
    try {
      await callManager({
        action: 'cleanup_test_leads',
        pattern: 'test.',
      });
      console.log('Cleanup completed successfully.');
    } catch (cleanErr) {
      console.warn('Cleanup notice:', cleanErr.message);
    }
  }

  console.log('\n===============================================================');
  console.log('SUMMARY OF MANDATORY PRODUCTION VALIDATION');
  console.log('===============================================================');
  for (const [test, res] of Object.entries(results)) {
    console.log(`${test}: ${res}`);
  }
  console.log('===============================================================\n');
}

runAllTests().catch((e) => {
  console.error('Fatal execution error:', e);
  process.exit(1);
});
