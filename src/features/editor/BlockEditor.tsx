import { useState } from 'react';
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
} from 'lucide-react';

interface BlockEditorProps {
  initialBlocks?: EmailBlock[];
  onChange?: (blocks: EmailBlock[], html: string, text: string) => void;
}

export function BlockEditor({ initialBlocks = [], onChange }: BlockEditorProps) {
  const [blocks, setBlocks] = useState<EmailBlock[]>(
    initialBlocks.length > 0
      ? initialBlocks
      : [
          {
            id: 'h-1',
            type: 'heading',
            text: 'Exclusive Update for {{salutation}}',
            level: 1,
            align: 'center',
            color: '#0f172a',
          },
          {
            id: 't-1',
            type: 'text',
            text: 'Hello {{first_name}},\n\nThank you for choosing Expert Dental Solutions. We are excited to present our newest program tailored to your practice.',
            align: 'left',
            color: '#334155',
          },
          {
            id: 'b-1',
            type: 'button',
            label: 'View Full Schedule',
            url: 'https://expdentalsolutions.com',
            align: 'center',
            bgColor: '#0284c7',
            textColor: '#ffffff',
          },
        ],
  );

  const [activeTab, setActiveTab] = useState<'editor' | 'preview'>('editor');
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);

  const updateBlocks = (newBlocks: EmailBlock[]) => {
    setBlocks(newBlocks);
    if (onChange) {
      const html = renderBlocksToHtml(newBlocks);
      const text = renderBlocksToText(newBlocks);
      onChange(newBlocks, html, text);
    }
  };

  const addBlock = (type: BlockType) => {
    const id = `${type}-${blocks.length + 1}`;
    let newB: EmailBlock;

    switch (type) {
      case 'heading':
        newB = { id, type: 'heading', text: 'New Heading', level: 2, align: 'left' };
        break;
      case 'text':
        newB = { id, type: 'text', text: 'Write your message paragraph here...', align: 'left' };
        break;
      case 'image':
        newB = { id, type: 'image', url: 'https://placehold.co/600x250/0284c7/ffffff?text=Header+Image', alt: 'Header Banner', align: 'center', width: '100%' };
        break;
      case 'button':
        newB = { id, type: 'button', label: 'Call to Action', url: 'https://expdentalsolutions.com', align: 'center', bgColor: '#0284c7', textColor: '#ffffff' };
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

  const insertVariable = (variable: string) => {
    if (!selectedBlockId) return;
    const block = blocks.find((b) => b.id === selectedBlockId);
    if (!block) return;

    if (block.type === 'heading' || block.type === 'text') {
      updateBlockField(selectedBlockId, { text: `${block.text} {{${variable}}}` });
    }
  };

  // Preview with simulated recipient
  const previewHtml = renderBlocksToHtml(blocks)
    .replace(/\{\{\s*first_name\s*\}\}/gi, 'John')
    .replace(/\{\{\s*last_name\s*\}\}/gi, 'Smith')
    .replace(/\{\{\s*salutation\s*\}\}/gi, 'Dr. Smith');

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden flex flex-col">
      {/* Editor Header Bar */}
      <div className="px-5 py-3.5 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-gray-50/60">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase text-gray-500 tracking-wider">Visual Email Builder</span>
          <div className="flex bg-gray-200/80 p-0.5 rounded-xl text-xs font-medium">
            <button
              type="button"
              onClick={() => setActiveTab('editor')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg transition-colors ${
                activeTab === 'editor' ? 'bg-white shadow-xs text-brand-700 font-semibold' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <Code className="h-3.5 w-3.5" />
              Editor
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('preview')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg transition-colors ${
                activeTab === 'preview' ? 'bg-white shadow-xs text-brand-700 font-semibold' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <Eye className="h-3.5 w-3.5" />
              Live Preview
            </button>
          </div>
        </div>

        {/* Variables shortcuts */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-medium text-gray-400 flex items-center gap-1">
            <Sparkles className="h-3 w-3 text-amber-500" /> Insert:
          </span>
          {['salutation', 'first_name', 'last_name'].map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => insertVariable(v)}
              className="px-2 py-0.5 text-[11px] font-mono bg-white border border-gray-200 text-gray-700 rounded-md hover:border-brand-500 hover:text-brand-600 transition-colors"
            >
              {`{{${v}}}`}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'editor' ? (
        <div className="p-6 space-y-6">
          {/* Add Block Toolbar */}
          <div className="flex flex-wrap items-center gap-2 p-3 bg-gray-50 rounded-xl border border-gray-200/70">
            <span className="text-xs font-semibold text-gray-500 mr-1 flex items-center gap-1">
              <Plus className="h-3.5 w-3.5" /> Add Block:
            </span>
            {[
              { type: 'heading' as BlockType, label: 'Heading', icon: Heading },
              { type: 'text' as BlockType, label: 'Paragraph', icon: AlignLeft },
              { type: 'image' as BlockType, label: 'Image', icon: ImageIcon },
              { type: 'button' as BlockType, label: 'Button', icon: MousePointerClick },
              { type: 'divider' as BlockType, label: 'Divider', icon: Minus },
              { type: 'spacer' as BlockType, label: 'Spacer', icon: MoveVertical },
            ].map((btn) => (
              <button
                key={btn.type}
                type="button"
                onClick={() => addBlock(btn.type)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white hover:bg-brand-50 hover:text-brand-700 border border-gray-200 rounded-lg shadow-2xs transition-colors"
              >
                <btn.icon className="h-3.5 w-3.5 text-gray-500" />
                {btn.label}
              </button>
            ))}
          </div>

          {/* Blocks Canvas */}
          <div className="space-y-4 max-w-2xl mx-auto">
            {blocks.map((block, idx) => {
              const isSelected = selectedBlockId === block.id;

              return (
                <div
                  key={block.id}
                  onClick={() => setSelectedBlockId(block.id)}
                  className={`p-4 rounded-xl border transition-all relative group ${
                    isSelected
                      ? 'border-brand-500 bg-white ring-2 ring-brand-500/10 shadow-sm'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  {/* Action controls */}
                  <div className="flex items-center justify-between mb-2 text-xs text-gray-400 border-b border-gray-100 pb-2">
                    <span className="font-semibold uppercase text-gray-600 text-[10px] tracking-wider">
                      {block.type} Block
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={(e) => {
                          e.stopPropagation();
                          moveBlock(idx, 'up');
                        }}
                        className="p-1 hover:text-gray-700 disabled:opacity-30"
                        title="Move Up"
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
                        className="p-1 hover:text-gray-700 disabled:opacity-30"
                        title="Move Down"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          duplicateBlock(idx);
                        }}
                        className="p-1 hover:text-gray-700"
                        title="Duplicate"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteBlock(block.id);
                        }}
                        className="p-1 hover:text-red-600"
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Block Content Editor */}
                  {block.type === 'heading' && (
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={block.text}
                        onChange={(e) => updateBlockField(block.id, { text: e.target.value })}
                        placeholder="Enter heading text..."
                        className="w-full px-3 py-1.5 text-base font-bold border border-gray-200 rounded-lg focus:ring-1 focus:ring-brand-500"
                      />
                      <div className="flex gap-2">
                        <select
                          value={block.level}
                          onChange={(e) => updateBlockField(block.id, { level: Number(e.target.value) as any })}
                          className="px-2 py-1 text-xs border border-gray-200 rounded bg-white"
                        >
                          <option value={1}>H1 - Large</option>
                          <option value={2}>H2 - Medium</option>
                          <option value={3}>H3 - Small</option>
                        </select>
                        <select
                          value={block.align}
                          onChange={(e) => updateBlockField(block.id, { align: e.target.value as any })}
                          className="px-2 py-1 text-xs border border-gray-200 rounded bg-white"
                        >
                          <option value="left">Align Left</option>
                          <option value="center">Align Center</option>
                          <option value="right">Align Right</option>
                        </select>
                      </div>
                    </div>
                  )}

                  {block.type === 'text' && (
                    <div className="space-y-2">
                      <textarea
                        rows={3}
                        value={block.text}
                        onChange={(e) => updateBlockField(block.id, { text: e.target.value })}
                        placeholder="Enter paragraph text..."
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-1 focus:ring-brand-500"
                      />
                      <select
                        value={block.align}
                        onChange={(e) => updateBlockField(block.id, { align: e.target.value as any })}
                        className="px-2 py-1 text-xs border border-gray-200 rounded bg-white"
                      >
                        <option value="left">Align Left</option>
                        <option value="center">Align Center</option>
                        <option value="right">Align Right</option>
                      </select>
                    </div>
                  )}

                  {block.type === 'image' && (
                    <div className="space-y-2">
                      <input
                        type="url"
                        value={block.url}
                        onChange={(e) => updateBlockField(block.id, { url: e.target.value })}
                        placeholder="https://example.com/banner.jpg"
                        className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-lg"
                      />
                      <input
                        type="text"
                        value={block.alt}
                        onChange={(e) => updateBlockField(block.id, { alt: e.target.value })}
                        placeholder="Alt text description"
                        className="w-full px-3 py-1 text-xs border border-gray-200 rounded-lg"
                      />
                    </div>
                  )}

                  {block.type === 'button' && (
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={block.label}
                        onChange={(e) => updateBlockField(block.id, { label: e.target.value })}
                        placeholder="Button text"
                        className="px-3 py-1 text-xs border border-gray-200 rounded-lg font-semibold"
                      />
                      <input
                        type="url"
                        value={block.url}
                        onChange={(e) => updateBlockField(block.id, { url: e.target.value })}
                        placeholder="Target URL"
                        className="px-3 py-1 text-xs border border-gray-200 rounded-lg"
                      />
                    </div>
                  )}

                  {block.type === 'divider' && (
                    <div className="py-2 text-center text-xs text-gray-400">
                      <hr className="border-t border-gray-200 my-1" />
                      <span>Horizontal Rule</span>
                    </div>
                  )}

                  {block.type === 'spacer' && (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-gray-500">Height:</span>
                      <input
                        type="number"
                        min={8}
                        max={80}
                        value={block.height}
                        onChange={(e) => updateBlockField(block.id, { height: Number(e.target.value) })}
                        className="w-20 px-2 py-0.5 border border-gray-200 rounded"
                      />
                      <span className="text-gray-400">px</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* LIVE PREVIEW IFRAME */
        <div className="p-6 bg-gray-100 flex justify-center">
          <div className="w-full max-w-[620px] bg-white rounded-xl shadow-md border border-gray-200 overflow-hidden">
            <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 flex items-center justify-between text-xs text-gray-500">
              <span>Simulated Recipient: <strong>Dr. John Smith</strong></span>
              <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 font-semibold text-[10px]">
                Responsive HTML Preview
              </span>
            </div>
            <iframe
              title="Campaign HTML Preview"
              srcDoc={previewHtml}
              className="w-full h-[550px] border-none"
            />
          </div>
        </div>
      )}
    </div>
  );
}
