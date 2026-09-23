import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { Layout } from '../../components/Layout';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';
import { EmptyState } from '../../components/EmptyState';
import { TemplateEditorModal } from './components/TemplateEditorModal';
import { TemplatePreviewModal } from './components/TemplatePreviewModal';
import { getTemplateChannel } from '../../utils/template-variables';
import { checkTemplateDeleteSafety, getTemplateUsage, type TemplateUsage } from './services/template-usage-service';
import type { EmailTemplate } from '../../types';
import {
  Plus,
  Edit2,
  Trash2,
  Eye,
  Mail,
  MessageSquare,
  Search,
  Layers,
  History,
} from 'lucide-react';

export function TemplatesListPage() {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [usages, setUsages] = useState<Record<string, TemplateUsage>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [channelFilter, setChannelFilter] = useState<'all' | 'email' | 'sms'>('all');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(null);
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
      const list = data || [];
      setTemplates(list);

      // Async load factual usages for loaded templates
      const usageMap: Record<string, TemplateUsage> = {};
      await Promise.all(
        list.map(async (tpl) => {
          try {
            const u = await getTemplateUsage(tpl.id);
            if (u.totalCount > 0) {
              usageMap[tpl.id] = u;
            }
          } catch {
            // Non-blocking in list view
          }
        }),
      );
      setUsages(usageMap);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar templates');
    } finally {
      setIsLoading(false);
    }
  }, [categoryFilter]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  // Filter templates by channel and search query
  const filteredTemplates = useMemo(() => {
    return templates.filter((tpl) => {
      const ch = getTemplateChannel(tpl);
      if (channelFilter !== 'all' && ch !== channelFilter) return false;
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesName = tpl.name.toLowerCase().includes(query);
        const matchesDesc = (tpl.description || '').toLowerCase().includes(query);
        if (!matchesName && !matchesDesc) return false;
      }
      return true;
    });
  }, [templates, channelFilter, searchQuery]);

  const handleOpenCreate = () => {
    setEditingTemplate(null);
    setIsEditorOpen(true);
  };

  const handleOpenEdit = (tpl: EmailTemplate) => {
    setEditingTemplate(tpl);
    setIsEditorOpen(true);
  };

  const handleDeleteTemplate = async (tpl: EmailTemplate) => {
    // Fail-safe check
    const safety = await checkTemplateDeleteSafety(tpl.id);
    if (!safety.canDelete) {
      alert(safety.errorMessage || 'Não foi possível verificar se este template está em uso. Tente novamente.');
      return;
    }

    if (safety.usage.totalCount > 0) {
      const confirmMsg =
        `Este template já foi utilizado como origem em ${safety.usage.totalCount} fluxo(s) ` +
        `(${safety.usage.campaigns.length} campanhas, ${safety.usage.automations.length + safety.usage.sequences.length} automações/sequências).\n\n` +
        `Como as versões foram copiadas e congeladas nos fluxos, a exclusão da biblioteca desvincula a referência sem interromper execuções salvas.\n\n` +
        `Deseja realmente excluir "${tpl.name}" da biblioteca?`;
      if (!confirm(confirmMsg)) return;
    } else {
      if (!confirm(`Tem certeza de que deseja excluir o template "${tpl.name}"?`)) return;
    }

    try {
      const { error: delErr } = await supabase.from('email_templates').delete().eq('id', tpl.id);
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
      subtitle="Biblioteca centralizada de modelos reutilizáveis para Campanhas, Automações e Sequências"
      actions={
        <button
          onClick={handleOpenCreate}
          className="btn-crimson text-xs px-3.5 py-2 shadow-sm flex items-center gap-1.5"
        >
          <Plus className="h-4 w-4" />
          <span>Novo Template</span>
        </button>
      }
    >
      <div className="space-y-6">
        {/* Filters & Search Toolbar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-slate-200/80 shadow-2xs">
          {/* Channel Filter Pills */}
          <div className="flex items-center gap-1.5 p-1 bg-slate-100/80 rounded-xl">
            <button
              onClick={() => setChannelFilter('all')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                channelFilter === 'all'
                  ? 'bg-white text-[#08254f] shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Todos ({templates.length})
            </button>
            <button
              onClick={() => setChannelFilter('email')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
                channelFilter === 'email'
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Mail className="w-3.5 h-3.5 text-blue-600" />
              <span>Email</span>
            </button>
            <button
              onClick={() => setChannelFilter('sms')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
                channelFilter === 'sms'
                  ? 'bg-white text-emerald-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
              <span>SMS</span>
            </button>
          </div>

          {/* Search & Category */}
          <div className="flex items-center gap-2.5">
            <div className="relative flex-1 sm:w-64">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar por nome ou conteúdo..."
                className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#08254f]"
              />
            </div>

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
          </div>
        </div>

        {/* Templates Grid */}
        {isLoading ? (
          <LoadingState message="Carregando biblioteca de templates..." />
        ) : error ? (
          <ErrorState message={error} onRetry={fetchTemplates} />
        ) : filteredTemplates.length === 0 ? (
          <EmptyState
            title="Nenhum template encontrado"
            message={
              searchQuery || channelFilter !== 'all' || categoryFilter
                ? 'Nenhum modelo corresponde aos filtros aplicados.'
                : 'Crie seu primeiro template reutilizável para Email ou SMS.'
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredTemplates.map((tpl) => {
              const ch = getTemplateChannel(tpl);
              const usage = usages[tpl.id];

              return (
                <div
                  key={tpl.id}
                  className="card-executive p-5 hover:border-[#449bd5]/50 transition-all flex flex-col justify-between space-y-4"
                >
                  <div className="space-y-2.5">
                    {/* Channel & Category Header */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {ch === 'email' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-[10px] font-bold uppercase rounded-md bg-blue-50 text-blue-700 border border-blue-200 font-heading">
                            <Mail className="w-3 h-3" /> Email
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-[10px] font-bold uppercase rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 font-heading">
                            <MessageSquare className="w-3 h-3" /> SMS
                          </span>
                        )}

                        <span className="px-2 py-0.5 text-[10px] font-medium rounded-md bg-slate-100 text-slate-600 border border-slate-200">
                          {tpl.category}
                        </span>
                      </div>

                      <span className="text-[11px] text-slate-400">
                        {new Date(tpl.created_at).toLocaleDateString('pt-BR')}
                      </span>
                    </div>

                    {/* Title & Description */}
                    <div>
                      <h3 className="text-base font-bold font-heading text-[#08254f] tracking-tight">
                        {tpl.name}
                      </h3>
                      <p className="text-xs text-slate-500 line-clamp-2 mt-1">
                        {tpl.description || (ch === 'sms' ? tpl.text_template : 'Sem descrição informada.')}
                      </p>
                    </div>

                    {/* Factual Origin Usage Badge */}
                    {usage && usage.totalCount > 0 ? (
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-500 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-200/80">
                        <History className="w-3.5 h-3.5 text-[#449bd5]" />
                        <span>
                          Origem em <strong>{usage.totalCount}</strong> fluxo(s)
                          {usage.campaigns.length > 0 && ` (${usage.campaigns.length} camp.)`}
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                        <Layers className="w-3.5 h-3.5 text-slate-300" />
                        <span>Pronto para uso</span>
                      </div>
                    )}
                  </div>

                  {/* Actions Footer */}
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
                        className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
                        title="Editar template"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteTemplate(tpl)}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                        title="Excluir template"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Modal: Create / Edit Template */}
        <TemplateEditorModal
          isOpen={isEditorOpen}
          onClose={() => setIsEditorOpen(false)}
          editingTemplate={editingTemplate}
          onSaveSuccess={fetchTemplates}
        />

        {/* Modal: Realistic Preview */}
        <TemplatePreviewModal
          isOpen={Boolean(previewTemplate)}
          onClose={() => setPreviewTemplate(null)}
          template={previewTemplate}
        />
      </div>
    </Layout>
  );
}
