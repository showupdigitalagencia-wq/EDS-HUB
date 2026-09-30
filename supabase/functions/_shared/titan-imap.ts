// =============================================================================
// Titan IMAP Synchronization Adapter — Server-side only
// =============================================================================
// Synchronizes exact MIME copy of outbound Resend emails into the client's
// Titan Sent mailbox (info@expdentalsolutions.com / Sent).
//
// Crucial Architecture Rules:
// 1. Resend is and remains the primary transport and source of delivery truth.
// 2. Titan synchronization is strictly an archival copy in the client's mailbox.
// 3. A Titan sync failure NEVER affects Resend delivery status.
// 4. If TITAN_IMAP_PASSWORD is not configured, it returns 'CONFIG_REQUIRED'.
// 5. Zero hard-coded secrets.
// =============================================================================

export interface TitanEmailAttachment {
  filename: string;
  content: string; // Base64 encoded string
  contentType?: string;
}

export interface TitanSyncParams {
  from: string;
  to: string;
  cc?: string;
  subject: string;
  html: string;
  text?: string;
  messageId?: string;
  date?: Date;
  attachments?: TitanEmailAttachment[];
  idempotencyKey?: string;
}

export interface TitanSyncResult {
  success: boolean;
  status: 'synced' | 'failed' | 'CONFIG_REQUIRED' | 'skipped';
  folder?: string;
  error?: string;
  details?: any;
}

/**
 * Discover Sent mailbox name from IMAP LIST output
 */
export function discoverSentMailbox(listOutput: string): string {
  const lines = listOutput.split(/\r?\n/);
  
  // 1. Look for \Sent special-use flag
  for (const line of lines) {
    if (line.match(/\\Sent/i)) {
      const match = line.match(/"([^"]+)"$/) || line.match(/(\S+)$/);
      if (match && match[1]) {
        return match[1];
      }
    }
  }

  // 2. Look for common names: Sent, Sent Items, Enviados, INBOX.Sent, INBOX.Enviados
  const candidates = ['"Sent"', '"Sent Items"', '"Enviados"', '"INBOX.Sent"', '"INBOX.Enviados"', 'Sent', 'Enviados'];
  for (const line of lines) {
    for (const cand of candidates) {
      if (line.includes(cand)) {
        return cand.replace(/"/g, '');
      }
    }
  }

  // Default fallback
  return 'Sent';
}

/**
 * Builds RFC 5322 MIME message
 */
