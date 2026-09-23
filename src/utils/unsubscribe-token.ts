// =============================================================================
// Unsubscribe Token Utility (Browser / Node compatible)
// =============================================================================
// Generates and verifies cryptographic, tamper-proof unsubscribe tokens
// based on normalized email address without exposing internal lead IDs.
// =============================================================================

export async function generateUnsubscribeToken(email: string, secretKey = 'eds_unsubscribe_salt_default'): Promise<string> {
  const normalized = email.trim().toLowerCase();
  const encoder = new TextEncoder();
  const keyBytes = encoder.encode(secretKey);
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
  secretKey = 'eds_unsubscribe_salt_default'
): Promise<boolean> {
  if (!email || !token) return false;
  const expectedToken = await generateUnsubscribeToken(email, secretKey);
  return token.toLowerCase() === expectedToken.toLowerCase();
}
