import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  Link as LinkIcon,
  Unlink,
} from 'lucide-react';
import { sanitizeRichText, isSafeUrl } from '../../../utils/rich-text-sanitizer';

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  align?: 'left' | 'center' | 'right';
  color?: string;
  placeholder?: string;
  className?: string;
  showToolbar?: boolean;
}

export function RichTextEditor({
  value,
  onChange,
  align = 'left',
  color = '#334155',
  placeholder = 'Escreva sua mensagem aqui...',
  className = '',
  showToolbar = true,
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const lastHtmlRef = useRef(value);

  // Sync value when template or block changes externally
  useEffect(() => {
    if (editorRef.current) {
      const currentInner = editorRef.current.innerHTML;
      if (value !== currentInner && value !== lastHtmlRef.current) {
        lastHtmlRef.current = value;
        // If value has no HTML tags, wrap plain paragraphs
        if (value && !/<[a-z][\s\S]*>/i.test(value)) {
          const formatted = value
            .split(/\r?\n\r?\n/)
            .map((p) => `<p>${p.replace(/\r?\n/g, '<br/>')}</p>`)
            .join('');
          editorRef.current.innerHTML = formatted;
        } else {
          editorRef.current.innerHTML = value || '';
        }
      }
    }
  }, [value]);

  const handleInput = useCallback(() => {
    if (editorRef.current) {
      const raw = editorRef.current.innerHTML;
      const sanitized = sanitizeRichText(raw);
      lastHtmlRef.current = sanitized;
      onChange(sanitized);
    }
  }, [onChange]);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      e.preventDefault();
      const html = e.clipboardData.getData('text/html');
      const text = e.clipboardData.getData('text/plain');

      let contentToInsert = '';
      if (html) {
        contentToInsert = sanitizeRichText(html);
      } else if (text) {
        const paragraphs = text.split(/\r?\n\r?\n/).filter(Boolean);
        if (paragraphs.length > 1) {
          contentToInsert = paragraphs
            .map(
              (p) =>
                `<p>${escapeHtml(p).replace(/\r?\n/g, '<br/>')}</p>`,
            )
            .join('');
        } else {
          contentToInsert = escapeHtml(text).replace(/\r?\n/g, '<br/>');
        }
      }

      if (!contentToInsert) return;

      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = contentToInsert;
        const frag = document.createDocumentFragment();
        let node: ChildNode | null;
        let lastNode: ChildNode | null = null;
        while ((node = tempDiv.firstChild)) {
          lastNode = frag.appendChild(node);
        }
        range.insertNode(frag);
        if (lastNode) {
          range.setStartAfter(lastNode);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      } else if (editorRef.current) {
        editorRef.current.innerHTML += contentToInsert;
      }

      if (editorRef.current) {
        const sanitized = sanitizeRichText(editorRef.current.innerHTML);
        lastHtmlRef.current = sanitized;
        onChange(sanitized);
      }
    },
    [onChange],
  );

  const exec = (command: string, arg: string | undefined = undefined) => {
    document.execCommand(command, false, arg);
    if (editorRef.current) {
      const sanitized = sanitizeRichText(editorRef.current.innerHTML);
      lastHtmlRef.current = sanitized;
      onChange(sanitized);
    }
  };

  const handleAddLink = () => {
    const url = prompt('Digite a URL do link (ex: https://expdentalsolutions.com):');
    if (url && isSafeUrl(url)) {
      exec('createLink', url.trim());
    } else if (url) {
      alert('URL inválida. Utilize links com protocolo http:// ou https://');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'b' || e.key === 'B') {
        e.preventDefault();
        exec('bold');
      } else if (e.key === 'i' || e.key === 'I') {
        e.preventDefault();
        exec('italic');
      } else if (e.key === 'u' || e.key === 'U') {
        e.preventDefault();
        exec('underline');
      }
    }
  };

  return (
    <div className={`relative group/editor ${className}`}>
      {/* Floating Micro Toolbar */}
      {showToolbar && (
        <div
          className={`flex items-center gap-0.5 px-2 py-1 mb-2 bg-slate-100/90 border border-slate-200/80 rounded-lg text-slate-600 transition-opacity ${
            isFocused ? 'opacity-100' : 'opacity-80 hover:opacity-100'
          }`}
        >
          <button
            type="button"
            onClick={() => exec('bold')}
            className="p-1 hover:bg-white hover:text-[#08254f] rounded text-xs font-bold transition-colors cursor-pointer"
            title="Negrito (Ctrl+B)"
            aria-label="Negrito"
          >
            <Bold className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => exec('italic')}
            className="p-1 hover:bg-white hover:text-[#08254f] rounded text-xs transition-colors cursor-pointer"
            title="Itálico (Ctrl+I)"
            aria-label="Itálico"
          >
            <Italic className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => exec('underline')}
            className="p-1 hover:bg-white hover:text-[#08254f] rounded text-xs transition-colors cursor-pointer"
            title="Sublinhado (Ctrl+U)"
            aria-label="Sublinhado"
          >
            <Underline className="w-3.5 h-3.5" />
          </button>

          <span className="w-px h-3 bg-slate-300 mx-1" />

          <button
            type="button"
            onClick={() => exec('insertUnorderedList')}
            className="p-1 hover:bg-white hover:text-[#08254f] rounded text-xs transition-colors cursor-pointer"
            title="Lista com marcadores"
            aria-label="Lista com marcadores"
          >
            <List className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => exec('insertOrderedList')}
            className="p-1 hover:bg-white hover:text-[#08254f] rounded text-xs transition-colors cursor-pointer"
            title="Lista numerada"
            aria-label="Lista numerada"
          >
            <ListOrdered className="w-3.5 h-3.5" />
          </button>

          <span className="w-px h-3 bg-slate-300 mx-1" />

          <button
            type="button"
            onClick={handleAddLink}
            className="p-1 hover:bg-white hover:text-[#08254f] rounded text-xs transition-colors cursor-pointer"
            title="Inserir link"
            aria-label="Inserir link"
          >
            <LinkIcon className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => exec('unlink')}
            className="p-1 hover:bg-white hover:text-red-600 rounded text-xs transition-colors cursor-pointer"
            title="Remover link"
            aria-label="Remover link"
          >
            <Unlink className="w-3.5 h-3.5" />
          </button>

          <span className="text-[10px] text-slate-400 ml-auto hidden sm:inline">
            Suporta Colar com Formatação
          </span>
        </div>
      )}

      {/* Editable Canvas */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        dangerouslySetInnerHTML={{ __html: value || '' }}
        onInput={handleInput}
        onPaste={handlePaste}
        onKeyDown={handleKeyDown}
        onFocus={() => setIsFocused(true)}
        onBlur={() => {
          setIsFocused(false);
          handleInput();
        }}
        data-placeholder={placeholder}
        className="w-full min-h-[60px] text-slate-800 text-sm sm:text-base leading-relaxed bg-transparent border-0 focus:outline-none focus:ring-0 p-0 font-sans cursor-text [&:empty]:before:content-[attr(data-placeholder)] [&:empty]:before:text-slate-400 [&:empty]:before:pointer-events-none [&_p]:mb-3 [&_ul]:mb-3 [&_ul]:pl-5 [&_ul]:list-disc [&_ol]:mb-3 [&_ol]:pl-5 [&_ol]:list-decimal [&_li]:mb-1 [&_a]:text-blue-600 [&_a]:underline"
        style={{ textAlign: align, color }}
      />
    </div>
  );
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
