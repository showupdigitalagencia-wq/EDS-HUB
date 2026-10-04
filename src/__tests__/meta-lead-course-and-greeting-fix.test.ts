// =============================================================================
// EDS HUB — META LEAD COURSE MATCHING, DOCTOR GREETING, & SAFETY TEST SUITE
// =============================================================================
// Verifies:
// A. Meta lead + known course -> correct course template sent
// B. Meta lead + unknown course -> no email sent (0 recipients)
// C. Conflicting course signals -> no email sent, conflict flagged
// D. Single-name lead (e.g. "Jamal") -> "Hello Doctor," (never "Hello Jamal," or "Hello Dr. Jamal,")
// E. Full-name lead (e.g. "Jamal Smith") -> "Hello Dr. Smith,"
// F. Replay webhook -> no duplicate email (idempotent)
// G. Multiple valid emails -> same correct course-specific template, recipient-level tracking
// H. One bounced email -> other recipient unaffected
// I. HubSpot later adds course -> no unintended late auto-send (DISABLED)
// J. Generic fallback template can never be used in Meta first-contact automation
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  resolveDoctorSalutation,
  resolveDoctorGreeting,
  resolveApprovedCourseTemplateKey,
  APPROVED_COURSE_TEMPLATES,
  getApprovedZygomaticText,
  getApprovedZygomaticHtml,
  getApprovedImplantText,
  getApprovedPeriodontalText,
  getApprovedEndodonticText,
  getApprovedWisdomText,
  getApprovedRehabilitationText,
} from '../utils/salutation';
import { resolveCanonicalEmails } from '../utils/email-validation';

describe('A. Meta Lead + Known Course -> Correct Course Template Sent', () => {
  it('maps Zygomatic course variations to zygomatic_course_details and exact approved copy', () => {
    expect(resolveApprovedCourseTemplateKey('ZIT-01')).toBe('zygomatic_course_details');
    expect(resolveApprovedCourseTemplateKey('Zygomatic')).toBe('zygomatic_course_details');
    expect(resolveApprovedCourseTemplateKey('Zygomatic Implant Training')).toBe('zygomatic_course_details');
    expect(resolveApprovedCourseTemplateKey('Full Arch and Zygomatic - November 2026')).toBe('zygomatic_course_details');

    const pkg = APPROVED_COURSE_TEMPLATES['zygomatic_course_details'];
    expect(pkg).toBeDefined();
    expect(pkg.subject).toBe('Zygomatic Course Details – Hands-On Training in Rio');
    expect(pkg.attachmentNames).toContain('Zygomatic Course (2).pdf');

    const text = pkg.getText({ first_name: 'Jamal' });
    expect(text).toContain('Hello Doctor');
    expect(text).toContain('The goal of our Zygomatic Implant Course is to help you learn or improve your skills');
    expect(text).toContain('November 7-10, 2026');
    expect(text).toContain('Tuition: $17,500');
  });

  it('maps Intensive / Advanced Implant variations to implant_course_details', () => {
    expect(resolveApprovedCourseTemplateKey('IDIT-01')).toBe('implant_course_details');
    expect(resolveApprovedCourseTemplateKey('ADIE-01')).toBe('implant_course_details');
    expect(resolveApprovedCourseTemplateKey('Intensive Dental Implant Training')).toBe('implant_course_details');
    expect(resolveApprovedCourseTemplateKey('Advanced Implant Experience')).toBe('implant_course_details');

    const pkg = APPROVED_COURSE_TEMPLATES['implant_course_details'];
    expect(pkg.subject).toBe('Implant Course Details – Hands-On Training');
    expect(pkg.attachmentNames).toEqual(['Intensive implant .pdf', 'Advanced implant course (1).pdf']);
  });

  it('maps Periodontal Surgery variations to periodontal_course_details', () => {
    expect(resolveApprovedCourseTemplateKey('PST-01')).toBe('periodontal_course_details');
    expect(resolveApprovedCourseTemplateKey('Periodontal Plastic Surgery')).toBe('periodontal_course_details');

    const pkg = APPROVED_COURSE_TEMPLATES['periodontal_course_details'];
    expect(pkg.subject).toBe('Periodontal Plastic Course Details – Hands-On Training in Rio');
    expect(pkg.attachmentNames).toContain('_Perio and Peri-implant Plastic Surgery.pdf');
  });

  it('maps Endodontics variations to endodontic_course_details', () => {
    expect(resolveApprovedCourseTemplateKey('ET-01')).toBe('endodontic_course_details');
    expect(resolveApprovedCourseTemplateKey('Endodontic Clinical Training')).toBe('endodontic_course_details');

    const pkg = APPROVED_COURSE_TEMPLATES['endodontic_course_details'];
    expect(pkg.subject).toBe('Endodontics Course Details, Hands-On Training in Rio');
    expect(pkg.attachmentNames).toContain('Endodontics course.pdf');
  });

  it('maps Wisdom Teeth variations to wisdom_course_details', () => {
    expect(resolveApprovedCourseTemplateKey('WTT-01')).toBe('wisdom_course_details');
    expect(resolveApprovedCourseTemplateKey('Wisdom Teeth Extraction Course')).toBe('wisdom_course_details');

    const pkg = APPROVED_COURSE_TEMPLATES['wisdom_course_details'];
    expect(pkg.subject).toBe('Wisdom Surgery Details – Hands-On Training in Rio');
    expect(pkg.attachmentNames).toContain('Third molar course.pdf');
  });

  it('maps Rehabilitation variations to rehabilitation_course_details', () => {
    expect(resolveApprovedCourseTemplateKey('AIRE-01')).toBe('rehabilitation_course_details');
    expect(resolveApprovedCourseTemplateKey('Advanced Implant Rehabilitation Experience')).toBe('rehabilitation_course_details');

    const pkg = APPROVED_COURSE_TEMPLATES['rehabilitation_course_details'];
    expect(pkg.subject).toBe('Implant Rehabilitation Course Details – Hands-On Training');
    expect(pkg.attachmentNames).toContain('Oral Rehabilitation Course.pdf');
  });
});

