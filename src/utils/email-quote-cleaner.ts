// =============================================================================
// Email Quote Cleaner Utility
// =============================================================================
// Splits inbound email body text into the fresh reply message and quoted
// historical email thread text without destroying the underlying stored factual data.
// =============================================================================

export interface SplitQuoteResult {
  freshText: string;
  quotedText: string | null;
}

const QUOTE_HEADER_PATTERNS = [
  /^-{3,}\s*(?:Original Message|Mensagem Original)\s*-{3,}/i,
  /^_{10,}/,
  /^(?:On|Em|No dia)\s+.+?(?:wrote|escreveu):/i,
  /^From:\s+.+\nSent:\s+.+/i,
  /^De:\s+.+\nEnviada em:\s+.+/i,
  /^De:\s+.+\nPara:\s+.+/i,
];

/**
 * Separates the newest reply from quoted historical thread content.
 * Safe for all languages (English & Portuguese common delimiters).
 */
export function splitEmailQuotes(rawBody: string | null | undefined): SplitQuoteResult {
  if (!rawBody || typeof rawBody !== 'string') {
    return { freshText: '', quotedText: null };
  }

  const normalized = rawBody.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');

  let splitIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Check for inline quote block marker (line starting with >)
    if (line.startsWith('>')) {
      splitIndex = i;
      break;
    }

    // Check header patterns against current line (or current + next lines)
    const multiLineChunk = lines.slice(i, i + 3).join('\n');
    let matched = false;

    for (const pattern of QUOTE_HEADER_PATTERNS) {
      if (pattern.test(line) || pattern.test(multiLineChunk)) {
        matched = true;
        break;
      }
    }

    if (matched) {
      splitIndex = i;
      break;
    }
  }

  if (splitIndex === -1) {
    return {
      freshText: normalized.trim(),
      quotedText: null,
    };
  }

  const fresh = lines.slice(0, splitIndex).join('\n').trim();
  const quoted = lines.slice(splitIndex).join('\n').trim();

  // If the reply only contained quotes, do not leave freshText empty
  if (!fresh && quoted) {
    return {
      freshText: quoted,
      quotedText: null,
    };
  }

  return {
    freshText: fresh,
    quotedText: quoted || null,
  };
}
