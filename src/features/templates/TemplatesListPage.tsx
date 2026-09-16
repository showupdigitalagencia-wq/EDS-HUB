import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { Layout } from '../../components/Layout';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';
import { EmptyState } from '../../components/EmptyState';
import { BlockEditor } from '../editor/BlockEditor';
import type { EmailTemplate } from '../../types';
import type { EmailBlock } from '../editor/types';
import {
  FileText,
  Plus,
  Edit2,
  Trash2,
  Eye,
  X,
  Save,
  FolderOpen,
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
      setError(err instanceof Error ? err.message : 'Failed to fetch templates');
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
      alert('Please provide a template name.');
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
      alert(err instanceof Error ? err.message : 'Failed to save template');
    }
  };

  const handleDeleteTemplate = async (tplId: string) => {
    if (!confirm('Are you sure you want to delete this template?')) return;
    try {
      const { error: delErr } = await supabase.from('email_templates').delete().eq('id', tplId);
      if (delErr) throw delErr;
      fetchTemplates();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete template');
    }
  };

  return (
    <Layout title="Email Templates">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-brand-50 text-brand-600">
                <FileText className="h-6 w-6" />
              </div>
              <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Email Templates</h1>
            </div>
            <p className="text-sm text-gray-500 mt-1">
              Reusable visual email designs for outbound marketing campaigns
            </p>
          </div>

          <div className="flex items-center gap-3">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-3 py-2 text-xs font-semibold bg-white border border-gray-200 rounded-xl shadow-xs"
            >
              <option value="">All Categories</option>
              <option value="general">General</option>
              <option value="welcome">Welcome Series</option>
              <option value="promotional">Promotional</option>
              <option value="followup">Follow-up</option>
            </select>
            <button
              onClick={handleOpenCreate}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-xl shadow-xs transition-colors"
            >
              <Plus className="h-4 w-4" />
              New Template
            </button>
          </div>
        </div>

        {isLoading ? (
          <LoadingState message="Loading templates..." />
        ) : error ? (
          <ErrorState message={error} onRetry={fetchTemplates} />
        ) : templates.length === 0 ? (
          <EmptyState
            title="No email templates found"
            message="Create your first reusable visual template to power marketing campaigns."
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {templates.map((tpl) => (
              <div
                key={tpl.id}
                className="bg-white rounded-2xl border border-gray-200 shadow-xs hover:shadow-md transition-all p-5 flex flex-col justify-between space-y-4"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="px-2.5 py-0.5 text-[10px] font-bold uppercase rounded-md bg-brand-50 text-brand-700 border border-brand-200">
                      {tpl.category}
                    </span>
                    <span className="text-[11px] text-gray-400">
                      {new Date(tpl.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-gray-900 tracking-tight">{tpl.name}</h3>
                  <p className="text-xs text-gray-500 line-clamp-2">
                    {tpl.description || 'No description provided.'}
                  </p>
                </div>

                <div className="pt-3 border-t border-gray-100 flex items-center justify-between">
                  <button
                    onClick={() => setPreviewTemplate(tpl)}
                    className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 hover:text-brand-600 transition-colors"
                  >
                    <Eye className="h-3.5 w-3.5" /> Preview
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleOpenEdit(tpl)}
                      className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                      title="Edit template"
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteTemplate(tpl.id)}
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Delete template"
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
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[92vh] overflow-y-auto border border-gray-100 flex flex-col">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <FolderOpen className="h-5 w-5 text-brand-600" />
                  <h2 className="text-base font-bold text-gray-900">
                    {editingTemplate ? 'Edit Template' : 'Create Email Template'}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="p-6 space-y-5 flex-1 overflow-y-auto">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Template Name</label>
                    <input
                      type="text"
                      value={templateName}
                      onChange={(e) => setTemplateName(e.target.value)}
                      placeholder="e.g. Masterclass Invitation Email"
                      className="w-full px-3.5 py-2 text-sm border border-gray-200 rounded-xl focus:ring-1 focus:ring-brand-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Category</label>
                    <select
                      value={templateCat}
                      onChange={(e) => setTemplateCat(e.target.value)}
                      className="w-full px-3.5 py-2 text-sm border border-gray-200 rounded-xl bg-white"
                    >
                      <option value="general">General</option>
                      <option value="welcome">Welcome</option>
                      <option value="promotional">Promotional</option>
                      <option value="followup">Follow-up</option>
                    </select>
                  </div>
                  <div className="sm:col-span-3">
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Description (optional)</label>
                    <input
                      type="text"
                      value={templateDesc}
                      onChange={(e) => setTemplateDesc(e.target.value)}
                      placeholder="Brief note on when to use this template..."
                      className="w-full px-3.5 py-1.5 text-xs border border-gray-200 rounded-xl"
                    />
                  </div>
                </div>

                {/* Embedded Visual Block Editor */}
                <div>
                  <label className="block text-xs font-bold text-gray-800 uppercase tracking-wider mb-2">
                    Template Content & Structure
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

              <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/50">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-200 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveTemplate}
                  className="flex items-center gap-2 px-5 py-2 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-xl shadow-xs transition-colors"
                >
                  <Save className="h-4 w-4" /> Save Template
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal: Preview Template */}
        {previewTemplate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50">
                <span className="text-sm font-bold text-gray-800">Preview: {previewTemplate.name}</span>
                <button
                  onClick={() => setPreviewTemplate(null)}
                  className="p-1 text-gray-400 hover:text-gray-600"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="flex-1 p-4 overflow-y-auto bg-gray-100">
                <iframe
                  title="Template HTML"
                  srcDoc={previewTemplate.html_template}
                  className="w-full h-[550px] bg-white rounded-xl shadow-sm border border-gray-200"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
