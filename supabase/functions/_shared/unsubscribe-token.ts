// =============================================================================
// Unsubscribe Token Utility (HMAC-based high entropy)
// =============================================================================
// Generates and verifies cryptographic, tamper-proof unsubscribe tokens
// based on normalized email address without exposing internal lead IDs.
// =============================================================================

export async function generateUnsubscribeToken(email: string, secretKey?: string): Promise<string> {
  const secret = secretKey || (typeof Deno !== 'undefined' ? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') : '') || 'eds_unsubscribe_salt_default';
  const normalized = email.trim().toLowerCase();
  const encoder = new TextEncoder();
  const keyBytes = encoder.encode(secret);
  const dataBytes = encoder.encode(`unsubscribe:${normalized}`);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, dataBytes);
  const hex = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return hex;
}

export async function verifyUnsubscribeToken(
  email: string,
  token: string,
  secretKey?: string
): Promise<boolean> {
  if (!email || !token) return false;
  const expectedToken = await generateUnsubscribeToken(email, secretKey);
  return token.toLowerCase() === expectedToken.toLowerCase();
}
