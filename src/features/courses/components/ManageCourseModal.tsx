import React, { useState, useEffect } from 'react';
import {
  X,
  BookOpen,
  FileText,
  Mail,
  MessageSquare,
  Calendar,
  Save,
  Plus,
  AlertCircle,
  CheckCircle2,
  Paperclip,
  ShieldAlert,
  Edit2,
  Trash2,
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { formatCohortDateRange } from '../../../utils/format';
import type { CourseSession } from '../../../types/database';

export interface CourseData {
  id: string;
  code: string;
  name: string;
  description: string | null;
  active: boolean;
  sort_order: number;
  default_price?: number | null;
}

export interface CourseMaterialItem {
  id: string;
  course_id: string;
  title: string;
  file_name: string;
  storage_bucket: string;
  storage_path: string;
  file_size_bytes?: number | null;
  is_active: boolean;
  is_required_for_outreach: boolean;
}

export interface AssociatedTemplateItem {
  id: string;
  name: string;
  template_key: string;
  category: string;
  subject?: string | null;
  text_template?: string | null;
  html_template?: string | null;
  has_attachment?: boolean;
  attachment_name?: string | null;
}

interface ManageCourseModalProps {
  course: CourseData | null;
  isOpen: boolean;
  onClose: () => void;
  onCourseUpdated: () => void;
  onOpenSessionModal?: (courseId: string) => void;
}

export const ManageCourseModal: React.FC<ManageCourseModalProps> = ({
  course,
  isOpen,
  onClose,
  onCourseUpdated,
  onOpenSessionModal,
}) => {
  const [activeTab, setActiveTab] = useState<'details' | 'materials' | 'templates' | 'sessions'>('details');

  // Form states
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [active, setActive] = useState(true);
  const [defaultPrice, setDefaultPrice] = useState<number | string>('');

  // Related data
  const [materials, setMaterials] = useState<CourseMaterialItem[]>([]);
  const [sessions, setSessions] = useState<CourseSession[]>([]);
  const [emailTemplate, setEmailTemplate] = useState<AssociatedTemplateItem | null>(null);
  const [smsTemplate, setSmsTemplate] = useState<AssociatedTemplateItem | null>(null);

  // Material form state
  const [isAddingMaterial, setIsAddingMaterial] = useState(false);
  const [newMaterialTitle, setNewMaterialTitle] = useState('');
  const [newMaterialFileName, setNewMaterialFileName] = useState('');
  const [newMaterialRequired, setNewMaterialRequired] = useState(true);

  // Status & Feedback
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (course && isOpen) {
      setName(course.name || '');
      setCode(course.code || '');
      setDescription(course.description || '');
      setActive(course.active ?? true);
      setDefaultPrice(course.default_price || '');
      setError(null);
      setSuccessMessage(null);
      setIsAddingMaterial(false);
      loadCourseRelations(course.id, course.code);
    }
  }, [course, isOpen]);

  const loadCourseRelations = async (courseId: string, courseCode: string) => {
    try {
      // 1. Load course materials
      const { data: mats } = await supabase
        .from('course_materials')
        .select('*')
        .eq('course_id', courseId)
        .order('created_at', { ascending: true });

      setMaterials(mats || []);

      // 2. Load course sessions
      const { data: sess } = await supabase
        .from('course_sessions')
        .select('*')
        .eq('course_id', courseId)
        .order('start_date', { ascending: true });

      setSessions(sess || []);

      // 3. Load associated templates
      const { data: allTpls } = await supabase
        .from('email_templates')
        .select('*')
        .eq('is_active', true);

      if (allTpls) {
        const codeLower = courseCode.toLowerCase();

        // Email template matching
        let emailTpl: AssociatedTemplateItem | null = null;
        if (codeLower === 'zit-01' || codeLower.includes('zygomatic')) {
          emailTpl = allTpls.find((t) => t.template_key === 'zygomatic_course_details') || null;
        } else {
          emailTpl = allTpls.find((t) => (t.category === 'email' || t.category === 'course_details') && t.name.toLowerCase().includes(codeLower)) || null;
        }
        setEmailTemplate(emailTpl);

        // SMS template matching
        let smsTpl: AssociatedTemplateItem | null = null;
        if (codeLower === 'zit-01' || codeLower.includes('zygomatic')) {
          smsTpl = allTpls.find((t) => t.template_key === 'zygomatic_followup_sms') || null;
        } else {
          smsTpl = allTpls.find((t) => t.category === 'sms' && t.name.toLowerCase().includes(codeLower)) || null;
        }
        setSmsTemplate(smsTpl);
      }
    } catch (err) {
      console.error('Error loading course relations:', err);
    }
  };

  if (!isOpen || !course) return null;

  const handleSaveCourse = async () => {
    if (!name.trim()) {
      setError('O nome do curso é obrigatório.');
      return;
    }
    if (!code.trim()) {
      setError('O código do curso é obrigatório.');
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const priceNum = defaultPrice === '' ? null : Number(defaultPrice);

      const { error: updErr } = await supabase
        .from('courses')
        .update({
          name: name.trim(),
          code: code.trim().toUpperCase(),
          description: description.trim() || null,
          active,
          default_price: priceNum,
          updated_at: new Date().toISOString(),
        })
        .eq('id', course.id);

      if (updErr) throw updErr;

      setSuccessMessage('Curso atualizado com sucesso. Nenhuma mensagem ou disparo externo foi acionado.');
      onCourseUpdated();

      setTimeout(() => {
        setSuccessMessage(null);
      }, 3500);
    } catch (err: any) {
      console.error('Failed to update course:', err);
      setError(err.message || 'Erro ao salvar alterações do curso.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddMaterial = async () => {
    if (!newMaterialTitle.trim() || !newMaterialFileName.trim()) {
      setError('Título e nome do arquivo são obrigatórios para vincular material.');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const { data: newMat, error: matErr } = await supabase
        .from('course_materials')
        .insert({
          course_id: course.id,
          title: newMaterialTitle.trim(),
          file_name: newMaterialFileName.trim(),
          storage_bucket: 'course-materials',
          storage_path: `courses/${course.code.toUpperCase()}/${newMaterialFileName.trim()}`,
          content_type: 'application/pdf',
          is_active: true,
          is_required_for_outreach: newMaterialRequired,
        })
        .select()
        .single();

      if (matErr) throw matErr;

      setMaterials([...materials, newMat]);
      setIsAddingMaterial(false);
      setNewMaterialTitle('');
      setNewMaterialFileName('');
      setSuccessMessage('Material associado com sucesso ao catálogo.');
      onCourseUpdated();
    } catch (err: any) {
      console.error('Error adding course material:', err);
      setError(err.message || 'Falha ao vincular material.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemoveMaterial = async (materialId: string) => {
    if (!confirm('Deseja realmente remover esta associação de material do curso?')) return;
    setIsSaving(true);
    setError(null);

    try {
      const { error: delErr } = await supabase
        .from('course_materials')
        .delete()
        .eq('id', materialId);

      if (delErr) throw delErr;

      setMaterials(materials.filter((m) => m.id !== materialId));
      setSuccessMessage('Material desvinculado com sucesso.');
      onCourseUpdated();
    } catch (err: any) {
      console.error('Error removing material:', err);
      setError(err.message || 'Erro ao desvincular material.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center font-bold">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <span>Gerenciar Curso Oficial</span>
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-200 text-slate-700">
                  {code}
                </span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Configuração acadêmica, catálogo, materiais oficiais e separação rigorosa de templates
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="px-6 border-b border-slate-200 flex items-center gap-6 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('details')}
            className={`py-3 border-b-2 transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'details'
                ? 'border-blue-600 text-blue-700 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Edit2 className="w-3.5 h-3.5" />
            <span>Dados do Curso</span>
          </button>
          <button
            onClick={() => setActiveTab('materials')}
            className={`py-3 border-b-2 transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'materials'
                ? 'border-blue-600 text-blue-700 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Materiais Oficiais ({materials.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('templates')}
            className={`py-3 border-b-2 transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'templates'
                ? 'border-blue-600 text-blue-700 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Mail className="w-3.5 h-3.5" />
            <span>Templates (Email × SMS)</span>
          </button>
          <button
            onClick={() => setActiveTab('sessions')}
            className={`py-3 border-b-2 transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'sessions'
                ? 'border-blue-600 text-blue-700 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            <span>Turmas ({sessions.length})</span>
          </button>
        </div>

        {/* Feedback Alerts */}
        {error && (
          <div className="mx-6 mt-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {successMessage && (
          <div className="mx-6 mt-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {/* TAB 1: DADOS DO CURSO */}
          {activeTab === 'details' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Nome Oficial do Curso *
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-medium"
                    placeholder="Ex: Zygomatic Implant Training"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Código Canônico *
                  </label>
                  <input
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-mono font-bold uppercase"
                    placeholder="Ex: ZIT-01"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Descrição Curricular
                </label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  placeholder="Resumo do programa, objetivos cirúrgicos e público-alvo..."
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Preço Padrão de Matrícula (R$)
                  </label>
                  <input
                    type="number"
                    value={defaultPrice}
                    onChange={(e) => setDefaultPrice(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-semibold"
                    placeholder="Ex: 15000"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    Referência para emissão de links de pagamento e métricas de receita
                  </p>
                </div>

                <div className="flex items-center gap-3 pt-6">
                  <input
                    type="checkbox"
                    id="courseActiveCheck"
                    checked={active}
                    onChange={(e) => setActive(e.target.checked)}
                    className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                  />
                  <label htmlFor="courseActiveCheck" className="text-xs font-bold text-slate-700 cursor-pointer">
                    Curso Ativo no Catálogo Oficial
                  </label>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 text-[11px] text-slate-600 space-y-1">
                <span className="font-bold text-slate-800 block">Garantia de Segurança Operacional:</span>
                <p>
                  A alteração dos dados cadastrais do curso é puramente administrativa. Nenhuma mensagem (email, SMS) é enviada, nenhuma oportunidade no pipeline é movida e nenhum lead tem sua preferência modificada ao salvar.
                </p>
              </div>
            </div>
          )}

          {/* TAB 2: MATERIAIS OFICIAIS */}
          {activeTab === 'materials' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Materiais Oficiais Vinculados
                  </h4>
                  <p className="text-xs text-slate-500">
                    PDFs canônicos armazenados no bucket seguro <code>course-materials</code>
                  </p>
                </div>
                {!isAddingMaterial && (
                  <button
                    type="button"
                    onClick={() => setIsAddingMaterial(true)}
                    className="px-2.5 py-1.5 rounded-lg bg-blue-50 text-blue-700 text-xs font-semibold hover:bg-blue-100 flex items-center gap-1 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Vincular Material</span>
                  </button>
                )}
              </div>

              {/* Add Material Card */}
              {isAddingMaterial && (
                <div className="p-4 rounded-xl border border-blue-200 bg-blue-50/40 space-y-3">
                  <span className="text-xs font-bold text-blue-950 block">Novo Material do Curso</span>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">Título do Documento</label>
                      <input
                        type="text"
                        value={newMaterialTitle}
                        onChange={(e) => setNewMaterialTitle(e.target.value)}
                        className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg"
                        placeholder="Ex: Zygomatic Course (2)"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">Nome do Arquivo (PDF)</label>
                      <input
                        type="text"
                        value={newMaterialFileName}
                        onChange={(e) => setNewMaterialFileName(e.target.value)}
                        className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg"
                        placeholder="Ex: Zygomatic Course (2).pdf"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="requiredMaterialCheck"
                      checked={newMaterialRequired}
                      onChange={(e) => setNewMaterialRequired(e.target.checked)}
                      className="w-3.5 h-3.5 text-blue-600 rounded"
                    />
                    <label htmlFor="requiredMaterialCheck" className="text-xs text-slate-700 cursor-pointer">
                      Anexo obrigatório para mensagens de Primeiro Contato
                    </label>
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setIsAddingMaterial(false)}
                      className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={handleAddMaterial}
                      disabled={isSaving}
                      className="px-3 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
                    >
                      Confirmar Associação
                    </button>
                  </div>
                </div>
              )}

              {/* Material List */}
              {materials.length === 0 ? (
                <div className="p-8 text-center border border-dashed border-slate-200 rounded-xl bg-slate-50">
                  <FileText className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                  <p className="text-xs text-slate-600 font-semibold">Nenhum material associado a este curso</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Adicione o folheto cirúrgico oficial para disponibilização no Primeiro Contato
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {materials.map((mat) => (
                    <div
                      key={mat.id}
                      className="p-3.5 rounded-xl border border-slate-200 bg-white hover:border-slate-300 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                          <Paperclip className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <h5 className="text-xs font-bold text-slate-900 truncate">{mat.title}</h5>
                          <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                            <span className="font-mono text-slate-600 truncate">{mat.file_name}</span>
                            <span>•</span>
                            <span className="text-slate-400">{mat.storage_bucket}</span>
                            {mat.is_required_for_outreach && (
                              <>
                                <span>•</span>
                                <span className="text-amber-700 font-semibold bg-amber-50 px-1.5 py-0.5 rounded text-[10px]">
                                  Obrigatório no 1º Contato
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveMaterial(mat.id)}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors ml-2"
                        title="Desvincular material"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: TEMPLATES ASSOCIADOS (SEPARAÇÃO ESTRITA EMAIL X SMS) */}
          {activeTab === 'templates' && (
            <div className="space-y-6">
              {/* Template Email */}
              <div className="p-4 rounded-xl border border-purple-200 bg-purple-50/30 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Mail className="w-4 h-4 text-purple-600" />
                    <span className="text-xs font-bold text-slate-900">Template de E-mail Associado</span>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-purple-100 text-purple-800">
                    Canal Email (Resend)
                  </span>
                </div>

                {emailTemplate ? (
                  <div className="space-y-2 text-xs">
                    <div className="flex items-center justify-between p-2.5 rounded-lg bg-white border border-purple-100">
                      <div>
                        <span className="font-bold text-slate-800">{emailTemplate.name}</span>
                        <p className="text-[11px] text-slate-500 font-mono mt-0.5">{emailTemplate.template_key}</p>
                      </div>
                      {emailTemplate.has_attachment && (
                        <span className="text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-md flex items-center gap-1">
                          <Paperclip className="w-3 h-3" />
                          {emailTemplate.attachment_name || 'PDF Oficial Anexo'}
                        </span>
                      )}
                    </div>
                    {emailTemplate.subject && (
                      <p className="text-[11px] text-slate-600">
                        <strong className="text-slate-700">Assunto:</strong> {emailTemplate.subject}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="p-3 rounded-lg bg-white border border-purple-100 text-xs text-slate-500 italic">
                    Nenhum template específico de e-mail associado a este curso.
                  </div>
                )}
              </div>

              {/* Template SMS (Regras Estritas: Body only, sem assunto, sem PDF, sem Resend) */}
              <div className="p-4 rounded-xl border border-blue-200 bg-blue-50/30 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-blue-600" />
                    <span className="text-xs font-bold text-slate-900">Template de SMS Associado</span>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-800">
                    Canal SMS (Manual Assistido)
                  </span>
                </div>

                {/* Banner de Conformidade SMS */}
                <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-900 flex items-start gap-2">
                  <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">Diretriz Rigorosa de SMS:</span>
                    <p className="mt-0.5 text-amber-800">
                      O SMS contém estritamente o corpo de texto (body only). Não possui linha de assunto, não suporta arquivos PDF e não utiliza disparo automático via Resend.
                    </p>
                  </div>
                </div>

                {smsTemplate ? (
                  <div className="space-y-2 text-xs">
                    <div className="p-2.5 rounded-lg bg-white border border-blue-100">
                      <span className="font-bold text-slate-800">{smsTemplate.name}</span>
                      <p className="text-[11px] text-slate-500 font-mono mt-0.5">{smsTemplate.template_key}</p>
                    </div>
                    {smsTemplate.text_template && (
                      <div className="p-3 bg-white rounded-lg border border-slate-200 text-xs font-mono text-slate-800 whitespace-pre-wrap max-h-40 overflow-y-auto">
                        {smsTemplate.text_template}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-3 rounded-lg bg-white border border-blue-100 text-xs text-slate-500 italic">
                    Nenhum template específico de SMS associado a este curso.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: TURMAS / COHORTS */}
          {activeTab === 'sessions' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Turmas Cadastradas ({sessions.length})
                  </h4>
                  <p className="text-xs text-slate-500">
                    Cohorts e cronogramas acadêmicos associados ao curso
                  </p>
                </div>
                {onOpenSessionModal && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenSessionModal(course.id);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 flex items-center gap-1.5 transition-colors shadow-xs"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Nova Turma</span>
                  </button>
                )}
              </div>

              {sessions.length === 0 ? (
                <div className="p-8 text-center border border-dashed border-slate-200 rounded-xl bg-slate-50">
                  <Calendar className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                  <p className="text-xs text-slate-600 font-semibold">Nenhuma turma cadastrada para este curso</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Cadastre a primeira turma para abrir matrículas e alocação de alunos
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {sessions.map((sess) => (
                    <div
                      key={sess.id}
                      className="p-3.5 rounded-xl border border-slate-200 bg-white flex items-center justify-between text-xs"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900">{sess.title}</span>
                          <span className="text-[10px] font-semibold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                            {sess.code}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2">
                          <span>{formatCohortDateRange(sess.start_date, sess.end_date)}</span>
                          {sess.location && (
                            <>
                              <span>•</span>
                              <span>{sess.location}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        sess.status === 'open' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'
                      }`}>
                        {sess.status === 'open' ? 'Aberta' : sess.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50/50 flex items-center justify-between">
          <span className="text-[11px] text-slate-400">
            Ações 100% isoladas de comunicação externa
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 text-xs font-semibold rounded-xl text-slate-600 hover:bg-slate-100 transition-colors"
            >
              Fechar
            </button>
            <button
              type="button"
              onClick={handleSaveCourse}
              disabled={isSaving}
              className="px-4 py-2 text-xs font-bold rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition-all flex items-center gap-1.5 shadow-xs disabled:opacity-50 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isSaving ? 'Salvando...' : 'Salvar Alterações'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
