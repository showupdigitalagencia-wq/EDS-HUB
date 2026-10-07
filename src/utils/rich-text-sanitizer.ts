// =============================================================================
// Rich Text Sanitizer & Normalizer for Email Template Editor
// =============================================================================
// Safely sanitizes and normalizes pasted HTML from Google Docs, Word, Gmail, etc.
// Preserves semantic formatting (p, br, strong, b, em, i, u, ul, ol, li, a, h1-h4)
// and personalization placeholders ({{salutation}}, {{first_name}}, etc.).
// Strictly eliminates XSS vectors (<script>, onerror, javascript:, iframe, etc.).
// =============================================================================

import type { EmailBlock, HeadingBlock, TextBlock, ImageBlock, ButtonBlock, DividerBlock, SpacerBlock } from '../features/editor/types';

const ALLOWED_TAGS = new Set([
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  'ul',
  'ol',
  'li',
  'a',
  'h1',
  'h2',
  'h3',
  'h4',
  'span',
  'div',
  'blockquote',
  'sub',
  'sup',
]);

const FORBIDDEN_CONTENT_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'meta',
  'link',
  'base',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'noscript',
  'svg',
  'math',
  'applet',
  'video',
  'audio',
]);

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

/**
 * Checks if a URL is safe to use in an href attribute.
 * Strictly blocks javascript:, vbscript:, data:, file:, protocol-relative URLs,
 * and malicious mixed-case or encoded variants.
 */
export function isSafeUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const raw = String(url).trim();
  if (!raw) return false;

  // Reject protocol-relative URLs (e.g. //evil.com)
  if (raw.startsWith('//')) return false;

  // Reject URLs containing Unicode replacement character, null bytes, or control characters
  if (/[\u0000-\u001F\u007F-\u009F\uFFFD]/.test(raw)) return false;

  // Strip whitespace and check normalized scheme
  const stripped = raw.replace(/[\s\t\r\n]+/g, '').toLowerCase();
  if (
    stripped.includes('javascript:') ||
    stripped.includes('vbscript:') ||
    stripped.includes('data:') ||
    stripped.includes('file:')
  ) {
    return false;
  }

  // Relative URLs (anchors or relative paths) are permitted
  if (raw.startsWith('/') || raw.startsWith('#')) return true;

  try {
    const parsed = new URL(raw, 'https://expdentalsolutions.com');
    return ALLOWED_PROTOCOLS.has(parsed.protocol);
  } catch {
    // If URL parsing fails, reject
    return false;
  }
}

/**
 * Helper to get document object in browser or JSDOM environment.
 */
function getDocument(): Document {
  if (typeof document !== 'undefined') {
    return document;
  }
  // Fallback for tests or SSR if needed
  const { JSDOM } = require('jsdom');
  return new JSDOM('').window.document;
}

/**
 * Normalizes and sanitizes HTML content, stripping dangerous tags, event handlers,
 * and malicious URI schemes while preserving safe semantic formatting.
 */
