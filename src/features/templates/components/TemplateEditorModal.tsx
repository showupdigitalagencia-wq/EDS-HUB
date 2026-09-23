import { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from '../../../lib/supabase';
import { BlockEditor } from '../../editor/BlockEditor';
import { CategorySelect } from './CategorySelect';
import { sanitizeHtml } from '../../../utils/sanitize-html';
import {
  getTemplateChannel,
  getTemplateSubject,
  GLOBAL_TEMPLATE_VARIABLES,
  calculateSmsSegments,
  renderTemplateWithSampleData,
  SAMPLE_PREVIEW_DATA,
  type TemplateChannel,
} from '../../../utils/template-variables';
import { renderBlocksToHtml, renderBlocksToText } from '../../editor/utils/htmlGenerator';
import { getTemplateUsage, type TemplateUsage } from '../services/template-usage-service';
import type { EmailTemplate } from '../../../types';
import type { EmailBlock, BlockType } from '../../editor/types';
import {
  Mail,
  MessageSquare,
  Save,
  Info,
  Sparkles,
  ArrowLeft,
  X,
  Eye,
  PenTool,
  LayoutGrid,
  Monitor,
  Smartphone,
  ShieldCheck,
  Trash2,
  ChevronUp,
  ChevronDown,
  ExternalLink,
} from 'lucide-react';

interface TemplateEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingTemplate: EmailTemplate | null;
  onSaveSuccess: () => void;
}

type EditorMode = 'compor' | 'blocos' | 'previa';
type PreviewDevice = 'desktop' | 'mobile';