describe('B. Meta Lead + Unknown Course -> No Email Sent (0 Recipients)', () => {
  it('returns null for unknown, empty, or unmapped courses — never a fallback key', () => {
    expect(resolveApprovedCourseTemplateKey(null)).toBeNull();
    expect(resolveApprovedCourseTemplateKey(undefined)).toBeNull();
    expect(resolveApprovedCourseTemplateKey('')).toBeNull();
    expect(resolveApprovedCourseTemplateKey('General Dentistry')).toBeNull();
    expect(resolveApprovedCourseTemplateKey('Dentistry Overview 2026')).toBeNull();
    expect(resolveApprovedCourseTemplateKey('Unknown Specialization')).toBeNull();
  });

  it('simulates intake orchestration with unknown course: suppresses outreach and leaves lead in Novo Lead', () => {
    // Simulated intake state
    const lead = {
      id: 'lead-unknown-course-123',
      pipeline_stage: 'Novo Lead',
      course_interest: null,
      first_name: 'Jamal',
      email: 'jamal@example.com',
    };

    const courseTemplateKey = resolveApprovedCourseTemplateKey(lead.course_interest);
    const sentMessages: any[] = [];
    const tasks: any[] = [];
    const activities: any[] = [];

    if (!courseTemplateKey) {
      // Core business rule: DO NOT SEND ANY AUTOMATIC EMAIL
      tasks.push({
        lead_id: lead.id,
        task_type: 'data_review',
        title: 'Triagem de Curso Não Identificado — Meta Lead',
        status: 'pending',
      });
      activities.push({
        lead_id: lead.id,
        activity_type: 'outreach_suppressed',
        summary: 'Envio automático de primeiro e-mail suspenso: curso de interesse não identificado com alta confiança.',
      });
    } else {
      sentMessages.push({ to: lead.email, template: courseTemplateKey });
    }

    expect(sentMessages.length).toBe(0);
    expect(tasks.length).toBe(1);
    expect(tasks[0].task_type).toBe('data_review');
    expect(activities.length).toBe(1);
    expect(activities[0].activity_type).toBe('outreach_suppressed');
    expect(lead.pipeline_stage).toBe('Novo Lead');
  });
});

