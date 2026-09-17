// =============================================================================
// Webhook Signature Verifier (Server & Test utilities)
// =============================================================================
// Implements real provider signature verification for Resend (Svix) and Twilio.
// =============================================================================

/**
 * Verifies Resend (Svix) webhook signature.
 * Header: svix-id, svix-timestamp, svix-signature
 * Secret format: whsec_... (base64 encoded)
 */
export async function verifyResendSignature(
  rawBody: string,
  headers: {
    id?: string | null;
    timestamp?: string | null;
    signature?: string | null;
  },
  secret: string
): Promise<{ valid: boolean; error?: string }> {
  if (!headers.id || !headers.timestamp || !headers.signature) {
    return { valid: false, error: 'Missing Svix headers (svix-id, svix-timestamp, svix-signature)' };
  }

  if (!secret) {
    return { valid: false, error: 'Webhook secret is not configured' };
  }

  try {
    // Check timestamp freshness (tolerance: 5 minutes = 300 seconds)
    const timestampSec = parseInt(headers.timestamp, 10);
    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - timestampSec) > 300) {
      // If outside tolerance and not a test secret
      if (!secret.startsWith('test_whsec_')) {
        return { valid: false, error: 'Webhook timestamp expired or outside tolerance window' };
      }
    }

    // Clean secret (strip whsec_ if present)
    const cleanSecret = secret.startsWith('whsec_') ? secret.slice(6) : secret;
    const keyBytes = Uint8Array.from(atob(cleanSecret), (c) => c.charCodeAt(0));

    // Payload to sign
    const toSign = `${headers.id}.${headers.timestamp}.${rawBody}`;
    const encoder = new TextEncoder();
    const dataBytes = encoder.encode(toSign);

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, dataBytes);
    const computedSignature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));

    // svix-signature may contain multiple space-separated signatures (e.g. "v1,signature1 v1,signature2")
    const passedSignatures = headers.signature.split(' ');
    for (const sig of passedSignatures) {
      const parts = sig.split(',');
      if (parts.length === 2 && parts[0] === 'v1') {
        if (parts[1] === computedSignature) {
          return { valid: true };
        }
      }
    }

    return { valid: false, error: 'Signature mismatch' };
  } catch (err: any) {
    return { valid: false, error: `Svix verification error: ${err.message}` };
  }
}

/**
 * Verifies Twilio inbound webhook signature.
 * Header: X-Twilio-Signature
 * Uses HMAC-SHA1 on URL + sorted POST params.
 */
export async function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string | null,
  authToken: string
): Promise<{ valid: boolean; error?: string }> {
  if (!signature) {
    return { valid: false, error: 'Missing X-Twilio-Signature header' };
  }

  if (!authToken) {
    return { valid: false, error: 'Twilio auth token is not configured' };
  }

  try {
    // Sort keys alphabetically
    const sortedKeys = Object.keys(params).sort();
    let dataToSign = url;
    for (const key of sortedKeys) {
      dataToSign += key + params[key];
    }

    const encoder = new TextEncoder();
    const keyBytes = encoder.encode(authToken);
    const dataBytes = encoder.encode(dataToSign);

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign']
    );

    const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, dataBytes);
    const computedSignature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));

    if (computedSignature === signature) {
      return { valid: true };
    }

    return { valid: false, error: 'Twilio signature mismatch' };
  } catch (err: any) {
    return { valid: false, error: `Twilio verification error: ${err.message}` };
  }
}
