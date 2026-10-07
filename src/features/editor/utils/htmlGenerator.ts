// =============================================================================
// HTML & Plain-Text Generator for Email Blocks
// =============================================================================

import type { EmailBlock } from '../types';
import { sanitizeRichText, htmlToPlainText } from '../../../utils/rich-text-sanitizer';

export function renderBlocksToHtml(blocks: EmailBlock[]): string {
  const content = blocks
    .map((b) => {
      switch (b.type) {
        case 'heading': {
          const size = b.level === 1 ? '24px' : b.level === 2 ? '20px' : '16px';
          const color = b.color || '#111827';
          return `<h${b.level} style="margin: 0 0 12px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: ${size}; font-weight: 700; color: ${color}; text-align: ${b.align}; line-height: 1.3;">${escapeHtml(
            b.text,
          )}</h${b.level}>`;
        }
        case 'text': {
          const color = b.color || '#374151';
          return renderTextBlockToHtml(b.text, color, b.align);
        }
        case 'image': {
          if (!b.url) return '';
          const width = b.width || '100%';
          return `<div style="text-align: ${b.align}; margin: 0 0 16px 0;"><img src="${escapeAttr(
            b.url,
          )}" alt="${escapeAttr(b.alt || '')}" style="max-width: ${width}; height: auto; border-radius: 8px; display: inline-block;" /></div>`;
        }
        case 'button': {
          const bgColor = b.bgColor || '#0284c7';
          const textColor = b.textColor || '#ffffff';
          return `<div style="text-align: ${b.align}; margin: 16px 0 20px 0;"><a href="${escapeAttr(
            b.url || '#',
          )}" style="display: inline-block; padding: 12px 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; font-weight: 600; color: ${textColor}; background-color: ${bgColor}; text-decoration: none; border-radius: 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">${escapeHtml(
            b.label,
          )}</a></div>`;
        }
        case 'divider': {
          const color = b.color || '#e5e7eb';
          const thickness = b.thickness || 1;
          return `<hr style="border: 0; border-top: ${thickness}px solid ${color}; margin: 20px 0;" />`;
        }
        case 'spacer': {
          const h = b.height || 20;
          return `<div style="height: ${h}px; line-height: ${h}px; font-size: 1px;">&nbsp;</div>`;
        }
        default:
          return '';
      }
    })
    .join('\n');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>EDS Campaign</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f9fafb; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f9fafb;">
    <tr>
      <td align="center" style="padding: 24px 12px;">
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; border: 1px solid #e5e7eb; overflow: hidden;">
          <tr>
            <td style="padding: 32px 28px;">
              ${content}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function renderBlocksToText(blocks: EmailBlock[]): string {
  return blocks
    .map((b) => {
      switch (b.type) {
        case 'heading':
          return `\n${b.text.toUpperCase()}\n`;
        case 'text':
          return /<[a-z][\s\S]*>/i.test(b.text)
            ? `${htmlToPlainText(b.text)}\n`
            : `${b.text}\n`;
        case 'image':
          return b.alt ? `[Image: ${b.alt}]\n` : '';
        case 'button':
          return `\n>>> ${b.label}: ${b.url}\n`;
        case 'divider':
          return `\n----------------------------------------\n`;
        case 'spacer':
          return `\n`;
        default:
          return '';
      }
    })
    .join('\n')
    .trim();
}

/**
 * Renders a Text block's content with proper email typography and layout styling.
 * Supports both rich HTML (p, strong, em, u, ul, ol, li, a, br) and legacy plain-text.
 */
function renderTextBlockToHtml(rawText: string, color: string, align: 'left' | 'center' | 'right'): string {
  if (!rawText || !rawText.trim()) {
    return `<p style="margin: 0 0 12px 0;">&nbsp;</p>`;
  }

  // If text does not contain HTML tags, fallback to legacy newline splitting
  if (!/<[a-z][\s\S]*>/i.test(rawText)) {
    const paragraphs = rawText
      .split('\n')
      .filter((p) => p.trim())
      .map(
        (p) =>
          `<p style="margin: 0 0 12px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.6; color: ${color}; text-align: ${align};">${escapeHtml(
            p,
          )}</p>`,
      )
      .join('');
    return paragraphs || `<p style="margin: 0 0 12px 0;">&nbsp;</p>`;
  }

  // Rich HTML content: sanitize and inject email inline styles
  const sanitized = sanitizeRichText(rawText);
  if (!sanitized) {
    return `<p style="margin: 0 0 12px 0;">&nbsp;</p>`;
  }

  // Parse and style tags for email clients
  if (typeof document !== 'undefined') {
    const container = document.createElement('div');
    container.innerHTML = sanitized;

    // Style paragraphs
    container.querySelectorAll('p').forEach((p) => {
      p.style.margin = '0 0 12px 0';
      p.style.fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
      p.style.fontSize = '15px';
      p.style.lineHeight = '1.6';
      p.style.color = color;
      if (!p.style.textAlign) p.style.textAlign = align;
    });

    // Style lists
    container.querySelectorAll('ul').forEach((ul) => {
      ul.style.margin = '0 0 12px 0';
      ul.style.paddingLeft = '20px';
      ul.style.fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
      ul.style.fontSize = '15px';
      ul.style.lineHeight = '1.6';
      ul.style.color = color;
    });

    container.querySelectorAll('ol').forEach((ol) => {
      ol.style.margin = '0 0 12px 0';
      ol.style.paddingLeft = '20px';
      ol.style.fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
      ol.style.fontSize = '15px';
      ol.style.lineHeight = '1.6';
      ol.style.color = color;
    });

    container.querySelectorAll('li').forEach((li) => {
      li.style.marginBottom = '6px';
    });

    // Style links
    container.querySelectorAll('a').forEach((a) => {
      a.style.color = '#0284c7';
      a.style.textDecoration = 'underline';
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    });

    return container.innerHTML;
  }

  return sanitized;
}

function escapeHtml(str: string): string {
  // Preserve {{first_name}}, {{last_name}}, {{salutation}} tags without HTML mangling
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(str: string): string {
  return str.replace(/"/g, '&quot;');
}