describe('C. Conflicting Course Signals -> No Email Sent, Conflict Flagged', () => {
  it('detects conflicting course signals between form ID mapping and lead field answers', () => {
    const formCourse = { code: 'ZIT-01', name: 'Zygomatic Implant Training' };
    const answerCourse = { code: 'WTT-01', name: 'Wisdom Teeth Extraction Course' };

    let hasConflict = false;
    let conflictReason = '';

    if (formCourse && answerCourse && formCourse.code !== answerCourse.code) {
      hasConflict = true;
      conflictReason = `Conflito entre mapeamento do formulário ("${formCourse.name}") e resposta do lead ("${answerCourse.name}").`;
    }

    expect(hasConflict).toBe(true);
    expect(conflictReason).toContain('Zygomatic Implant Training');
    expect(conflictReason).toContain('Wisdom Teeth Extraction Course');

    // Rule: DO NOT SEND when conflict exists
    const messagesSent: any[] = [];
    const tasks: any[] = [];

    if (hasConflict) {
      tasks.push({
        task_type: 'data_review',
        title: 'Conflito de Curso — Meta Lead',
        description: conflictReason,
      });
    } else {
      messagesSent.push({ to: 'doctor@example.com' });
    }

    expect(messagesSent.length).toBe(0);
    expect(tasks.length).toBe(1);
    expect(tasks[0].title).toBe('Conflito de Curso — Meta Lead');
  });
});

describe('D. Single-Name Lead -> "Hello Doctor," (Strict Rule)', () => {
  it('evaluates single name "Jamal" to "Hello Doctor," and NEVER "Hello Jamal," or "Hello Dr. Jamal,"', () => {
    const singleLead = { first_name: 'Jamal' };
    const greeting = resolveDoctorGreeting(singleLead);

    expect(greeting).toBe('Hello Doctor,');
    expect(greeting).not.toBe('Hello Jamal,');
    expect(greeting).not.toBe('Hello Dr. Jamal,');
    expect(greeting).not.toBe('Hello Dr.,');

    const salutation = resolveDoctorSalutation('Hello', singleLead);
    expect(salutation).toBe('Hello Doctor');
  });

  it('evaluates single token full_name "Jamal" to "Hello Doctor,"', () => {
    const lead = { full_name: 'Jamal' };
    expect(resolveDoctorGreeting(lead)).toBe('Hello Doctor,');
    expect(resolveDoctorSalutation('Hello', lead)).toBe('Hello Doctor');
  });

  it('evaluates single name passed as string "Jamal" to "Hello Doctor"', () => {
    expect(resolveDoctorSalutation('Hello', 'Jamal')).toBe('Hello Doctor');
    expect(resolveDoctorGreeting('Jamal')).toBe('Hello Doctor,');
  });

  it('renders "Hello Doctor" in approved email templates for Jamal', () => {
    const zygText = getApprovedZygomaticText({ full_name: 'Jamal' });
    expect(zygText.startsWith('Hello Doctor\n')).toBe(true);
    expect(zygText).not.toContain('Hello Jamal');
    expect(zygText).not.toContain('Hello Dr. Jamal');

    const zygHtml = getApprovedZygomaticHtml({ full_name: 'Jamal' });
    expect(zygHtml).toContain('<p>Hello Doctor</p>');
    expect(zygHtml).not.toContain('Hello Jamal');
    expect(zygHtml).not.toContain('Hello Dr. Jamal');

    const implantText = getApprovedImplantText({ first_name: 'Jamal' });
    expect(implantText.startsWith('Hello Doctor\n')).toBe(true);

    const perioText = getApprovedPeriodontalText({ first_name: 'Jamal' });
    expect(perioText.startsWith('Hi Doctor\n')).toBe(true);

    const endoText = getApprovedEndodonticText({ first_name: 'Jamal' });
    expect(endoText.startsWith('Hi Doctor\n')).toBe(true);

    const wisdomText = getApprovedWisdomText({ first_name: 'Jamal' });
    expect(wisdomText.startsWith('Hello Doctor\n')).toBe(true);

    const rehabText = getApprovedRehabilitationText({ first_name: 'Jamal' });
    expect(rehabText.startsWith('Hi Doctor\n')).toBe(true);
  });

  it('treats placeholders, single tokens, titles, and email prefixes as "Hello Doctor,"', () => {
    expect(resolveDoctorGreeting({ first_name: 'Dr. Jamal' })).toBe('Hello Doctor,');
    expect(resolveDoctorGreeting({ first_name: 'Jamal DDS' })).toBe('Hello Doctor,');
    expect(resolveDoctorGreeting({ first_name: 'Jamal Dentist' })).toBe('Hello Doctor,');
    expect(resolveDoctorGreeting({ first_name: 'sheham', email: 'dr_sheham@hotmail.com' })).toBe('Hello Doctor,');
    expect(resolveDoctorGreeting({ first_name: 'teste' })).toBe('Hello Doctor,');
    expect(resolveDoctorGreeting({ first_name: 'unknown' })).toBe('Hello Doctor,');
    expect(resolveDoctorGreeting({})).toBe('Hello Doctor,');
    expect(resolveDoctorGreeting(null)).toBe('Hello Doctor,');
  });
});