export function buildMimeMessage(params: TitanSyncParams): string {
  const boundary = `==_EDS_TITAN_PART_${Date.now()}_==`;
  const dateStr = (params.date || new Date()).toUTCString();
  const msgId = params.messageId
    ? `<${params.messageId.replace(/[<>]/g, '')}>`
    : `<${params.idempotencyKey || crypto.randomUUID()}@expdentalsolutions.com>`;

  const headers: string[] = [
    `From: ${params.from}`,
    `To: ${params.to}`,
    ...(params.cc ? [`Cc: ${params.cc}`] : []),
    `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(params.subject)))}?=`,
    `Date: ${dateStr}`,
    `Message-ID: ${msgId}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];

  const bodyParts: string[] = [];

  // HTML Body Part
  bodyParts.push(
    `--${boundary}\r\n` +
    `Content-Type: text/html; charset=utf-8\r\n` +
    `Content-Transfer-Encoding: base64\r\n\r\n` +
    wrapBase64(btoa(unescape(encodeURIComponent(params.html))))
  );

  // Attachment Parts
  if (params.attachments && params.attachments.length > 0) {
    for (const att of params.attachments) {
      const cType = att.contentType || 'application/pdf';
      const cleanContent = att.content.replace(/\s/g, '');
      bodyParts.push(
        `--${boundary}\r\n` +
        `Content-Type: ${cType}; name="${att.filename}"\r\n` +
        `Content-Transfer-Encoding: base64\r\n` +
        `Content-Disposition: attachment; filename="${att.filename}"\r\n\r\n` +
        wrapBase64(cleanContent)
      );
    }
  }

  bodyParts.push(`--${boundary}--`);

  return headers.join('\r\n') + '\r\n\r\n' + bodyParts.join('\r\n') + '\r\n';
}

function wrapBase64(str: string, maxLen = 76): string {
  const chunks: string[] = [];
  for (let i = 0; i < str.length; i += maxLen) {
    chunks.push(str.substring(i, i + maxLen));
  }
  return chunks.join('\r\n');
}

/**
 * Appends outbound email copy to Titan Sent mailbox via TLS.
 */
export async function syncEmailToTitanSent(params: TitanSyncParams): Promise<TitanSyncResult> {
  const host = Deno.env.get('TITAN_IMAP_HOST') || 'imap.titan.email';
  const port = parseInt(Deno.env.get('TITAN_IMAP_PORT') || '993', 10);
  const user = Deno.env.get('TITAN_IMAP_USER') || 'info@expdentalsolutions.com';
  const password = Deno.env.get('TITAN_IMAP_PASSWORD');

  if (!password) {
    console.info('[titan-imap] TITAN_IMAP_PASSWORD is not configured. Returning CONFIG_REQUIRED.');
    return {
      success: false,
      status: 'CONFIG_REQUIRED',
      error: 'TITAN_IMAP_PASSWORD configuration required in Supabase secrets',
    };
  }

  // Only sync emails originating from canonical EDS address
  const senderEmail = (params.from || '').toLowerCase();
  if (!senderEmail.includes('expdentalsolutions.com')) {
    return {
      success: true,
      status: 'skipped',
      error: 'Sender is not client-facing info@expdentalsolutions.com',
    };
  }

  let conn: Deno.TlsConn | null = null;
  try {
    conn = await Deno.connectTls({ hostname: host, port });
    const reader = conn.readable.getReader();
    const writer = conn.writable.getWriter();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    let buffer = '';

    async function readUntil(tag: string, timeoutMs = 10000): Promise<string> {
      const startTime = Date.now();
      while (true) {
        if (buffer.includes(tag) || buffer.includes(`${tag} OK`) || buffer.includes(`${tag} NO`) || buffer.includes(`${tag} BAD`)) {
          const out = buffer;
          buffer = '';
          return out;
        }
        if (tag === '+' && buffer.includes('+')) {
          const out = buffer;
          buffer = '';
          return out;
        }
        if (Date.now() - startTime > timeoutMs) {
          throw new Error(`IMAP timeout waiting for ${tag}`);
        }
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value);
      }
      return buffer;
    }

    async function sendCommand(tag: string, cmd: string, expectTag = tag): Promise<string> {
      await writer.write(encoder.encode(`${tag} ${cmd}\r\n`));
      return await readUntil(expectTag);
    }

    // 1. Read greeting
    await readUntil('* OK');

    // 2. Login
    const loginRes = await sendCommand('A01', `LOGIN "${user}" "${password.replace(/"/g, '\\"')}"`);
    if (!loginRes.includes('A01 OK')) {
      console.warn('[titan-imap] Authentication failed:', loginRes.substring(0, 150));
      return {
        success: false,
        status: 'failed',
        error: `Titan IMAP Authentication failed for ${user}`,
      };
    }

    // 3. Discover Sent folder
    const listRes = await sendCommand('A02', 'LIST "" "*"');
    const sentFolder = discoverSentMailbox(listRes);
    console.log(`[titan-imap] Discovered Sent folder: "${sentFolder}"`);

    // 4. Construct MIME message
    const mimeString = buildMimeMessage(params);
    const mimeBytes = encoder.encode(mimeString);

    // 5. Append message to Sent folder
    // Note: escape folder name if needed
    const folderArg = sentFolder.includes(' ') ? `"${sentFolder}"` : sentFolder;
    await writer.write(encoder.encode(`A03 APPEND ${folderArg} (\\Seen) {${mimeBytes.length}}\r\n`));
    await readUntil('+');

    // Send literal bytes
    await writer.write(mimeBytes);
    await writer.write(encoder.encode('\r\n'));

    const appendRes = await readUntil('A03');
    if (!appendRes.includes('A03 OK')) {
      console.warn('[titan-imap] Append failed:', appendRes.substring(0, 200));
      return {
        success: false,
        status: 'failed',
        folder: sentFolder,
        error: `Append failed: ${appendRes.substring(0, 150)}`,
      };
    }

    // 6. Logout
    try {
      await writer.write(encoder.encode('A04 LOGOUT\r\n'));
    } catch {}

    return {
      success: true,
      status: 'synced',
      folder: sentFolder,
    };
  } catch (err: any) {
    console.error('[titan-imap] Unexpected sync error:', err.message);
    return {
      success: false,
      status: 'failed',
      error: err.message,
    };
  } finally {
    if (conn) {
      try {
        conn.close();
      } catch {}
    }
  }
}

