// =============================================================================
// Security Script: Rotate VAPID Keypair & Supabase Secrets
// =============================================================================
// Generates a cryptographically secure ECDSA P-256 keypair for Web Push (RFC 8292).
// Sets Supabase remote secrets without logging or printing the private key.
// Updates frontend constant and invalidates stale subscriptions.
// =============================================================================

const crypto = require('crypto');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function generateVapidKeys() {
  const ec = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });

  // Raw uncompressed public key (65 bytes, starts with 0x04)
  const publicKeyDer = ec.publicKey.export({ type: 'spki', format: 'der' });
  const rawPublicKey = publicKeyDer.subarray(publicKeyDer.length - 65);
  const publicKeyBase64Url = rawPublicKey
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  // PKCS#8 private key
  const privateKeyDer = ec.privateKey.export({ type: 'pkcs8', format: 'der' });
  const privateKeyBase64Url = privateKeyDer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return { publicKey: publicKeyBase64Url, privateKey: privateKeyBase64Url };
}

async function main() {
  console.log('--- Rotating VAPID Web Push Credentials ---');

  const { publicKey, privateKey } = generateVapidKeys();
  const subject = 'mailto:info@expdentalsolutions.com';

  console.log('New VAPID Public Key generated:', publicKey);
  console.log('New VAPID Private Key generated: [REDACTED FOR SECURITY]');

  // 1. Update Supabase Remote Secrets securely via Supabase CLI
  console.log('Setting new Supabase remote secrets...');
  try {
    const cmd = `cmd.exe /c npx supabase secrets set VAPID_PUBLIC_KEY="${publicKey}" VAPID_PRIVATE_KEY="${privateKey}" VAPID_SUBJECT="${subject}"`;
    execSync(cmd, { stdio: 'ignore' });
    console.log('Supabase secrets updated successfully (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT).');
  } catch (err) {
    console.error('Failed to update Supabase secrets via CLI:', err.message);
    process.exit(1);
  }

  // 2. Update frontend service default public key
  const serviceFile = path.join(__dirname, '../src/features/notifications/services/push-notification-service.ts');
  let content = fs.readFileSync(serviceFile, 'utf8');

  content = content.replace(
    /export const DEFAULT_VAPID_PUBLIC_KEY =[\s\S]*?;/,
    `export const DEFAULT_VAPID_PUBLIC_KEY =\n  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_VAPID_PUBLIC_KEY) ||\n  '${publicKey}';`
  );

  fs.writeFileSync(serviceFile, content, 'utf8');
  console.log('Updated DEFAULT_VAPID_PUBLIC_KEY in push-notification-service.ts.');

  // 3. Mark existing subscriptions as revoked in database via Supabase
  // We can execute SQL via supabase db execute or mark it via migration/script
  console.log('Marking existing subscriptions as revoked due to key rotation...');
  try {
    const sql = `UPDATE public.push_subscriptions SET status = 'revoked', updated_at = now() WHERE status = 'active';`;
    execSync(`cmd.exe /c npx supabase db query --linked "${sql}"`, { stdio: 'inherit' });
    console.log('Existing subscriptions revoked successfully.');
  } catch (err) {
    console.warn('Note: Could not revoke subscriptions directly via db query (non-fatal, Edge Function auto-revokes 410s):', err.message);
  }

  console.log('--- VAPID Key Rotation Complete ---');
}

main().catch((err) => {
  console.error('VAPID rotation error:', err);
  process.exit(1);
});
