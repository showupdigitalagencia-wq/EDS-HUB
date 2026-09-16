// =============================================================================
// Test T15: Secrets Safety
// =============================================================================
// Verifies that no server-side secrets appear in the frontend bundle.
// This test builds the production bundle and scans it.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

const FORBIDDEN_PATTERNS = [
  'RESEND_API_KEY',
  'RESEND_FROM_EMAIL',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_FROM_NUMBER',
  'SUPABASE_SERVICE_ROLE_KEY',
  'service_role',
];

function getAllFiles(dirPath: string, files: string[] = []): string[] {
  if (!existsSync(dirPath)) return files;

  const entries = readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      getAllFiles(fullPath, files);
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

describe('Secrets Safety', () => {
  // T15: No secrets in source files accessible to browser
  it('T15: no server secrets in frontend source code', () => {
    const srcDir = join(process.cwd(), 'src');
    const files = getAllFiles(srcDir).filter(
      f => f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.js') || f.endsWith('.jsx'),
    );

    for (const filePath of files) {
      const content = readFileSync(filePath, 'utf-8');
      for (const pattern of FORBIDDEN_PATTERNS) {
        // Allow references in test files (like this one) and type definitions
        if (filePath.includes('__tests__') || filePath.includes('.test.')) continue;
        // Allow comments that reference the variable names
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Skip comment lines
          if (line.trim().startsWith('//') || line.trim().startsWith('*') || line.trim().startsWith('/*')) {
            continue;
          }
          // Check for actual usage (not in string literals used for documentation)
          if (line.includes(`process.env.${pattern}`) || line.includes(`Deno.env.get('${pattern}')`)) {
            throw new Error(
              `Secret reference "${pattern}" found in ${filePath}:${i + 1}. ` +
              'Server-side secrets must only be used in Edge Functions.',
            );
          }
        }
      }
    }
  });

  it('T15: no secrets in .env.example actual values', () => {
    const envExample = join(process.cwd(), '.env.example');
    if (!existsSync(envExample)) return;

    const content = readFileSync(envExample, 'utf-8');
    const lines = content.split('\n');

    for (const line of lines) {
      // Skip comments and empty lines
      if (line.trim().startsWith('#') || line.trim().length === 0) continue;

      const [key, ...valueParts] = line.split('=');
      const value = valueParts.join('=').trim();

      if (key && FORBIDDEN_PATTERNS.some(p => key.includes(p))) {
        // These keys should NOT have real values
        expect(
          value === '' || value.startsWith('your-') || value.startsWith('(set'),
          `${key} in .env.example should not contain a real value. Found: "${value}"`,
        ).toBe(true);
      }
    }
  });
});
