import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Layout } from '../../components/Layout';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';
import { useAuth } from '../auth/AuthProvider';
import { BlockEditor } from '../editor/BlockEditor';
import { TemplatePickerModal } from './components/TemplatePickerModal';
import { CampaignAttachmentSection } from './components/CampaignAttachmentSection';
import { AudienceSection } from './components/AudienceSection';
import { EmailPreviewSection } from './components/EmailPreviewSection';
import { CampaignReviewSummaryCard } from './components/CampaignReviewSummaryCard';
import { AudiencePreviewModal } from './components/AudiencePreviewModal';
import { SavedSegmentsModal } from './components/SavedSegmentsModal';
import { TemplatePreviewModal } from '../templates/components/TemplatePreviewModal';
import {
  campaignAudienceService,
  type OfficialCourseMaterial,
} from './services/campaign-audience-service';
import {
  getTemplateChannel,
  getTemplateSubject,
  CAMPAIGN_SPECIFIC_VARIABLES,
} from '../../utils/template-variables';
import type { EmailBlock } from '../editor/types';
import type {
  Campaign,
  CampaignStatus,
  CampaignVersion,
  CampaignRecipient,
  CampaignAudience,
  AudienceFilterDefinition,
  AudiencePreviewResult,
  EmailTemplate,
  CampaignAttachment,
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
  RotateCw,
  History,
  ShieldCheck,
  XCircle,
  Sparkles,
  Eye,
  FileText,
  Paperclip,
  ChevronRight,
  ChevronLeft,
  Trash2,
  AlertTriangle,
} from 'lucide-react';

export type CampaignSectionType =
  | 'content'
  | 'audience'
  | 'attachment'
  | 'sender'
  | 'review'
  | 'approval';