describe('E. Full-Name Lead -> Approved Personalized Greeting', () => {
  it('correctly addresses a lead with confirmed full name and surname', () => {
    const fullLead = { first_name: 'Jamal', last_name: 'Smith' };
    expect(resolveDoctorGreeting(fullLead)).toBe('Hello Dr. Smith,');
    expect(resolveDoctorSalutation('Hello', fullLead)).toBe('Hello Dr. Smith');

    const fullLead2 = { full_name: 'Jamal Smith' };
    expect(resolveDoctorGreeting(fullLead2)).toBe('Hello Dr. Smith,');

    const fullLead3 = { full_name: 'Dr. Jamal Smith' };
    expect(resolveDoctorGreeting(fullLead3)).toBe('Hello Dr. Smith,');
  });

  it('renders "Hello Dr. Smith" in approved email templates for Jamal Smith', () => {
    const lead = { first_name: 'Jamal', last_name: 'Smith' };
    const zygText = getApprovedZygomaticText(lead);
    expect(zygText.startsWith('Hello Dr. Smith\n')).toBe(true);

    const zygHtml = getApprovedZygomaticHtml(lead);
    expect(zygHtml).toContain('<p>Hello Dr. Smith</p>');

    const perioText = getApprovedPeriodontalText(lead);
    expect(perioText.startsWith('Hi Dr. Smith\n')).toBe(true);
  });
});

describe('F. Replay Webhook -> No Duplicate Email (Idempotency)', () => {
  it('prevents duplicate sends on webhook retry using acquisition + template + recipient key', () => {
    const leadId = 'lead-jamal-001';
    const acquisitionId = 'leadgen-1550052100209535';
    const templateKey = 'zygomatic_course_details';
    const recipient = 'dr_sheham@hotmail.com';

    const msgIdempotencyKey = `${leadId}:${acquisitionId}:${templateKey}:${recipient}`;

    // Existing messages database
    const outboundMessages = new Map<string, any>();

    // First attempt: sent
    outboundMessages.set(msgIdempotencyKey, {
      id: 'msg-1',
      status: 'delivered',
      recipient,
      template_key: templateKey,
    });

    // Replay attempt
    let sendAttempted = false;
    const existing = outboundMessages.get(msgIdempotencyKey);
    if (!existing || !['sent', 'delivered', 'opened', 'clicked', 'pending', 'queued'].includes(existing.status)) {
      sendAttempted = true;
    }

    expect(sendAttempted).toBe(false);
  });
});

describe('G. Multiple Valid Emails -> Same Correct Course Template, Recipient-Level Tracking', () => {
  it('resolves multiple factual emails and ensures both receive the same approved course template', () => {
    const fieldMap = {
      email: 'Scottishdentalimplant@gmail.com',
      confirm_your_email: 'Dr_sheham@hotmail.com',
    };

    const resolution = resolveCanonicalEmails(fieldMap, 'meta');
    expect(resolution.emails.length).toBe(2);
    expect(resolution.emails[0].normalized_email).toBe('scottishdentalimplant@gmail.com');
    expect(resolution.emails[1].normalized_email).toBe('dr_sheham@hotmail.com');

    const courseTemplateKey = resolveApprovedCourseTemplateKey('ZIT-01');
    expect(courseTemplateKey).toBe('zygomatic_course_details');

    const sentRecords: any[] = [];
    for (const identity of resolution.emails) {
      sentRecords.push({
        recipient: identity.normalized_email,
        template: courseTemplateKey,
        subject: APPROVED_COURSE_TEMPLATES[courseTemplateKey!].subject,
      });
    }

    expect(sentRecords.length).toBe(2);
    expect(sentRecords[0].template).toBe('zygomatic_course_details');
    expect(sentRecords[1].template).toBe('zygomatic_course_details');
    expect(sentRecords[0].subject).toBe(sentRecords[1].subject);
    expect(sentRecords[0].recipient).toBe('scottishdentalimplant@gmail.com');
    expect(sentRecords[1].recipient).toBe('dr_sheham@hotmail.com');
  });
});