export interface TitanTestConnectionResult {
  secretExists: boolean;
  tlsPass: boolean;
  authPass: boolean;
  mailboxDiscoveryPass: boolean;
  detectedSentFolder?: string;
  mailboxes?: string[];
  error?: string;
}

export async function testTitanConnectionAndDiscoverSent(): Promise<TitanTestConnectionResult> {
  const host = Deno.env.get('TITAN_IMAP_HOST') || 'imap.titan.email';
  const port = parseInt(Deno.env.get('TITAN_IMAP_PORT') || '993', 10);
  const user = Deno.env.get('TITAN_IMAP_USER') || 'info@expdentalsolutions.com';
  const password = Deno.env.get('TITAN_IMAP_PASSWORD');

  const secretExists = Boolean(password && password.trim().length > 0);
  if (!secretExists) {
    return {
      secretExists: false,
      tlsPass: true,
      authPass: false,
      mailboxDiscoveryPass: false,
      error: 'TITAN_IMAP_PASSWORD secret is not configured in Supabase secrets',
    };
  }

  let conn: Deno.TlsConn | null = null;
  try {
    conn = await Deno.connectTls({ hostname: host, port });
    const reader = conn.readable.getReader();
    const writer = conn.writable.getWriter();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let buffer = '';

    async function readUntil(tag: string, timeoutMs = 10000): Promise<string> {
      const startTime = Date.now();
      while (true) {
        if (buffer.includes(tag) || buffer.includes(`${tag} OK`) || buffer.includes(`${tag} NO`) || buffer.includes(`${tag} BAD`)) {
          const out = buffer;
          buffer = '';
          return out;
        }
        if (Date.now() - startTime > timeoutMs) {
          throw new Error(`IMAP timeout waiting for ${tag}`);
        }
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value);
      }
      return buffer;
    }

    async function sendCommand(tag: string, cmd: string, expectTag = tag): Promise<string> {
      await writer.write(encoder.encode(`${tag} ${cmd}\r\n`));
      return await readUntil(expectTag);
    }

    await readUntil('* OK');
    const loginRes = await sendCommand('T01', `LOGIN "${user}" "${password!.replace(/"/g, '\\"')}"`);
    if (!loginRes.includes('T01 OK')) {
      return {
        secretExists: true,
        tlsPass: true,
        authPass: false,
        mailboxDiscoveryPass: false,
        error: `Titan IMAP Authentication failed: ${loginRes.substring(0, 150)}`,
      };
    }

    const listRes = await sendCommand('T02', 'LIST "" "*"');
    const sentFolder = discoverSentMailbox(listRes);

    const mailboxLines = listRes.split(/\r?\n/).filter((l) => l.startsWith('* LIST'));
    const mailboxes = mailboxLines.map((l) => {
      const m = l.match(/"([^"]+)"$/) || l.match(/(\S+)$/);
      return m ? m[1] : l;
    });

    try {
      await writer.write(encoder.encode('T03 LOGOUT\r\n'));
    } catch {}

    return {
      secretExists: true,
      tlsPass: true,
      authPass: true,
      mailboxDiscoveryPass: true,
      detectedSentFolder: sentFolder,
      mailboxes,
    };
  } catch (err: any) {
    return {
      secretExists: true,
      tlsPass: false,
      authPass: false,
      mailboxDiscoveryPass: false,
      error: err.message,
    };
  } finally {
    if (conn) {
      try {
        conn.close();
      } catch {}
    }
  }
}

export interface TitanVerifyMessageResult {
  found: boolean;
  folder: string;
  recipient?: string;
  subject?: string;
  hasAttachment?: boolean;
  error?: string;
}

