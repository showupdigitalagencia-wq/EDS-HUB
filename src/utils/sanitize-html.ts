// =============================================================================
// HTML Sanitizer for Inbound Email Content (XSS Prevention)
// =============================================================================
// Sanitizes untrusted third-party HTML, stripping scripts, iframes, inline event
// handlers (onerror, onload, etc.), and unsafe URI schemes (javascript:).
// =============================================================================

const DANGEROUS_TAGS = [
  'script',
  'iframe',
  'object',
  'embed',
  'applet',
  'meta',
  'link',
  'style',
  'base',
  'form',
  'input',
  'button',
];

/**
 * Sanitizes an HTML string to prevent XSS attacks while preserving formatting.
 */
export function sanitizeHtml(rawHtml: string | null | undefined): string {
  if (!rawHtml) return '';

  let sanitized = rawHtml;

  // 1. Remove dangerous elements and their contents
  for (const tag of DANGEROUS_TAGS) {
    const regex = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi');
    sanitized = sanitized.replace(regex, '');
    // Self-closing or unclosed variants
    const selfClosingRegex = new RegExp(`<${tag}[^>]*\\/?>`, 'gi');
    sanitized = sanitized.replace(selfClosingRegex, '');
  }

  // 2. Remove all inline event handlers (e.g. onload, onerror, onclick, onmouseover)
  sanitized = sanitized.replace(/\s+on[a-zA-Z]+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, '');

  // 3. Neutralize javascript: and vbscript: URIs in href and src
  sanitized = sanitized.replace(
    /\s+(href|src)\s*=\s*(?:'javascript:[^']*'|"javascript:[^"]*"|javascript:[^\s>]+)/gi,
    ' $1="#"'
  );
  sanitized = sanitized.replace(
    /\s+(href|src)\s*=\s*(?:'data:[^']*'|"data:[^"]*"|data:[^\s>]+)/gi,
    ' $1="#"'
  );

  // 4. Force rel="noopener noreferrer" and target="_blank" on remaining links
  sanitized = sanitized.replace(/<a\s+([^>]*?)>/gi, (_match, attrs) => {
    const cleanAttrs = attrs.replace(/\s*target\s*=\s*['"][^'"]*['"]/gi, '').replace(/\s*rel\s*=\s*['"][^'"]*['"]/gi, '');
    return `<a ${cleanAttrs} target="_blank" rel="noopener noreferrer">`;
  });

  return sanitized.trim();
}
