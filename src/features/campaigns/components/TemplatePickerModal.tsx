import { useState, useMemo } from 'react';
import { Modal } from '../../../components/ui/Modal';
import { getTemplateChannel, getTemplateSubject } from '../../../utils/template-variables';
import type { EmailTemplate } from '../../../types';
import {
  Search,
  Check,
  FileText,
  Sparkles,
} from 'lucide-react';

interface TemplatePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  templates: EmailTemplate[];
  selectedTemplateId: string | null;
  onSelectTemplate: (template: EmailTemplate) => void;
}

export function TemplatePickerModal({
  isOpen,
  onClose,
  templates,
  selectedTemplateId,
  onSelectTemplate,
}: TemplatePickerModalProps) {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  const emailTemplates = useMemo(() => {
    return templates.filter((t) => getTemplateChannel(t) === 'email');
  }, [templates]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    emailTemplates.forEach((t) => {
      if (t.category) cats.add(t.category);
    });
    return Array.from(cats);
  }, [emailTemplates]);

  const filteredTemplates = useMemo(() => {
    return emailTemplates.filter((t) => {
      const matchesCategory = selectedCategory === 'all' || t.category === selectedCategory;
      if (!matchesCategory) return false;

      if (!search.trim()) return true;
      const term = search.toLowerCase();
      const subject = (getTemplateSubject(t) || '').toLowerCase();
      const name = (t.name || '').toLowerCase();
      const preheader = (t.description || '').toLowerCase();

      return name.includes(term) || subject.includes(term) || preheader.includes(term);
    });
  }, [emailTemplates, selectedCategory, search]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Escolher Template de Email"
      maxWidthClass="max-w-2xl"
    >
      <div className="space-y-4 max-h-[75vh] flex flex-col">
        {/* Search & Category Filter */}
        <div className="space-y-3 shrink-0">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome do template ou assunto..."
              className="w-full pl-10 pr-4 py-2 text-xs border border-slate-200 rounded-xl focus:ring-1 focus:ring-[#08254f] outline-none"
            />
          </div>

          <div className="flex flex-wrap gap-1.5 pb-1">
            <button
              type="button"
              onClick={() => setSelectedCategory('all')}
              className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors cursor-pointer ${
                selectedCategory === 'all'
                  ? 'bg-[#08254f] text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Todos ({emailTemplates.length})
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors cursor-pointer capitalize ${
                  selectedCategory === cat
                    ? 'bg-[#08254f] text-white shadow-2xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Template List Cards */}
        <div className="overflow-y-auto space-y-3 pr-1 divide-y divide-slate-100">
          {filteredTemplates.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400 italic">
              Nenhum template encontrado com os critérios de busca informados.
            </div>
          ) : (
            filteredTemplates.map((t) => {
              const isSelected = t.id === selectedTemplateId;
              const subject = getTemplateSubject(t) || 'Sem assunto definido';
              const hasAttachment = Boolean(t.has_attachment || t.attachment_name);

              return (
                <div
                  key={t.id}
                  className={`pt-3 first:pt-0 p-3.5 rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'border-[#08254f] bg-blue-50/40 ring-1 ring-[#08254f]'
                      : 'border-slate-200/80 bg-white hover:border-slate-300 hover:bg-slate-50/60'
                  }`}
                  onClick={() => {
                    onSelectTemplate(t);
                    onClose();
                  }}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="space-y-1.5 flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm text-[#08254f] truncate">{t.name}</span>
                        {t.category && (
                          <span className="px-2 py-0.5 text-[10px] font-semibold rounded-md bg-slate-100 text-slate-700 capitalize">
                            {t.category}
                          </span>
                        )}
                        {hasAttachment && (
                          <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-amber-50 text-amber-800 border border-amber-200 flex items-center gap-1">
                            <FileText className="w-3 h-3 text-amber-600" />
                            Possui PDF ({t.attachment_name || 'Anexo'})
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-slate-700 font-medium line-clamp-1">
                        <span className="text-slate-400 font-normal">Assunto:</span> {subject}
                      </p>

                      {t.description && (
                        <p className="text-[11px] text-slate-500 line-clamp-2">{t.description}</p>
                      )}
                    </div>

                    <div className="shrink-0 flex items-center gap-2">
                      {isSelected ? (
                        <span className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-emerald-800 bg-emerald-100 rounded-lg">
                          <Check className="w-3.5 h-3.5" /> Template Ativo
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="w-full sm:w-auto px-3.5 py-1.5 text-xs font-bold text-white bg-[#08254f] hover:bg-[#061d3d] rounded-lg transition-colors shadow-2xs"
                        >
                          Carregar Este Template
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer info */}
        <div className="pt-3 border-t border-slate-100 text-[11px] text-slate-500 flex items-center justify-between">
          <span className="flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5 text-[#449bd5]" /> O conteúdo será copiado para o editor desta campanha.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
          >
            Fechar
          </button>
        </div>
      </div>
    </Modal>
  );
}
