import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../../lib/supabase';
import { Modal } from '../../../components/ui/Modal';
import { BlockEditor } from '../../editor/BlockEditor';
import {
  getTemplateChannel,
  getTemplateSubject,
  GLOBAL_TEMPLATE_VARIABLES,
  calculateSmsSegments,
  type TemplateChannel,
} from '../../../utils/template-variables';
import { getTemplateUsage, type TemplateUsage } from '../services/template-usage-service';
import type { EmailTemplate } from '../../../types';
import type { EmailBlock } from '../../editor/types';
import {
  Mail,
  MessageSquare,
  Save,
  Info,
  Sparkles,
} from 'lucide-react';

interface TemplateEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingTemplate: EmailTemplate | null;
  onSaveSuccess: () => void;
}

export function TemplateEditorModal({
  isOpen,
  onClose,
  editingTemplate,
  onSaveSuccess,
}: TemplateEditorModalProps) {
  const [channel, setChannel] = useState<TemplateChannel>('email');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('general');

  // Email specific state
  const [subject, setSubject] = useState('');
  const [currentBlocks, setCurrentBlocks] = useState<EmailBlock[]>([]);
  const [currentHtml, setCurrentHtml] = useState('');
  const [currentText, setCurrentText] = useState('');

  // SMS specific state
  const [smsBody, setSmsBody] = useState('');
  const smsTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Status & Usage
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<TemplateUsage | null>(null);

  // Initialize or reset state when modal opens
  useEffect(() => {
    if (!isOpen) return;
    setError(null);

    if (editingTemplate) {
      const ch = getTemplateChannel(editingTemplate);
      setChannel(ch);
      setName(editingTemplate.name || '');
      setDescription(editingTemplate.description || '');
      setCategory(editingTemplate.category || 'general');

      if (ch === 'email') {
        setSubject(getTemplateSubject(editingTemplate));
        const cj = editingTemplate.content_json;
        if (Array.isArray(cj)) {
          setCurrentBlocks(cj as EmailBlock[]);
        } else if (typeof cj === 'object' && cj !== null && Array.isArray((cj as { blocks?: unknown[] }).blocks)) {
          setCurrentBlocks((cj as { blocks: EmailBlock[] }).blocks);
        } else {
          setCurrentBlocks([]);
        }
        setCurrentHtml(editingTemplate.html_template || '');
        setCurrentText(editingTemplate.text_template || '');
        setSmsBody('');
      } else {
        setSubject('');
        setCurrentBlocks([]);
        setCurrentHtml('');
        setCurrentText('');
        setSmsBody(editingTemplate.text_template || '');
      }

      // Check origin usage
      getTemplateUsage(editingTemplate.id)
        .then((u) => setUsage(u))
        .catch((err) => console.error('[TemplateEditor] Usage check failed:', err));
    } else {
      setChannel('email');
      setName('');
      setDescription('');
      setCategory('general');
      setSubject('');
      setCurrentBlocks([]);
      setCurrentHtml('');
      setCurrentText('');
      setSmsBody('');
      setUsage(null);
    }
  }, [isOpen, editingTemplate]);

  // Insert variable into SMS textarea at cursor position
  const handleInsertVariableSms = (varKey: string) => {
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
  };

  // Insert variable into Email subject
  const handleInsertVariableEmailSubject = (varKey: string) => {
    setSubject((prev) => `${prev ? prev + ' ' : ''}${varKey}`);
  };

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

  const smsMetrics = calculateSmsSegments(smsBody);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editingTemplate ? `Editar Template (${channel === 'sms' ? 'SMS' : 'Email'})` : 'Novo Template de Mensagem'}
      maxWidthClass={channel === 'email' ? 'max-w-5xl' : 'max-w-2xl'}
      footer={
        <div className="flex items-center justify-between w-full">
          <div className="text-xs text-slate-400">
            {channel === 'sms'
              ? `${smsMetrics.characterCount} caracteres • ${smsMetrics.segmentCount} segmento(s)`
              : 'Editor visual com exportação HTML automática'}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="btn-secondary text-xs px-4 py-2"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="btn-crimson text-xs px-5 py-2 flex items-center gap-2"
            >
              <Save className="h-4 w-4" />
              <span>{isSaving ? 'Salvando...' : 'Salvar Template'}</span>
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Informational Origin Usage Notice (Factual & Non-Alarming) */}
        {editingTemplate && usage && usage.totalCount > 0 && (
          <div className="p-3.5 bg-blue-50/70 border border-blue-200/80 rounded-xl text-xs text-blue-900 flex items-start gap-2.5">
            <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold font-heading">
                Este template já foi utilizado como origem em {usage.campaigns.length} campanha(s) e {usage.automations.length + usage.sequences.length} fluxo(s).
              </p>
              <p className="text-[11px] text-blue-800/80 mt-0.5">
                Alterações feitas aqui não modificam automaticamente conteúdos já salvos nesses fluxos.
              </p>
            </div>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
            {error}
          </div>
        )}

        {/* Channel Switcher (Only when creating new) */}
        {!editingTemplate && (
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Canal de Comunicação</label>
            <div className="inline-flex p-1 bg-slate-100 rounded-xl border border-slate-200">
              <button
                type="button"
                onClick={() => setChannel('email')}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  channel === 'email'
                    ? 'bg-white text-[#08254f] shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Mail className="w-3.5 h-3.5 text-blue-600" />
                <span>Email Marketing</span>
              </button>
              <button
                type="button"
                onClick={() => setChannel('sms')}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  channel === 'sms'
                    ? 'bg-white text-[#08254f] shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
                <span>SMS</span>
              </button>
            </div>
          </div>
        )}

        {/* Metadata Inputs */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-slate-700 mb-1">Nome do Template</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={channel === 'email' ? 'Ex: Boas-vindas Pós-Inscrição' : 'Ex: Lembrete de Matrícula SMS'}
              className="input-executive text-xs"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Categoria Operacional</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="input-executive text-xs bg-white"
            >
              <option value="general">Geral</option>
              <option value="welcome">Boas-vindas</option>
              <option value="promotional">Promocional</option>
              <option value="followup">Follow-up</option>
            </select>
          </div>
          <div className="sm:col-span-3">
            <label className="block text-xs font-semibold text-slate-700 mb-1">Descrição (opcional)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Anotações para a equipe sobre a finalidade deste template..."
              className="input-executive text-xs"
            />
          </div>
        </div>

        {/* Global Variables Picker Bar */}
        <div className="bg-slate-50 border border-slate-200/90 rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5 font-heading">
              <Sparkles className="w-3.5 h-3.5 text-[#449bd5]" /> Variáveis Globais Compatíveis
            </span>
            <span className="text-[10px] text-slate-400">
              Clique em um chip para inserir no texto
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {GLOBAL_TEMPLATE_VARIABLES.map((v) => (
              <button
                key={v.key}
                type="button"
                onClick={() => {
                  if (channel === 'sms') {
                    handleInsertVariableSms(v.key);
                  } else {
                    handleInsertVariableEmailSubject(v.key);
                  }
                }}
                className="px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg text-xs font-mono font-medium text-[#08254f] transition-colors flex items-center gap-1 shadow-2xs"
                title={v.description}
              >
                <span>{v.key}</span>
                <span className="text-[10px] text-slate-400 font-sans">({v.label})</span>
              </button>
            ))}
          </div>
        </div>

        {/* Channel Specific Composer */}
        {channel === 'email' ? (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Assunto Padrão do Email
              </label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Ex: Atualização importante para {{salutation}}"
                className="input-executive text-xs"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-[#08254f] uppercase tracking-wider mb-2 font-heading">
                Compositor Visual de Blocos (Email)
              </label>
              <BlockEditor
                initialBlocks={currentBlocks}
                onChange={(b, html, text) => {
                  setCurrentBlocks(b);
                  setCurrentHtml(html);
                  setCurrentText(text);
                }}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-slate-700">
                  Mensagem de Texto (SMS)
                </label>
                <div className="flex items-center gap-2 text-[11px] font-mono">
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
                rows={5}
                value={smsBody}
                onChange={(e) => setSmsBody(e.target.value)}
                placeholder="Ex: Olá {{salutation}}, confirmamos o recebimento da sua inscrição na Expert Dental Solutions..."
                className="w-full p-3.5 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#08254f] font-sans leading-relaxed"
              />

              <p className="text-[11px] text-slate-400 mt-1">
                Codificação detectada: <strong>{smsMetrics.encoding}</strong>.
                {smsMetrics.encoding === 'GSM-7'
                  ? ' Limite de 160 caracteres para 1 segmento (153 em mensagens concatenadas).'
                  : ' Caracteres especiais ou acentuação avançada utilizam UCS-2 (limite de 70 caracteres por segmento).'}
              </p>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