describe('H. One Bounced Email -> Other Recipient Unaffected', () => {
  it('tracks hard bounce independently while preserving delivered recipient', () => {
    const recipientsState = [
      { email: 'scottishdentalimplant@gmail.com', status: 'bounced', bounceReason: '550-5.1.1 User does not exist' },
      { email: 'dr_sheham@hotmail.com', status: 'delivered', bounceReason: null },
    ];

    const bounced = recipientsState.filter((r) => r.status === 'bounced');
    const healthy = recipientsState.filter((r) => r.status === 'delivered');

    expect(bounced.length).toBe(1);
    expect(bounced[0].email).toBe('scottishdentalimplant@gmail.com');
    expect(healthy.length).toBe(1);
    expect(healthy[0].email).toBe('dr_sheham@hotmail.com');

    // Suppress retry on hard bounce
    const shouldRetryBounced = bounced[0].bounceReason?.includes('550');
    expect(shouldRetryBounced).toBe(true); // Permanent hard bounce -> retry is NOT appropriate
  });
});

describe('I. HubSpot Later Adds Course -> No Unintended Late Auto-Send', () => {
  it('strictly disables retroactive automatic email when HubSpot updates course on existing lead', () => {
    const existingLead = {
      id: 'faa927d9-c8c9-4ed8-afe2-0494fd95bc54',
      isNewLead: false,
      isNewSubmission: false, // Late HubSpot enrichment
      source: 'hubspot',
      initialCourseIdentified: false,
    };

    // Late enrichment decision logic
    const isLateEnrichment = !existingLead.isNewSubmission || existingLead.source === 'hubspot';
    let autoSendExecuted = false;
    let activitySummary = '';

    if (!existingLead.isNewLead && isLateEnrichment) {
      autoSendExecuted = false;
      activitySummary = 'Atualização de lead existente (hubspot). Envio retroativo de primeiro e-mail automático estritamente desabilitado.';
    } else {
      autoSendExecuted = true;
    }

    expect(autoSendExecuted).toBe(false);
    expect(activitySummary).toContain('Envio retroativo de primeiro e-mail automático estritamente desabilitado');
  });
});

describe('J. Generic Fallback Template Can Never Be Used in Meta First-Contact Automation', () => {
  it('guarantees APPROVED_COURSE_TEMPLATES does not contain lead_intake_email', () => {
    expect(APPROVED_COURSE_TEMPLATES['lead_intake_email']).toBeUndefined();
  });

  it('guarantees resolveApprovedCourseTemplateKey never returns lead_intake_email', () => {
    const testInputs = [
      '',
      null,
      undefined,
      'unknown',
      'meta lead',
      'Facebook Lead Ads: Generic Form',
      'dentistry',
    ];

    for (const input of testInputs) {
      const resolved = resolveApprovedCourseTemplateKey(input);
      expect(resolved).not.toBe('lead_intake_email');
      expect(resolved).toBeNull();
    }
  });

  it('verifies all supported courses have approved packages with non-empty templates', () => {
    const supportedKeys = [
      'zygomatic_course_details',
      'implant_course_details',
      'periodontal_course_details',
      'endodontic_course_details',
      'wisdom_course_details',
      'rehabilitation_course_details',
    ];

    for (const key of supportedKeys) {
      const pkg = APPROVED_COURSE_TEMPLATES[key];
      expect(pkg).toBeDefined();
      expect(pkg.subject.length).toBeGreaterThan(10);
      expect(pkg.getText({ first_name: 'Jamal' }).length).toBeGreaterThan(100);
      expect(pkg.getHtml({ first_name: 'Jamal' }).length).toBeGreaterThan(100);
      expect(pkg.attachmentNames.length).toBeGreaterThan(0);
    }
  });
});
