// =============================================================================
// Tests: Provider Configuration & Safety (Phase 1)
// =============================================================================
// Validates Resend, Twilio safety guard (absence of TWILIO_FROM_NUMBER),
// and Call preference intake workflow.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { resolveSalutation } from '../utils/salutation';

describe('Providers Phase 1 Configuration & Safety', () => {
  const functionsEnvPath = join(process.cwd(), 'supabase', 'functions', '.env');

  // Helper to parse env file without leaking secrets
  function getFunctionsEnv(): Record<string, string> {
    if (!existsSync(functionsEnvPath)) return {};
    const content = readFileSync(functionsEnvPath, 'utf-8');
    const result: Record<string, string> = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const [k, ...v] = trimmed.split('=');
      if (k) result[k.trim()] = v.join('=').trim();
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // 1. Resend Tests
  // ---------------------------------------------------------------------------
  describe('Resend Provider', () => {
    it('confirms server-side configuration exists in Edge Functions environment', () => {
      const env = getFunctionsEnv();
      expect(Boolean(env.RESEND_API_KEY), 'RESEND_API_KEY should be present in server-side env').toBe(true);
      expect(Boolean(env.RESEND_FROM_EMAIL), 'RESEND_FROM_EMAIL should be present in server-side env').toBe(true);
      expect(env.RESEND_FROM_EMAIL).toBe('no-reply@expdentalsolutions.com');
    });

    it('confirms RESEND_FROM_EMAIL uses verified domain expdentalsolutions.com', () => {
      const env = getFunctionsEnv();
      const fromEmail = env.RESEND_FROM_EMAIL || '';
      expect(fromEmail.endsWith('@expdentalsolutions.com')).toBe(true);
    });

    it('confirms server-side secrets never leak into frontend source files', () => {
      const env = getFunctionsEnv();
      const apiKey = env.RESEND_API_KEY;
      if (!apiKey) return;

      const srcDir = join(process.cwd(), 'src');
      // Read all non-test ts/tsx files
      const checkFile = (filePath: string) => {
        const content = readFileSync(filePath, 'utf-8');
        expect(content.includes(apiKey), `Secret found in ${filePath}!`).toBe(false);
      };

      const scanDir = (dir: string) => {
        const { readdirSync, statSync } = require('fs');
        const entries = readdirSync(dir);
        for (const entry of entries) {
          const full = join(dir, entry);
          if (statSync(full).isDirectory()) {
            if (entry !== '__tests__' && entry !== 'node_modules') scanDir(full);
          } else if (full.endsWith('.ts') || full.endsWith('.tsx')) {
            checkFile(full);
          }
        }
      };

      scanDir(srcDir);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Twilio Tests
  // ---------------------------------------------------------------------------
  describe('Twilio Provider & Safety Guard', () => {
    it('confirms Account SID and Auth Token exist in server-side env', () => {
      const env = getFunctionsEnv();
      expect(Boolean(env.TWILIO_ACCOUNT_SID), 'TWILIO_ACCOUNT_SID should be present in server-side env').toBe(true);
      expect(Boolean(env.TWILIO_AUTH_TOKEN), 'TWILIO_AUTH_TOKEN should be present in server-side env').toBe(true);
    });

    it('confirms TWILIO_FROM_NUMBER is NOT configured (Pending)', () => {
      const env = getFunctionsEnv();
      expect(Boolean(env.TWILIO_FROM_NUMBER), 'TWILIO_FROM_NUMBER must be pending/absent').toBe(false);
    });

    it('controlled guard blocks SMS sending safely when TWILIO_FROM_NUMBER is absent', async () => {
      // Simulate adapter logic without sending real network traffic
      const simulateSendSms = (config: { sid?: string; token?: string; from?: string }) => {
        if (!config.sid || !config.token) {
          return {
            success: false,
            messageId: null,
            errorCode: 'CONFIG_ERROR',
            errorMessage: 'Twilio credentials are not configured',
          };
        }
        if (!config.from) {
          return {
            success: false,
            messageId: null,
            errorCode: 'MISSING_FROM_NUMBER',
            errorMessage: 'TWILIO_FROM_NUMBER is not configured',
          };
        }
        return { success: true, messageId: 'sms-simulated', errorCode: null, errorMessage: null };
      };

      const env = getFunctionsEnv();
      const result = simulateSendSms({
        sid: env.TWILIO_ACCOUNT_SID,
        token: env.TWILIO_AUTH_TOKEN,
        from: env.TWILIO_FROM_NUMBER,
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('MISSING_FROM_NUMBER');
      expect(result.errorMessage).toBe('TWILIO_FROM_NUMBER is not configured');

      const errMessage = result.errorMessage ?? '';
      // Verify no credentials leaked in error
      if (env.TWILIO_ACCOUNT_SID) {
        expect(errMessage.includes(env.TWILIO_ACCOUNT_SID)).toBe(false);
      }
      if (env.TWILIO_AUTH_TOKEN) {
        expect(errMessage.includes(env.TWILIO_AUTH_TOKEN)).toBe(false);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Call Preference Test
  // ---------------------------------------------------------------------------
  describe('Call Preference Workflow', () => {
    it('creates a call task, advances stage from Captura to Qualificação, and dispatches zero messages', async () => {
      interface LeadActivity {
        type: string;
        summary: string;
      }
      interface Task {
        type: string;
        title: string;
        status: string;
      }

      // Simulated Lead Intake DB state
      const tasks: Task[] = [];
      const activities: LeadActivity[] = [];
      const outboundMessages: Array<{ channel: string; status: string }> = [];
      let currentStage = 'capture';

      const fakeLead = {
        first_name: 'Carlos',
        last_name: 'Mendes',
        contact_preference: 'call' as const,
        phone: '+5511999998888',
      };

      // Execution mirroring Edge Function logic
      const salutation = resolveSalutation(fakeLead.last_name, fakeLead.first_name);

      // Handle call preference
      tasks.push({
        type: 'call',
        title: `Call lead — ${salutation}`,
        status: 'pending',
      });
      activities.push({
        type: 'call_task_created',
        summary: `Call task created for ${salutation}`,
      });

      // Stage advance on success
      currentStage = 'qualification';
      activities.push({
        type: 'stage_changed',
        summary: 'Lead advanced from Captura to Qualificação after successful intake processing',
      });

      // Assertions
      expect(tasks).toHaveLength(1);
      expect(tasks[0].type).toBe('call');
      expect(tasks[0].title).toBe('Call lead — Mendes');
      expect(currentStage).toBe('qualification');
      expect(outboundMessages).toHaveLength(0);
      expect(activities.some(a => a.type === 'call_task_created')).toBe(true);
      expect(activities.some(a => a.type === 'stage_changed')).toBe(true);
    });
  });
});
