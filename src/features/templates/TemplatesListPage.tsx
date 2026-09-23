import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { Layout } from '../../components/Layout';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';
import { EmptyState } from '../../components/EmptyState';
import { Modal } from '../../components/ui/Modal';
import { BlockEditor } from '../editor/BlockEditor';
import type { EmailTemplate } from '../../types';
import type { EmailBlock } from '../editor/types';
import {
  Plus,
  Edit2,
  Trash2,
  Eye,
  Save,
} from 'lucide-react';

export function TemplatesListPage() {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Category filter
  const [categoryFilter, setCategoryFilter] = useState('');

  // Edit / Create Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(null);
  const [templateName, setTemplateName] = useState('');
  const [templateDesc, setTemplateDesc] = useState('');
  const [templateCat, setTemplateCat] = useState('general');
  const [currentBlocks, setCurrentBlocks] = useState<EmailBlock[]>([]);
  const [currentHtml, setCurrentHtml] = useState('');
  const [currentText, setCurrentText] = useState('');

  // Preview Modal
  const [previewTemplate, setPreviewTemplate] = useState<EmailTemplate | null>(null);

  const fetchTemplates = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      let query = supabase.from('email_templates').select('*').order('created_at', { ascending: false });
      if (categoryFilter) {
        query = query.eq('category', categoryFilter);
      }
      const { data, error: err } = await query;
      if (err) throw err;
      setTemplates(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar templates');
    } finally {
      setIsLoading(false);
    }
  }, [categoryFilter]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const handleOpenCreate = () => {
    setEditingTemplate(null);
    setTemplateName('');
    setTemplateDesc('');
    setTemplateCat('general');
    setCurrentBlocks([]);
    setCurrentHtml('');
    setCurrentText('');
    setIsModalOpen(true);
  };

  const handleOpenEdit = (tpl: EmailTemplate) => {
    setEditingTemplate(tpl);
    setTemplateName(tpl.name);
    setTemplateDesc(tpl.description || '');
    setTemplateCat(tpl.category);
    setCurrentBlocks(Array.isArray(tpl.content_json) ? (tpl.content_json as EmailBlock[]) : []);
    setCurrentHtml(tpl.html_template);
    setCurrentText(tpl.text_template);
    setIsModalOpen(true);
  };

  const handleSaveTemplate = async () => {
    if (!templateName.trim()) {
      alert('Por favor, informe o nome do template.');
      return;
    }

    try {
      if (editingTemplate) {
        // Update existing
        const { error: upErr } = await supabase
          .from('email_templates')
          .update({
            name: templateName.trim(),
            description: templateDesc.trim() || null,
            category: templateCat,
            content_json: currentBlocks,
            html_template: currentHtml,
            text_template: currentText,
            updated_at: new Date().toISOString(),
          })
          .eq('id', editingTemplate.id);

        if (upErr) throw upErr;
      } else {
        // Create new
        const { error: insErr } = await supabase.from('email_templates').insert({
          name: templateName.trim(),
          description: templateDesc.trim() || null,
          category: templateCat,
          content_json: currentBlocks,
          html_template: currentHtml,
          text_template: currentText,
        });

        if (insErr) throw insErr;
      }

      setIsModalOpen(false);
      fetchTemplates();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Falha ao salvar template');
    }
  };

  const handleDeleteTemplate = async (tplId: string) => {
    if (!confirm('Tem certeza de que deseja excluir este template?')) return;
    try {
      const { error: delErr } = await supabase.from('email_templates').delete().eq('id', tplId);
      if (delErr) throw delErr;
      fetchTemplates();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Falha ao excluir template');
    }
  };

  return (
    <Layout
      eyebrow="MARKETING & COMUNICAÇÃO"
      title="Templates de Mensagem"
      subtitle="Biblioteca de templates e peças visuais reutilizáveis para campanhas e automações"
      actions={
        <div className="flex items-center gap-2.5">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="input-executive text-xs py-1.5 px-3 bg-white w-auto"
          >
            <option value="">Todas as Categorias</option>
            <option value="general">Geral</option>
            <option value="welcome">Boas-vindas</option>
            <option value="promotional">Promocional</option>
            <option value="followup">Follow-up</option>
          </select>
          <button
            onClick={handleOpenCreate}
            className="btn-crimson text-xs px-3.5 py-2 shadow-sm"
          >
            <Plus className="h-4 w-4" />
            <span>Novo Template</span>
          </button>
        </div>
      }
    >
      <div className="space-y-6">

        {isLoading ? (
          <LoadingState message="Carregando templates..." />
        ) : error ? (
          <ErrorState message={error} onRetry={fetchTemplates} />
        ) : templates.length === 0 ? (
          <EmptyState
            title="Nenhum template encontrado"
            message="Crie seu primeiro template visual reutilizável para campanhas de marketing."
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {templates.map((tpl) => (
              <div
                key={tpl.id}
                className="card-executive p-5 hover:border-[#449bd5]/50 transition-all flex flex-col justify-between space-y-4"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="px-2.5 py-0.5 text-[10px] font-bold uppercase rounded-md bg-[#08254f]/8 text-[#08254f] border border-[#08254f]/20 font-heading">
                      {tpl.category}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {new Date(tpl.created_at).toLocaleDateString('pt-BR')}
                    </span>
                  </div>
                  <h3 className="text-base font-bold font-heading text-[#08254f] tracking-tight">{tpl.name}</h3>
                  <p className="text-xs text-slate-500 line-clamp-2">
                    {tpl.description || 'Nenhuma descrição informada.'}
                  </p>
                </div>

                <div className="pt-3 border-t border-gray-100 flex items-center justify-between">
                  <button
                    onClick={() => setPreviewTemplate(tpl)}
                    className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 hover:text-[#08254f] transition-colors"
                  >
                    <Eye className="h-3.5 w-3.5" /> Pré-visualizar
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleOpenEdit(tpl)}
                      className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                      title="Editar template"
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteTemplate(tpl.id)}
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Excluir template"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Modal: Create / Edit Template */}
        <Modal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          title={editingTemplate ? 'Editar Template de Email' : 'Novo Template de Email'}
          maxWidthClass="max-w-4xl"
          footer={
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="btn-secondary text-xs px-4 py-2"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveTemplate}
                className="btn-crimson text-xs px-5 py-2 flex items-center gap-2"
              >
                <Save className="h-4 w-4" />
                <span>Salvar Template</span>
              </button>
            </div>
          }
        >
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">Nome do Template</label>
                <input
                  type="text"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="Ex: Convite para Masterclass"
                  className="input-executive text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Categoria</label>
                <select
                  value={templateCat}
                  onChange={(e) => setTemplateCat(e.target.value)}
                  className="input-executive text-sm bg-white"
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
                  value={templateDesc}
                  onChange={(e) => setTemplateDesc(e.target.value)}
                  placeholder="Breve anotação sobre quando utilizar este template..."
                  className="input-executive text-xs"
                />
              </div>
            </div>

            {/* Embedded Visual Block Editor */}
            <div>
              <label className="block text-xs font-bold text-[#08254f] uppercase tracking-wider mb-2 font-heading">
                Estrutura & Conteúdo do Template
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
        </Modal>

        {/* Modal: Preview Template */}
        <Modal
          isOpen={Boolean(previewTemplate)}
          onClose={() => setPreviewTemplate(null)}
          title={`Pré-visualização: ${previewTemplate?.name || ''}`}
          maxWidthClass="max-w-2xl"
        >
          <div className="p-2 bg-slate-100 rounded-xl">
            <iframe
              title="Template HTML"
              srcDoc={previewTemplate?.html_template || ''}
              className="w-full h-[550px] bg-white rounded-xl shadow-xs border border-gray-200"
            />
          </div>
        </Modal>
      </div>
    </Layout>
  );
}
