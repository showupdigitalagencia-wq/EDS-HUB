import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Layout } from '../../components/Layout';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';
import type { FormFieldType, PipelineStage, Tag as TagType } from '../../types';
import {
  Save,
  ArrowLeft,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Settings,
  Eye,
  Sliders,
  Sparkles,
  Layers,
  AlertTriangle,
  Check,
  ExternalLink,
  Phone,
  Mail,
  User,
  List,
  AlignLeft,
  CheckSquare,
} from 'lucide-react';

interface LocalFormField {
  id?: string;
  internal_name: string;
  label: string;
  field_type: FormFieldType;
  required: boolean;
  placeholder: string;
  help_text: string;
  options: string[];
  sort_order: number;
}

const FIELD_PALETTE: {
  type: FormFieldType;
  label: string;
  defaultLabel: string;
  defaultInternal: string;
  icon: typeof User;
  category: 'crm' | 'general';
  defaultOptions?: string[];
}[] = [
  { type: 'first_name', label: 'Nome', defaultLabel: 'Nome', defaultInternal: 'first_name', icon: User, category: 'crm' },
  { type: 'last_name', label: 'Sobrenome', defaultLabel: 'Sobrenome', defaultInternal: 'last_name', icon: User, category: 'crm' },
  { type: 'email', label: 'Endereço de Email', defaultLabel: 'Email', defaultInternal: 'email', icon: Mail, category: 'crm' },
  { type: 'phone', label: 'Telefone / WhatsApp', defaultLabel: 'Telefone / WhatsApp', defaultInternal: 'phone', icon: Phone, category: 'crm' },
  {
    type: 'contact_preference',
    label: 'Preferência de Contato',
    defaultLabel: 'Canal de Preferência',
    defaultInternal: 'contact_preference',
    icon: Sparkles,
    category: 'crm',
    defaultOptions: ['email', 'sms', 'call'],
  },
  {
    type: 'course_interest',
    label: 'Curso de Interesse',
    defaultLabel: 'Programa de Interesse',
    defaultInternal: 'course_interest',
    icon: Layers,
    category: 'crm',
    defaultOptions: ['Comprehensive Esthetics', 'Full Arch Mastery', 'Surgical Foundations'],
  },
  { type: 'text', label: 'Texto Curto', defaultLabel: 'Campo de Texto', defaultInternal: 'custom_text', icon: AlignLeft, category: 'general' },
  { type: 'textarea', label: 'Texto Longo', defaultLabel: 'Comentários / Observações', defaultInternal: 'comments', icon: AlignLeft, category: 'general' },
  {
    type: 'select',
    label: 'Menu Suspenso',
    defaultLabel: 'Selecione uma opção',
    defaultInternal: 'custom_select',
    icon: List,
    category: 'general',
    defaultOptions: ['Opção A', 'Opção B', 'Opção C'],
  },
  {
    type: 'radio',
    label: 'Múltipla Escolha (Radio)',
    defaultLabel: 'Escolha uma opção',
    defaultInternal: 'custom_radio',
    icon: List,
    category: 'general',
    defaultOptions: ['Opção 1', 'Opção 2'],
  },
  {
    type: 'checkbox',
    label: 'Caixa de Seleção (Opt-in)',
    defaultLabel: 'Concordo em receber comunicações',
    defaultInternal: 'consent_opt_in',
    icon: CheckSquare,
    category: 'general',
  },
];

