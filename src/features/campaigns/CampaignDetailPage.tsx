import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Layout } from '../../components/Layout';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';
import { BlockEditor } from '../editor/BlockEditor';
import { AudienceFilterBuilder } from './components/AudienceFilterBuilder';
import { AudiencePreviewModal } from './components/AudiencePreviewModal';
import { SavedSegmentsModal } from './components/SavedSegmentsModal';
import { campaignAudienceService } from './services/campaign-audience-service';
import type { EmailBlock } from '../editor/types';
import type {
  Campaign,
  CampaignStatus,
  CampaignVersion,
  CampaignRecipient,
  CampaignAudience,
  AudienceFilterDefinition,
  AudiencePreviewResult,
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
  PhoneCall,
  MessageSquare,
  Sparkles,
  Eye,
} from 'lucide-react';

type TabType = 'editor' | 'audience' | 'ab_test' | 'versions' | 'send';

export function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('editor');

  // Loading & Action states
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Campaign Header & Details
  const [name, setName] = useState('');
  const [channel, setChannel] = useState<'email' | 'sms' | 'call'>('email');
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

  // Audience & Segmentation 2.0
  const [filterDefinition, setFilterDefinition] = useState<AudienceFilterDefinition>({
    version: 1,
    operator: 'and',
  });
  const [campaignAudience, setCampaignAudience] = useState<CampaignAudience | null>(null);
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewResult, setPreviewResult] = useState<AudiencePreviewResult | null>(null);
  const [savedSegmentsOpen, setSavedSegmentsOpen] = useState(false);

  // A/B Variants
  const [hasABTest, setHasABTest] = useState(false);
  const [variantASubject, setVariantASubject] = useState('');
  const [variantAPercent, setVariantAPercent] = useState(50);
  const [variantBSubject, setVariantBSubject] = useState('');
  const [variantBPercent, setVariantBPercent] = useState(50);

  // Prepare & Execution
  const [recipients, setRecipients] = useState<CampaignRecipient[]>([]);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isActivatingCall, setIsActivatingCall] = useState(false);

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
      setChannel(camp.channel || 'email');
      setSubject(camp.subject || '');
      setPreviewText(camp.preview_text || '');
      setFromName(camp.from_name || 'Expert Dental Solutions');
      setReplyTo(camp.reply_to || '');
      setScheduledAt(camp.scheduled_at ? new Date(camp.scheduled_at).toISOString().slice(0, 16) : '');

      // 2. Fetch Versions
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

      // 3. Fetch Audience & Segmentation
      const aud = await campaignAudienceService.fetchCampaignAudience(id);
      if (aud) {
        setCampaignAudience(aud);
        if (aud.filter_definition && typeof aud.filter_definition === 'object') {
          setFilterDefinition(aud.filter_definition as AudienceFilterDefinition);
        }
      }

      // 4. Fetch Variants
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

      // 5. Fetch Materialized Recipients (Snapshot members)
      const recs = await campaignAudienceService.fetchCampaignRecipients(id, 100, 0);
      setRecipients(recs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load campaign');
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadCampaignData();
  }, [loadCampaignData]);

  // Save campaign details & create new version snapshot
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
          channel,
          subject: subject.trim(),
          preview_text: previewText.trim() || null,
          from_name: fromName.trim() || 'Expert Dental Solutions',
          reply_to: replyTo.trim() || null,
          scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', campaign.id);

      if (campUpdateErr) throw campUpdateErr;

      // 2. Insert new version snapshot
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

      // 3. Save audience filters in campaign_audiences
      await supabase.from('campaign_audiences').upsert(
        {
          campaign_id: campaign.id,
          saved_segment_id: campaignAudience?.saved_segment_id || null,
          filter_definition: filterDefinition,
          estimated_recipient_count: previewResult?.eligible_count ?? 0,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'campaign_id' },
      );

      // 4. Save A/B variants if active
      if (hasABTest && channel === 'email') {
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
      setCampaign({ ...campaign, name, channel, subject, preview_text: previewText, from_name: fromName, reply_to: replyTo });
      setSuccessMessage(`Campaign saved successfully! (Version ${nextVersionNumber} snapshot created)`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error saving campaign');
    } finally {
      setIsSaving(false);
    }
  };

  // Status transition workflow
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

  // Prepare Campaign Audience (FREEZE SNAPSHOT — DOES NOT CREATE TASKS OR SEND)
  const handlePrepareAudience = async () => {
    if (!campaign) return;
    setIsPreparing(true);
    setError(null);

    try {
      const prepRes = await campaignAudienceService.prepareCampaignAudience(
        campaign.id,
        campaignAudience?.saved_segment_id || null,
      );

      setSuccessMessage(
        `Audience snapshot frozen! ${prepRes.recipients_materialized} contacts recorded (${prepRes.eligible_count} eligible, ${prepRes.excluded_count} safely excluded).`,
      );

      // Refresh audience and recipients
      const aud = await campaignAudienceService.fetchCampaignAudience(campaign.id);
      if (aud) setCampaignAudience(aud);

      const recs = await campaignAudienceService.fetchCampaignRecipients(campaign.id, 100, 0);
      setRecipients(recs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error preparing audience snapshot');
    } finally {
      setIsPreparing(false);
    }
  };

  // Activate Call Campaign (Explicit action: creates deduplicated tasks in public.tasks)
  const handleActivateCallCampaign = async () => {
    if (!campaign || campaign.channel !== 'call') return;
    setIsActivatingCall(true);
    setError(null);

    try {
      const actRes = await campaignAudienceService.activateCallCampaign(campaign.id);
      setSuccessMessage(
        `Call Campaign Activated! ${actRes.tasks_created} call tasks dispatched to Daily Operations (${actRes.tasks_skipped_idempotent} skipped as already pending).`,
      );

      setCampaign({ ...campaign, status: 'sent', activated_at: actRes.activated_at });

      // Refresh recipients
      const recs = await campaignAudienceService.fetchCampaignRecipients(campaign.id, 100, 0);
      setRecipients(recs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error activating call campaign');
    } finally {
      setIsActivatingCall(false);
    }
  };

  if (isLoading) {
    return (
      <Layout backTo="/campaigns" eyebrow="MARKETING & COMUNICAÇÃO" title="Detalhes da Campanha">
        <LoadingState message="Carregando detalhes da campanha..." />
      </Layout>
    );
  }

  if (error && !campaign) {
    return (
      <Layout backTo="/campaigns" eyebrow="MARKETING & COMUNICAÇÃO" title="Detalhes da Campanha">
        <ErrorState message={error} onRetry={loadCampaignData} />
      </Layout>
    );
  }

  if (!campaign) return null;

  const getStatusBadge = (status: CampaignStatus) => {
    switch (status) {
      case 'draft':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-700">Draft</span>;
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
            <Check className="h-3 w-3" /> {campaign.channel === 'call' ? 'Activated' : 'Sent'}
          </span>
        );
      default:
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-700">{status}</span>;
    }
  };

  const getChannelBadge = (ch: 'email' | 'sms' | 'call') => {
    switch (ch) {
      case 'email':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
            <Mail className="h-3 w-3" /> Email
          </span>
        );
      case 'sms':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-bold bg-purple-50 text-purple-700 border border-purple-200">
            <MessageSquare className="h-3 w-3" /> SMS
          </span>
        );
      case 'call':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <PhoneCall className="h-3 w-3" /> Call Campaign
          </span>
        );
    }
  };

  return (
    <Layout
      backTo="/campaigns"
      eyebrow="MARKETING & COMUNICAÇÃO"
      title={campaign.name}
      subtitle={channel === 'email' ? 'Compositor & Gestão de Campanhas de Email' : 'Compositor & Gestão de Campanhas'}
    >
      <div className="space-y-6 max-w-7xl mx-auto pb-12">
        {/* Top Breadcrumb & Status Action Bar */}
        <div className="card-executive p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              to="/campaigns"
              className="p-2 rounded-xl border border-slate-200/80 text-slate-500 hover:bg-slate-50 hover:text-slate-900 transition-colors cursor-pointer"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-xl font-bold font-heading text-[#08254f]">{campaign.name}</h1>
                {getStatusBadge(campaign.status)}
                {getChannelBadge(campaign.channel)}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Created {new Date(campaign.created_at).toLocaleDateString()} • Snapshot:{' '}
                {campaignAudience?.snapshot_frozen_at
                  ? `Frozen on ${new Date(campaignAudience.snapshot_frozen_at).toLocaleDateString()}`
                  : 'Dynamic Draft'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {campaign.status === 'draft' && (
              <button
                onClick={() => handleTransitionStatus('pending_approval')}
                className="px-3.5 py-2 text-xs font-semibold rounded-xl bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors flex items-center gap-1.5 cursor-pointer font-heading"
              >
                <Clock className="h-3.5 w-3.5" /> Submit for Approval
              </button>
            )}

            {(campaign.status === 'draft' || campaign.status === 'pending_approval') && (
              <button
                onClick={() => handleTransitionStatus('approved')}
                className="btn-secondary text-xs"
              >
                <ShieldCheck className="h-3.5 w-3.5 text-[#449bd5]" /> Approve Campaign
              </button>
            )}

            <button
              onClick={handleSaveCampaign}
              disabled={isSaving}
              className="btn-crimson text-xs disabled:opacity-50"
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
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-gray-900 tracking-tight uppercase text-gray-400">
              Envelope & Channel Settings
            </h2>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 font-medium">Channel:</span>
              <select
                disabled={campaign.status === 'sent'}
                value={channel}
                onChange={(e) => setChannel(e.target.value as 'email' | 'sms' | 'call')}
                className="px-2.5 py-1 text-xs border border-gray-200 rounded-lg bg-gray-50 font-bold text-gray-800"
              >
                <option value="email">Email Campaign</option>
                <option value="sms">SMS Campaign</option>
                <option value="call">Call Campaign (Operational)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                {channel === 'call' ? 'Call Campaign Purpose' : 'Subject Line'}
              </label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder={channel === 'call' ? 'e.g. VIP Consultation Outreach' : 'e.g. Invitation for {{salutation}}'}
                className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                {channel === 'call' ? 'Internal Call Script Notes' : 'Preview Text'}
              </label>
              <input
                type="text"
                value={previewText}
                onChange={(e) => setPreviewText(e.target.value)}
                placeholder={channel === 'call' ? 'Focus on course enrollment balance...' : 'Inbox preheader text...'}
                className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Sender Name / Organizer</label>
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
        <div className="flex border-b border-gray-200 gap-2 bg-white px-4 pt-3 rounded-t-2xl overflow-x-auto">
          {[
            { id: 'editor', label: 'Content Editor', icon: Mail, visible: channel === 'email' },
            { id: 'audience', label: `Audience (${campaignAudience?.eligible_count ?? '0'})`, icon: Users, visible: true },
            { id: 'ab_test', label: 'A/B Testing', icon: FlaskConical, visible: channel === 'email' },
            { id: 'versions', label: `Versions (${versions.length})`, icon: History, visible: true },
            { id: 'send', label: channel === 'call' ? 'Activate & Dispatch' : 'Execution & Delivery', icon: Send, visible: true },
          ]
            .filter((t) => t.visible)
            .map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id as TabType)}
                className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-all cursor-pointer shrink-0 ${
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

        {/* TAB 1: Visual Block Editor (Email only) */}
        {activeTab === 'editor' && channel === 'email' && (
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

        {/* TAB 2: Audience & Segmentation 2.0 */}
        {activeTab === 'audience' && (
          <div className="bg-white rounded-b-2xl border border-gray-200 shadow-xs p-6 space-y-6">
            {/* Snapshot Immutability Banner */}
            {campaignAudience?.snapshot_frozen_at ? (
              <div className="p-4 rounded-xl bg-blue-50/80 border border-blue-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-full bg-blue-200 text-blue-900 text-xs font-bold">
                      Audience Snapshot Frozen
                    </span>
                    <span className="text-xs text-blue-800">
                      Prepared on {new Date(campaignAudience.snapshot_frozen_at).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-xs text-blue-700">
                    This campaign has an immutable snapshot with {campaignAudience.eligible_count} eligible contacts and{' '}
                    {campaignAudience.excluded_count} audit exclusions. Changes to Saved Segments will not alter this snapshot.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handlePrepareAudience}
                  disabled={isPreparing || campaign.status === 'sent'}
                  className="px-3.5 py-2 text-xs font-bold rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition-colors shadow-2xs cursor-pointer shrink-0 disabled:opacity-50"
                >
                  <RotateCw className={`h-3.5 w-3.5 inline mr-1.5 ${isPreparing ? 'animate-spin' : ''}`} />
                  {isPreparing ? 'Rebuilding...' : 'Rebuild / Refresh Snapshot'}
                </button>
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-amber-50/80 border border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <span className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4 text-amber-600" />
                    Dynamic Audience Draft
                  </span>
                  <p className="text-xs text-amber-800">
                    Criteria are evaluated dynamically. Click &quot;Prepare Audience&quot; to freeze an immutable snapshot before dispatch.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handlePrepareAudience}
                  disabled={isPreparing}
                  className="px-4 py-2 text-xs font-bold rounded-xl bg-gray-900 text-white hover:bg-black transition-colors shadow-xs cursor-pointer shrink-0 disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Layers className="h-4 w-4" />
                  {isPreparing ? 'Preparing Snapshot...' : 'Prepare Audience (Freeze Snapshot)'}
                </button>
              </div>
            )}

            {/* Visual Audience Filter Builder */}
            <AudienceFilterBuilder
              channel={channel}
              filterDefinition={filterDefinition}
              onChange={setFilterDefinition}
              onOpenPreview={(prev) => {
                setPreviewResult(prev);
                setPreviewModalOpen(true);
              }}
              onOpenSavedSegments={() => setSavedSegmentsOpen(true)}
              disabled={campaign.status === 'sent'}
            />
          </div>
        )}

        {/* TAB 3: A/B Testing */}
        {activeTab === 'ab_test' && channel === 'email' && (
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
              Immutable history of campaign content and settings. Previous versions are preserved for auditability.
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

        {/* TAB 5: Execution & Delivery */}
        {activeTab === 'send' && (
          <div className="space-y-6">
            {/* Call Campaign Dispatch View */}
            {channel === 'call' ? (
              <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-xs space-y-6">
                <div className="flex items-center gap-2.5">
                  <PhoneCall className="h-5 w-5 text-emerald-600" />
                  <div>
                    <h3 className="text-base font-bold text-gray-900">Call Campaign Activation</h3>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Call campaigns create deduplicated outbound calling tasks directly in the Daily Operations Command Center (`/work`).
                    </p>
                  </div>
                </div>

                {!campaignAudience?.snapshot_frozen_at ? (
                  <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center gap-3">
                    <AlertCircle className="h-5 w-5 text-amber-600 shrink-0" />
                    <div>
                      <span className="font-bold">Audience Not Prepared</span>
                      <p className="mt-0.5">
                        Please go to the Audience tab and click &quot;Prepare Audience&quot; to freeze the snapshot before activating call tasks.
                      </p>
                    </div>
                  </div>
                ) : campaign.status === 'sent' ? (
                  <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                    <div>
                      <span className="font-bold">Call Campaign Is Active</span>
                      <p className="mt-0.5">
                        Tasks were generated on {new Date(campaign.activated_at || campaign.updated_at).toLocaleString()}. You can view and process them in the Work Queue.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="p-5 rounded-xl border border-emerald-200 bg-emerald-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <span className="font-bold text-xs text-emerald-950 block">Ready for Call Activation</span>
                      <p className="text-xs text-emerald-800 mt-0.5">
                        {campaignAudience.eligible_count} eligible call contacts ready. Activating will schedule deduplicated call tasks for each lead.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleActivateCallCampaign}
                      disabled={isActivatingCall}
                      className="px-4 py-2.5 text-xs font-bold rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 transition-all shadow-xs flex items-center gap-2 cursor-pointer disabled:opacity-50 shrink-0"
                    >
                      <PhoneCall className="h-4 w-4" />
                      {isActivatingCall ? 'Activating Tasks...' : 'Activate Call Campaign'}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              /* Email / SMS Provider Deferred View */
              <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-xs space-y-6">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-gray-900">Campaign Execution & Delivery</h3>
                    <span className="px-2 py-0.5 text-[11px] font-bold rounded-full bg-purple-100 text-purple-800 border border-purple-200">
                      Provider Integration Deferred — Phase 7
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Live batch sending via Resend (Email) and Twilio (SMS) is scheduled for Phase 7 (Integrations). Audience segmentation, contact preference safety, and snapshot immutability are fully operational.
                  </p>
                </div>

                {/* Safe Preview Section (Correction 3: No live provider dispatch in Batch 4.3) */}
                {channel === 'email' && (
                  <div className="p-4 rounded-xl border border-slate-200/80 bg-slate-50/50 space-y-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2 text-[#08254f]">
                        <Eye className="h-4 w-4 text-[#449bd5]" />
                        <span className="text-xs font-bold text-slate-800 font-heading">Pré-visualização da Mensagem</span>
                      </div>
                      <span className="px-2 py-0.5 text-[10px] font-semibold rounded bg-amber-50 text-amber-700 border border-amber-200">
                        Disparo em teste desativado (Provedores inativos)
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">
                      Visualize a renderização real do template de email e verifique as tags de substituição sem envio de mensagens para redes externas.
                    </p>
                    <div className="p-4 bg-white rounded-xl border border-slate-200 text-xs max-h-72 overflow-y-auto">
                      <div className="mb-2 pb-2 border-b border-slate-100 text-slate-500">
                        <strong>Assunto:</strong> {subject || '(Sem assunto)'}
                      </div>
                      <div
                        className="prose prose-sm max-w-none text-slate-800"
                        dangerouslySetInnerHTML={{ __html: htmlContent || '<p class="text-slate-400 italic">Nenhum conteúdo adicionado ao editor.</p>' }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Materialized Recipients & Audit Table */}
            <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-gray-900">Materialized Audience Snapshot ({recipients.length})</h4>
                  <p className="text-xs text-gray-500">
                    Auditable list of eligible recipients and safely excluded contacts preserved at preparation time.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    const recs = await campaignAudienceService.fetchCampaignRecipients(campaign.id, 100, 0);
                    setRecipients(recs);
                  }}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 transition-colors"
                  title="Refresh recipients"
                >
                  <RotateCw className="h-3.5 w-3.5" />
                </button>
              </div>

              {recipients.length === 0 ? (
                <div className="p-8 text-center text-xs text-gray-400 italic">
                  No audience snapshot materialized yet. Click &quot;Prepare Audience&quot; in the Audience tab to freeze the snapshot.
                </div>
              ) : (
                <div className="border border-gray-200 rounded-xl overflow-hidden text-xs">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50 text-gray-600 font-semibold">
                      <tr>
                        <th className="px-3.5 py-2.5 text-left">Destination</th>
                        <th className="px-3.5 py-2.5 text-left">Channel</th>
                        <th className="px-3.5 py-2.5 text-left">Eligibility & Exclusion Audit</th>
                        <th className="px-3.5 py-2.5 text-left">Status</th>
                        <th className="px-3.5 py-2.5 text-left">Prepared At</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {recipients.map((r) => (
                        <tr key={r.id} className="hover:bg-gray-50/70">
                          <td className="px-3.5 py-2 font-medium text-gray-900">
                            {r.email || r.phone_e164 || 'No destination'}
                          </td>
                          <td className="px-3.5 py-2 uppercase font-bold text-[10px] text-gray-600">
                            {r.channel}
                          </td>
                          <td className="px-3.5 py-2">
                            {r.is_eligible ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px]">
                                <CheckCircle2 className="h-3 w-3" /> Eligible
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 font-bold text-[10px]">
                                <XCircle className="h-3 w-3" /> {r.exclusion_reason || 'Excluded'}
                              </span>
                            )}
                          </td>
                          <td className="px-3.5 py-2">
                            <span
                              className={`px-2 py-0.5 rounded-full font-semibold text-[10px] ${
                                r.status === 'sent'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : r.status === 'skipped'
                                    ? 'bg-gray-100 text-gray-600'
                                    : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {r.status}
                            </span>
                          </td>
                          <td className="px-3.5 py-2 text-gray-500 text-[11px]">
                            {new Date(r.prepared_at).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Audience Preview Modal */}
      {previewResult && (
        <AudiencePreviewModal
          isOpen={previewModalOpen}
          onClose={() => setPreviewModalOpen(false)}
          channel={channel}
          previewResult={previewResult}
        />
      )}

      {/* Saved Segments Modal */}
      <SavedSegmentsModal
        isOpen={savedSegmentsOpen}
        onClose={() => setSavedSegmentsOpen(false)}
        currentFilterDefinition={filterDefinition}
        onApplySegment={(seg) => {
          setFilterDefinition(seg.filter_definition);
          setCampaignAudience((prev) =>
            prev
              ? { ...prev, saved_segment_id: seg.id }
              : ({ campaign_id: campaign.id, saved_segment_id: seg.id, filter_definition: seg.filter_definition } as CampaignAudience),
          );
          setSuccessMessage(`Applied saved segment "${seg.name}"`);
        }}
      />
    </Layout>
  );
}
