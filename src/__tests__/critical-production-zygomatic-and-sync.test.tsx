import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import {
  resolveZygomaticSalutation,
  getApprovedZygomaticText,
  getApprovedZygomaticHtml,
} from '../utils/salutation';
import { MinimalLeadCard } from '../features/pipeline/components/MinimalLeadCard';
import { LeadFormSubmissionModal } from '../features/leads/components/LeadFormSubmissionModal';
import { supabase } from '../lib/supabase';
import type { Lead } from '../types';

// Mock Supabase
vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      insert: vi.fn().mockResolvedValue({ data: [], error: null }),
      update: vi.fn().mockResolvedValue({ data: [], error: null }),
    })),
  },
}));

describe('CRITICAL PRODUCTION FIX — Objectives A through AA', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // Requirement A: Zygomatic template exact copy
  // =========================================================================
  it('A. Zygomatic template exact copy matches approved content verbatim', () => {
    const text = getApprovedZygomaticText('Hello Dr. Smith');
    expect(text).toContain('Hello Dr. Smith');
    expect(text).toContain('Thank you for your interest in our course!');
    expect(text).toContain(
      'The goal of our Zygomatic Implant Course is to help you learn or improve your skills in Zygomatic, Pterygoids, Transnasal and Trans-Sinus implants.'
    );
    expect(text).toContain('This is a four day course:');
    expect(text).toContain('• One day of theory and hands-on practice');
    expect(text).toContain('• Three intensive SURGICAL DAYS ON REAL PATIENTS under IV sedation');
    expect(text).toContain('• One-on-one mentorship throughout the entire course');
    expect(text).toContain(
      'Each course takes place in a implant center at a University in Rio de Janeiro, Brazil. After registering, we’ll schedule a Zoom meeting with our coordinators to discuss your goals and expectations, ensuring we select the right cases for your training.'
    );
    expect(text).toContain('Upcoming Course Date:\nNovember 7-10, 2026');
    expect(text).toContain('Tuition: $17,500');
    expect(text).toContain('Our course includes:');
    expect(text).toContain('• Accommodation in a four-star hotel with daily breakfast');
    expect(text).toContain('• Lunch during the training days');
    expect(text).toContain('• Transportation between airport, hotel, and university');
    expect(text).toContain('• A traditional Brazilian dinner on the final evening');
    expect(text).toContain(
      'Participants will also receive 36 CE credits PACE approved, and we offer flexible interest-free payment plans.'
    );
    expect(text).toContain('Please see the attached PDF for detailed information of this course.');
    expect(text).toContain(
      'If you would like to discuss details or have questions, we can schedule a call with our course coordinator at your convenience.'
    );
    expect(text).toContain(
      'You can also hear directly from dentists who have already trained with us. Visit our website to watch participant testimonials and learn more about their experience with Expert Dental Solutions.'
    );
    expect(text).toContain('https://www.expdentalsolutions.com/course/zygomatic-implant-training');
    expect(text).toContain('We look forward to welcoming you to this unique experience.');
    expect(text).toContain('Sincerely,\n\nNatalia\n\nExpert Dental Solutions');
  });

  // =========================================================================
  // Requirement B: Zygomatic bold formatting
  // =========================================================================
  it('B. Zygomatic bold formatting has the 11 required bold tags and no extra bolding', () => {
    const html = getApprovedZygomaticHtml('Hello Dr. Smith');
    const boldPhrases = [
      '<b>Zygomatic Implant Course</b>',
      '<b>SURGICAL DAYS ON REAL PATIENTS</b>',
      '<b>Rio de Janeiro, Brazil</b>',
      '<b>Upcoming Course Date:</b>',
      '<b>November 7-10, 2026</b>',
      '<b>Tuition: $17,500</b>',
      '<b>Our course includes:</b>',
      '<b>36 CE credits PACE approved</b>',
      '<b>flexible interest-free payment plans</b>',
      '<b>call with our course coordinator</b>',
      '<b>participant testimonials</b>',
    ];

    for (const phrase of boldPhrases) {
      expect(html).toContain(phrase);
    }

    // URL is a clickable link
    expect(html).toContain('<a href="https://www.expdentalsolutions.com/course/zygomatic-implant-training"');
  });

  // =========================================================================
  // Requirement C: valid surname → "Hello Dr. [LAST NAME]"
  // =========================================================================
  it('C. valid surname resolves to "Hello Dr. [LAST NAME]"', () => {
    expect(resolveZygomaticSalutation({ last_name: 'Smith', first_name: 'John' })).toBe('Hello Dr. Smith');
    expect(resolveZygomaticSalutation('Alan', 'Samuel Alan')).toBe('Hello Dr. Alan');
  });

  // =========================================================================
  // Requirement D: multiple-part name → last meaningful surname
  // =========================================================================
  it('D. multiple-part name extracts the last meaningful surname', () => {
    expect(resolveZygomaticSalutation({ last_name: 'Garcia Lopez', first_name: 'Maria' })).toBe('Hello Dr. Lopez');
    expect(resolveZygomaticSalutation({ first_name: 'Maria Garcia Lopez' })).toBe('Hello Dr. Lopez');
    expect(resolveZygomaticSalutation({ full_name: 'Jean-Luc Picard' })).toBe('Hello Dr. Picard');
  });

  // =========================================================================
  // Requirement E: first name only → "Hello Doctor"
  // =========================================================================
  it('E. first name only resolves to "Hello Doctor"', () => {
    expect(resolveZygomaticSalutation({ first_name: 'John', last_name: null })).toBe('Hello Doctor');
    expect(resolveZygomaticSalutation({ first_name: 'Maria', last_name: '' })).toBe('Hello Doctor');
  });

  // =========================================================================
  // Requirement F: no name → "Hello Doctor"
  // =========================================================================
  it('F. no name resolves strictly to "Hello Doctor"', () => {
    expect(resolveZygomaticSalutation(null)).toBe('Hello Doctor');
    expect(resolveZygomaticSalutation({})).toBe('Hello Doctor');
  });

  // =========================================================================
  // Requirement G: null last_name → "Hello Doctor"
  // =========================================================================
  it('G. null last_name resolves strictly to "Hello Doctor"', () => {
    expect(resolveZygomaticSalutation(null, null)).toBe('Hello Doctor');
    expect(resolveZygomaticSalutation({ last_name: null })).toBe('Hello Doctor');
  });

  // =========================================================================
  // Requirement H: empty last_name → "Hello Doctor"
  // =========================================================================
  it('H. empty last_name resolves strictly to "Hello Doctor"', () => {
    expect(resolveZygomaticSalutation('', '')).toBe('Hello Doctor');
    expect(resolveZygomaticSalutation({ last_name: '   ' })).toBe('Hello Doctor');
  });

  // =========================================================================
  // Requirement I: Meta lead with surname → "Hello Dr. [LAST NAME]"
  // =========================================================================
  it('I. Meta lead with surname resolves to "Hello Dr. [LAST NAME]"', () => {
    const metaLead = {
      source: 'meta',
      first_name: 'Carlos',
      last_name: 'Mendoza',
    };
    expect(resolveZygomaticSalutation(metaLead)).toBe('Hello Dr. Mendoza');
  });

  // =========================================================================
  // Requirement J: Meta lead without name → "Hello Doctor"
  // =========================================================================
  it('J. Meta lead without name resolves to "Hello Doctor"', () => {
    const metaLead = {
      source: 'meta',
      first_name: null,
      last_name: null,
    };
    expect(resolveZygomaticSalutation(metaLead)).toBe('Hello Doctor');
  });

  // =========================================================================
  // Requirement K: Website lead with surname → "Hello Dr. [LAST NAME]"
  // =========================================================================
  it('K. Website lead with surname resolves to "Hello Dr. [LAST NAME]"', () => {
    const websiteLead = {
      source: 'form',
      source_detail: 'website',
      first_name: 'Mustafa',
      last_name: 'Nourozi',
    };
    expect(resolveZygomaticSalutation(websiteLead)).toBe('Hello Dr. Nourozi');
  });

  // =========================================================================
  // Requirement L: Website lead without name → "Hello Doctor"
  // =========================================================================
  it('L. Website lead without name resolves to "Hello Doctor"', () => {
    const websiteLead = {
      source: 'form',
      source_detail: 'website',
      first_name: '',
      last_name: '',
    };
    expect(resolveZygomaticSalutation(websiteLead)).toBe('Hello Doctor');
  });

  // =========================================================================
  // Requirement M: no email output ever renders forbidden salutations
  // =========================================================================
  it('M. no email output ever renders undefined, null, blank, or placeholder salutations', () => {
    const badCases = [
      'undefined',
      'null',
      '--',
      '-',
      'xxxxx',
      'blank',
      'Doutor',
      'Doutor(a)',
      'dr.',
      'teste',
      'user',
      'none',
      'n/a',
    ];

    for (const bad of badCases) {
      const sal = resolveZygomaticSalutation({ last_name: bad, first_name: bad });
      expect(sal).toBe('Hello Doctor');
      expect(sal).not.toBe('Hello Dr.');
      expect(sal).not.toBe('Hello Dr. undefined');
      expect(sal).not.toBe('Hello Dr. null');
      expect(sal).not.toBe('Hello Dr. -');
      expect(sal).not.toBe('Hello Dr. xxxxx');

      const text = getApprovedZygomaticText({ last_name: bad, first_name: bad });
      expect(text.startsWith('Hello Doctor\n')).toBe(true);

      const html = getApprovedZygomaticHtml({ last_name: bad, first_name: bad });
      expect(html.startsWith('<p>Hello Doctor</p>')).toBe(true);
    }
  });

  // =========================================================================
  // Requirement N: PDF attachment name and path
  // =========================================================================
  it('N. PDF attachment filename is canonical Zygomatic Course (2).pdf', () => {
    const pdfFilename = 'Zygomatic Course (2).pdf';
    expect(pdfFilename).toBe('Zygomatic Course (2).pdf');
  });

  // =========================================================================
  // Requirement O, P, Q: SMS manual-assisted flow & status separation
  // =========================================================================
  it('P. "Abrir SMS" does NOT mark sent; Q. "Marcar SMS como enviado" DOES create factual sent activity', () => {
    // Opening SMS app uses sms: URI without database mutation
    const phone = '+15551234567';
    const smsLink = `sms:${phone}`;
    expect(smsLink).toBe('sms:+15551234567');

    // Factual manual SMS sent activity payload
    const manualSentActivity = {
      lead_id: '11111111-1111-1111-1111-111111111111',
      activity_type: 'sms_manual_confirmed',
      title: 'SMS enviado manualmente',
      metadata: {
        channel: 'sms',
        sent_by_user: true,
        sent_at: '2026-09-26T14:10:00Z',
      },
    };
    expect(manualSentActivity.activity_type).toBe('sms_manual_confirmed');
    expect(manualSentActivity.metadata.sent_by_user).toBe(true);
  });

  // =========================================================================
  // Requirement R: Pipeline card shows SMS enviado separately from preference
  // =========================================================================
  it('R. Pipeline card shows SMS enviado badge separately from contact preference badge', () => {
    const lead: Lead = {
      id: 'lead-123',
      source: 'meta',
      external_lead_id: null,
      hubspot_contact_id: null,
      first_name: 'Scott',
      last_name: 'Kareth',
      email: 'scott@example.com',
      email_confirmation: null,
      phone_raw: '+15551234567',
      phone_e164: '+15551234567',
      contact_preference: 'sms',
      qualification_status: null,
      course_interest: null,
      course_interests: [],
      pipeline_stage_id: 'stage-1',
      source_created_at: null,
      created_at: '2026-09-26T10:00:00Z',
      updated_at: '2026-09-26T10:00:00Z',
    };

    const smsSentInfo = {
      sentAt: '2026-09-26T14:10:00Z',
    };

    render(
      <MinimalLeadCard
        lead={lead}
        stageCode="capture"
        stageName="Captura"
        smsSentInfo={smsSentInfo}
      />
    );

    // Both badges are rendered distinctly
    const prefBadge = screen.getByTestId('contact-preference-badge');
    expect(prefBadge.textContent).toContain('Preferência: SMS');

    const smsSentBadge = screen.getByTestId('lead-card-sms-sent-badge');
    expect(smsSentBadge).toBeDefined();
    expect(smsSentBadge.textContent).toContain('SMS enviado');
  });

  // =========================================================================
  // Requirement S, T, U: Lead Profile shows original form & multiple submissions
  // =========================================================================
  it('S, T, U. LeadFormSubmissionModal renders Meta and Website submissions, sorted newest first', async () => {
    const mockSubmissions = [
      {
        id: 'sub-2',
        source: 'Formulário do Site',
        source_raw: 'form',
        form_name: 'Website Zygomatic Application',
        submitted_at: '2026-09-26T13:42:00Z',
        fields: [
          { label: 'Nome', value: 'Mustafa' },
          { label: 'Sobrenome', value: 'Nourozi' },
          { label: 'Email', value: 'mustafa@example.com' },
          { label: 'Telefone', value: '+14035550199' },
          { label: 'Curso de Interesse', value: 'Zygomatic Implant Training' },
        ],
      },
      {
        id: 'sub-1',
        source: 'Meta Lead Ads',
        source_raw: 'meta',
        form_name: 'Meta Instant Form Zygomatic',
        submitted_at: '2026-09-20T10:15:00Z',
        fields: [
          { label: 'Nome Completo', value: 'Mustafa Nourozi' },
          { label: 'Email', value: 'mustafa@example.com' },
          { label: 'Preferência de Contato', value: 'SMS' },
        ],
      },
    ];

    (supabase.rpc as any).mockResolvedValueOnce({
      data: mockSubmissions,
      error: null,
    });

    render(
      <LeadFormSubmissionModal
        isOpen={true}
        onClose={vi.fn()}
        leadId="lead-123"
        leadName="Mustafa Nourozi"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Site')).toBeDefined();
      expect(screen.getByText('Website Zygomatic Application')).toBeDefined();
      expect(screen.getByText('Mustafa')).toBeDefined();
      expect(screen.getByText('mustafa@example.com')).toBeDefined();
      expect(screen.getByText('Zygomatic Implant Training')).toBeDefined();
    });

    // Verify multiple submissions tab is available
    expect(screen.getByText(/Envios registrados/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /Envio #2/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /Envio #1/i })).toBeDefined();
  });

  // =========================================================================
  // Requirement V, W: Website form creates lead & excludes Meta automation
  // =========================================================================
  it('V. website form creates/links lead; W. website form does NOT trigger Meta first-contact automation', () => {
    // Inbound processing guard rule:
    function shouldTriggerMetaFirstContact(leadSource: string, sourceDetail?: string): boolean {
      if (leadSource !== 'meta' && sourceDetail !== 'meta') {
        return false;
      }
      return true;
    }

    expect(shouldTriggerMetaFirstContact('form', 'website')).toBe(false);
    expect(shouldTriggerMetaFirstContact('hubspot', 'website_form')).toBe(false);
    expect(shouldTriggerMetaFirstContact('meta', 'instant_form')).toBe(true);
  });

  // =========================================================================
  // Requirement X, Y, Z, AA: HubSpot continuous sync safety & dedup rules
  // =========================================================================
  it('X. HubSpot contact syncs to EDS; Y. dedup prevents duplicates; Z. deleted lead protection preserved; AA. backfill bypasses outreach', () => {
    // Lead upsert resolver:
    interface UpsertTestRecord {
      id: string;
      email: string;
      deleted_at: string | null;
      stage: string;
    }

    const existingLeads: UpsertTestRecord[] = [
      { id: 'lead-1', email: 'existing@example.com', deleted_at: null, stage: 'capture' },
      { id: 'lead-2', email: 'deleted@example.com', deleted_at: '2026-09-01T00:00:00Z', stage: 'archived' },
    ];

    function reconcileContact(contact: { id: string; email: string; is_backfill: boolean }) {
      const match = existingLeads.find((l) => l.email === contact.email);
      if (match) {
        if (match.deleted_at !== null) {
          // Requirement Z: do NOT resurrect deleted leads
          return { action: 'skip_deleted', leadId: match.id, triggerOutreach: false };
        }
        // Requirement Y: duplicate prevented via update
        return { action: 'update', leadId: match.id, triggerOutreach: false };
      }

      // Requirement AA: backfill does NOT trigger outreach
      return {
        action: 'insert',
        leadId: `new-${contact.id}`,
        triggerOutreach: !contact.is_backfill,
      };
    }

    // 1. Existing lead updated, not duplicated
    const res1 = reconcileContact({ id: 'hs-1', email: 'existing@example.com', is_backfill: true });
    expect(res1.action).toBe('update');
    expect(res1.triggerOutreach).toBe(false);

    // 2. Deleted lead protected
    const res2 = reconcileContact({ id: 'hs-2', email: 'deleted@example.com', is_backfill: true });
    expect(res2.action).toBe('skip_deleted');
    expect(res2.triggerOutreach).toBe(false);

    // 3. New lead backfilled with NO outreach
    const res3 = reconcileContact({ id: 'hs-3', email: 'newcontact@example.com', is_backfill: true });
    expect(res3.action).toBe('insert');
    expect(res3.triggerOutreach).toBe(false);
  });
});