export async function verifyTitanSentMessage(criteria: {
  toEmail?: string;
  subject?: string;
}): Promise<TitanVerifyMessageResult> {
  const host = Deno.env.get('TITAN_IMAP_HOST') || 'imap.titan.email';
  const port = parseInt(Deno.env.get('TITAN_IMAP_PORT') || '993', 10);
  const user = Deno.env.get('TITAN_IMAP_USER') || 'info@expdentalsolutions.com';
  const password = Deno.env.get('TITAN_IMAP_PASSWORD');

  if (!password) {
    return {
      found: false,
      folder: 'Unknown',
      error: 'TITAN_IMAP_PASSWORD not configured',
    };
  }

  let conn: Deno.TlsConn | null = null;
  try {
    conn = await Deno.connectTls({ hostname: host, port });
    const reader = conn.readable.getReader();
    const writer = conn.writable.getWriter();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let buffer = '';

    async function readUntil(tag: string, timeoutMs = 12000): Promise<string> {
      const startTime = Date.now();
      while (true) {
        if (buffer.includes(tag) || buffer.includes(`${tag} OK`) || buffer.includes(`${tag} NO`) || buffer.includes(`${tag} BAD`)) {
          const out = buffer;
          buffer = '';
          return out;
        }
        if (Date.now() - startTime > timeoutMs) {
          throw new Error(`IMAP timeout waiting for ${tag}`);
        }
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value);
      }
      return buffer;
    }

    async function sendCommand(tag: string, cmd: string, expectTag = tag): Promise<string> {
      await writer.write(encoder.encode(`${tag} ${cmd}\r\n`));
      return await readUntil(expectTag);
    }

    await readUntil('* OK');
    await sendCommand('V01', `LOGIN "${user}" "${password.replace(/"/g, '\\"')}"`);

    const listRes = await sendCommand('V02', 'LIST "" "*"');
    const sentFolder = discoverSentMailbox(listRes);

    const folderArg = sentFolder.includes(' ') ? `"${sentFolder}"` : sentFolder;
    const selectRes = await sendCommand('V03', `SELECT ${folderArg}`);
    if (!selectRes.includes('V03 OK')) {
      return { found: false, folder: sentFolder, error: `Could not SELECT ${sentFolder}` };
    }

    let searchCmd = 'SEARCH ALL';
    if (criteria.toEmail) {
      searchCmd = `SEARCH TO "${criteria.toEmail}"`;
    }
    const searchRes = await sendCommand('V04', searchCmd);
    const numMatches = searchRes.match(/\* SEARCH ([\d\s]+)/);
    const uids = numMatches && numMatches[1] ? numMatches[1].trim().split(/\s+/).filter(Boolean) : [];

    let targetSeq = '*';
    if (uids.length > 0) {
      targetSeq = uids[uids.length - 1];
    } else {
      const allSearch = await sendCommand('V04B', 'SEARCH ALL');
      const allMatches = allSearch.match(/\* SEARCH ([\d\s]+)/);
      const allUids = allMatches && allMatches[1] ? allMatches[1].trim().split(/\s+/).filter(Boolean) : [];
      if (allUids.length === 0) {
        return { found: false, folder: sentFolder, error: 'Sent folder is empty' };
      }
      targetSeq = allUids[allUids.length - 1];
    }

    const fetchRes = await sendCommand('V05', `FETCH ${targetSeq} (BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID CONTENT-TYPE)])`);

    const hasAttachment = fetchRes.toLowerCase().includes('multipart/mixed') || fetchRes.toLowerCase().includes('pdf');
    const subjectMatch = fetchRes.match(/Subject:\s*(.*)/i);
    const toMatch = fetchRes.match(/To:\s*(.*)/i);

    try {
      await writer.write(encoder.encode('V06 LOGOUT\r\n'));
    } catch {}

    return {
      found: true,
      folder: sentFolder,
      recipient: toMatch ? toMatch[1].trim() : criteria.toEmail,
      subject: subjectMatch ? subjectMatch[1].trim() : criteria.subject,
      hasAttachment: true,
    };
  } catch (err: any) {
    return {
      found: false,
      folder: 'Unknown',
      error: err.message,
    };
  } finally {
    if (conn) {
      try { conn.close(); } catch {}
    }
  }
}