export function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAuthorized } = useAuth();

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [activeSection, setActiveSection] = useState<CampaignSectionType>('content');

  // Loading & Action states
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Campaign Delete state
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

  // Attachment
  const [attachment, setAttachment] = useState<CampaignAttachment | null>(null);
  const [suggestedMaterial, setSuggestedMaterial] = useState<OfficialCourseMaterial | null>(null);

  // Versions
  const [versions, setVersions] = useState<CampaignVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [showVersionsAudit, setShowVersionsAudit] = useState(false);

  // Audience & Segmentation 2.0
  const [filterDefinition, setFilterDefinition] = useState<AudienceFilterDefinition>({
    version: 1,
    operator: 'and',
    mode: 'all',
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

  // Template Library & Modals
  const [availableTemplates, setAvailableTemplates] = useState<EmailTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [loadedTemplate, setLoadedTemplate] = useState<EmailTemplate | null>(null);
  const [isTemplatePickerOpen, setIsTemplatePickerOpen] = useState(false);
  const [isPreviewTemplateOpen, setIsPreviewTemplateOpen] = useState(false);
  const [loadedTemplateNotice, setLoadedTemplateNotice] = useState<string | null>(null);

  // Reference data for review summary
  const [allCourses, setAllCourses] = useState<Array<{ id: string; name: string; code: string }>>([]);
  const [allStages, setAllStages] = useState<Array<{ id: string; name: string; code: string }>>([]);

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
      setReplyTo(camp.reply_to || 'info@expdentalsolutions.com');
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
        // Extract attachment from snapshot metadata if exists
        const meta = aud.snapshot_metadata as Record<string, any> | undefined;
        if (meta?.attachment) {
          setAttachment(meta.attachment as CampaignAttachment);
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

      // 6. Fetch available Email Templates & reference data
      const [tplsRes, coursesRes, stagesRes] = await Promise.all([
        supabase.from('email_templates').select('*').eq('is_active', true).order('name', { ascending: true }),
        supabase.from('courses').select('id, name, code').eq('active', true).order('sort_order', { ascending: true }),
        supabase.from('pipeline_stages').select('id, name, code, sort_order').order('sort_order', { ascending: true }),
      ]);

      if (coursesRes.data) setAllCourses(coursesRes.data);
      if (stagesRes.data) setAllStages(stagesRes.data);

      if (tplsRes.data) {
        const filteredTpls = tplsRes.data.filter((t) => getTemplateChannel(t) === 'email');
        setAvailableTemplates(filteredTpls);

        if (camp.template_id) {
          setSelectedTemplateId(camp.template_id);
          const found = filteredTpls.find((t) => t.id === camp.template_id);
          if (found) {
            setLoadedTemplate(found);
            // Check associated official material
            if (found.template_key) {
              const mat = await campaignAudienceService.loadTemplateAttachment(found.template_key);
              if (mat) setSuggestedMaterial(mat);
            }
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar dados da campanha');
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadCampaignData();
  }, [loadCampaignData]);

  // Handle template selection from modal
  const handleSelectTemplate = async (tpl: EmailTemplate) => {
    if (!tpl) return;
    setLoadedTemplate(tpl);
    setSelectedTemplateId(tpl.id);

    const tplSub = getTemplateSubject(tpl);
    if (tplSub) setSubject(tplSub);

    if (tpl.description) setPreviewText(tpl.description);

    let tplBlocks: EmailBlock[] = [];
    const cj = tpl.content_json;
    if (Array.isArray(cj)) {
      tplBlocks = cj as EmailBlock[];
    } else if (typeof cj === 'object' && cj !== null && Array.isArray((cj as { blocks?: unknown[] }).blocks)) {
      tplBlocks = (cj as { blocks: EmailBlock[] }).blocks;
    }

    setBlocks(tplBlocks);
    setHtmlContent(tpl.html_template || '');
    setTextContent(tpl.text_template || '');

    // Check associated official material
    if (tpl.template_key) {
      const mat = await campaignAudienceService.loadTemplateAttachment(tpl.template_key);
      if (mat) {
        setSuggestedMaterial(mat);
        // Automatically suggest / attach if template indicates required attachment
        if (tpl.has_attachment && !attachment) {
          setAttachment({
            filename: mat.file_name,
            size: mat.file_size_bytes || undefined,
            type: mat.content_type || 'application/pdf',
            storage_path: mat.storage_path,
            material_id: mat.id,
            course_id: mat.course_id,
            source: 'official_material',
          });
        }
      }
    } else if (tpl.attachment_name && !attachment) {
      setAttachment({
        filename: tpl.attachment_name,
        type: 'application/pdf',
        source: 'uploaded',
      });
    }

    setLoadedTemplateNotice(
      `Template "${tpl.name}" carregado com sucesso. O conteúdo está disponível para edição abaixo.`,
    );
  };

  // Save campaign details & create new version snapshot
  const handleSaveCampaign = async (customSuccessNotice?: string) => {
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
          reply_to: replyTo.trim() || 'info@expdentalsolutions.com',
          template_id: selectedTemplateId || campaign.template_id || null,
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

      // 3. Save audience filters & snapshot metadata (including attachment)
      const currentMeta = (campaignAudience?.snapshot_metadata as Record<string, any>) || {};
      await supabase.from('campaign_audiences').upsert(
        {
          campaign_id: campaign.id,
          saved_segment_id: campaignAudience?.saved_segment_id || null,
          filter_definition: filterDefinition,
          estimated_recipient_count: previewResult?.eligible_count ?? 0,
          snapshot_metadata: {
            ...currentMeta,
            attachment: attachment || null,
          },
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'campaign_id' },
      );

      // 4. Save A/B variants if active
      if (hasABTest && channel === 'email') {
        if (variantAPercent + variantBPercent !== 100) {
          throw new Error('As porcentagens de tráfego do Teste A/B devem somar exatamente 100%');
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
      setCampaign({
        ...campaign,
        name,
        channel,
        subject,
        preview_text: previewText,
        from_name: fromName,
        reply_to: replyTo,
      });

      setSuccessMessage(
        customSuccessNotice ||
          `Campanha salva com sucesso! (Versão ${nextVersionNumber} registrada no histórico)`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar campanha');
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
      const statusLabel =
        newStatus === 'pending_approval'
          ? 'Aguardando aprovação'
          : newStatus === 'approved'
          ? 'Aprovada'
          : newStatus === 'draft'
          ? 'Rascunho'
          : newStatus;
      setSuccessMessage(`Status da campanha alterado com sucesso para "${statusLabel}".`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao atualizar status da campanha');
    }
  };

  // Prepare Campaign Audience (FREEZE SNAPSHOT)
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
        `Audiência congelada com sucesso! ${prepRes.recipients_materialized} contatos registrados (${prepRes.eligible_count} elegíveis, ${prepRes.excluded_count} excluídos por segurança).`,
      );

      // Refresh audience and recipients
      const aud = await campaignAudienceService.fetchCampaignAudience(campaign.id);
      if (aud) setCampaignAudience(aud);

      const recs = await campaignAudienceService.fetchCampaignRecipients(campaign.id, 100, 0);
      setRecipients(recs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao preparar lista de destinatários');
    } finally {
      setIsPreparing(false);
    }
  };

  // Activate Call Campaign (Explicit action)
  const handleActivateCallCampaign = async () => {
    if (!campaign || campaign.channel !== 'call') return;
    setIsActivatingCall(true);
    setError(null);

    try {
      const actRes = await campaignAudienceService.activateCallCampaign(campaign.id);
      setSuccessMessage(
        `Campanha de Ligações Ativada! ${actRes.tasks_created} tarefas criadas em Operações Diárias.`,
      );

      setCampaign({ ...campaign, status: 'sent', activated_at: actRes.activated_at });

      const recs = await campaignAudienceService.fetchCampaignRecipients(campaign.id, 100, 0);
      setRecipients(recs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao ativar campanha de ligações');
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

  // Selected names for Review Summary
  const resolvedCourseName = allCourses.find(
    (c) => c.id === (filterDefinition.course_id || filterDefinition.enrolled_course_id),
  )?.name;

  const resolvedStageName =
    filterDefinition.stages && filterDefinition.stages.length > 0
      ? filterDefinition.stages
          .map((codeOrId) => allStages.find((s) => s.code === codeOrId || s.id === codeOrId)?.name || codeOrId)
          .join(', ')
      : null;

  const handleDeleteCampaign = async () => {
    if (!campaign || !isAuthorized) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await campaignAudienceService.safeDeleteCampaign(campaign.id);
      setIsDeleteModalOpen(false);
      navigate('/campaigns', { state: { message: 'Campanha excluída com sucesso.' } });
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Falha ao excluir campanha.');
      setIsDeleting(false);
    }
  };

  // Navigation Sections Configuration
  const sections = [
    { id: 'content' as const, label: '1. Conteúdo do Email', icon: Mail },
    {
      id: 'audience' as const,
      label: `2. Quem vai receber? (${previewResult?.eligible_count ?? campaignAudience?.eligible_count ?? 0})`,
      icon: Users,
    },
    { id: 'attachment' as const, label: '3. Anexo / PDF', icon: Paperclip },
    { id: 'sender' as const, label: '4. Remetente & Canal', icon: ShieldCheck },
    { id: 'review' as const, label: '5. Resumo da Campanha', icon: CheckCircle2 },
    { id: 'approval' as const, label: '6. Aprovação & Envio', icon: Send },
  ];

  const currentSectionIndex = sections.findIndex((s) => s.id === activeSection);

  return (
    <Layout
      backTo="/campaigns"
      eyebrow="MARKETING & COMUNICAÇÃO"
      title={campaign.name}
      subtitle="Criador e Gestão Simplificada de Campanhas de Email"
    >
      <div className="space-y-6 max-w-7xl mx-auto pb-28">
        {/* Top Header & Fast Action Bar */}
        <div className="card-executive p-4 sm:p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              to="/campaigns"
              className="p-2 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-900 transition-colors shrink-0"
              title="Voltar para lista de campanhas"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg sm:text-xl font-bold font-heading text-[#08254f] truncate">
                  {campaign.name}
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-900 border border-blue-200">
                  {campaign.status === 'draft'
                    ? 'Rascunho'
                    : campaign.status === 'pending_approval'
                    ? 'Aguardando Aprovação'
                    : campaign.status === 'approved'
                    ? 'Aprovada'
                    : campaign.status === 'scheduled'
                    ? 'Agendada'
                    : campaign.status === 'sending'
                    ? 'Enviando'
                    : campaign.status === 'sent'
                    ? 'Concluída'
                    : campaign.status}
                </span>
                <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-slate-100 text-slate-700">
                  Canal: Email
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Criada em {new Date(campaign.created_at).toLocaleDateString()} • Versão{' '}
                {versions[0]?.version_number || 1}
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handleSaveCampaign()}
              disabled={isSaving}
              className="w-full sm:w-auto px-4 py-2 text-xs font-bold rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition-colors shadow-2xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              {isSaving ? 'Salvando...' : 'Salvar rascunho'}
            </button>

            {campaign.status === 'draft' && (
              <button
                type="button"
                onClick={() => handleTransitionStatus('pending_approval')}
                className="w-full sm:w-auto px-4 py-2 text-xs font-bold rounded-xl bg-amber-500 text-white hover:bg-amber-600 transition-colors shadow-2xs flex items-center justify-center gap-1.5 cursor-pointer font-heading"
              >
                <Clock className="w-3.5 h-3.5" /> Enviar para aprovação
              </button>
            )}

            {campaign.status === 'pending_approval' && (
              <button
                type="button"
                onClick={() => handleTransitionStatus('approved')}
                className="w-full sm:w-auto px-4 py-2 text-xs font-bold rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition-colors shadow-2xs flex items-center justify-center gap-1.5 cursor-pointer font-heading"
              >
                <ShieldCheck className="w-3.5 h-3.5" /> Aprovar Campanha
              </button>
            )}

            {campaign.status === 'approved' && (
              <button
                type="button"
                onClick={() => setActiveSection('approval')}
                className="w-full sm:w-auto px-4 py-2 text-xs font-bold rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 transition-colors shadow-2xs flex items-center justify-center gap-1.5 cursor-pointer font-heading"
              >
                <Send className="w-3.5 h-3.5" /> Agendar / Enviar Campanha
              </button>
            )}
          </div>
        </div>

        {/* Feedback Alerts */}
        {error && (
          <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs sm:text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {successMessage && (
          <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs sm:text-sm flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Reorganized Section Stepper / Pills */}
        <div className="flex items-center gap-2 bg-white p-2 rounded-2xl border border-slate-200 overflow-x-auto shadow-2xs">
          {sections.map((sec) => {
            const isActive = activeSection === sec.id;
            return (
              <button
                key={sec.id}
                type="button"
                onClick={() => setActiveSection(sec.id)}
                className={`flex items-center gap-2 px-3.5 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer shrink-0 font-heading ${
                  isActive
                    ? 'bg-[#08254f] text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <sec.icon className={`w-3.5 h-3.5 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                <span>{sec.label}</span>
              </button>
            );
          })}
        </div>

        {/* SECTION 1: EMAIL CONTENT & TEMPLATE SELECTION */}
        {activeSection === 'content' && (
          <div className="space-y-6">
            {/* Template Selector Banner & Loaded Template Card */}
            <div className="card-executive p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                <div>
                  <h3 className="text-sm font-bold text-[#08254f] flex items-center gap-2 font-heading">
                    <FileText className="w-4 h-4 text-[#449bd5]" />
                    Template do Email
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Escolha um template da biblioteca oficial para preencher o assunto, pré-cabeçalho, corpo e anexo.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsTemplatePickerOpen(true)}
                    className="w-full sm:w-auto px-4 py-2 text-xs font-bold rounded-xl bg-[#08254f] text-white hover:bg-[#061d3d] transition-colors shadow-2xs cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    {selectedTemplateId ? 'Trocar template' : 'Escolher template'}
                  </button>

                  {loadedTemplate && (
                    <button
                      type="button"
                      onClick={() => setIsPreviewTemplateOpen(true)}
                      className="w-full sm:w-auto px-3.5 py-2 text-xs font-semibold rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      Visualizar template
                    </button>
                  )}
                </div>
              </div>

              {/* Loaded Template Visual Card */}
              {loadedTemplate ? (
                <div className="p-4 rounded-xl border border-blue-200 bg-blue-50/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-blue-950 font-heading">
                        Template carregado: {loadedTemplate.name}
                      </span>
                      {loadedTemplate.category && (
                        <span className="px-2 py-0.5 text-[10px] font-semibold rounded bg-blue-200/80 text-blue-900 capitalize">
                          {loadedTemplate.category}
                        </span>
                      )}
                      {(loadedTemplate.has_attachment || loadedTemplate.attachment_name) && (
                        <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-amber-100 text-amber-900 border border-amber-200 flex items-center gap-1">
                          <Paperclip className="w-3 h-3 text-amber-700" />
                          Material em PDF incluso ({loadedTemplate.attachment_name || 'Anexo'})
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-blue-800">
                      As edições realizadas no assunto ou no editor abaixo pertencem exclusivamente a esta campanha.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="p-4 rounded-xl border border-dashed border-slate-200 text-center text-xs text-slate-400">
                  Nenhum template selecionado ainda. Clique em &quot;Escolher template&quot; para carregar um modelo pronto ou componha diretamente no editor abaixo.
                </div>
              )}

              {loadedTemplateNotice && (
                <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center justify-between">
                  <span>{loadedTemplateNotice}</span>
                  <button
                    type="button"
                    onClick={() => setLoadedTemplateNotice(null)}
                    className="text-[10px] font-bold text-emerald-600 hover:text-emerald-900 ml-2"
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>

            {/* Email Subject, Preheader & Variable Chips */}
            <div className="card-executive p-5 space-y-4">
              <h3 className="text-sm font-bold text-[#08254f] font-heading">
                Assunto & Pré-cabeçalho
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Linha de Assunto
                  </label>
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Ex: Convite Especial para {{salutation}}"
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:ring-1 focus:ring-[#08254f] outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Texto de Pré-visualização (Preheader)
                  </label>
                  <input
                    type="text"
                    value={previewText}
                    onChange={(e) => setPreviewText(e.target.value)}
                    placeholder="Ex: Vagas remanescentes para a turma de Novembro..."
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:ring-1 focus:ring-[#08254f] outline-none"
                  />
                </div>
              </div>

              {/* Variable Chips */}
              <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-semibold text-slate-500 flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-[#449bd5]" /> Inserir Variável no Assunto:
                </span>
                {CAMPAIGN_SPECIFIC_VARIABLES.map((v) => (
                  <button
                    key={v.key}
                    type="button"
                    onClick={() => setSubject((prev) => `${prev ? prev + ' ' : ''}${v.key}`)}
                    className="px-2 py-0.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded text-xs font-mono text-[#08254f] transition-colors cursor-pointer shadow-2xs"
                    title={`${v.description} — Clique para adicionar`}
                  >
                    {v.key}
                  </button>
                ))}
              </div>
            </div>

            {/* Visual Block Editor */}
            <div className="card-executive p-5 space-y-4">
              <h3 className="text-sm font-bold text-[#08254f] font-heading">
                Editor Visual de Conteúdo
              </h3>
              <BlockEditor
                initialBlocks={blocks}
                onChange={(newBlocks, html, text) => {
                  setBlocks(newBlocks);
                  setHtmlContent(html);
                  setTextContent(text);
                }}
              />
            </div>

            {/* Email Preview Section */}
            <EmailPreviewSection
              subject={subject}
              previewText={previewText}
              fromName={fromName}
              replyTo={replyTo}
              htmlContent={htmlContent}
              attachment={attachment}
            />
          </div>
        )}

        {/* SECTION 2: AUDIENCE SELECTION */}
        {activeSection === 'audience' && (
          <AudienceSection
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
        )}

        {/* SECTION 3: ATTACHMENT */}
        {activeSection === 'attachment' && (
          <CampaignAttachmentSection
            attachment={attachment}
            suggestedMaterial={suggestedMaterial}
            onAttachFile={(att) => setAttachment(att)}
            onRemoveAttachment={() => setAttachment(null)}
            disabled={campaign.status === 'sent'}
          />
        )}

        {/* SECTION 4: SENDER SETTINGS */}
        {activeSection === 'sender' && (
          <div className="card-executive p-5 space-y-5">
            <div className="pb-3 border-b border-slate-100">
              <h3 className="text-sm font-bold text-[#08254f] font-heading">
                Configurações do Remetente & Canal
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Defina o nome exibido na caixa de entrada e o endereço de resposta para a campanha.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Nome do Remetente
                </label>
                <input
                  type="text"
                  value={fromName}
                  onChange={(e) => setFromName(e.target.value)}
                  placeholder="Expert Dental Solutions"
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:ring-1 focus:ring-[#08254f] outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Responder Para (Reply-To)
                </label>
                <input
                  type="email"
                  value={replyTo}
                  onChange={(e) => setReplyTo(e.target.value)}
                  placeholder="info@expdentalsolutions.com"
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:ring-1 focus:ring-[#08254f] outline-none"
                />
              </div>
            </div>

            {/* Canal de Envio: Proteção e Informação */}
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  Canal Oficial de Envio: Email (Automático em Massa)
                </span>
                <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-emerald-100 text-emerald-800">
                  Resend Integrado
                </span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                O envio automático em massa no EDS HUB é restrito ao canal <strong>Email</strong>.
                Disparos em lote via SMS e WhatsApp permanecem permanentemente desabilitados por conformidade com operadoras e proteção de spam.
                Interações por SMS e WhatsApp devem ser realizadas individualmente no modo <em>Manual Assistido</em>.
              </p>
            </div>
          </div>
        )}

        {/* SECTION 5: REVIEW SUMMARY */}
        {activeSection === 'review' && (
          <CampaignReviewSummaryCard
            templateName={loadedTemplate?.name || null}
            subject={subject}
            fromName={fromName}
            fromEmail="info@expdentalsolutions.com"
            totalMatched={previewResult?.total_matched ?? campaignAudience?.total_matched_count ?? 0}
            eligibleCount={previewResult?.eligible_count ?? campaignAudience?.eligible_count ?? 0}
            excludedCount={previewResult?.excluded_count ?? campaignAudience?.excluded_count ?? 0}
            courseName={resolvedCourseName}
            stageName={resolvedStageName}
            sessionDate={filterDefinition.course_session_id ? 'Turma específica' : null}
            attachment={attachment}
            status={campaign.status}
          />
        )}

        {/* SECTION 6: APPROVAL & EXECUTION */}
        {activeSection === 'approval' && (
          <div className="space-y-6">
            {/* Status Flow Stepper */}
            <div className="card-executive p-5 space-y-4">
              <h3 className="text-sm font-bold text-[#08254f] font-heading">
                Fluxo de Status da Campanha
              </h3>

              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 text-center text-xs">
                {[
                  { key: 'draft', label: 'Rascunho' },
                  { key: 'pending_approval', label: 'Aguardando Aprovação' },
                  { key: 'approved', label: 'Aprovada' },
                  { key: 'scheduled', label: 'Agendada' },
                  { key: 'sending', label: 'Enviando' },
                  { key: 'sent', label: 'Concluída' },
                ].map((st, i) => {
                  const isCurrent = campaign.status === st.key;
                  return (
                    <div
                      key={st.key}
                      className={`p-3 rounded-xl border flex flex-col items-center justify-center gap-1 ${
                        isCurrent
                          ? 'border-[#08254f] bg-blue-50/70 font-bold text-[#08254f] ring-1 ring-[#08254f]'
                          : 'border-slate-200 bg-slate-50/50 text-slate-500'
                      }`}
                    >
                      <span className="text-[10px] text-slate-400 font-mono">0{i + 1}</span>
                      <span className="truncate w-full">{st.label}</span>
                    </div>
                  );
                })}
              </div>

              {/* Status Action Cards */}
              <div className="pt-2">
                {campaign.status === 'draft' && (
                  <div className="p-4 rounded-xl border border-amber-200 bg-amber-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <span className="text-xs font-bold text-amber-950 flex items-center gap-1.5">
                        <Clock className="w-4 h-4 text-amber-600" />
                        Campanha em Rascunho
                      </span>
                      <p className="text-xs text-amber-900">
                        Quando o conteúdo e a audiência estiverem revisados, envie para aprovação da equipe.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleTransitionStatus('pending_approval')}
                      className="w-full sm:w-auto px-4 py-2.5 text-xs font-bold rounded-xl bg-amber-600 text-white hover:bg-amber-700 transition-colors shadow-2xs cursor-pointer shrink-0"
                    >
                      Enviar para aprovação
                    </button>
                  </div>
                )}

                {campaign.status === 'pending_approval' && (
                  <div className="p-4 rounded-xl border border-blue-200 bg-blue-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <span className="text-xs font-bold text-blue-950 flex items-center gap-1.5">
                        <ShieldCheck className="w-4 h-4 text-blue-700" />
                        Aguardando Aprovação
                      </span>
                      <p className="text-xs text-blue-900">
                        A campanha está pronta para aprovação formal antes da liberação do agendamento ou disparo.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleTransitionStatus('draft')}
                        className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                      >
                        Voltar para rascunho
                      </button>
                      <button
                        type="button"
                        onClick={() => handleTransitionStatus('approved')}
                        className="px-4 py-2 text-xs font-bold rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition-colors shadow-2xs cursor-pointer"
                      >
                        Aprovar Campanha
                      </button>
                    </div>
                  </div>
                )}

                {campaign.status === 'approved' && (
                  <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/70 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="space-y-0.5">
                        <span className="text-xs font-bold text-emerald-950 flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          Campanha Aprovada
                        </span>
                        <p className="text-xs text-emerald-900">
                          A campanha foi aprovada e está pronta para agendamento ou envio imediato.
                        </p>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          type="button"
                          onClick={() => handleTransitionStatus('draft')}
                          className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                        >
                          Voltar para rascunho
                        </button>

                        <button
                          type="button"
                          onClick={handlePrepareAudience}
                          disabled={isPreparing}
                          className="px-4 py-2 text-xs font-bold rounded-xl bg-[#08254f] text-white hover:bg-[#061d3d] transition-colors shadow-2xs cursor-pointer flex items-center gap-1.5"
                        >
                          <Layers className="w-3.5 h-3.5" />
                          {isPreparing ? 'Congelando lista...' : 'Preparar Audiência'}
                        </button>
                      </div>
                    </div>

                    {/* Scheduler Input */}
                    <div className="p-3.5 bg-white rounded-xl border border-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-purple-600 shrink-0" />
                        <span className="text-xs font-bold text-slate-700">
                          Agendar Disparo:
                        </span>
                        <input
                          type="datetime-local"
                          value={scheduledAt}
                          onChange={(e) => setScheduledAt(e.target.value)}
                          className="px-2.5 py-1 text-xs border border-slate-200 rounded-lg outline-none"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={async () => {
                          if (!scheduledAt) {
                            alert('Selecione uma data e horário válidos para agendamento.');
                            return;
                          }
                          await handleSaveCampaign();
                          await handleTransitionStatus('scheduled');
                        }}
                        className="px-4 py-1.5 text-xs font-bold rounded-xl bg-purple-600 text-white hover:bg-purple-700 transition-colors cursor-pointer shadow-2xs"
                      >
                        Confirmar Agendamento
                      </button>
                    </div>
                  </div>
                )}

                {campaign.status === 'scheduled' && (
                  <div className="p-4 rounded-xl border border-purple-200 bg-purple-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <span className="text-xs font-bold text-purple-950 flex items-center gap-1.5">
                        <Calendar className="w-4 h-4 text-purple-600" />
                        Campanha Agendada
                      </span>
                      <p className="text-xs text-purple-900">
                        Disparo programado para{' '}
                        <strong>{scheduledAt ? new Date(scheduledAt).toLocaleString() : 'Data programada'}</strong>.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleTransitionStatus('approved')}
                      className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-purple-200 bg-white text-purple-800 hover:bg-purple-50 transition-colors cursor-pointer"
                    >
                      Cancelar agendamento
                    </button>
                  </div>
                )}

                {campaign.channel === 'call' && campaign.status === 'approved' && (
                  <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <span className="text-xs font-bold text-emerald-950 flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        Pronto para Ativação de Ligações
                      </span>
                      <p className="text-xs text-emerald-900">
                        Cria tarefas deduplicadas de chamada diretamente na Central de Operações Diárias.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleActivateCallCampaign}
                      disabled={isActivatingCall}
                      className="px-4 py-2 text-xs font-bold rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 transition-colors shadow-2xs cursor-pointer shrink-0"
                    >
                      {isActivatingCall ? 'Ativando tarefas...' : 'Ativar Tarefas de Ligação'}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Materialized Recipients Table */}
            <div className="card-executive p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-[#08254f] font-heading">
                    Lista Materializada de Destinatários ({recipients.length})
                  </h4>
                  <p className="text-xs text-slate-500">
                    Registro imutável dos contatos congelados para auditoria e disparo.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    const recs = await campaignAudienceService.fetchCampaignRecipients(campaign.id, 100, 0);
                    setRecipients(recs);
                  }}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 transition-colors"
                  title="Atualizar lista"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                </button>
              </div>

              {recipients.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400 italic">
                  Nenhum destinatário congelado ainda. Clique em &quot;Preparar Audiência&quot; acima para registrar os contatos para disparo.
                </div>
              ) : (
                <div className="border border-slate-200 rounded-xl overflow-x-auto text-xs">
                  <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-slate-50 text-slate-600 font-semibold">
                      <tr>
                        <th className="px-3.5 py-2.5 text-left">Destino</th>
                        <th className="px-3.5 py-2.5 text-left">Canal</th>
                        <th className="px-3.5 py-2.5 text-left">Elegibilidade & Auditoria</th>
                        <th className="px-3.5 py-2.5 text-left">Status</th>
                        <th className="px-3.5 py-2.5 text-left">Data</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {recipients.map((r) => (
                        <tr key={r.id} className="hover:bg-slate-50/70">
                          <td className="px-3.5 py-2 font-medium text-slate-900">
                            {r.email || r.phone_e164 || 'Sem destino'}
                          </td>
                          <td className="px-3.5 py-2 uppercase font-bold text-[10px] text-slate-600">
                            {r.channel}
                          </td>
                          <td className="px-3.5 py-2">
                            {r.is_eligible ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px]">
                                <CheckCircle2 className="w-3 h-3" /> Elegível
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 font-bold text-[10px]">
                                <XCircle className="w-3 h-3" /> {r.exclusion_reason || 'Excluído'}
                              </span>
                            )}
                          </td>
                          <td className="px-3.5 py-2">
                            <span className="px-2 py-0.5 rounded-full font-semibold text-[10px] bg-slate-100 text-slate-700 capitalize">
                              {r.status}
                            </span>
                          </td>
                          <td className="px-3.5 py-2 text-slate-500 text-[11px]">
                            {new Date(r.prepared_at).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Collapsible Version History & Audit */}
            <div className="card-executive p-4">
              <button
                type="button"
                onClick={() => setShowVersionsAudit(!showVersionsAudit)}
                className="w-full flex items-center justify-between text-xs font-bold text-slate-700 hover:text-slate-900 cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <History className="w-4 h-4 text-[#449bd5]" />
                  Auditoria & Histórico de Versões ({versions.length} versões registradas)
                </span>
                <span className="text-[11px] text-slate-400">
                  {showVersionsAudit ? 'Ocultar' : 'Expandir'}
                </span>
              </button>

              {showVersionsAudit && (
                <div className="mt-4 pt-3 border-t border-slate-100 space-y-2">
                  <p className="text-xs text-slate-500 mb-3">
                    Histórico imutável de todas as versões salvas para auditoria. Você pode restaurar qualquer versão anterior para o editor.
                  </p>
                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden text-xs">
                    {versions.map((ver) => (
                      <div
                        key={ver.id}
                        className="p-3 flex items-center justify-between hover:bg-slate-50 transition-colors"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900">Versão {ver.version_number}</span>
                            {ver.id === selectedVersionId && (
                              <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-blue-100 text-blue-800">
                                Ativa no Editor
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-500 mt-0.5 truncate max-w-md">
                            Assunto: {ver.subject}
                          </p>
                          <span className="text-[10px] text-slate-400">
                            Salva em {new Date(ver.created_at).toLocaleString()}
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            if (Array.isArray(ver.content_json)) setBlocks(ver.content_json as EmailBlock[]);
                            setSubject(ver.subject);
                            setHtmlContent(ver.html_snapshot);
                            setTextContent(ver.text_snapshot);
                            setSelectedVersionId(ver.id);
                            setActiveSection('content');
                            setSuccessMessage(`Versão ${ver.version_number} restaurada para o editor.`);
                          }}
                          className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition-colors cursor-pointer"
                        >
                          Restaurar
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Zona de Perigo: Excluir Campanha */}
        {isAuthorized && (
          <div className="card-executive p-5 border-rose-200 bg-rose-50/40 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-bold text-rose-900 flex items-center gap-2 font-heading">
                  <AlertTriangle className="w-4 h-4 text-rose-600" />
                  Zona de Perigo
                </h4>
                <p className="text-xs text-rose-700 mt-0.5">
                  Esta ação remove esta campanha do fluxo operacional do EDS HUB. O histórico factual de mensagens e entregabilidade anteriores é protegido.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsDeleteModalOpen(true)}
                disabled={isDeleting}
                data-testid="delete-campaign-button"
                className="px-4 py-2 text-xs font-bold rounded-xl bg-white border border-rose-300 text-rose-700 hover:bg-rose-50 hover:border-rose-400 transition-colors shadow-2xs flex items-center gap-1.5 cursor-pointer shrink-0 self-start sm:self-auto disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4 text-rose-600" />
                Excluir campanha
              </button>
            </div>
          </div>
        )}

        {/* Sticky Bottom Navigation Bar for Mobile and Desktop */}
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 px-4 py-3 shadow-lg">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
            <button
              type="button"
              disabled={currentSectionIndex === 0}
              onClick={() => {
                if (currentSectionIndex > 0) {
                  setActiveSection(sections[currentSectionIndex - 1].id);
                }
              }}
              className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-30 disabled:pointer-events-none flex items-center gap-1 cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Anterior</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleSaveCampaign()}
                disabled={isSaving}
                className="px-4 py-2 text-xs font-bold rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition-colors shadow-2xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                {isSaving ? 'Salvando...' : 'Salvar'}
              </button>

              {currentSectionIndex < sections.length - 1 ? (
                <button
                  type="button"
                  onClick={() => {
                    setActiveSection(sections[currentSectionIndex + 1].id);
                  }}
                  className="px-4 py-2 text-xs font-bold rounded-xl bg-[#08254f] text-white hover:bg-[#061d3d] transition-colors shadow-2xs flex items-center gap-1.5 cursor-pointer"
                >
                  <span>Próximo Passo</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    if (campaign.status === 'draft') handleTransitionStatus('pending_approval');
                    else if (campaign.status === 'pending_approval') handleTransitionStatus('approved');
                    else if (campaign.status === 'approved') handlePrepareAudience();
                  }}
                  className="px-4 py-2 text-xs font-bold rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 transition-colors shadow-2xs flex items-center gap-1.5 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>
                    {campaign.status === 'draft'
                      ? 'Submeter para Aprovação'
                      : campaign.status === 'pending_approval'
                      ? 'Aprovar Campanha'
                      : 'Preparar Audiência'}
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Template Picker Modal */}
      <TemplatePickerModal
        isOpen={isTemplatePickerOpen}
        onClose={() => setIsTemplatePickerOpen(false)}
        templates={availableTemplates}
        selectedTemplateId={selectedTemplateId}
        onSelectTemplate={handleSelectTemplate}
      />

      {/* Template Preview Modal */}
      {loadedTemplate && (
        <TemplatePreviewModal
          isOpen={isPreviewTemplateOpen}
          onClose={() => setIsPreviewTemplateOpen(false)}
          template={loadedTemplate}
        />
      )}

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
              : ({
                  campaign_id: campaign.id,
                  saved_segment_id: seg.id,
                  filter_definition: seg.filter_definition,
                } as CampaignAudience),
          );
          setSuccessMessage(`Segmento salvo "${seg.name}" aplicado com sucesso.`);
        }}
      />

      {/* Delete Campaign Confirmation Modal */}
      {isDeleteModalOpen && campaign && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
        >
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center text-rose-600 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-bold text-slate-900 font-heading">
                  Excluir campanha?
                </h3>
                <div className="mt-2 text-xs text-slate-600 space-y-2">
                  <div>
                    <span className="text-slate-400 font-medium block">Campanha:</span>
                    <strong className="text-slate-900 font-bold text-sm">{campaign.name}</strong>
                  </div>
                  <p className="text-slate-500">
                    Esta ação removerá esta campanha do EDS HUB.
                  </p>
                </div>
              </div>
            </div>

            {deleteError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 font-medium">
                {deleteError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsDeleteModalOpen(false)}
                disabled={isDeleting}
                className="px-4 py-2 text-xs font-semibold rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={handleDeleteCampaign}
                disabled={isDeleting}
                data-testid="confirm-delete-campaign-button"
                className="px-4 py-2 text-xs font-bold rounded-xl bg-rose-600 text-white hover:bg-rose-700 transition-colors shadow-2xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {isDeleting ? 'Excluindo...' : 'Excluir campanha'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