export function TemplateEditorModal({
  isOpen,
  onClose,
  editingTemplate,
  onSaveSuccess,
}: TemplateEditorModalProps) {
  // Navigation & Mode
  const [channel, setChannel] = useState<TemplateChannel>('email');
  const [activeMode, setActiveMode] = useState<EditorMode>('compor');
  const [previewDevice, setPreviewDevice] = useState<PreviewDevice>('desktop');

  // Metadata state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('general');

  // Email specific state
  const [subject, setSubject] = useState('');
  const [currentBlocks, setCurrentBlocks] = useState<EmailBlock[]>([]);
  const [currentHtml, setCurrentHtml] = useState('');
  const [currentText, setCurrentText] = useState('');
  const [editingButtonBlockId, setEditingButtonBlockId] = useState<string | null>(null);

  // SMS specific state
  const [smsBody, setSmsBody] = useState('');
  const smsTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const subjectInputRef = useRef<HTMLInputElement | null>(null);

  // Status & Usage
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<TemplateUsage | null>(null);
  const [variableCopiedNotice, setVariableCopiedNotice] = useState<string | null>(null);

  // Initialize or reset state when modal opens
  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setActiveMode('compor');
    setPreviewDevice('desktop');
    setEditingButtonBlockId(null);

    if (editingTemplate) {
      const ch = getTemplateChannel(editingTemplate);
      setChannel(ch);
      setName(editingTemplate.name || '');
      setDescription(editingTemplate.description || '');
      setCategory(editingTemplate.category || 'general');

      if (ch === 'email') {
        setSubject(getTemplateSubject(editingTemplate));
        const cj = editingTemplate.content_json;
        let loadedBlocks: EmailBlock[] = [];
        if (Array.isArray(cj)) {
          loadedBlocks = cj as EmailBlock[];
        } else if (
          typeof cj === 'object' &&
          cj !== null &&
          Array.isArray((cj as { blocks?: unknown[] }).blocks)
        ) {
          loadedBlocks = (cj as { blocks: EmailBlock[] }).blocks;
        }
        setCurrentBlocks(loadedBlocks);
        setCurrentHtml(editingTemplate.html_template || renderBlocksToHtml(loadedBlocks));
        setCurrentText(editingTemplate.text_template || renderBlocksToText(loadedBlocks));
        setSmsBody('');
      } else {
        setSubject('');
        setCurrentBlocks([]);
        setCurrentHtml('');
        setCurrentText('');
        setSmsBody(editingTemplate.text_template || '');
      }

      // Check origin usage (non-blocking)
      getTemplateUsage(editingTemplate.id)
        .then((u) => setUsage(u))
        .catch((err) => console.error('[TemplateEditor] Usage check failed:', err));
    } else {
      setChannel('email');
      setName('');
      setDescription('');
      setCategory('general');
      setSubject('');
      const defaultBlocks: EmailBlock[] = [
        {
          id: 'h-1',
          type: 'heading',
          text: 'Atualização exclusiva para {{salutation}}',
          level: 1,
          align: 'left',
          color: '#08254f',
        },
        {
          id: 't-1',
          type: 'text',
          text: 'Olá {{first_name}},\n\nObrigado por seu contato com a Expert Dental Solutions. Estamos prontos para apoiar o crescimento da sua prática clínica.',
          align: 'left',
          color: '#334155',
        },
        {
          id: 'b-1',
          type: 'button',
          label: 'Conhecer Soluções',
          url: 'https://expdentalsolutions.com',
          align: 'center',
          bgColor: '#08254f',
          textColor: '#ffffff',
        },
      ];
      setCurrentBlocks(defaultBlocks);
      setCurrentHtml(renderBlocksToHtml(defaultBlocks));
      setCurrentText(renderBlocksToText(defaultBlocks));
      setSmsBody('');
      setUsage(null);
    }
  }, [isOpen, editingTemplate]);

  // Handle ESC key to close
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    }
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  // Sync rendered HTML/text whenever blocks change
  const handleBlocksChange = (newBlocks: EmailBlock[]) => {
    setCurrentBlocks(newBlocks);
    const html = renderBlocksToHtml(newBlocks);
    const text = renderBlocksToText(newBlocks);
    setCurrentHtml(html);
    setCurrentText(text);
  };

  // Variable chip interaction
  const handleInsertVariable = (varKey: string) => {
    // Copy to clipboard for easy pasting
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(varKey).catch(() => {});
      setVariableCopiedNotice(`Copiado: ${varKey}`);
      setTimeout(() => setVariableCopiedNotice(null), 2500);
    }

    if (channel === 'sms') {
      const textarea = smsTextareaRef.current;
      if (!textarea) {
        setSmsBody((prev) => `${prev} ${varKey}`);
        return;
      }
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newText = smsBody.substring(0, start) + varKey + smsBody.substring(end);
      setSmsBody(newText);
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(start + varKey.length, start + varKey.length);
      }, 0);
    } else {
      // In email: if subject is active or has focus, insert into subject
      if (document.activeElement === subjectInputRef.current) {
        setSubject((prev) => `${prev ? prev + ' ' : ''}${varKey}`);
        return;
      }

      // Otherwise insert into first text block or add variable
      if (currentBlocks.length > 0) {
        const textBlockIndex = currentBlocks.findIndex((b) => b.type === 'text');
        if (textBlockIndex >= 0) {
          const updated = [...currentBlocks];
          const tb = updated[textBlockIndex];
          if (tb.type === 'text') {
            updated[textBlockIndex] = { ...tb, text: `${tb.text} ${varKey}` };
            handleBlocksChange(updated);
            return;
          }
        }
      }
      // If no text block exists, append to subject
      setSubject((prev) => `${prev ? prev + ' ' : ''}${varKey}`);
    }
  };

  // Add block from composer quick bar
  const handleQuickAddBlock = (type: BlockType) => {
    const id = `${type}-${Date.now()}`;
    let newBlock: EmailBlock;

    switch (type) {
      case 'heading':
        newBlock = { id, type: 'heading', text: 'Novo Título', level: 2, align: 'left', color: '#08254f' };
        break;
      case 'text':
        newBlock = { id, type: 'text', text: 'Novo parágrafo...', align: 'left', color: '#334155' };
        break;
      case 'image':
        newBlock = {
          id,
          type: 'image',
          url: 'https://placehold.co/600x250/08254f/ffffff?text=Banner+Informativo',
          alt: 'Imagem em destaque',
          align: 'center',
          width: '100%',
        };
        break;
      case 'button':
        newBlock = {
          id,
          type: 'button',
          label: 'Acessar Link',
          url: 'https://expdentalsolutions.com',
          align: 'center',
          bgColor: '#08254f',
          textColor: '#ffffff',
        };
        break;
      case 'divider':
        newBlock = { id, type: 'divider', thickness: 1, color: '#e2e8f0' };
        break;
      case 'spacer':
        newBlock = { id, type: 'spacer', height: 24 };
        break;
    }

    const next = [...currentBlocks, newBlock];
    handleBlocksChange(next);
  };

  const handleUpdateBlock = (id: string, updates: Partial<EmailBlock>) => {
    const next = currentBlocks.map((b) => (b.id === id ? ({ ...b, ...updates } as EmailBlock) : b));
    handleBlocksChange(next);
  };

  const handleDeleteBlock = (id: string) => {
    const next = currentBlocks.filter((b) => b.id !== id);
    handleBlocksChange(next);
  };

  const handleMoveBlock = (index: number, direction: 'up' | 'down') => {
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= currentBlocks.length) return;
    const copy = [...currentBlocks];
    const item = copy[index];
    copy[index] = copy[targetIdx];
    copy[targetIdx] = item;
    handleBlocksChange(copy);
  };

  // Save handler
  const handleSave = async () => {
    if (!name.trim()) {
      setError('Por favor, informe o nome do template.');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      if (channel === 'email') {
        const payloadContentJson = {
          channel: 'email',
          subject: subject.trim(),
          blocks: currentBlocks,
        };

        if (editingTemplate) {
          const { error: upErr } = await supabase
            .from('email_templates')
            .update({
              name: name.trim(),
              description: description.trim() || null,
              category,
              content_json: payloadContentJson,
              html_template: currentHtml,
              text_template: currentText,
              updated_at: new Date().toISOString(),
            })
            .eq('id', editingTemplate.id);

          if (upErr) throw upErr;
        } else {
          const { error: insErr } = await supabase.from('email_templates').insert({
            name: name.trim(),
            description: description.trim() || null,
            category,
            content_json: payloadContentJson,
            html_template: currentHtml,
            text_template: currentText,
          });

          if (insErr) throw insErr;
        }
      } else {
        // SMS channel
        const payloadContentJson = {
          channel: 'sms',
          body: smsBody.trim(),
        };

        if (editingTemplate) {
          const { error: upErr } = await supabase
            .from('email_templates')
            .update({
              name: name.trim(),
              description: description.trim() || null,
              category,
              content_json: payloadContentJson,
              html_template: '',
              text_template: smsBody.trim(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', editingTemplate.id);

          if (upErr) throw upErr;
        } else {
          const { error: insErr } = await supabase.from('email_templates').insert({
            name: name.trim(),
            description: description.trim() || null,
            category,
            content_json: payloadContentJson,
            html_template: '',
            text_template: smsBody.trim(),
          });

          if (insErr) throw insErr;
        }
      }

      onSaveSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar template');
    } finally {
      setIsSaving(false);
    }
  };

  // Preview derivations
  const smsMetrics = calculateSmsSegments(smsBody);

  const previewEmailData = useMemo(() => {
    const rawSubject = subject || name || 'Assunto do Email';
    const substitutedSubject = renderTemplateWithSampleData(rawSubject, 'global');
    const substitutedHtml = renderTemplateWithSampleData(currentHtml, 'global');
    const safeHtml = sanitizeHtml(substitutedHtml);

    return {
      subject: substitutedSubject,
      html: safeHtml,
    };
  }, [subject, name, currentHtml]);

  const previewSmsData = useMemo(() => {
    const substitutedText = renderTemplateWithSampleData(smsBody, 'global');
    const segments = calculateSmsSegments(substitutedText);
    return {
      text: substitutedText,
      segments,
    };
  }, [smsBody]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 md:p-6"
    >
      {/* Dimmed backdrop with subtle blur */}
      <div
        onClick={onClose}
        aria-hidden="true"
        className="fixed inset-0 bg-[#061a38]/50 backdrop-blur-xs transition-opacity duration-200"
      />

      {/* Main Composer Surface */}
      <div className="relative w-full h-full sm:h-auto sm:max-h-[92vh] sm:max-w-5xl bg-[#f7f9fc] sm:rounded-2xl shadow-2xl border-0 sm:border sm:border-slate-200/90 flex flex-col overflow-hidden z-10 animate-in fade-in-0 zoom-in-95 duration-200">
        {/* ===================================================================
            1. STICKY TOP HEADER
        =================================================================== */}
        <header className="sticky top-0 z-20 bg-white border-b border-slate-200/90 px-4 sm:px-6 py-3 shrink-0 flex items-center justify-between gap-3 shadow-2xs">
          {/* Left: Back / Title */}
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 -ml-1 text-slate-500 hover:text-[#08254f] hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              title="Voltar"
              aria-label="Voltar"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold text-[#08254f] truncate font-heading tracking-tight">
                {editingTemplate
                  ? `Editar Template (${channel === 'sms' ? 'SMS' : 'Email'})`
                  : 'Novo Template'}
              </h2>
              <p className="text-[11px] text-slate-500 truncate hidden sm:block">
                Crie uma mensagem profissional para seus leads.
              </p>
            </div>
          </div>

          {/* Center: Mode Segmented Tabs */}
          <div className="flex bg-slate-100/90 p-0.5 rounded-xl border border-slate-200/80 text-xs font-medium">
            <button
              type="button"
              onClick={() => setActiveMode('compor')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                activeMode === 'compor'
                  ? 'bg-white text-[#08254f] font-bold shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <PenTool className="h-3.5 w-3.5 text-[#08254f]" />
              <span>Compor</span>
            </button>

            {channel === 'email' && (
              <button
                type="button"
                onClick={() => setActiveMode('blocos')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  activeMode === 'blocos'
                    ? 'bg-white text-[#08254f] font-bold shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <LayoutGrid className="h-3.5 w-3.5 text-[#449bd5]" />
                <span>Blocos</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setActiveMode('previa')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                activeMode === 'previa'
                  ? 'bg-white text-[#08254f] font-bold shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Eye className="h-3.5 w-3.5 text-emerald-600" />
              <span>Prévia</span>
            </button>
          </div>

          {/* Right: Quick Save Action */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="px-3.5 sm:px-4 py-1.5 bg-[#8a1c1c] hover:bg-[#721717] text-white text-xs font-bold rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
            >
              <Save className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{isSaving ? 'Salvando...' : 'Salvar'}</span>
              <span className="sm:hidden">{isSaving ? '...' : 'Salvar'}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer hidden sm:block"
              title="Fechar"
              aria-label="Fechar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* ===================================================================
            2. SCROLLABLE BODY
        =================================================================== */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {/* Informational Origin Usage Notice (Factual & Non-Alarming) */}
          {editingTemplate && usage && usage.totalCount > 0 && (
            <div className="p-3 bg-blue-50/70 border border-blue-200/80 rounded-xl text-xs text-blue-900 flex items-start gap-2.5 shadow-2xs">
              <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold font-heading">
                  Este template já foi utilizado como origem em {usage.campaigns.length} campanha(s) e{' '}
                  {usage.automations.length + usage.sequences.length} fluxo(s).
                </p>
                <p className="text-[11px] text-blue-800/80 mt-0.5">
                  Alterações feitas aqui não modificam automaticamente conteúdos já salvos nesses fluxos.
                </p>
              </div>
            </div>
          )}

          {/* Error Alert */}
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-medium shadow-2xs">
              {error}
            </div>
          )}

          {/* ===================================================================
              BASIC SETTINGS: CANAL, NOME, CATEGORIA, DESCRIÇÃO
          =================================================================== */}
          <section className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 shadow-2xs space-y-4">
            {/* Channel Selection: Only selectable when creating new */}
            {!editingTemplate && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-2 font-heading">
                  Canal de Comunicação
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {/* Email Card */}
                  <button
                    type="button"
                    onClick={() => {
                      setChannel('email');
                      if (activeMode === 'blocos') setActiveMode('compor');
                    }}
                    className={`p-3 rounded-xl border text-left flex items-start gap-3 transition-all duration-150 cursor-pointer ${
                      channel === 'email'
                        ? 'border-[#08254f] bg-blue-50/30 text-[#08254f] ring-1 ring-[#08254f]/15 shadow-2xs'
                        : 'border-slate-200/90 hover:border-slate-300 bg-white text-slate-700'
                    }`}
                  >
                    <div
                      className={`p-2 rounded-lg shrink-0 ${
                        channel === 'email' ? 'bg-[#08254f] text-white' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      <Mail className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-xs sm:text-sm font-heading">Email Marketing</p>
                      <p className="text-[11px] text-slate-500 truncate">Campanhas e automações</p>
                    </div>
                  </button>

                  {/* SMS Card */}
                  <button
                    type="button"
                    onClick={() => {
                      setChannel('sms');
                      if (activeMode === 'blocos') setActiveMode('compor');
                    }}
                    className={`p-3 rounded-xl border text-left flex items-start gap-3 transition-all duration-150 cursor-pointer ${
                      channel === 'sms'
                        ? 'border-[#08254f] bg-blue-50/30 text-[#08254f] ring-1 ring-[#08254f]/15 shadow-2xs'
                        : 'border-slate-200/90 hover:border-slate-300 bg-white text-slate-700'
                    }`}
                  >
                    <div
                      className={`p-2 rounded-lg shrink-0 ${
                        channel === 'sms' ? 'bg-[#08254f] text-white' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      <MessageSquare className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-xs sm:text-sm font-heading">SMS</p>
                      <p className="text-[11px] text-slate-500 truncate">Mensagens curtas</p>
                    </div>
                  </button>
                </div>
              </div>
            )}

            {/* Basic metadata fields */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1.5 font-heading">
                  Nome do Template
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={
                    channel === 'email'
                      ? 'Ex: Boas-vindas Pós-Inscrição'
                      : 'Ex: Lembrete de Matrícula SMS'
                  }
                  className="w-full h-11 px-3.5 text-xs sm:text-sm bg-white border border-slate-200/90 hover:border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#08254f]/15 focus:border-[#08254f] transition-all"
                />
              </div>

              <div>
                <CategorySelect
                  value={category}
                  onChange={(val) => setCategory(val)}
                  label="Categoria"
                />
              </div>

              <div className="sm:col-span-3">
                <label className="block text-xs font-semibold text-slate-700 mb-1.5 font-heading">
                  Descrição (opcional)
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Anotações para a equipe sobre a finalidade deste template..."
                  className="w-full h-11 px-3.5 text-xs sm:text-sm bg-white border border-slate-200/90 hover:border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#08254f]/15 focus:border-[#08254f] transition-all"
                />
              </div>
            </div>
          </section>

          {/* ===================================================================
              PERSONALIZAÇÃO (GLOBAL VARIABLES)
          =================================================================== */}
          <section className="bg-white rounded-2xl border border-slate-200/80 p-3.5 sm:p-4 shadow-2xs">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 mb-2.5">
              <div className="flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-[#449bd5]" />
                <span className="text-xs font-bold text-[#08254f] font-heading">
                  Personalização
                </span>
                <span className="text-[11px] text-slate-400 font-normal">
                  — Insira dados automaticamente na mensagem.
                </span>
              </div>
              {variableCopiedNotice && (
                <span className="text-[10px] text-emerald-600 font-semibold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 animate-in fade-in">
                  {variableCopiedNotice}
                </span>
              )}
            </div>

            {/* Chips */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {GLOBAL_TEMPLATE_VARIABLES.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => handleInsertVariable(v.key)}
                  className="flex items-center justify-between px-3 py-2 bg-slate-50/80 hover:bg-blue-50/50 border border-slate-200/80 hover:border-[#08254f]/30 rounded-xl transition-all duration-150 cursor-pointer text-left group"
                  title="Clique para inserir no texto ou copiar"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-[#08254f] bg-white px-2 py-0.5 rounded border border-slate-200/80">
                      {v.key}
                    </span>
                    <span className="text-xs text-slate-600 font-medium">{v.label}</span>
                  </div>
                  <span className="text-[10px] text-slate-400 group-hover:text-[#08254f] transition-colors">
                    Inserir ↵
                  </span>
                </button>
              ))}
            </div>
          </section>

          {/* ===================================================================
              MODE 1: COMPOR (GMAIL / SUPERHUMAN WRITING EXPERIENCE)
          =================================================================== */}
          {activeMode === 'compor' && (
            <div>
              {channel === 'email' ? (
                /* EMAIL COMPOSER */
                <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden flex flex-col">
                  {/* Gmail-style Envelope Header */}
                  <div className="bg-slate-50/70 border-b border-slate-200/80 px-4 sm:px-6 py-3 space-y-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400 font-medium w-16">De:</span>
                      <span className="font-semibold text-slate-700">
                        Expert Dental Solutions &lt;preview@exemplo.com&gt;
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400 font-medium w-16">Para:</span>
                      <span className="text-slate-500">
                        Destinatários da automação ou campanha (Lead / Aluno)
                      </span>
                    </div>

                    {/* Clean Subject Line */}
                    <div className="flex items-center gap-2 pt-2 border-t border-slate-200/60">
                      <label
                        htmlFor="email-subject-input"
                        className="text-slate-700 font-bold w-16 font-heading"
                      >
                        Assunto:
                      </label>
                      <input
                        id="email-subject-input"
                        ref={subjectInputRef}
                        type="text"
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        placeholder="Atualização importante para {{first_name}}"
                        className="flex-1 h-9 px-2.5 text-xs sm:text-sm font-semibold text-[#08254f] bg-transparent border-0 border-b border-transparent hover:border-slate-300 focus:border-[#08254f] focus:outline-none transition-colors placeholder:text-slate-400 placeholder:font-normal"
                      />
                    </div>
                  </div>

                  {/* Gmail Writing Canvas Toolbar */}
                  <div className="px-4 sm:px-6 py-2 bg-slate-50/40 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[11px] font-semibold text-slate-500 mr-1 font-heading">
                        + Bloco:
                      </span>
                      {[
                        { type: 'heading' as BlockType, label: 'Título' },
                        { type: 'text' as BlockType, label: 'Texto' },
                        { type: 'button' as BlockType, label: 'Botão' },
                        { type: 'image' as BlockType, label: 'Imagem' },
                        { type: 'divider' as BlockType, label: 'Divisor' },
                        { type: 'spacer' as BlockType, label: 'Espaço' },
                      ].map((item) => (
                        <button
                          key={item.type}
                          type="button"
                          onClick={() => handleQuickAddBlock(item.type)}
                          className="px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-200/90 rounded-lg text-xs font-medium text-slate-700 transition-colors shadow-2xs cursor-pointer"
                        >
                          + {item.label}
                        </button>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => setActiveMode('blocos')}
                      className="text-xs text-[#08254f] font-semibold hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <LayoutGrid className="w-3.5 h-3.5" />
                      <span>Organizar Blocos</span>
                    </button>
                  </div>

                  {/* Gmail Body Document Canvas */}
                  <div className="p-5 sm:p-8 min-h-[360px] space-y-4 bg-white">
                    {currentBlocks.length === 0 ? (
                      <div className="text-center py-12 text-slate-400 text-xs">
                        <p className="font-semibold text-slate-600 mb-1">
                          Nenhum conteúdo no corpo do email.
                        </p>
                        <p>Use os botões acima para adicionar Título, Texto ou Botão de Ação.</p>
                      </div>
                    ) : (
                      currentBlocks.map((block, idx) => (
                        <div
                          key={block.id}
                          className="relative group rounded-xl hover:bg-slate-50/50 p-2 sm:p-3 -mx-2 sm:-mx-3 transition-colors"
                        >
                          {/* Floating micro-toolbar on hover */}
                          <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity bg-white border border-slate-200 rounded-lg shadow-xs px-1.5 py-0.5 flex items-center gap-1 z-10">
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={() => handleMoveBlock(idx, 'up')}
                              className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-20 cursor-pointer"
                              title="Mover para cima"
                            >
                              <ChevronUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={idx === currentBlocks.length - 1}
                              onClick={() => handleMoveBlock(idx, 'down')}
                              className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-20 cursor-pointer"
                              title="Mover para baixo"
                            >
                              <ChevronDown className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteBlock(block.id)}
                              className="p-1 text-slate-400 hover:text-red-600 cursor-pointer"
                              title="Excluir"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          {/* Editable Element Rendering */}
                          {block.type === 'heading' && (
                            <input
                              type="text"
                              value={block.text}
                              onChange={(e) => handleUpdateBlock(block.id, { text: e.target.value })}
                              placeholder="Digite o título do email..."
                              className={`w-full font-bold text-[#08254f] bg-transparent border-0 focus:outline-none focus:ring-0 p-0 ${
                                block.level === 1
                                  ? 'text-xl sm:text-2xl'
                                  : block.level === 2
                                    ? 'text-lg sm:text-xl'
                                    : 'text-base sm:text-lg'
                              }`}
                              style={{ textAlign: block.align }}
                            />
                          )}

                          {block.type === 'text' && (
                            <textarea
                              rows={Math.max(2, block.text.split('\n').length)}
                              value={block.text}
                              onChange={(e) => handleUpdateBlock(block.id, { text: e.target.value })}
                              placeholder="Escreva sua mensagem aqui..."
                              className="w-full text-slate-800 text-sm sm:text-base leading-relaxed bg-transparent border-0 focus:outline-none focus:ring-0 p-0 resize-none font-sans"
                              style={{ textAlign: block.align }}
                            />
                          )}

                          {block.type === 'button' && (
                            <div
                              className="py-2 flex flex-col"
                              style={{
                                alignItems:
                                  block.align === 'center'
                                    ? 'center'
                                    : block.align === 'right'
                                      ? 'flex-end'
                                      : 'flex-start',
                              }}
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  setEditingButtonBlockId(
                                    editingButtonBlockId === block.id ? null : block.id
                                  )
                                }
                                className="px-6 py-2.5 bg-[#08254f] hover:bg-[#061a38] text-white text-xs sm:text-sm font-bold rounded-xl shadow-xs transition-all flex items-center gap-2 cursor-pointer"
                              >
                                <span>{block.label || 'Clique aqui'}</span>
                                <ExternalLink className="w-3.5 h-3.5 opacity-70" />
                              </button>

                              {/* Button inline configuration */}
                              {editingButtonBlockId === block.id && (
                                <div className="mt-2 p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2 w-full max-w-sm animate-in fade-in text-xs shadow-2xs">
                                  <div>
                                    <label className="block text-[11px] text-slate-500 mb-0.5">
                                      Texto do botão
                                    </label>
                                    <input
                                      type="text"
                                      value={block.label}
                                      onChange={(e) =>
                                        handleUpdateBlock(block.id, { label: e.target.value })
                                      }
                                      className="w-full h-8 px-2.5 border border-slate-200 rounded-lg text-xs"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-[11px] text-slate-500 mb-0.5">
                                      Link de Destino (URL)
                                    </label>
                                    <input
                                      type="url"
                                      value={block.url}
                                      onChange={(e) =>
                                        handleUpdateBlock(block.id, { url: e.target.value })
                                      }
                                      className="w-full h-8 px-2.5 border border-slate-200 rounded-lg text-xs"
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          {block.type === 'image' && (
                            <div className="py-2 text-center">
                              {block.url ? (
                                <img
                                  src={block.url}
                                  alt={block.alt || 'Imagem'}
                                  className="max-h-56 mx-auto rounded-xl object-contain shadow-2xs"
                                />
                              ) : (
                                <div className="p-6 bg-slate-50 border border-dashed border-slate-200 rounded-xl text-slate-400 text-xs">
                                  Sem URL de imagem informada. Altere na aba "Blocos".
                                </div>
                              )}
                            </div>
                          )}

                          {block.type === 'divider' && (
                            <div className="py-2">
                              <hr className="border-t border-slate-200" />
                            </div>
                          )}

                          {block.type === 'spacer' && (
                            <div
                              style={{ height: `${block.height}px` }}
                              className="border border-dashed border-slate-200/50 rounded flex items-center justify-center text-[10px] text-slate-300"
                            >
                              Espaço ({block.height}px)
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : (
                /* SMS COMPOSER */
                <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-4 sm:p-6 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                    <label className="block text-xs font-bold text-[#08254f] font-heading">
                      Mensagem de Texto (SMS)
                    </label>
                    <div className="flex items-center gap-2 text-xs font-mono">
                      <span className="text-slate-500">
                        {smsMetrics.characterCount} caracteres
                      </span>
                      <span className="text-slate-300">•</span>
                      <span className="text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                        {smsMetrics.segmentCount} segmento(s) ({smsMetrics.encoding})
                      </span>
                    </div>
                  </div>

                  <textarea
                    ref={smsTextareaRef}
                    rows={6}
                    value={smsBody}
                    onChange={(e) => setSmsBody(e.target.value)}
                    placeholder="Ex: Olá {{salutation}}, confirmamos seu agendamento na Expert Dental Solutions. Qualquer dúvida, responda a esta mensagem."
                    className="w-full p-4 text-xs sm:text-sm text-slate-900 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#08254f]/15 focus:border-[#08254f] leading-relaxed transition-all font-sans"
                  />

                  <p className="text-[11px] text-slate-400">
                    Codificação detectada: <strong>{smsMetrics.encoding}</strong>.{' '}
                    {smsMetrics.encoding === 'GSM-7'
                      ? 'Limite de 160 caracteres para 1 segmento (153 em mensagens concatenadas).'
                      : 'Caracteres especiais ou acentuação avançada utilizam UCS-2 (limite de 70 caracteres por segmento).'}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ===================================================================
              MODE 2: BLOCOS (ADVANCED BLOCK EDITOR FOR EMAIL)
          =================================================================== */}
          {activeMode === 'blocos' && channel === 'email' && (
            <div className="space-y-4">
              <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-2xs">
                <p className="text-xs font-bold text-[#08254f] font-heading mb-1">
                  Organizador Estrutural de Blocos
                </p>
                <p className="text-[11px] text-slate-500">
                  Gerencie ordenação, níveis de cabeçalho, alinhamentos e URLs de botões.
                </p>
              </div>

              <BlockEditor
                blocks={currentBlocks}
                hideHeader={true}
                onChange={(b, html, text) => {
                  setCurrentBlocks(b);
                  setCurrentHtml(html);
                  setCurrentText(text);
                }}
              />
            </div>
          )}

          {/* ===================================================================
              MODE 3: PRÉVIA (REALISTIC PREVIEW WITH DEVICE TOGGLE)
          =================================================================== */}
          {activeMode === 'previa' && (
            <div className="space-y-4">
              {/* Sample Data Disclaimer Badge */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between bg-slate-50 border border-slate-200/80 px-4 py-2.5 rounded-xl text-xs gap-2 shadow-2xs">
                <div className="flex items-center gap-2 text-slate-800 font-semibold font-heading">
                  <Sparkles className="w-4 h-4 text-[#449bd5]" />
                  <span>DADOS DE EXEMPLO — PRÉ-VISUALIZAÇÃO ESTÁTICA</span>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Nenhum lead real consultado • Envio desativado</span>
                </div>
              </div>

              {channel === 'email' ? (
                /* EMAIL PREVIEW */
                <div className="space-y-3">
                  {/* Device Toggle */}
                  <div className="flex justify-center">
                    <div className="inline-flex bg-white p-1 rounded-xl border border-slate-200 shadow-2xs text-xs font-semibold">
                      <button
                        type="button"
                        onClick={() => setPreviewDevice('desktop')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                          previewDevice === 'desktop'
                            ? 'bg-[#08254f] text-white shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        <Monitor className="w-3.5 h-3.5" />
                        <span>Desktop</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setPreviewDevice('mobile')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                          previewDevice === 'mobile'
                            ? 'bg-[#08254f] text-white shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        <Smartphone className="w-3.5 h-3.5" />
                        <span>Mobile (390px)</span>
                      </button>
                    </div>
                  </div>

                  {/* Rendered Frame */}
                  <div className="flex justify-center">
                    <div
                      className={`w-full rounded-2xl border border-slate-200 overflow-hidden shadow-md bg-white transition-all ${
                        previewDevice === 'mobile' ? 'max-w-[390px]' : 'max-w-2xl'
                      }`}
                    >
                      {/* Window Chrome */}
                      <div className="bg-slate-100/90 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-rose-400 inline-block" />
                          <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" />
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block" />
                          <span className="ml-2 text-xs font-bold text-slate-700 font-heading">
                            Cliente de Email ({previewDevice === 'mobile' ? 'Mobile' : 'Desktop'})
                          </span>
                        </div>
                        <span className="text-[10px] font-mono uppercase bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded font-bold">
                          Email
                        </span>
                      </div>

                      {/* Email Headers */}
                      <div className="px-4 py-3 bg-slate-50/70 border-b border-slate-100 text-xs space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-slate-400 font-medium w-14">De:</span>
                          <span className="font-semibold text-slate-800 truncate">
                            {SAMPLE_PREVIEW_DATA.sender_name} &lt;{SAMPLE_PREVIEW_DATA.sender_email}&gt;
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-400 font-medium w-14">Para:</span>
                          <span className="text-slate-700 truncate">
                            {SAMPLE_PREVIEW_DATA.first_name} {SAMPLE_PREVIEW_DATA.last_name} &lt;
                            {SAMPLE_PREVIEW_DATA.recipient_email}&gt;
                          </span>
                        </div>
                        <div className="flex items-center gap-2 pt-1 border-t border-slate-100">
                          <span className="text-slate-400 font-medium w-14">Assunto:</span>
                          <span className="font-bold text-[#08254f] font-heading truncate">
                            {previewEmailData.subject || '(Sem assunto definido)'}
                          </span>
                        </div>
                      </div>

                      {/* Sanitized HTML Preview Iframe */}
                      <div className="p-3 sm:p-4 bg-slate-50">
                        <iframe
                          title="Prévia do Email"
                          srcDoc={
                            previewEmailData.html ||
                            '<p style="color:#64748b; font-size:13px; text-align:center; padding: 20px;">(Template sem conteúdo HTML)</p>'
                          }
                          className="w-full h-[450px] bg-white rounded-xl border border-slate-200 shadow-2xs"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                /* SMS PREVIEW */
                <div className="max-w-sm mx-auto rounded-3xl border border-slate-300 overflow-hidden shadow-lg bg-slate-900 text-white">
                  {/* Mobile Shell Top Bar */}
                  <div className="bg-slate-950 px-5 py-3 flex items-center justify-between border-b border-slate-800">
                    <div className="flex items-center gap-2">
                      <Smartphone className="w-4 h-4 text-emerald-400" />
                      <span className="text-xs font-bold text-slate-200 font-heading">
                        Dispositivo Móvel • SMS
                      </span>
                    </div>
                    <span className="text-[10px] font-mono uppercase bg-emerald-950 text-emerald-300 border border-emerald-800 px-2 py-0.5 rounded font-bold">
                      SMS
                    </span>
                  </div>

                  {/* Contact header */}
                  <div className="bg-slate-900/90 px-4 py-2.5 text-center border-b border-slate-800">
                    <p className="text-xs font-bold text-slate-200 font-heading">
                      {SAMPLE_PREVIEW_DATA.first_name} {SAMPLE_PREVIEW_DATA.last_name}
                    </p>
                    <p className="text-[11px] font-mono text-slate-400">
                      {SAMPLE_PREVIEW_DATA.recipient_phone}
                    </p>
                  </div>

                  {/* Chat bubble screen */}
                  <div className="p-5 bg-slate-800/40 min-h-[260px] flex flex-col justify-end">
                    <div className="max-w-[85%] self-start bg-slate-700/90 text-slate-100 rounded-2xl rounded-bl-xs p-3.5 shadow-sm border border-slate-600/50 text-xs leading-relaxed break-words whitespace-pre-wrap">
                      {previewSmsData.text || '(Template de SMS sem mensagem de texto)'}
                    </div>
                    <div className="mt-2 text-[10px] text-slate-400 flex items-center gap-1">
                      <MessageSquare className="w-3 h-3 text-emerald-400" />
                      <span>Mensagem de texto (SMS)</span>
                    </div>
                  </div>

                  {/* Metrics Footer */}
                  <div className="bg-slate-950 px-4 py-3 border-t border-slate-800 text-[11px] text-slate-400 space-y-1 font-mono">
                    <div className="flex items-center justify-between">
                      <span>
                        Contagem: <strong className="text-slate-200">{previewSmsData.segments.characterCount}</strong>
                      </span>
                      <span>
                        Segmentos: <strong className="text-emerald-400">{previewSmsData.segments.segmentCount}</strong>
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-slate-500">
                      <span>
                        Codificação: <strong className="text-slate-300">{previewSmsData.segments.encoding}</strong>
                      </span>
                      <span>Sem envio real</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ===================================================================
            3. STICKY BOTTOM ACTION BAR (~64px)
        =================================================================== */}
        <footer className="sticky bottom-0 z-20 bg-white border-t border-slate-200/90 px-4 sm:px-6 py-3.5 shrink-0 flex items-center justify-between shadow-2xs">
          <div className="text-xs text-slate-400 truncate max-w-[180px] sm:max-w-md">
            {channel === 'sms'
              ? `${smsMetrics.characterCount} caracteres • ${smsMetrics.segmentCount} segmento(s)`
              : `${currentBlocks.length} bloco(s) • Exportação HTML automática`}
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="px-5 py-2 bg-[#8a1c1c] hover:bg-[#721717] text-white text-xs font-bold rounded-xl shadow-xs transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-60 whitespace-nowrap"
            >
              <Save className="h-4 w-4" />
              <span>{isSaving ? 'Salvando...' : 'Salvar Template'}</span>
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