export function sanitizeRichText(html: string | null | undefined): string {
  if (!html || typeof html !== 'string') return '';
  const trimmed = html.trim();
  if (!trimmed) return '';

  const doc = getDocument();
  const container = doc.createElement('div');

  // Strip Word conditional comments before parsing
  const preCleaned = trimmed
    .replace(/<!--\[if[\s\S]*?\]>[\s\S]*?<!\[endif\]-->/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  container.innerHTML = preCleaned;

  // Recursive DOM sanitization
  function cleanNode(node: Node): Node | null {
    if (node.nodeType === Node.TEXT_NODE) {
      return node;
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const tagName = el.tagName.toLowerCase();

      // Completely discard dangerous elements and their children
      if (FORBIDDEN_CONTENT_TAGS.has(tagName)) {
        return null;
      }

      // If tag is not in whitelist, unwrap children (keep content, drop tag)
      if (!ALLOWED_TAGS.has(tagName)) {
        const fragment = doc.createDocumentFragment();
        const children = Array.from(el.childNodes);
        for (const child of children) {
          const cleaned = cleanNode(child);
          if (cleaned) fragment.appendChild(cleaned);
        }
        return fragment;
      }

      // Create new clean element
      let targetTag = tagName;

      // Normalize Google Docs bold span/b
      const style = el.getAttribute('style') || '';
      const isBold = /font-weight\s*:\s*(bold|[7-9]00)/i.test(style);
      const isItalic = /font-style\s*:\s*italic/i.test(style);
      const isUnderline = /text-decoration\s*:\s*underline/i.test(style);

      // Google Docs wraps in <b style="font-weight:normal">
      const isGoogleDocsNormalB = tagName === 'b' && /font-weight\s*:\s*normal/i.test(style);

      if (isGoogleDocsNormalB) {
        // Just unwrap this b tag
        const fragment = doc.createDocumentFragment();
        const children = Array.from(el.childNodes);
        for (const child of children) {
          const cleaned = cleanNode(child);
          if (cleaned) fragment.appendChild(cleaned);
        }
        return fragment;
      }

      if (tagName === 'b') targetTag = 'strong';
      if (tagName === 'i') targetTag = 'em';

      const cleanEl = doc.createElement(targetTag);

      // Process attributes safely
      if (targetTag === 'a') {
        const href = el.getAttribute('href');
        if (isSafeUrl(href)) {
          cleanEl.setAttribute('href', href!.trim());
          cleanEl.setAttribute('target', '_blank');
          cleanEl.setAttribute('rel', 'noopener noreferrer');
        } else {
          // Unsafe link: convert to text without link
          const fragment = doc.createDocumentFragment();
          const children = Array.from(el.childNodes);
          for (const child of children) {
            const cleaned = cleanNode(child);
            if (cleaned) fragment.appendChild(cleaned);
          }
          return fragment;
        }
      }

      // Preserve safe inline alignment if present
      if (style.includes('text-align')) {
        const alignMatch = style.match(/text-align\s*:\s*(left|center|right|justify)/i);
        if (alignMatch) {
          cleanEl.style.textAlign = alignMatch[1].toLowerCase();
        }
      }

      // Recursively clean children
      const children = Array.from(el.childNodes);
      for (const child of children) {
        const cleaned = cleanNode(child);
        if (cleaned) cleanEl.appendChild(cleaned);
      }

      // If span had bold/italic/underline, wrap accordingly and unwrap empty/plain span
      let resultNode: HTMLElement = cleanEl;
      if (tagName === 'span' && !cleanEl.getAttribute('style') && !cleanEl.getAttribute('class')) {
        // If it was just a wrapper span, unwrap its contents when converted
        if (isBold) {
          const strong = doc.createElement('strong');
          while (cleanEl.firstChild) strong.appendChild(cleanEl.firstChild);
          resultNode = strong;
        }
        if (isItalic) {
          const em = doc.createElement('em');
          if (resultNode !== cleanEl) {
            em.appendChild(resultNode);
          } else {
            while (cleanEl.firstChild) em.appendChild(cleanEl.firstChild);
          }
          resultNode = em;
        }
        if (isUnderline) {
          const u = doc.createElement('u');
          if (resultNode !== cleanEl) {
            u.appendChild(resultNode);
          } else {
            while (cleanEl.firstChild) u.appendChild(cleanEl.firstChild);
          }
          resultNode = u;
        }
      } else {
        if (isBold && targetTag !== 'strong') {
          const strong = doc.createElement('strong');
          strong.appendChild(resultNode);
          resultNode = strong;
        }
        if (isItalic && targetTag !== 'em') {
          const em = doc.createElement('em');
          em.appendChild(resultNode);
          resultNode = em;
        }
        if (isUnderline && targetTag !== 'u') {
          const u = doc.createElement('u');
          u.appendChild(resultNode);
          resultNode = u;
        }
      }

      return resultNode;
    }

    return null;
  }

  const cleanedFragment = doc.createDocumentFragment();
  const rootChildren = Array.from(container.childNodes);
  for (const child of rootChildren) {
    const cleaned = cleanNode(child);
    if (cleaned) cleanedFragment.appendChild(cleaned);
  }

  const resultDiv = doc.createElement('div');
  resultDiv.appendChild(cleanedFragment);

  return resultDiv.innerHTML.trim();
}

/**
 * Converts rich HTML into clean, human-readable plain text.
 */
export function htmlToPlainText(html: string | null | undefined): string {
  if (!html || typeof html !== 'string') return '';
  const trimmed = html.trim();
  if (!trimmed) return '';

  const doc = getDocument();
  const temp = doc.createElement('div');
  temp.innerHTML = trimmed;

  // Process list items with bullet points
  const listItems = temp.querySelectorAll('li');
  listItems.forEach((li) => {
    li.textContent = `• ${li.textContent?.trim() || ''}\n`;
  });

  // Process line breaks
  const brs = temp.querySelectorAll('br');
  brs.forEach((br) => {
    br.replaceWith('\n');
  });

  // Process headings and paragraphs to ensure double newlines
  const blocks = temp.querySelectorAll('p, h1, h2, h3, h4, div, ul, ol');
  blocks.forEach((b) => {
    b.textContent = `${b.textContent?.trim() || ''}\n\n`;
  });

  const rawText = temp.textContent || '';
  // Normalize consecutive newlines (max 2)
  return rawText
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Extracts inner email body from full HTML layout if wrapped in table boilerplate.
 */
function extractBodyContent(rawHtml: string): string {
  // If wrapped in standard EDS layout table
  const tdMatch = rawHtml.match(/<td style="padding:\s*32px\s*28px;">([\s\S]*?)<\/td>/i);
  if (tdMatch) {
    return tdMatch[1].trim();
  }

  // If standard body tag exists
  const bodyMatch = rawHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) {
    // If table exists inside body, check if there's a inner content cell
    const innerTd = bodyMatch[1].match(/<td[^>]*padding:[^>]*>([\s\S]*?)<\/td>/i);
    if (innerTd) return innerTd[1].trim();
    return bodyMatch[1].trim();
  }

  return rawHtml.trim();
}

/**
 * Converts an existing HTML string into EmailBlock[] for the visual editor.
 * Ensures existing templates with rich content hydrate cleanly without data loss.
 */
export function convertHtmlToBlocks(rawHtml: string | null | undefined): EmailBlock[] {
  if (!rawHtml || typeof rawHtml !== 'string') return [];
  const content = extractBodyContent(rawHtml);
  if (!content) return [];

  const doc = getDocument();
  const container = doc.createElement('div');
  container.innerHTML = content;

  const blocks: EmailBlock[] = [];
  let currentTextHtml = '';

  const flushTextBlock = () => {
    const sanitized = sanitizeRichText(currentTextHtml);
    if (sanitized && sanitized !== '<p></p>' && sanitized !== '<p>&nbsp;</p>') {
      blocks.push({
        id: `text-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        type: 'text',
        text: sanitized,
        align: 'left',
        color: '#334155',
      } as TextBlock);
    }
    currentTextHtml = '';
  };

  const children = Array.from(container.children);
  if (children.length === 0 && container.textContent?.trim()) {
    // Plain text or inline HTML only
    blocks.push({
      id: `text-${Date.now()}`,
      type: 'text',
      text: sanitizeRichText(container.innerHTML) || container.textContent.trim(),
      align: 'left',
      color: '#334155',
    } as TextBlock);
    return blocks;
  }

  for (const child of children) {
    const el = child as HTMLElement;
    const tagName = el.tagName.toLowerCase();

    // Check for Heading
    if (tagName === 'h1' || tagName === 'h2' || tagName === 'h3') {
      flushTextBlock();
      const level = tagName === 'h1' ? 1 : tagName === 'h2' ? 2 : 3;
      const align = (el.style.textAlign as 'left' | 'center' | 'right') || 'left';
      blocks.push({
        id: `heading-${Date.now()}-${blocks.length}`,
        type: 'heading',
        text: el.textContent?.trim() || '',
        level,
        align: align === 'center' || align === 'right' ? align : 'left',
        color: el.style.color || '#08254f',
      } as HeadingBlock);
      continue;
    }

    // Check for Divider
    if (tagName === 'hr') {
      flushTextBlock();
      blocks.push({
        id: `divider-${Date.now()}-${blocks.length}`,
        type: 'divider',
        thickness: 1,
        color: '#e2e8f0',
      } as DividerBlock);
      continue;
    }

    // Check for Spacer
    if (
      tagName === 'div' &&
      el.style.height &&
      (el.textContent === '' || el.textContent === '\u00A0' || el.innerHTML.includes('&nbsp;'))
    ) {
      flushTextBlock();
      const height = parseInt(el.style.height, 10) || 24;
      blocks.push({
        id: `spacer-${Date.now()}-${blocks.length}`,
        type: 'spacer',
        height,
      } as SpacerBlock);
      continue;
    }

    // Check for Button (links styled with padding/background)
    const btnLink =
      tagName === 'a' && (el.style.backgroundColor || el.style.padding)
        ? (el as HTMLAnchorElement)
        : (el.querySelector('a[style*="background"], a.btn, a.button') as HTMLAnchorElement | null);

    if (btnLink && el.children.length <= 1) {
      flushTextBlock();
      const bgColor = btnLink.style.backgroundColor || '#08254f';
      const textColor = btnLink.style.color || '#ffffff';
      const align = (el.style.textAlign as 'left' | 'center' | 'right') || 'center';
      blocks.push({
        id: `button-${Date.now()}-${blocks.length}`,
        type: 'button',
        label: btnLink.textContent?.trim() || 'Acessar Link',
        url: btnLink.getAttribute('href') || 'https://expdentalsolutions.com',
        align: align === 'left' || align === 'right' ? align : 'center',
        bgColor,
        textColor,
      } as ButtonBlock);
      continue;
    }

    // Check for Image
    const imgEl = tagName === 'img' ? (el as HTMLImageElement) : (el.querySelector('img') as HTMLImageElement | null);
    if (imgEl && el.children.length <= 1 && !el.textContent?.trim()) {
      flushTextBlock();
      const align = (el.style.textAlign as 'left' | 'center' | 'right') || 'center';
      blocks.push({
        id: `image-${Date.now()}-${blocks.length}`,
        type: 'image',
        url: imgEl.getAttribute('src') || '',
        alt: imgEl.getAttribute('alt') || '',
        width: imgEl.style.maxWidth || imgEl.getAttribute('width') || '100%',
        align: align === 'left' || align === 'right' ? align : 'center',
      } as ImageBlock);
      continue;
    }

    // Otherwise, append to current text block
    currentTextHtml += el.outerHTML;
  }

  flushTextBlock();

  if (blocks.length === 0 && content.trim()) {
    blocks.push({
      id: `text-${Date.now()}`,
      type: 'text',
      text: sanitizeRichText(content),
      align: 'left',
      color: '#334155',
    } as TextBlock);
  }

  return blocks;
}
