import { useState, useEffect, useCallback, useId } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Layout } from '../../components/Layout';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';
import { BlockEditor } from '../editor/BlockEditor';
import type { EmailBlock } from '../editor/types';
import type {
  Campaign,
  CampaignStatus,
  CampaignVersion,
  CampaignRecipient,
  PipelineStage,
  Tag,
} from '../../types';
import {
  ArrowLeft,
  Mail,
  Save,
  Send,
  CheckCircle2,
  AlertCircle,
  Clock,
  Calendar,
  Layers,
  Users,
  FlaskConical,
  RotateCw,
  History,
  Check,
  ShieldCheck,
  XCircle,
} from 'lucide-react';

type TabType = 'editor' | 'audience' | 'ab_test' | 'versions' | 'recipients' | 'send';

export function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>('editor');

  // Loading & Action states
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Campaign Header & Details
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [previewText, setPreviewText] = useState('');
  const [fromName, setFromName] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [scheduledAt, setScheduledAt] = useState<string>('');

  // Content Blocks & HTML
  const [blocks, setBlocks] = useState<EmailBlock[]>([]);
  const [htmlContent, setHtmlContent] = useState('');
  const [textContent, setTextContent] = useState('');

  // Versions
  const [versions, setVersions] = useState<CampaignVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);

  // Audience
  const [selectedStageIds, setSelectedStageIds] = useState<string[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [selectedSource, setSelectedSource] = useState<string>('');
  const [selectedPref, setSelectedPref] = useState<string>('');
  const [estimatedCount, setEstimatedCount] = useState<number>(0);
  const [isEstimating, setIsEstimating] = useState(false);

  // A/B Variants
  const [hasABTest, setHasABTest] = useState(false);
  const [variantASubject, setVariantASubject] = useState('');
  const [variantAPercent, setVariantAPercent] = useState(50);
  const [variantBSubject, setVariantBSubject] = useState('');
  const [variantBPercent, setVariantBPercent] = useState(50);

  // Test Send
  const [testEmail, setTestEmail] = useState('');
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Prepare & Batch Send
  const [recipients, setRecipients] = useState<CampaignRecipient[]>([]);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isSendingBatch, setIsSendingBatch] = useState(false);
  const [batchStats, setBatchStats] = useState<{
    sent: number;
    failed: number;
    remaining: number;
  } | null>(null);

  const testEmailInputId = useId();

  const loadCampaignData = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    setError(null);

    try {
      // 1. Fetch Campaign
      const { data: camp, error: campErr } = await supabase
        .from('campaigns')
        .select('*')
        .eq('id', id)
        .single();

      if (campErr || !camp) throw campErr || new Error('Campaign not found');

      setCampaign(camp);
      setName(camp.name);
      setSubject(camp.subject || '');
      setPreviewText(camp.preview_text || '');
      setFromName(camp.from_name || 'Expert Dental Solutions');
      setReplyTo(camp.reply_to || '');
      setScheduledAt(camp.scheduled_at ? new Date(camp.scheduled_at).toISOString().slice(0, 16) : '');

      // 2. Fetch Reference data
      const [stagesRes, tagsRes] = await Promise.all([
        supabase.from('pipeline_stages').select('*').order('sort_order', { ascending: true }),
        supabase.from('tags').select('*').order('name', { ascending: true }),
      ]);
      if (stagesRes.data) setStages(stagesRes.data);
      if (tagsRes.data) setTags(tagsRes.data);

      // 3. Fetch Versions
      const { data: vers } = await supabase
        .from('campaign_versions')
        .select('*')
        .eq('campaign_id', id)
        .order('version_number', { ascending: false });

      if (vers && vers.length > 0) {
        setVersions(vers);
        const latest = vers[0];
        setSelectedVersionId(latest.id);
        if (Array.isArray(latest.content_json) && latest.content_json.length > 0) {
          setBlocks(latest.content_json as EmailBlock[]);
        }
        setHtmlContent(latest.html_snapshot || '');
        setTextContent(latest.text_snapshot || '');
      }

      // 4. Fetch Audience
      const { data: aud } = await supabase
        .from('campaign_audiences')
        .select('*')
        .eq('campaign_id', id)
        .maybeSingle();

      if (aud) {
        const def = (aud.filter_definition as Record<string, unknown>) || {};
        if (Array.isArray(def.pipeline_stage_id)) setSelectedStageIds(def.pipeline_stage_id);
        else if (def.pipeline_stage_id) setSelectedStageIds([def.pipeline_stage_id as string]);

        if (Array.isArray(def.tag_ids)) setSelectedTagIds(def.tag_ids as string[]);
        if (def.source) setSelectedSource(def.source as string);
        if (def.contact_preference) setSelectedPref(def.contact_preference as string);
        setEstimatedCount(aud.estimated_recipient_count || 0);
      }

      // 5. Fetch Variants
      const { data: vars } = await supabase
        .from('campaign_variants')
        .select('*')
        .eq('campaign_id', id)
        .order('variant_key', { ascending: true });

      if (vars && vars.length >= 2) {
        setHasABTest(true);
        const a = vars.find((v) => v.variant_key === 'A');
        const b = vars.find((v) => v.variant_key === 'B');
        if (a) {
          setVariantASubject(a.subject);
          setVariantAPercent(Number(a.traffic_percentage) || 50);
        }
        if (b) {
          setVariantBSubject(b.subject);
          setVariantBPercent(Number(b.traffic_percentage) || 50);
        }
      } else {
        setVariantASubject(camp.subject);
        setVariantBSubject(camp.subject);
      }

      // 6. Fetch materialized recipients if campaign was prepared
      const { data: recs } = await supabase
        .from('campaign_recipients')
        .select('*')
        .eq('campaign_id', id)
        .order('created_at', { ascending: true })
        .limit(100);

      if (recs) setRecipients(recs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load campaign');
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadCampaignData();
  }, [loadCampaignData]);

  // Calculate estimated recipients based on current audience filters
  const calculateEstimatedAudience = useCallback(async () => {
    setIsEstimating(true);
    try {
      let query = supabase.from('leads').select('id, email', { count: 'exact' }).not('email', 'is', null);

      if (selectedStageIds.length > 0) {
        query = query.in('pipeline_stage_id', selectedStageIds);
      }
      if (selectedSource) {
        query = query.eq('source', selectedSource);
      }
      if (selectedPref) {
        query = query.eq('contact_preference', selectedPref);
      }

      const { data, count, error: countErr } = await query;
      if (countErr) throw countErr;

      let validCount = count || 0;

      // Filter by tag links if tag filters selected
      if (selectedTagIds.length > 0 && data && data.length > 0) {
        const leadIds = data.map((l) => l.id);
        const { data: tagMatches } = await supabase
          .from('lead_tags')
          .select('lead_id')
          .in('tag_id', selectedTagIds)
          .in('lead_id', leadIds);

        const matchingIds = new Set((tagMatches || []).map((t) => t.lead_id));
        validCount = data.filter((l) => matchingIds.has(l.id)).length;
      }

      setEstimatedCount(validCount);
    } catch (err) {
      console.error('Error calculating audience:', err);
    } finally {
      setIsEstimating(false);
    }
  }, [selectedStageIds, selectedTagIds, selectedSource, selectedPref]);

  useEffect(() => {
    if (!isLoading) {
      calculateEstimatedAudience();
    }
  }, [calculateEstimatedAudience, isLoading]);

  // Save campaign details & create new version
  const handleSaveCampaign = async () => {
    if (!campaign) return;
    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      // 1. Update campaign master fields
      const { error: campUpdateErr } = await supabase
        .from('campaigns')
        .update({
          name: name.trim(),
          subject: subject.trim(),
          preview_text: previewText.trim() || null,
          from_name: fromName.trim() || 'Expert Dental Solutions',
          reply_to: replyTo.trim() || null,
          scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', campaign.id);

      if (campUpdateErr) throw campUpdateErr;

      // 2. Insert new version (never silently overwrite previous versions)
      const nextVersionNumber = (versions[0]?.version_number || 0) + 1;
      const { data: newVer, error: verErr } = await supabase
        .from('campaign_versions')
        .insert({
          campaign_id: campaign.id,
          version_number: nextVersionNumber,
          subject: subject.trim(),
          preview_text: previewText.trim() || null,
          content_json: blocks,
          html_snapshot: htmlContent,
          text_snapshot: textContent,
        })
        .select()
        .single();

      if (verErr) throw verErr;

      // 3. Save audience filters
      const filterDef: Record<string, unknown> = {};
      if (selectedStageIds.length > 0) filterDef.pipeline_stage_id = selectedStageIds;
      if (selectedTagIds.length > 0) filterDef.tag_ids = selectedTagIds;
      if (selectedSource) filterDef.source = selectedSource;
      if (selectedPref) filterDef.contact_preference = selectedPref;

      await supabase.from('campaign_audiences').upsert(
        {
          campaign_id: campaign.id,
          filter_definition: filterDef,
          estimated_recipient_count: estimatedCount,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'campaign_id' },
      );

      // 4. Save A/B variants if active
      if (hasABTest) {
        if (variantAPercent + variantBPercent !== 100) {
          throw new Error('A/B traffic percentages must sum to exactly 100%');
        }

        await supabase.from('campaign_variants').upsert([
          {
            campaign_id: campaign.id,
            variant_key: 'A',
            subject: variantASubject || subject,
            content_json: blocks,
            html_snapshot: htmlContent,
            traffic_percentage: variantAPercent,
            updated_at: new Date().toISOString(),
          },
          {
            campaign_id: campaign.id,
            variant_key: 'B',
            subject: variantBSubject || subject,
            content_json: blocks,
            html_snapshot: htmlContent,
            traffic_percentage: variantBPercent,
            updated_at: new Date().toISOString(),
          },
        ]);
      } else {
        await supabase.from('campaign_variants').delete().eq('campaign_id', campaign.id);
      }

      setVersions([newVer, ...versions]);
      setSelectedVersionId(newVer.id);
      setSuccessMessage(`Campaign saved successfully! (Version ${nextVersionNumber} snapshot created)`);
      setCampaign({ ...campaign, name, subject, preview_text: previewText, from_name: fromName, reply_to: replyTo });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error saving campaign');
    } finally {
      setIsSaving(false);
    }
  };

  // Approval Action: Enforce workflow Draft -> Pending Approval -> Approved
  const handleTransitionStatus = async (newStatus: CampaignStatus) => {
    if (!campaign) return;
    setError(null);
    try {
      const updatePayload: Partial<Campaign> = {
        status: newStatus,
        updated_at: new Date().toISOString(),
      };

      if (newStatus === 'approved') {
        updatePayload.approved_at = new Date().toISOString();
      }

      const { error: upErr } = await supabase
        .from('campaigns')
        .update(updatePayload)
        .eq('id', campaign.id);

      if (upErr) throw upErr;

      setCampaign({ ...campaign, ...updatePayload });
      setSuccessMessage(`Campaign status successfully changed to '${newStatus.replace('_', ' ')}'`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error updating campaign status');
    }
  };

  // Send Test Email via Edge Function
  const handleSendTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testEmail.trim() || !campaign) return;
    setIsSendingTest(true);
    setTestResult(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/campaign-test-send`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token || ''}`,
          },
          body: JSON.stringify({
            campaign_id: campaign.id,
            test_email: testEmail.trim().toLowerCase(),
            subject,
            html_content: htmlContent,
            version_id: selectedVersionId,
          }),
        },
      );

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to send test email');

      setTestResult({
        success: true,
        message: `Test email sent to ${testEmail}! Provider Message ID: ${json.messageId || 'OK'}`,
      });
    } catch (err) {
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : 'Error sending test email',
      });
    } finally {
      setIsSendingTest(false);
    }
  };

  // Prepare Campaign (Materialize Recipients)
  const handlePrepareCampaign = async () => {
    if (!campaign) return;
    setIsPreparing(true);
    setError(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/campaign-prepare`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token || ''}`,
          },
          body: JSON.stringify({
            campaign_id: campaign.id,
          }),
        },
      );

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to prepare campaign');

      setSuccessMessage(
        `Audience prepared! ${json.recipients_materialized} unique recipients materialized in 'pending' status.`,
      );

      // Refresh recipients list
      const { data: recs } = await supabase
        .from('campaign_recipients')
        .select('*')
        .eq('campaign_id', campaign.id)
        .order('created_at', { ascending: true })
        .limit(100);

      if (recs) setRecipients(recs);
      setActiveTab('send');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error preparing campaign');
    } finally {
      setIsPreparing(false);
    }
  };

  // Dispatch Batch Send via Edge Function
  const handleDispatchBatch = async () => {
    if (!campaign) return;
    setIsSendingBatch(true);
    setError(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/campaign-send-batch`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token || ''}`,
          },
          body: JSON.stringify({
            campaign_id: campaign.id,
            batch_size: 25,
          }),
        },
      );

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to dispatch batch');

      setBatchStats({
        sent: json.sent || 0,
        failed: json.failed || 0,
        remaining: json.remaining_pending || 0,
      });

      if (json.campaign_status) {
        setCampaign({ ...campaign, status: json.campaign_status });
      }

      // Refresh recipients
      const { data: recs } = await supabase
        .from('campaign_recipients')
        .select('*')
        .eq('campaign_id', campaign.id)
        .order('created_at', { ascending: true })
        .limit(100);

      if (recs) setRecipients(recs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error sending batch');
    } finally {
      setIsSendingBatch(false);
    }
  };

  if (isLoading) {
    return (
      <Layout title="Campaign Details">
        <LoadingState message="Loading campaign details..." />
      </Layout>
    );
  }

  if (error && !campaign) {
    return (
      <Layout title="Campaign Details">
        <ErrorState message={error} onRetry={loadCampaignData} />
      </Layout>
    );
  }

  if (!campaign) return null;

  const getStatusBadge = (status: CampaignStatus) => {
    switch (status) {
      case 'draft':
        return (
          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-700">
            Draft
          </span>
        );
      case 'pending_approval':
        return (
          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-amber-100 text-amber-800 flex items-center gap-1">
            <Clock className="h-3 w-3" /> Pending Approval
          </span>
        );
      case 'approved':
        return (
          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800 flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" /> Approved
          </span>
        );
      case 'scheduled':
        return (
          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-purple-100 text-purple-800 flex items-center gap-1">
            <Calendar className="h-3 w-3" /> Scheduled
          </span>
        );
      case 'sending':
        return (
          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-indigo-100 text-indigo-800 flex items-center gap-1">
            <RotateCw className="h-3 w-3 animate-spin" /> Sending
          </span>
        );
      case 'sent':
        return (
          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-800 flex items-center gap-1">
            <Check className="h-3 w-3" /> Sent
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-700">
            {status}
          </span>
        );
    }
  };

  return (
    <Layout title={`Campaign: ${campaign.name}`}>
      <div className="space-y-6 max-w-7xl mx-auto pb-12">
        {/* Top Breadcrumb & Status Action Bar */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-white p-5 rounded-2xl border border-gray-200 shadow-xs">
          <div className="flex items-center gap-3">
            <Link
              to="/campaigns"
              className="p-2 rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-900 transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-bold text-gray-900">{campaign.name}</h1>
                {getStatusBadge(campaign.status)}
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                Channel: Email • Created {new Date(campaign.created_at).toLocaleDateString()}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Status transitions */}
            {campaign.status === 'draft' && (
              <button
                onClick={() => handleTransitionStatus('pending_approval')}
                className="px-3.5 py-2 text-xs font-semibold rounded-xl bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <Clock className="h-3.5 w-3.5" /> Submit for Approval
              </button>
            )}

            {(campaign.status === 'draft' || campaign.status === 'pending_approval') && (
              <button
                onClick={() => handleTransitionStatus('approved')}
                className="px-3.5 py-2 text-xs font-semibold rounded-xl bg-blue-600 text-white hover:bg-blue-700 shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <ShieldCheck className="h-3.5 w-3.5" /> Approve Campaign
              </button>
            )}

            <button
              onClick={handleSaveCampaign}
              disabled={isSaving}
              className="px-4 py-2 text-xs font-semibold rounded-xl bg-brand-600 text-white hover:bg-brand-700 shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              {isSaving ? 'Saving...' : 'Save & Snapshot Version'}
            </button>
          </div>
        </div>

        {/* Feedback alerts */}
        {error && (
          <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm flex items-center gap-2">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {successMessage && (
          <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Campaign Header Settings Bar */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-xs space-y-4">
          <h2 className="text-sm font-bold text-gray-900 tracking-tight uppercase text-gray-400">
            Envelope & Delivery Settings
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Subject Line</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="e.g. Exclusive Invitation for {{salutation}}"
                className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Preview Text</label>
              <input
                type="text"
                value={previewText}
                onChange={(e) => setPreviewText(e.target.value)}
                placeholder="Inbox preheader text..."
                className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">From Name</label>
              <input
                type="text"
                value={fromName}
                onChange={(e) => setFromName(e.target.value)}
                placeholder="Expert Dental Solutions"
                className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Reply-To (Optional)</label>
              <input
                type="email"
                value={replyTo}
                onChange={(e) => setReplyTo(e.target.value)}
                placeholder="support@expdentalsolutions.com"
                className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl focus:ring-1 focus:ring-brand-500"
              />
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-gray-200 gap-2 bg-white px-4 pt-3 rounded-t-2xl">
          {[
            { id: 'editor', label: 'Content Editor', icon: Mail },
            { id: 'audience', label: `Audience (${estimatedCount})`, icon: Users },
            { id: 'ab_test', label: 'A/B Testing', icon: FlaskConical },
            { id: 'versions', label: `Versions (${versions.length})`, icon: History },
            { id: 'send', label: 'Test & Send Execution', icon: Send },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id as TabType)}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-all cursor-pointer ${
                activeTab === t.id
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-gray-500 hover:text-gray-900 hover:border-gray-200'
              }`}
            >
              <t.icon className="h-4 w-4" />
              {t.label}
            </button>
          ))}
        </div>

        {/* TAB 1: Visual Block Editor */}
        {activeTab === 'editor' && (
          <div className="bg-white rounded-b-2xl border border-gray-200 shadow-xs p-6">
            <BlockEditor
              initialBlocks={blocks}
              onChange={(newBlocks, html, text) => {
                setBlocks(newBlocks);
                setHtmlContent(html);
                setTextContent(text);
              }}
            />
          </div>
        )}

        {/* TAB 2: Audience Definition */}
        {activeTab === 'audience' && (
          <div className="bg-white rounded-b-2xl border border-gray-200 shadow-xs p-6 space-y-6">
            <div>
              <h3 className="text-base font-bold text-gray-900">Target Audience Filters</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Segment leads for this campaign. Recipient list is evaluated dynamically without pre-materializing prematurely.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {/* Filter: Pipeline Stage */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-2">Pipeline Stages</label>
                <div className="space-y-1.5 max-h-48 overflow-y-auto border border-gray-200 rounded-xl p-3">
                  {stages.map((stg) => (
                    <label key={stg.id} className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedStageIds.includes(stg.id)}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedStageIds([...selectedStageIds, stg.id]);
                          else setSelectedStageIds(selectedStageIds.filter((id) => id !== stg.id));
                        }}
                        className="rounded text-brand-600 focus:ring-brand-500"
                      />
                      <span>{stg.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Filter: Tags */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-2">Lead Tags</label>
                <div className="space-y-1.5 max-h-48 overflow-y-auto border border-gray-200 rounded-xl p-3">
                  {tags.map((t) => (
                    <label key={t.id} className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedTagIds.includes(t.id)}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedTagIds([...selectedTagIds, t.id]);
                          else setSelectedTagIds(selectedTagIds.filter((id) => id !== t.id));
                        }}
                        className="rounded text-brand-600 focus:ring-brand-500"
                      />
                      <span>{t.name}</span>
                    </label>
                  ))}
                  {tags.length === 0 && <p className="text-xs text-gray-400">No tags found.</p>}
                </div>
              </div>

              {/* Filter: Source */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-2">Lead Source</label>
                <select
                  value={selectedSource}
                  onChange={(e) => setSelectedSource(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl"
                >
                  <option value="">All Sources</option>
                  <option value="meta">Meta</option>
                  <option value="google">Google</option>
                  <option value="manual">Manual</option>
                  <option value="test">Test</option>
                </select>
              </div>

              {/* Filter: Contact Preference */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-2">Contact Preference</label>
                <select
                  value={selectedPref}
                  onChange={(e) => setSelectedPref(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl"
                >
                  <option value="">Any Preference</option>
                  <option value="email">Email</option>
                  <option value="sms">SMS</option>
                  <option value="call">Call</option>
                </select>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-brand-50 border border-brand-200 flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-brand-900">Estimated Target Reach:</span>
                <p className="text-2xl font-black text-brand-700">
                  {isEstimating ? 'Calculating...' : `${estimatedCount} Eligible Leads`}
                </p>
              </div>
              <button
                onClick={calculateEstimatedAudience}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white text-brand-700 border border-brand-300 hover:bg-brand-100 transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCw className={`h-3.5 w-3.5 ${isEstimating ? 'animate-spin' : ''}`} /> Refresh Calculation
              </button>
            </div>
          </div>
        )}

        {/* TAB 3: A/B Testing */}
        {activeTab === 'ab_test' && (
          <div className="bg-white rounded-b-2xl border border-gray-200 shadow-xs p-6 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-gray-900">A/B Testing Configuration</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Split your campaign audience between two variations (A and B) to test subject lines.
                </p>
              </div>
              <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-gray-800">
                <input
                  type="checkbox"
                  checked={hasABTest}
                  onChange={(e) => setHasABTest(e.target.checked)}
                  className="rounded text-brand-600 focus:ring-brand-500"
                />
                Enable A/B Test
              </label>
            </div>

            {hasABTest && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-gray-100">
                <div className="p-4 rounded-xl border border-sky-200 bg-sky-50/40 space-y-3">
                  <span className="inline-block px-2 py-0.5 rounded text-xs font-black bg-sky-200 text-sky-900">
                    Variant A
                  </span>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Subject Line</label>
                    <input
                      type="text"
                      value={variantASubject}
                      onChange={(e) => setVariantASubject(e.target.value)}
                      placeholder="Subject for Variant A"
                      className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      Traffic Percentage ({variantAPercent}%)
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={variantAPercent}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setVariantAPercent(val);
                        setVariantBPercent(100 - val);
                      }}
                      className="w-full"
                    />
                  </div>
                </div>

                <div className="p-4 rounded-xl border border-purple-200 bg-purple-50/40 space-y-3">
                  <span className="inline-block px-2 py-0.5 rounded text-xs font-black bg-purple-200 text-purple-900">
                    Variant B
                  </span>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Subject Line</label>
                    <input
                      type="text"
                      value={variantBSubject}
                      onChange={(e) => setVariantBSubject(e.target.value)}
                      placeholder="Alternative Subject for Variant B"
                      className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      Traffic Percentage ({variantBPercent}%)
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={variantBPercent}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setVariantBPercent(val);
                        setVariantAPercent(100 - val);
                      }}
                      className="w-full"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: Version History */}
        {activeTab === 'versions' && (
          <div className="bg-white rounded-b-2xl border border-gray-200 shadow-xs p-6 space-y-4">
            <h3 className="text-base font-bold text-gray-900">Campaign Version Snapshots</h3>
            <p className="text-xs text-gray-500">
              Immutable history of campaign edits. Previous versions are never deleted.
            </p>

            <div className="divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden">
              {versions.map((ver) => (
                <div key={ver.id} className="p-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-gray-900">Version {ver.version_number}</span>
                      {ver.id === selectedVersionId && (
                        <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-brand-100 text-brand-700">
                          Active in Editor
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">Subject: {ver.subject}</p>
                    <span className="text-[11px] text-gray-400">
                      Saved {new Date(ver.created_at).toLocaleString()}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      if (Array.isArray(ver.content_json)) setBlocks(ver.content_json as EmailBlock[]);
                      setSubject(ver.subject);
                      setHtmlContent(ver.html_snapshot);
                      setTextContent(ver.text_snapshot);
                      setSelectedVersionId(ver.id);
                      setActiveTab('editor');
                    }}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-200 hover:bg-white text-gray-700 transition-colors cursor-pointer"
                  >
                    Restore to Editor
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 5: Test Send & Execution */}
        {activeTab === 'send' && (
          <div className="space-y-6">
            {/* Test Send Section */}
            <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-xs space-y-4">
              <div className="flex items-center gap-2 text-brand-700">
                <FlaskConical className="h-5 w-5" />
                <h3 className="text-base font-bold text-gray-900">Preview & Send Test Email</h3>
              </div>
              <p className="text-xs text-gray-500">
                Sends a one-off preview to your email using Resend. Personalized tags like {'{{salutation}}'} are resolved using official rules.
              </p>

              <form onSubmit={handleSendTest} className="flex flex-col sm:flex-row gap-3 max-w-xl">
                <label htmlFor={testEmailInputId} className="sr-only">
                  Recipient Test Email
                </label>
                <input
                  id={testEmailInputId}
                  type="email"
                  required
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  placeholder="your-email@expdentalsolutions.com"
                  className="flex-1 px-3.5 py-2 text-xs border border-gray-200 rounded-xl"
                />
                <button
                  type="submit"
                  disabled={isSendingTest}
                  className="px-4 py-2 text-xs font-semibold rounded-xl bg-gray-900 text-white hover:bg-black transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5 shrink-0"
                >
                  <Send className="h-3.5 w-3.5" />
                  {isSendingTest ? 'Sending...' : 'Send Test'}
                </button>
              </form>

              {testResult && (
                <div
                  className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                    testResult.success
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      : 'bg-red-50 text-red-800 border border-red-200'
                  }`}
                >
                  {testResult.success ? <Check className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                  <span>{testResult.message}</span>
                </div>
              )}
            </div>

            {/* Preparation & Scheduling Section */}
            <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-xs space-y-6">
              <div>
                <h3 className="text-base font-bold text-gray-900">Campaign Execution & Delivery</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Prepare target recipients from audience filters and dispatch in throttled batches via Resend.
                </p>
              </div>

              {/* Approval status check */}
              {campaign.status !== 'approved' && campaign.status !== 'scheduled' && campaign.status !== 'sending' && (
                <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center gap-3">
                  <AlertCircle className="h-5 w-5 text-amber-600 shrink-0" />
                  <div>
                    <span className="font-bold">Mandatory Approval Required</span>
                    <p className="mt-0.5">
                      Campaigns cannot be prepared or sent while in draft status. Click "Approve Campaign" in the top bar before proceeding.
                    </p>
                  </div>
                </div>
              )}

              {/* Scheduling Field */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-xl border border-gray-200 bg-gray-50/50">
                <div>
                  <span className="text-xs font-bold text-gray-900 flex items-center gap-1.5">
                    <Calendar className="h-4 w-4 text-purple-600" />
                    Scheduled Dispatch (Server-Side)
                  </span>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Leave blank to send manually, or set a future date and time. Server processes without needing browser open.
                  </p>
                </div>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="px-3 py-1.5 text-xs border border-gray-200 rounded-xl bg-white"
                />
              </div>

              {/* Actions: Prepare vs Dispatch Batch */}
              <div className="flex flex-wrap gap-4 pt-2">
                <button
                  onClick={handlePrepareCampaign}
                  disabled={isPreparing || (campaign.status !== 'approved' && campaign.status !== 'scheduled')}
                  className="px-4 py-2.5 text-xs font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 shadow-xs transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <Layers className="h-4 w-4" />
                  {isPreparing ? 'Preparing Recipients...' : 'Step 1: Prepare & Materialize Recipients'}
                </button>

                <button
                  onClick={handleDispatchBatch}
                  disabled={isSendingBatch || recipients.length === 0}
                  className="px-4 py-2.5 text-xs font-semibold rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 shadow-xs transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <Send className="h-4 w-4" />
                  {isSendingBatch ? 'Dispatching Batch...' : 'Step 2: Dispatch Next Batch (25 emails)'}
                </button>
              </div>

              {/* Batch execution stats */}
              {batchStats && (
                <div className="p-4 rounded-xl bg-gray-50 border border-gray-200 text-xs flex items-center gap-6">
                  <div>
                    <span className="text-gray-500">Sent in Batch:</span>{' '}
                    <strong className="text-emerald-700 font-bold">{batchStats.sent}</strong>
                  </div>
                  <div>
                    <span className="text-gray-500">Failed:</span>{' '}
                    <strong className="text-red-700 font-bold">{batchStats.failed}</strong>
                  </div>
                  <div>
                    <span className="text-gray-500">Remaining Pending:</span>{' '}
                    <strong className="text-gray-900 font-bold">{batchStats.remaining}</strong>
                  </div>
                </div>
              )}

              {/* Materialized Recipients Table */}
              <div className="space-y-3 pt-4 border-t border-gray-100">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase text-gray-400">
                    Materialized Recipients ({recipients.length})
                  </h4>
                  <span className="text-[11px] text-gray-400">Showing first 100 entries</span>
                </div>

                {recipients.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">
                    No recipients materialized yet. Click 'Prepare & Materialize Recipients' to populate target leads.
                  </p>
                ) : (
                  <div className="border border-gray-200 rounded-xl overflow-hidden text-xs">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50 text-gray-600 font-semibold">
                        <tr>
                          <th className="px-3.5 py-2.5 text-left">Email</th>
                          <th className="px-3.5 py-2.5 text-left">Variant</th>
                          <th className="px-3.5 py-2.5 text-left">Status</th>
                          <th className="px-3.5 py-2.5 text-left">Message ID</th>
                          <th className="px-3.5 py-2.5 text-left">Sent At</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 bg-white">
                        {recipients.map((r) => (
                          <tr key={r.id}>
                            <td className="px-3.5 py-2 font-medium text-gray-900">{r.email}</td>
                            <td className="px-3.5 py-2 text-gray-500">{r.variant || 'Base'}</td>
                            <td className="px-3.5 py-2">
                              <span
                                className={`px-2 py-0.5 rounded-full font-semibold text-[10px] ${
                                  r.status === 'sent'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : r.status === 'failed'
                                      ? 'bg-red-100 text-red-800'
                                      : 'bg-amber-100 text-amber-800'
                                }`}
                              >
                                {r.status}
                              </span>
                            </td>
                            <td className="px-3.5 py-2 text-gray-400 font-mono text-[11px]">
                              {r.provider_message_id || '—'}
                            </td>
                            <td className="px-3.5 py-2 text-gray-500">
                              {r.sent_at ? new Date(r.sent_at).toLocaleTimeString() : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
