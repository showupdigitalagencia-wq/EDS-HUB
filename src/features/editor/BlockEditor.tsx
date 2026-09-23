import { useState, useEffect } from 'react';
import type { EmailBlock, BlockType } from './types';
import { renderBlocksToHtml, renderBlocksToText } from './utils/htmlGenerator';
import {
  Heading,
  AlignLeft,
  Image as ImageIcon,
  MousePointerClick,
  Minus,
  MoveVertical,
  ChevronUp,
  ChevronDown,
  Copy,
  Trash2,
  Eye,
  Code,
  Sparkles,
  Plus,
  GripVertical,
} from 'lucide-react';
import { GLOBAL_TEMPLATE_VARIABLES } from '../../utils/template-variables';

interface BlockEditorProps {
  initialBlocks?: EmailBlock[];
  blocks?: EmailBlock[];
  onChange?: (blocks: EmailBlock[], html: string, text: string) => void;
  hideHeader?: boolean;
}

export function BlockEditor({
  initialBlocks = [],
  blocks: controlledBlocks,
  onChange,
  hideHeader = false,
}: BlockEditorProps) {
  const [internalBlocks, setInternalBlocks] = useState<EmailBlock[]>(() => {
    if (controlledBlocks && controlledBlocks.length > 0) return controlledBlocks;
    if (initialBlocks && initialBlocks.length > 0) return initialBlocks;
    return [
      {
        id: 'h-1',
        type: 'heading',
        text: 'Atualização exclusiva para {{salutation}}',
        level: 1,
        align: 'center',
        color: '#08254f',
      },
      {
        id: 't-1',
        type: 'text',
        text: 'Olá {{first_name}},\n\nObrigado por confiar na Expert Dental Solutions. Estamos muito felizes em apresentar as novidades pensadas para a sua clínica.',
        align: 'left',
        color: '#334155',
      },
      {
        id: 'b-1',
        type: 'button',
        label: 'Ver Programação Completa',
        url: 'https://expdentalsolutions.com',
        align: 'center',
        bgColor: '#08254f',
        textColor: '#ffffff',
      },
    ];
  });

  // Sync when controlled blocks change
  useEffect(() => {
    if (controlledBlocks) {
      setInternalBlocks(controlledBlocks);
    }
  }, [controlledBlocks]);

  const blocks = controlledBlocks ?? internalBlocks;

  const [activeTab, setActiveTab] = useState<'editor' | 'preview'>('editor');
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);

  const updateBlocks = (newBlocks: EmailBlock[]) => {
    if (!controlledBlocks) {
      setInternalBlocks(newBlocks);
    }
    if (onChange) {
      const html = renderBlocksToHtml(newBlocks);
      const text = renderBlocksToText(newBlocks);
      onChange(newBlocks, html, text);
    }
  };

  const addBlock = (type: BlockType) => {
    const id = `${type}-${Date.now()}`;
    let newB: EmailBlock;

    switch (type) {
      case 'heading':
        newB = { id, type: 'heading', text: 'Novo Título', level: 2, align: 'left', color: '#08254f' };
        break;
      case 'text':
        newB = { id, type: 'text', text: 'Escreva o texto do parágrafo aqui...', align: 'left', color: '#334155' };
        break;
      case 'image':
        newB = {
          id,
          type: 'image',
          url: 'https://placehold.co/600x250/08254f/ffffff?text=Banner+Informativo',
          alt: 'Imagem de cabeçalho',
          align: 'center',
          width: '100%',
        };
        break;
      case 'button':
        newB = {
          id,
          type: 'button',
          label: 'Acessar Conteúdo',
          url: 'https://expdentalsolutions.com',
          align: 'center',
          bgColor: '#08254f',
          textColor: '#ffffff',
        };
        break;
      case 'divider':
        newB = { id, type: 'divider', thickness: 1, color: '#e2e8f0' };
        break;
      case 'spacer':
        newB = { id, type: 'spacer', height: 24 };
        break;
    }

    updateBlocks([...blocks, newB]);
    setSelectedBlockId(id);
  };

  const moveBlock = (index: number, direction: 'up' | 'down') => {
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= blocks.length) return;

    const copy = [...blocks];
    const item = copy[index];
    copy[index] = copy[targetIdx];
    copy[targetIdx] = item;
    updateBlocks(copy);
  };

  const duplicateBlock = (index: number) => {
    const item = blocks[index];
    const copy = { ...item, id: `${item.type}-${Date.now()}` };
    const next = [...blocks];
    next.splice(index + 1, 0, copy);
    updateBlocks(next);
  };

  const deleteBlock = (id: string) => {
    updateBlocks(blocks.filter((b) => b.id !== id));
    if (selectedBlockId === id) setSelectedBlockId(null);
  };

  const updateBlockField = (id: string, updates: Partial<EmailBlock>) => {
    const next = blocks.map((b) => (b.id === id ? ({ ...b, ...updates } as EmailBlock) : b));
    updateBlocks(next);
  };

  const insertVariable = (variableKey: string) => {
    if (!selectedBlockId) return;
    const block = blocks.find((b) => b.id === selectedBlockId);
    if (!block) return;

    if (block.type === 'heading' || block.type === 'text') {
      updateBlockField(selectedBlockId, { text: `${block.text} ${variableKey}` });
    }
  };

  const getBlockLabel = (type: BlockType): string => {
    switch (type) {
      case 'heading':
        return 'Bloco de Título';
      case 'text':
        return 'Bloco de Texto';
      case 'image':
        return 'Bloco de Imagem';
      case 'button':
        return 'Bloco de Botão';
      case 'divider':
        return 'Bloco de Divisor';
      case 'spacer':
        return 'Bloco de Espaço';
    }
  };

  // Preview with fictional simulated recipient
  const previewHtml = renderBlocksToHtml(blocks)
    .replace(/\{\{\s*first_name\s*\}\}/gi, 'Maria')
    .replace(/\{\{\s*salutation\s*\}\}/gi, 'Silva');

  return (
    <div className="bg-transparent flex flex-col space-y-4">
      {/* Optional Standalone Header Bar (if not embedded inside modal tabs) */}
      {!hideHeader && (
        <div className="px-4 py-3 bg-white rounded-xl border border-slate-200/80 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-2xs">
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-[#08254f] font-heading">
              Editor de Email
            </span>
            <div className="flex bg-slate-100 p-0.5 rounded-lg text-xs font-medium">
              <button
                type="button"
                onClick={() => setActiveTab('editor')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-colors ${
                  activeTab === 'editor'
                    ? 'bg-white shadow-2xs text-[#08254f] font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Code className="h-3.5 w-3.5" />
                Blocos
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('preview')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-colors ${
                  activeTab === 'preview'
                    ? 'bg-white shadow-2xs text-[#08254f] font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Eye className="h-3.5 w-3.5" />
                Prévia
              </button>
            </div>
          </div>

          {/* Variables shortcuts */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1">
              <Sparkles className="h-3 w-3 text-[#449bd5]" /> Inserir:
            </span>
            {GLOBAL_TEMPLATE_VARIABLES.map((v) => (
              <button
                key={v.key}
                type="button"
                onClick={() => insertVariable(v.key)}
                className="px-2 py-0.5 text-[11px] font-mono bg-white border border-slate-200 text-slate-700 rounded-md hover:border-[#08254f] hover:text-[#08254f] transition-colors"
                title={v.description}
              >
                {v.key}
              </button>
            ))}
          </div>
        </div>
      )}

      {(activeTab === 'editor' || hideHeader) ? (
        <div className="space-y-4">
          {/* Add Block Toolbar */}
          <div className="p-3 bg-white rounded-xl border border-slate-200/80 shadow-2xs">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5 font-heading">
                <Plus className="h-3.5 w-3.5 text-[#08254f]" /> Adicionar bloco
              </span>
              <span className="text-[11px] text-slate-400 hidden sm:inline">
                Selecione o tipo de bloco para inserir no template
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
              {[
                { type: 'heading' as BlockType, label: 'Título', icon: Heading },
                { type: 'text' as BlockType, label: 'Texto', icon: AlignLeft },
                { type: 'image' as BlockType, label: 'Imagem', icon: ImageIcon },
                { type: 'button' as BlockType, label: 'Botão', icon: MousePointerClick },
                { type: 'divider' as BlockType, label: 'Divisor', icon: Minus },
                { type: 'spacer' as BlockType, label: 'Espaço', icon: MoveVertical },
              ].map((btn) => (
                <button
                  key={btn.type}
                  type="button"
                  onClick={() => addBlock(btn.type)}
                  className="flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium bg-slate-50/70 hover:bg-blue-50/60 hover:text-[#08254f] border border-slate-200/80 rounded-xl transition-all duration-150 cursor-pointer text-slate-700 group"
                >
                  <btn.icon className="h-3.5 w-3.5 text-slate-400 group-hover:text-[#08254f] transition-colors" />
                  <span>{btn.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Blocks Canvas */}
          <div className="space-y-3">
            {blocks.length === 0 ? (
              <div className="p-8 text-center bg-white rounded-xl border border-dashed border-slate-200 text-slate-400 text-xs">
                Nenhum bloco adicionado. Clique em uma das opções acima para começar a compor.
              </div>
            ) : (
              blocks.map((block, idx) => {
                const isSelected = selectedBlockId === block.id;

                return (
                  <div
                    key={block.id}
                    onClick={() => setSelectedBlockId(block.id)}
                    className={`p-3.5 sm:p-4 rounded-xl border transition-all duration-150 bg-white ${
                      isSelected
                        ? 'border-[#08254f]/40 bg-blue-50/15 shadow-xs ring-1 ring-[#08254f]/10'
                        : 'border-slate-200/80 hover:border-slate-300'
                    }`}
                  >
                    {/* Compact Header */}
                    <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100">
                      <div className="flex items-center gap-2">
                        <GripVertical className="h-4 w-4 text-slate-300 shrink-0" />
                        <span className="font-semibold text-slate-700 text-xs font-heading">
                          {getBlockLabel(block.type)}
                        </span>
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={(e) => {
                            e.stopPropagation();
                            moveBlock(idx, 'up');
                          }}
                          className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded disabled:opacity-20 cursor-pointer"
                          title="Subir bloco"
                        >
                          <ChevronUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === blocks.length - 1}
                          onClick={(e) => {
                            e.stopPropagation();
                            moveBlock(idx, 'down');
                          }}
                          className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded disabled:opacity-20 cursor-pointer"
                          title="Descer bloco"
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            duplicateBlock(idx);
                          }}
                          className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded cursor-pointer"
                          title="Duplicar bloco"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteBlock(block.id);
                          }}
                          className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded cursor-pointer"
                          title="Excluir bloco"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Block Content Editor */}
                    {block.type === 'heading' && (
                      <div className="space-y-2.5">
                        <input
                          type="text"
                          value={block.text}
                          onChange={(e) => updateBlockField(block.id, { text: e.target.value })}
                          placeholder="Digite o texto do título..."
                          className="w-full h-10 px-3.5 text-sm sm:text-base font-bold text-slate-900 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#08254f] focus:border-[#08254f]"
                        />
                        <div className="flex flex-wrap items-center gap-3 text-xs">
                          {/* Tamanho Pills */}
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-400 font-medium">Tamanho:</span>
                            <div className="inline-flex p-0.5 bg-slate-100 rounded-lg border border-slate-200/80">
                              {[
                                { level: 1, label: 'H1' },
                                { level: 2, label: 'H2' },
                                { level: 3, label: 'H3' },
                              ].map((lvl) => (
                                <button
                                  key={lvl.level}
                                  type="button"
                                  onClick={() => updateBlockField(block.id, { level: lvl.level as 1 | 2 | 3 })}
                                  className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
                                    block.level === lvl.level
                                      ? 'bg-white text-[#08254f] shadow-2xs'
                                      : 'text-slate-500 hover:text-slate-800'
                                  }`}
                                >
                                  {lvl.label}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Alinhamento Pills */}
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-400 font-medium">Alinhamento:</span>
                            <div className="inline-flex p-0.5 bg-slate-100 rounded-lg border border-slate-200/80">
                              {[
                                { align: 'left', label: 'Esquerda' },
                                { align: 'center', label: 'Centro' },
                                { align: 'right', label: 'Direita' },
                              ].map((al) => (
                                <button
                                  key={al.align}
                                  type="button"
                                  onClick={() => updateBlockField(block.id, { align: al.align as any })}
                                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
                                    block.align === al.align
                                      ? 'bg-white text-[#08254f] font-semibold shadow-2xs'
                                      : 'text-slate-500 hover:text-slate-800'
                                  }`}
                                >
                                  {al.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {block.type === 'text' && (
                      <div className="space-y-2.5">
                        <textarea
                          rows={3}
                          value={block.text}
                          onChange={(e) => updateBlockField(block.id, { text: e.target.value })}
                          placeholder="Digite o texto do parágrafo..."
                          className="w-full p-3 text-xs sm:text-sm text-slate-800 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#08254f] focus:border-[#08254f] leading-relaxed"
                        />
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="text-slate-400 font-medium">Alinhamento:</span>
                          <div className="inline-flex p-0.5 bg-slate-100 rounded-lg border border-slate-200/80">
                            {[
                              { align: 'left', label: 'Esquerda' },
                              { align: 'center', label: 'Centro' },
                              { align: 'right', label: 'Direita' },
                            ].map((al) => (
                              <button
                                key={al.align}
                                type="button"
                                onClick={() => updateBlockField(block.id, { align: al.align as any })}
                                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
                                  block.align === al.align
                                    ? 'bg-white text-[#08254f] font-semibold shadow-2xs'
                                    : 'text-slate-500 hover:text-slate-800'
                                }`}
                              >
                                {al.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {block.type === 'image' && (
                      <div className="space-y-2">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-0.5">URL da Imagem</label>
                            <input
                              type="url"
                              value={block.url}
                              onChange={(e) => updateBlockField(block.id, { url: e.target.value })}
                              placeholder="https://exemplo.com/banner.jpg"
                              className="w-full h-9 px-3 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#08254f]"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-0.5">Texto Alternativo (Alt)</label>
                            <input
                              type="text"
                              value={block.alt}
                              onChange={(e) => updateBlockField(block.id, { alt: e.target.value })}
                              placeholder="Descrição da imagem para acessibilidade"
                              className="w-full h-9 px-3 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#08254f]"
                            />
                          </div>
                        </div>
                        {block.url && (
                          <div className="mt-2 p-2 bg-slate-50 rounded-lg border border-slate-200 flex justify-center">
                            <img
                              src={block.url}
                              alt={block.alt || 'Prévia'}
                              className="max-h-36 rounded object-contain"
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = 'none';
                              }}
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {block.type === 'button' && (
                      <div className="space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-0.5">Texto do botão</label>
                            <input
                              type="text"
                              value={block.label}
                              onChange={(e) => updateBlockField(block.id, { label: e.target.value })}
                              placeholder="Ex: Ver agenda completa"
                              className="w-full h-9 px-3 text-xs font-semibold border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#08254f]"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-0.5">Link de Destino</label>
                            <input
                              type="url"
                              value={block.url}
                              onChange={(e) => updateBlockField(block.id, { url: e.target.value })}
                              placeholder="https://..."
                              className="w-full h-9 px-3 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#08254f]"
                            />
                          </div>
                        </div>

                        {/* Brand-Styled Button Preview */}
                        <div className="pt-2 border-t border-slate-100 flex flex-col items-center justify-center p-3 bg-slate-50/60 rounded-lg">
                          <span className="text-[10px] text-slate-400 uppercase tracking-wider mb-2 font-heading">
                            Prévia visual do botão
                          </span>
                          <span className="inline-block px-5 py-2.5 bg-[#08254f] text-white text-xs font-bold rounded-xl shadow-xs">
                            {block.label || 'Clique aqui'}
                          </span>
                        </div>
                      </div>
                    )}

                    {block.type === 'divider' && (
                      <div className="py-2 text-center text-xs text-slate-400">
                        <hr className="border-t border-slate-200 my-1" />
                        <span className="text-[11px]">Linha Divisória Horizontal</span>
                      </div>
                    )}

                    {block.type === 'spacer' && (
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-slate-500 font-medium">Altura do espaçamento:</span>
                        <input
                          type="number"
                          min={8}
                          max={80}
                          value={block.height}
                          onChange={(e) => updateBlockField(block.id, { height: Number(e.target.value) })}
                          className="w-20 h-8 px-2.5 border border-slate-200 rounded-lg text-xs"
                        />
                        <span className="text-slate-400">pixels</span>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : (
        /* Standalone Live Preview (when activeTab === 'preview' in standalone mode) */
        <div className="p-4 sm:p-6 bg-slate-100 rounded-xl flex justify-center">
          <div className="w-full max-w-[620px] bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between text-xs text-slate-600">
              <span>Destinatário Simulado: <strong>Maria Silva</strong></span>
              <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-semibold text-[10px] font-mono">
                HTML Responsivo
              </span>
            </div>
            <iframe
              title="Prévia HTML do Email"
              srcDoc={previewHtml}
              className="w-full h-[500px] border-none"
            />
          </div>
        </div>
      )}
    </div>
  );
}
