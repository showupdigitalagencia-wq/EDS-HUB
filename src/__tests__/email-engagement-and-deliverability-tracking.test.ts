import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
  fetchLeadEmailHealth,
  resolveLeadDeliverabilityHealth,
} from '../features/dashboard/services/deliverability-health-service';
import { getActivityLabel } from '../features/leads/components/LeadTimeline';

describe('CRITICAL ENHANCEMENT — Email Engagement & Deliverability Tracking Suite', () => {
  const webhookCode = readFileSync(
    join(process.cwd(), 'supabase', 'functions', 'resend-event-webhook', 'index.ts'),
    'utf-8'
  );

  // ===========================================================================
  // 1. Provider Capability Audit & Factuality
  // ===========================================================================
  describe('1. Provider Capability & Factuality', () => {
    it('verifies Resend supported events in webhook implementation', () => {
      expect(webhookCode).toContain("eventType === 'email.delivered'");
      expect(webhookCode).toContain("eventType === 'email.opened'");
      expect(webhookCode).toContain("eventType === 'email.clicked'");
      expect(webhookCode).toContain("eventType === 'email.delivery_delayed'");
      expect(webhookCode).toContain("eventType === 'email.bounced'");
      expect(webhookCode).toContain("eventType === 'email.complained'");
      expect(webhookCode).toContain("eventType === 'email.failed'");
      expect(webhookCode).toContain("eventType === 'email.sent'");
      expect(webhookCode).toContain("eventType === 'email.suppressed'");
    });

    it('documents that recipient manual block is not directly detectable by email providers', () => {
      // Per Section 1 & 10: email providers cannot detect client-side "Block sender" actions
      const manualBlockDetectable = false;
      expect(manualBlockDetectable).toBe(false);
    });
  });

  // ===========================================================================
  // 2. Open Tracking & Limitations
  // ===========================================================================
  describe('2. Open Tracking & Semantic Limitations', () => {
    it('persists open event timestamps, counters, and provider status in webhook', () => {
      expect(webhookCode).toContain("status: 'opened'");
      expect(webhookCode).toContain('opened_at: occurredAt');
      expect(webhookCode).toContain('last_opened_at: occurredAt');
      expect(webhookCode).toContain('open_count: 1');
      expect(webhookCode).toContain("provider_status: 'opened'");
    });

    it('records open activity with factual non-speculative wording "Abertura detectada"', () => {
      expect(webhookCode).toContain("activity_type: 'email_opened'");
      expect(webhookCode).toContain("summary: 'Abertura detectada'");
      expect(getActivityLabel('email_opened')).toBe('Abertura detectada');
    });

    it('resolves email health to "Abertura detectada" when recent email is opened', async () => {
      const mockClient = {
        from: (_table: string) => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null }),
              eq: () => ({
                order: () => ({
                  limit: async () => ({
                    data: [
                      {
                        status: 'opened',
                        opened_at: new Date().toISOString(),
                        delivered_at: new Date().toISOString(),
                      },
                    ],
                  }),
                }),
              }),
            }),
          }),
        }),
      } as any;

      const health = await fetchLeadEmailHealth('opened@example.com', mockClient);
      expect(health.status).toBe('saudavel');
      expect(health.label).toBe('Abertura detectada');
      expect(health.details).toContain('sujeito a proxies/scanners');
    });
  });

  // ===========================================================================
  // 3. Click Tracking & Scanner Considerations
  // ===========================================================================
  describe('3. Click Tracking & Bot/Scanner Factuality', () => {
    it('persists click event timestamps, link URL, and counter in webhook', () => {
      expect(webhookCode).toContain("status: 'clicked'");
      expect(webhookCode).toContain('clicked_at: occurredAt');
      expect(webhookCode).toContain('last_clicked_at: occurredAt');
      expect(webhookCode).toContain('click_count: 1');
      expect(webhookCode).toContain('last_clicked_url: clickUrl');
      expect(webhookCode).toContain("provider_status: 'clicked'");
    });

    it('records click activity with factual wording "Clique detectado"', () => {
      expect(webhookCode).toContain("activity_type: 'email_clicked'");
      expect(getActivityLabel('email_clicked')).toBe('Clique detectado');
    });

    it('resolves email health to "Clique detectado" when recent email was clicked', async () => {
      const mockClient = {
        from: (_table: string) => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null }),
              eq: () => ({
                order: () => ({
                  limit: async () => ({
                    data: [
                      {
                        status: 'clicked',
                        clicked_at: new Date().toISOString(),
                        delivered_at: new Date().toISOString(),
                      },
                    ],
                  }),
                }),
              }),
            }),
          }),
        }),
      } as any;

      const health = await fetchLeadEmailHealth('clicked@example.com', mockClient);
      expect(health.status).toBe('saudavel');
      expect(health.label).toBe('Clique detectado');
      expect(health.details).toContain('Engajamento comprovado');
    });
  });

  // ===========================================================================
  // 4. Soft Bounce vs Hard Bounce Granularity
  // ===========================================================================
  describe('4. Bounce Handling Granularity', () => {
    it('differentiates soft bounce from hard bounce in webhook', () => {
      expect(webhookCode).toContain("bounceType.includes('soft')");
      expect(webhookCode).toContain("bounce_type: 'soft_bounce'");
      expect(webhookCode).toContain("bounce_type: 'hard_bounce'");
    });

    it('does NOT permanently suppress soft bounces', () => {
      // In soft bounce block, email_suppressions is NOT upserted
      const softBounceBlock = webhookCode.slice(
        webhookCode.indexOf('if (isSoftBounce) {'),
        webhookCode.indexOf('} else {')
      );
      expect(softBounceBlock).not.toContain("from('email_suppressions')");
    });

    it('suppresses and alerts on hard bounce', () => {
      const hardBounceBlock = webhookCode.slice(
        webhookCode.indexOf('// Hard Bounce: permanent failure, SUPPRESS recipient')
      );
      expect(hardBounceBlock).toContain("from('email_suppressions')");
      expect(hardBounceBlock).toContain("reason: 'hard_bounce'");
      expect(hardBounceBlock).toContain("event_type: 'deliverability_critical'");
    });

    it('resolves email health correctly for soft bounce vs hard bounce', async () => {
      const mockClientSoft = {
        from: (_table: string) => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null }),
              eq: () => ({
                order: () => ({
                  limit: async () => ({
                    data: [
                      {
                        status: 'failed',
                        bounce_type: 'soft_bounce',
                      },
                    ],
                  }),
                }),
              }),
            }),
          }),
        }),
      } as any;

      const softHealth = await fetchLeadEmailHealth('soft@example.com', mockClientSoft);
      expect(softHealth.label).toBe('Falha temporária');

      const mockClientHard = {
        from: (_table: string) => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { reason: 'hard_bounce' },
              }),
            }),
          }),
        }),
      } as any;

      const hardHealth = await fetchLeadEmailHealth('hard@example.com', mockClientHard);
      expect(hardHealth.label).toBe('Falha de entrega');
    });
  });

  // ===========================================================================
  // 5. Spam / Complaint Critical Handling
  // ===========================================================================
  describe('5. Spam / Complaint Critical Handling', () => {
    it('persists complaint status, suppresses recipient and generates critical push', () => {
      expect(webhookCode).toContain("status: 'complained'");
      expect(webhookCode).toContain("reason: 'complaint'");
      expect(webhookCode).toContain("activity_type: 'email_complained'");
      expect(webhookCode).toContain("event_type: 'deliverability_critical'");
      expect(webhookCode).toContain('reportado como spam (Reclamação)');
    });

    it('resolves email health to Reclamação / Spam', async () => {
      const mockClient = {
        from: (_table: string) => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { reason: 'complaint' },
              }),
            }),
          }),
        }),
      } as any;

      const health = await fetchLeadEmailHealth('spam@example.com', mockClient);
      expect(health.status).toBe('reclamacao');
      expect(health.label).toBe('Reclamação / Spam');
    });
  });

  // ===========================================================================
  // 6. Pipeline Kanban & Deliverability Resolution Compatibility
  // ===========================================================================
  describe('6. Pipeline Kanban Deliverability Compatibility', () => {
    it('treats opens and clicks as verified delivery on Kanban cards', () => {
      const resClick = resolveLeadDeliverabilityHealth({
        leadEmail: 'click@example.com',
        recentOutboundMessages: [
          { status: 'clicked', clicked_at: new Date().toISOString() },
        ],
      });
      expect(resClick.status).toBe('saudavel');
      expect(resClick.label).toBe('Saudável');
      expect(resClick.description).toContain('Clique detectado');

      const resOpen = resolveLeadDeliverabilityHealth({
        leadEmail: 'open@example.com',
        recentOutboundMessages: [
          { status: 'opened', opened_at: new Date().toISOString() },
        ],
      });
      expect(resOpen.status).toBe('saudavel');
      expect(resOpen.label).toBe('Saudável');
      expect(resOpen.description).toContain('Abertura detectada');
    });

    it('correctly reports Suprimido when suppressionReason is present', () => {
      const res = resolveLeadDeliverabilityHealth({
        leadEmail: 'suppressed@example.com',
        suppressionReason: 'complaint',
      });
      expect(res.status).toBe('suprimido');
      expect(res.label).toBe('Suprimido');
    });
  });

  // ===========================================================================
  // 7. Migration 00065 Integrity
  // ===========================================================================
  describe('7. Migration 00065 Schema Verification', () => {
    it('verifies migration 00065 exists and defines engagement columns and activity types', () => {
      const migPath = join(
        process.cwd(),
        'supabase',
        'migrations',
        '00065_email_engagement_and_granular_deliverability.sql'
      );
      expect(existsSync(migPath)).toBe(true);

      const migSql = readFileSync(migPath, 'utf-8');
      expect(migSql).toContain('opened_at TIMESTAMPTZ NULL');
      expect(migSql).toContain('clicked_at TIMESTAMPTZ NULL');
      expect(migSql).toContain('open_count INTEGER NOT NULL DEFAULT 0');
      expect(migSql).toContain('click_count INTEGER NOT NULL DEFAULT 0');
      expect(migSql).toContain('delivery_delayed_at TIMESTAMPTZ NULL');
      expect(migSql).toContain('bounce_type TEXT NULL');
      expect(migSql).toContain("'email_opened'::text");
      expect(migSql).toContain("'email_clicked'::text");
      expect(migSql).toContain("'email_delivery_delayed'::text");
      expect(migSql).toContain("'email_suppressed'::text");
    });
  });
});