export function FormBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = !id;

  const [isLoading, setIsLoading] = useState(!isNew);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [activeTab, setActiveTab] = useState<'builder' | 'settings' | 'preview'>('builder');

  // Form metadata
  const [formId, setFormId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  const [submitButtonText, setSubmitButtonText] = useState('Submit Application');
  const [successMessage, setSuccessMessage] = useState('Thank you for your application! Our team will contact you shortly.');
  const [redirectUrl, setRedirectUrl] = useState('');
  const [sourceDetail, setSourceDetail] = useState('website-lead-capture');
  const [defaultStageId, setDefaultStageId] = useState('');
  const [defaultTags, setDefaultTags] = useState<string[]>([]);
  const [duplicateUpdateEnabled, setDuplicateUpdateEnabled] = useState(true);
  const [currentVersion, setCurrentVersion] = useState(1);
  const [submissionCount, setSubmissionCount] = useState(0);

  // Form fields
  const [fields, setFields] = useState<LocalFormField[]>([]);
  const [selectedFieldIndex, setSelectedFieldIndex] = useState<number | null>(null);

  // Lookups
  const [pipelineStages, setPipelineStages] = useState<PipelineStage[]>([]);
  const [availableTags, setAvailableTags] = useState<TagType[]>([]);

  // Load pipeline stages & tags
  useEffect(() => {
    async function loadLookups() {
      try {
        const { data: stages } = await supabase
          .from('pipeline_stages')
          .select('*')
          .order('sort_order', { ascending: true });

        if (stages && stages.length > 0) {
          setPipelineStages(stages);
          if (!defaultStageId) {
            const captureStage = stages.find((s) => s.code === 'capture') || stages[0];
            setDefaultStageId(captureStage.id);
          }
        }

        const { data: tags } = await supabase
          .from('tags')
          .select('*')
          .order('name', { ascending: true });

        if (tags) setAvailableTags(tags);
      } catch (err) {
        console.error('Error loading lookups:', err);
      }
    }
    loadLookups();
  }, [defaultStageId]);

  // Load existing form
  const loadForm = useCallback(async (targetId: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const { data: formData, error: formErr } = await supabase
        .from('forms')
        .select('*')
        .eq('id', targetId)
        .single();

      if (formErr) throw formErr;
      if (!formData) throw new Error('Form not found');

      setFormId(formData.id);
      setName(formData.name);
      setSlug(formData.slug);
      setSlugTouched(true);
      setDescription(formData.description || '');
      setStatus(formData.status);
      setSubmitButtonText(formData.submit_button_text || 'Submit');
      setSuccessMessage(formData.success_message || '');
      setRedirectUrl(formData.redirect_url || '');
      setSourceDetail(formData.source_detail || 'website-form');
      setDefaultStageId(formData.default_pipeline_stage_id);
      setDefaultTags(Array.isArray(formData.default_tags) ? formData.default_tags : []);
      setDuplicateUpdateEnabled(formData.duplicate_update_enabled);
      setCurrentVersion(formData.current_version);

      // Check submission count
      const { count } = await supabase
        .from('form_submissions')
        .select('*', { count: 'exact', head: true })
        .eq('form_id', targetId);

      setSubmissionCount(count || 0);

      // Load fields for current version
      const { data: fieldsData, error: fieldsErr } = await supabase
        .from('form_fields')
        .select('*')
        .eq('form_id', targetId)
        .eq('version', formData.current_version)
        .order('sort_order', { ascending: true });

      if (fieldsErr) throw fieldsErr;

      setFields(
        (fieldsData || []).map((f) => ({
          id: f.id,
          internal_name: f.internal_name,
          label: f.label,
          field_type: f.field_type,
          required: f.required,
          placeholder: f.placeholder || '',
          help_text: f.help_text || '',
          options: Array.isArray(f.options) ? f.options : [],
          sort_order: f.sort_order,
        }))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load form');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (id) {
      loadForm(id);
    } else {
      // Default starter fields for a new form
      setFields([
        {
          internal_name: 'first_name',
          label: 'First Name',
          field_type: 'first_name',
          required: true,
          placeholder: 'Dr. Jane',
          help_text: '',
          options: [],
          sort_order: 0,
        },
        {
          internal_name: 'last_name',
          label: 'Last Name',
          field_type: 'last_name',
          required: true,
          placeholder: 'Smith',
          help_text: '',
          options: [],
          sort_order: 1,
        },
        {
          internal_name: 'email',
          label: 'Email Address',
          field_type: 'email',
          required: true,
          placeholder: 'jane.smith@dentalcare.com',
          help_text: '',
          options: [],
          sort_order: 2,
        },
        {
          internal_name: 'phone',
          label: 'Mobile Phone',
          field_type: 'phone',
          required: false,
          placeholder: '+1 (555) 000-0000',
          help_text: 'For SMS status updates',
          options: [],
          sort_order: 3,
        },
        {
          internal_name: 'contact_preference',
          label: 'Preferred Contact Method',
          field_type: 'contact_preference',
          required: true,
          placeholder: '',
          help_text: 'We respect your channel of choice',
          options: ['email', 'sms', 'call'],
          sort_order: 4,
        },
        {
          internal_name: 'course_interest',
          label: 'Clinical Focus Area',
          field_type: 'course_interest',
          required: false,
          placeholder: 'Select your focus area',
          help_text: '',
          options: ['Comprehensive Esthetics', 'Full Arch Mastery', 'Surgical Foundations'],
          sort_order: 5,
        },
      ]);
    }
  }, [id, loadForm]);

  // Auto-slugify name if not edited manually
  const handleNameChange = (val: string) => {
    setName(val);
    if (!slugTouched && isNew) {
      const generated = val
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)+/g, '');
      setSlug(generated);
    }
  };

  const addField = (paletteItem: typeof FIELD_PALETTE[number]) => {
    // Generate unique internal name
    let baseName = paletteItem.defaultInternal;
    let count = 1;
    while (fields.some((f) => f.internal_name === (count === 1 ? baseName : `${baseName}_${count}`))) {
      count++;
    }
    const finalInternalName = count === 1 ? baseName : `${baseName}_${count}`;

    const newField: LocalFormField = {
      internal_name: finalInternalName,
      label: paletteItem.defaultLabel,
      field_type: paletteItem.type,
      required: paletteItem.type === 'email' || paletteItem.type === 'first_name',
      placeholder: '',
      help_text: '',
      options: paletteItem.defaultOptions ? [...paletteItem.defaultOptions] : [],
      sort_order: fields.length,
    };

    setFields((prev) => [...prev, newField]);
    setSelectedFieldIndex(fields.length);
  };

  const removeField = (index: number) => {
    setFields((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.map((f, i) => ({ ...f, sort_order: i }));
    });
    if (selectedFieldIndex === index) {
      setSelectedFieldIndex(null);
    } else if (selectedFieldIndex !== null && selectedFieldIndex > index) {
      setSelectedFieldIndex(selectedFieldIndex - 1);
    }
  };

  const moveField = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= fields.length) return;

    setFields((prev) => {
      const next = [...prev];
      const temp = next[index];
      next[index] = next[targetIndex];
      next[targetIndex] = temp;
      return next.map((f, i) => ({ ...f, sort_order: i }));
    });

    if (selectedFieldIndex === index) {
      setSelectedFieldIndex(targetIndex);
    } else if (selectedFieldIndex === targetIndex) {
      setSelectedFieldIndex(index);
    }
  };

  const updateSelectedField = (key: keyof LocalFormField, value: unknown) => {
    if (selectedFieldIndex === null) return;
    setFields((prev) =>
      prev.map((f, i) => (i === selectedFieldIndex ? { ...f, [key]: value } : f))
    );
  };

  // Save form
  const handleSave = async () => {
    if (!name.trim()) {
      alert('Form Name is required');
      setActiveTab('settings');
      return;
    }
    if (!slug.trim()) {
      alert('Slug is required');
      setActiveTab('settings');
      return;
    }
    if (!defaultStageId) {
      alert('Default Pipeline Stage is required');
      setActiveTab('settings');
      return;
    }
    if (fields.length === 0) {
      alert('At least one form field is required');
      setActiveTab('builder');
      return;
    }

    // Check for email field
    if (!fields.some((f) => f.field_type === 'email')) {
      if (!window.confirm('Notice: This form does not have an Email field. Email is recommended for lead deduplication. Save anyway?')) {
        return;
      }
    }

    setIsSaving(true);
    setError(null);

    try {
      let targetFormId = formId;
      let nextVersion = currentVersion;

      // Check if version bump is required (has prior submissions)
      const isVersionBumpRequired = !isNew && submissionCount > 0;
      if (isVersionBumpRequired) {
        nextVersion = currentVersion + 1;
      }

      if (isNew) {
        // Create new form
        const { data: newForm, error: createErr } = await supabase
          .from('forms')
          .insert({
            name: name.trim(),
            slug: slug.trim().toLowerCase(),
            description: description.trim() || null,
            status,
            submit_button_text: submitButtonText.trim() || 'Submit',
            success_message: successMessage.trim() || 'Thank you for your submission!',
            redirect_url: redirectUrl.trim() || null,
            source_detail: sourceDetail.trim() || 'website-form',
            default_pipeline_stage_id: defaultStageId,
            default_tags: defaultTags,
            duplicate_update_enabled: duplicateUpdateEnabled,
            current_version: 1,
          })
          .select('id')
          .single();

        if (createErr) throw createErr;
        targetFormId = newForm.id;
        setFormId(newForm.id);
      } else {
        // Update existing form
        const { error: updateErr } = await supabase
          .from('forms')
          .update({
            name: name.trim(),
            slug: slug.trim().toLowerCase(),
            description: description.trim() || null,
            status,
            submit_button_text: submitButtonText.trim() || 'Submit',
            success_message: successMessage.trim() || 'Thank you for your submission!',
            redirect_url: redirectUrl.trim() || null,
            source_detail: sourceDetail.trim() || 'website-form',
            default_pipeline_stage_id: defaultStageId,
            default_tags: defaultTags,
            duplicate_update_enabled: duplicateUpdateEnabled,
            current_version: nextVersion,
            updated_at: new Date().toISOString(),
          })
          .eq('id', targetFormId!)
          .not('id', 'is', null);

        if (updateErr) throw updateErr;
      }

      // If form had 0 submissions, replace current version fields.
      // If version bumped, insert new rows under nextVersion, leaving previous versions intact!
      if (!isVersionBumpRequired && !isNew) {
        await supabase
          .from('form_fields')
          .delete()
          .eq('form_id', targetFormId!)
          .eq('version', nextVersion)
          .not('id', 'is', null);
      }

      // Insert field definitions
      const fieldRows = fields.map((f, idx) => ({
        form_id: targetFormId!,
        version: nextVersion,
        field_type: f.field_type,
        internal_name: f.internal_name.trim().toLowerCase(),
        label: f.label.trim(),
        required: f.required,
        placeholder: f.placeholder.trim() || null,
        help_text: f.help_text.trim() || null,
        options: f.options,
        sort_order: idx,
        settings: {},
      }));

      const { error: fieldsInsertErr } = await supabase
        .from('form_fields')
        .insert(fieldRows);

      if (fieldsInsertErr) throw fieldsInsertErr;

      setCurrentVersion(nextVersion);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);

      if (isNew) {
        navigate(`/forms/${targetFormId}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save form');
    } finally {
      setIsSaving(false);
    }
  };

  const selectedField = selectedFieldIndex !== null ? fields[selectedFieldIndex] : null;

  if (isLoading) {
    return (
      <Layout backTo="/forms" eyebrow="INTAKE & FORMULÁRIOS" title={isNew ? 'Novo Formulário' : 'Carregando Formulário...'}>
        <LoadingState message="Carregando configuração do formulário..." />
      </Layout>
    );
  }

  return (
    <Layout
      backTo="/forms"
      eyebrow="INTAKE & FORMULÁRIOS"
      title={isNew ? 'Novo Formulário de Captura' : name || 'Editar Formulário'}
      subtitle="Construtor visual de formulários de captura com visualização ao vivo e vinculação ao CRM"
    >
      <div className="space-y-6">
        {/* Top Header Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/forms')}
              className="p-2 text-slate-500 hover:text-slate-900 rounded-xl hover:bg-slate-100 transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold font-heading text-[#08254f] tracking-tight">
                  {isNew ? 'Create Capture Form' : name || 'Untitled Form'}
                </h1>
                {!isNew && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-[#08254f]/10 text-[#08254f] border border-[#08254f]/20">
                    v{currentVersion}
                  </span>
                )}
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                    status === 'active'
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {status === 'active' ? 'Active' : 'Inactive'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5 font-mono">
                {slug ? `/f/${slug}` : 'URL slug will be generated'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* View Mode Tabs */}
            <div className="inline-flex rounded-xl border border-slate-200/80 p-0.5 bg-slate-50">
              <button
                type="button"
                onClick={() => setActiveTab('builder')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors font-heading ${
                  activeTab === 'builder'
                    ? 'bg-white text-[#08254f] shadow-xs'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <Sliders className="h-3.5 w-3.5" />
                Construtor
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('settings')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors font-heading ${
                  activeTab === 'settings'
                    ? 'bg-white text-[#08254f] shadow-xs'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <Settings className="h-3.5 w-3.5" />
                Configurações
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('preview')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors font-heading ${
                  activeTab === 'preview'
                    ? 'bg-white text-[#08254f] shadow-xs'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <Eye className="h-3.5 w-3.5" />
                Pré-visualização
              </button>
            </div>

            {!isNew && (
              <a
                href={`/f/${slug}`}
                target="_blank"
                rel="noreferrer"
                className="btn-secondary text-xs"
              >
                <ExternalLink className="h-3.5 w-3.5 text-slate-500" />
                Abrir Link
              </a>
            )}

            <button
              type="button"
              id="btn-save-form"
              disabled={isSaving}
              onClick={handleSave}
              className="btn-crimson text-xs disabled:opacity-50 cursor-pointer"
            >
              {saveSuccess ? (
                <>
                  <Check className="h-4 w-4" />
                  Salvo!
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  {isSaving ? 'Salvando...' : 'Salvar Formulário'}
                </>
              )}
            </button>
          </div>
        </div>

        {/* Version Notice for Forms with Submissions */}
        {submissionCount > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3 text-amber-900 text-xs leading-relaxed">
            <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-amber-950">Active Form Versioning Enabled</p>
              <p className="mt-0.5">
                This form has <strong>{submissionCount} existing submissions</strong> under version {currentVersion}.
                Any structural field modifications will be automatically saved as <strong>Version {currentVersion + 1}</strong>,
                preserving the historical field schema for all prior leads.
              </p>
            </div>
          </div>
        )}

        {error && <ErrorState message={error} />}

        {/* TAB 1: BUILDER CANVAS & INSPECTOR */}
        {activeTab === 'builder' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column: Field Palette */}
            <div className="lg:col-span-3 space-y-4">
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                <h3 className="text-xs font-bold text-[#08254f] uppercase tracking-wider mb-3 flex items-center gap-2 font-heading">
                  <Sparkles className="h-3.5 w-3.5 text-[#449bd5]" />
                  Campos Nativos do CRM
                </h3>
                <div className="space-y-1.5">
                  {FIELD_PALETTE.filter((f) => f.category === 'crm').map((item) => (
                    <button
                      key={item.type}
                      type="button"
                      onClick={() => addField(item)}
                      className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-[#08254f]/5 hover:text-[#08254f] rounded-lg border border-slate-200 hover:border-[#08254f]/30 transition-all text-left cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <item.icon className="h-3.5 w-3.5 text-slate-500" />
                        <span>{item.label}</span>
                      </div>
                      <Plus className="h-3 w-3 text-slate-400" />
                    </button>
                  ))}
                </div>

                <h3 className="text-xs font-bold text-[#08254f] uppercase tracking-wider mt-5 mb-3 flex items-center gap-2 font-heading">
                  <Layers className="h-3.5 w-3.5 text-indigo-600" />
                  Campos Gerais
                </h3>
                <div className="space-y-1.5">
                  {FIELD_PALETTE.filter((f) => f.category === 'general').map((item) => (
                    <button
                      key={item.type}
                      type="button"
                      onClick={() => addField(item)}
                      className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-[#08254f]/5 hover:text-[#08254f] rounded-lg border border-slate-200 hover:border-[#08254f]/30 transition-all text-left cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <item.icon className="h-3.5 w-3.5 text-slate-500" />
                        <span>{item.label}</span>
                      </div>
                      <Plus className="h-3 w-3 text-slate-400" />
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Center Column: Form Canvas */}
            <div className="lg:col-span-5 space-y-4">
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm min-h-[500px]">
                <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-100">
                  <div>
                    <h2 className="text-sm font-bold text-[#08254f] font-heading">Estrutura do Formulário</h2>
                    <p className="text-xs text-slate-400 mt-0.5">{fields.length} campos ativos</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedFieldIndex(null)}
                    className="text-xs text-[#125e95] hover:underline cursor-pointer"
                  >
                    Desmarcar seleção
                  </button>
                </div>

                {fields.length === 0 ? (
                  <div className="py-16 text-center text-gray-400">
                    <p className="text-sm font-medium">No fields added yet</p>
                    <p className="text-xs mt-1">Click a field on the left palette to add it to your form.</p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {fields.map((field, idx) => {
                      const isSelected = selectedFieldIndex === idx;
                      return (
                        <div
                          key={`${field.internal_name}-${idx}`}
                          onClick={() => setSelectedFieldIndex(idx)}
                          className={`p-3.5 rounded-lg border cursor-pointer transition-all flex items-center justify-between gap-3 ${
                            isSelected
                              ? 'bg-brand-50/50 border-brand-500 ring-2 ring-brand-500/20 shadow-xs'
                              : 'bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50/50'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="text-xs font-mono font-medium text-gray-400 w-4">
                              {idx + 1}
                            </span>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-sm font-semibold text-gray-900 truncate">
                                  {field.label}
                                </span>
                                {field.required && (
                                  <span className="text-xs font-bold text-red-500" title="Required field">*</span>
                                )}
                              </div>
                              <p className="text-[11px] text-gray-400 font-mono truncate">
                                {field.internal_name} ({field.field_type})
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={() => moveField(idx, 'up')}
                              className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-20 rounded"
                            >
                              <ChevronUp className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              disabled={idx === fields.length - 1}
                              onClick={() => moveField(idx, 'down')}
                              className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-20 rounded"
                            >
                              <ChevronDown className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => removeField(idx)}
                              className="p-1 text-red-400 hover:text-red-600 rounded ml-1"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Field Inspector */}
            <div className="lg:col-span-4 space-y-4">
              <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm sticky top-6">
                <h3 className="text-xs font-bold text-gray-900 uppercase tracking-wider mb-4 pb-3 border-b border-gray-100 flex items-center justify-between">
                  <span>Field Inspector</span>
                  {selectedField && (
                    <span className="text-[11px] font-mono font-normal text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                      {selectedField.field_type}
                    </span>
                  )}
                </h3>

                {selectedField ? (
                  <div className="space-y-4 text-xs">
                    <div>
                      <label className="font-semibold text-gray-700 block mb-1">Field Label</label>
                      <input
                        type="text"
                        value={selectedField.label}
                        onChange={(e) => updateSelectedField('label', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                      />
                    </div>

                    <div>
                      <label className="font-semibold text-gray-700 block mb-1">Internal Name (Database Key)</label>
                      <input
                        type="text"
                        value={selectedField.internal_name}
                        onChange={(e) => updateSelectedField('internal_name', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
                      />
                      <p className="text-[11px] text-gray-400 mt-1">Lowercase alphanumeric with underscores.</p>
                    </div>

                    <div>
                      <label className="font-semibold text-gray-700 block mb-1">Placeholder</label>
                      <input
                        type="text"
                        value={selectedField.placeholder}
                        onChange={(e) => updateSelectedField('placeholder', e.target.value)}
                        placeholder="e.g. Enter your value..."
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                      />
                    </div>

                    <div>
                      <label className="font-semibold text-gray-700 block mb-1">Help Text</label>
                      <input
                        type="text"
                        value={selectedField.help_text}
                        onChange={(e) => updateSelectedField('help_text', e.target.value)}
                        placeholder="Subtle guidance text below input"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                      />
                    </div>

                    <div className="pt-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedField.required}
                          onChange={(e) => updateSelectedField('required', e.target.checked)}
                          className="rounded border-gray-300 text-brand-600 focus:ring-brand-500 h-4 w-4"
                        />
                        <span className="font-medium text-gray-800 text-sm">Required Field</span>
                      </label>
                    </div>

                    {/* Options list for select, radio, course_interest */}
                    {['select', 'radio', 'course_interest'].includes(selectedField.field_type) && (
                      <div className="pt-3 border-t border-gray-100">
                        <label className="font-semibold text-gray-700 block mb-2">Options (One per line)</label>
                        <textarea
                          rows={4}
                          value={selectedField.options.join('\n')}
                          onChange={(e) =>
                            updateSelectedField(
                              'options',
                              e.target.value.split('\n').filter((opt) => opt.trim() !== '')
                            )
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="py-12 text-center text-gray-400">
                    <Sliders className="h-8 w-8 mx-auto text-gray-300 mb-2" />
                    <p className="font-medium text-xs">No field selected</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">Click any field on the canvas to configure its properties.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: FORM SETTINGS */}
        {activeTab === 'settings' && (
          <div className="max-w-3xl mx-auto bg-white p-6 rounded-xl border border-gray-200 shadow-sm space-y-6">
            <div>
              <h2 className="text-base font-bold text-gray-900">Form Configuration & Intake Rules</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Define canonical routing, stage progression, and submission behavior.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="md:col-span-2">
                <label className="text-xs font-semibold text-gray-700 block mb-1">Form Name *</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="e.g. Website Homepage Consultation Form"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Public URL Slug *</label>
                <div className="flex items-center">
                  <span className="px-3 py-2 bg-gray-100 border border-r-0 border-gray-300 rounded-l-lg text-xs font-mono text-gray-500">
                    /f/
                  </span>
                  <input
                    type="text"
                    value={slug}
                    onChange={(e) => {
                      setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
                      setSlugTouched(true);
                    }}
                    placeholder="consultation"
                    className="w-full px-3 py-2 border border-gray-300 rounded-r-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Source Detail (Context Tag)</label>
                <input
                  type="text"
                  value={sourceDetail}
                  onChange={(e) => setSourceDetail(e.target.value)}
                  placeholder="website-homepage"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <p className="text-[11px] text-gray-400 mt-1">
                  Stored as metadata alongside canonical <code className="text-brand-600">source = 'form'</code>.
                </p>
              </div>

              <div className="md:col-span-2">
                <label className="text-xs font-semibold text-gray-700 block mb-1">Description (Optional)</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Internal description for team reference..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Default Pipeline Stage *</label>
                <select
                  value={defaultStageId}
                  onChange={(e) => setDefaultStageId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
                >
                  {pipelineStages.map((stage) => (
                    <option key={stage.id} value={stage.id}>
                      {stage.name} ({stage.code})
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-gray-400 mt-1">Stage newly created leads will enter initially.</p>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Submit Button Text</label>
                <input
                  type="text"
                  value={submitButtonText}
                  onChange={(e) => setSubmitButtonText(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              <div className="md:col-span-2">
                <label className="text-xs font-semibold text-gray-700 block mb-1">Success Message</label>
                <textarea
                  rows={2}
                  value={successMessage}
                  onChange={(e) => setSuccessMessage(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              <div className="md:col-span-2">
                <label className="text-xs font-semibold text-gray-700 block mb-1">Redirect URL (Optional)</label>
                <input
                  type="url"
                  value={redirectUrl}
                  onChange={(e) => setRedirectUrl(e.target.value)}
                  placeholder="https://yourwebsite.com/thank-you"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <p className="text-[11px] text-gray-400 mt-1">Redirects visitor automatically after successful submission.</p>
              </div>

              {availableTags.length > 0 && (
                <div className="md:col-span-2">
                  <label className="text-xs font-semibold text-gray-700 block mb-1.5">
                    Default Lead Tags
                  </label>
                  <div className="flex flex-wrap gap-2 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                    {availableTags.map((tag) => {
                      const isChecked = defaultTags.includes(tag.id);
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() => {
                            setDefaultTags((prev) =>
                              isChecked ? prev.filter((tid) => tid !== tag.id) : [...prev, tag.id]
                            );
                          }}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                            isChecked
                              ? 'bg-brand-600 text-white shadow-2xs'
                              : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-100'
                          }`}
                        >
                          <span>{tag.name}</span>
                          {isChecked && <Check className="h-3 w-3" />}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1">Automatically assigned to newly created or updated leads from this form.</p>
                </div>
              )}

              <div className="md:col-span-2 pt-4 border-t border-gray-100 flex items-center justify-between">
                <div>
                  <span className="text-sm font-semibold text-gray-900 block">Non-destructive Lead Update</span>
                  <span className="text-xs text-gray-500 block mt-0.5">
                    When a submission matches an existing lead, merge non-empty values without overwriting existing data with blanks.
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={duplicateUpdateEnabled}
                  onChange={(e) => setDuplicateUpdateEnabled(e.target.checked)}
                  className="rounded border-gray-300 text-brand-600 focus:ring-brand-500 h-5 w-5"
                />
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: LIVE PREVIEW */}
        {activeTab === 'preview' && (
          <div className="max-w-xl mx-auto">
            <div className="bg-white rounded-2xl border border-gray-200 shadow-lg p-6 sm:p-8">
              <div className="text-center mb-6">
                <h2 className="text-xl font-bold text-gray-900 tracking-tight">{name || 'Form Title'}</h2>
                {description && <p className="text-xs text-gray-500 mt-1.5">{description}</p>}
              </div>

              <form onSubmit={(e) => e.preventDefault()} className="space-y-4">
                {fields.map((field) => (
                  <div key={field.internal_name} className="space-y-1">
                    <label className="block text-xs font-semibold text-gray-700">
                      {field.label}
                      {field.required && <span className="text-red-500 ml-0.5">*</span>}
                    </label>

                    {field.field_type === 'textarea' ? (
                      <textarea
                        placeholder={field.placeholder || ''}
                        disabled
                        rows={3}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-gray-50"
                      />
                    ) : field.field_type === 'select' || field.field_type === 'course_interest' ? (
                      <select disabled className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-gray-50">
                        <option value="">{field.placeholder || 'Select an option...'}</option>
                        {field.options.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : field.field_type === 'contact_preference' ? (
                      <div className="grid grid-cols-3 gap-2">
                        {['email', 'sms', 'call'].map((pref) => (
                          <div
                            key={pref}
                            className="p-2 border border-gray-300 rounded-lg text-center text-xs font-medium text-gray-700 bg-gray-50 uppercase"
                          >
                            {pref}
                          </div>
                        ))}
                      </div>
                    ) : field.field_type === 'checkbox' ? (
                      <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-600">
                        <input type="checkbox" disabled className="rounded border-gray-300" />
                        <span>{field.placeholder || field.label}</span>
                      </label>
                    ) : (
                      <input
                        type={field.field_type === 'email' ? 'email' : 'text'}
                        placeholder={field.placeholder || ''}
                        disabled
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-gray-50"
                      />
                    )}

                    {field.help_text && (
                      <p className="text-[11px] text-gray-400">{field.help_text}</p>
                    )}
                  </div>
                ))}

                <button
                  type="button"
                  disabled
                  className="w-full py-3 bg-brand-600 text-white rounded-lg text-sm font-semibold shadow-sm mt-6 opacity-90 cursor-not-allowed"
                >
                  {submitButtonText}
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
