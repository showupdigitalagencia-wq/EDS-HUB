// =============================================================================
// Web Push Crypto & VAPID Utilities (RFC 8291 & RFC 8292)
// =============================================================================
// Pure Web Crypto implementation of Web Push payload encryption (aes128gcm)
// and VAPID JWT authorization for Deno Edge Functions and Node/Browser environments.
// Zero third-party runtime dependencies.
// =============================================================================

function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const buffer = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    buffer[i] = rawData.charCodeAt(i);
  }
  return buffer;
}

function uint8ArrayToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((acc, curr) => acc + curr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/**
 * Creates an ES256 VAPID Authorization JWT for a given push endpoint.
 */
export async function createVapidToken(
  endpoint: string,
  vapidSubject: string,
  vapidPublicKeyBase64Url: string,
  vapidPrivateKeyBase64Url: string
): Promise<{ authorization: string }> {
  const url = new URL(endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 12 * 60 * 60; // 12 hours

  const header = {
    typ: 'JWT',
    alg: 'ES256',
  };

  const payload = {
    aud: audience,
    exp,
    sub: vapidSubject,
  };

  const enc = new TextEncoder();
  const headerB64 = uint8ArrayToBase64Url(enc.encode(JSON.stringify(header)));
  const payloadB64 = uint8ArrayToBase64Url(enc.encode(JSON.stringify(payload)));
  const unsignedToken = `${headerB64}.${payloadB64}`;

  // Import private key (PKCS8)
  const pkcs8Bytes = base64UrlToUint8Array(vapidPrivateKeyBase64Url);
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    pkcs8Bytes,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const signatureBuffer = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    cryptoKey,
    enc.encode(unsignedToken)
  );

  const signatureB64 = uint8ArrayToBase64Url(new Uint8Array(signatureBuffer));
  const jwt = `${unsignedToken}.${signatureB64}`;

  return {
    authorization: `vapid t=${jwt}, k=${vapidPublicKeyBase64Url}`,
  };
}

/**
 * Encrypts a text payload according to RFC 8291 (aes128gcm) for Web Push.
 */
export async function encryptWebPushPayload(
  payloadText: string,
  p256dhBase64Url: string,
  authBase64Url: string
): Promise<{ body: Uint8Array; headers: Record<string, string> }> {
  const enc = new TextEncoder();
  const userPublicKeyBytes = base64UrlToUint8Array(p256dhBase64Url);
  const userAuthSecret = base64UrlToUint8Array(authBase64Url);

  // 1. Generate local ephemeral ECDH keypair
  const localKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );

  // 2. Export local public key in uncompressed raw format (65 bytes)
  const localPublicKeyRaw = new Uint8Array(
    await crypto.subtle.exportKey('raw', localKeyPair.publicKey)
  );

  // 3. Import subscriber's public key
  const userPublicKey = await crypto.subtle.importKey(
    'raw',
    userPublicKeyBytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  // 4. Derive shared ECDH secret (32 bytes)
  const sharedSecretBuffer = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: userPublicKey },
    localKeyPair.privateKey,
    256
  );
  const sharedSecret = new Uint8Array(sharedSecretBuffer);

  // 5. Derive IKM using HKDF-Extract and Expand with user auth secret
  // info = "WebPush: info\0" + userPublicKeyBytes + localPublicKeyRaw
  const ikmInfo = concatUint8Arrays([
    enc.encode('WebPush: info\0'),
    userPublicKeyBytes,
    localPublicKeyRaw,
  ]);

  const authSecretKey = await crypto.subtle.importKey(
    'raw',
    userAuthSecret,
    { name: 'HKDF' },
    false,
    ['deriveBits']
  );

  // First HKDF: prk = HKDF-Extract(salt = userAuthSecret, ikm = sharedSecret)
  // ikm = HKDF-Expand(prk, info = ikmInfo, L = 32)
  const ikmBuffer = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: sharedSecret,
      info: ikmInfo,
    },
    authSecretKey,
    256
  );

  // 6. Generate 16 bytes random salt
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const ikmKey = await crypto.subtle.importKey(
    'raw',
    ikmBuffer,
    { name: 'HKDF' },
    false,
    ['deriveBits', 'deriveKey']
  );

  // Derive Content Encryption Key (CEK, 16 bytes)
  const cekBuffer = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt,
      info: enc.encode('Content-Encoding: aes128gcm\0'),
    },
    ikmKey,
    128
  );

  // Derive Nonce (12 bytes)
  const nonceBuffer = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt,
      info: enc.encode('Content-Encoding: nonce\0'),
    },
    ikmKey,
    96
  );

  // 7. Plaintext record: payload bytes + 0x02 delimiter
  const payloadBytes = enc.encode(payloadText);
  const recordPlaintext = new Uint8Array(payloadBytes.length + 1);
  recordPlaintext.set(payloadBytes, 0);
  recordPlaintext[payloadBytes.length] = 0x02; // Record delimiter

  // 8. Encrypt using AES-128-GCM
  const cekCryptoKey = await crypto.subtle.importKey(
    'raw',
    cekBuffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  const ciphertextBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: new Uint8Array(nonceBuffer),
      tagLength: 128,
    },
    cekCryptoKey,
    recordPlaintext
  );
  const ciphertext = new Uint8Array(ciphertextBuffer);

  // 9. Construct RFC 8291 Header:
  // salt (16 bytes) | rs (4 bytes uint32 = 4096) | idlen (1 byte = 65) | keyid (65 bytes)
  const recordSize = 4096;
  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  const dv = new DataView(header.buffer, header.byteOffset, header.byteLength);
  dv.setUint32(16, recordSize, false); // Big endian
  header[20] = 65; // uncompressed P-256 key length
  header.set(localPublicKeyRaw, 21);

  // Final body is header + ciphertext (which includes 16-byte auth tag)
  const body = concatUint8Arrays([header, ciphertext]);

  return {
    body,
    headers: {
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'high',
    },
  };
}
