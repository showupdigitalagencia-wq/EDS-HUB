import { describe, it, expect } from 'vitest';
import {
  APPROVED_COURSE_TEMPLATES,
  resolveDoctorSalutation,
  getApprovedZygomaticText,
  getApprovedZygomaticHtml,
  getApprovedPeriodontalText,
  getApprovedPeriodontalHtml,
  getApprovedEndodonticText,
  getApprovedEndodonticHtml,
  getApprovedImplantText,
  getApprovedImplantHtml,
  getApprovedWisdomText,
  getApprovedWisdomHtml,
  getApprovedRehabilitationText,
  getApprovedRehabilitationHtml,
} from '../utils/salutation';
import { getLeadCanonicalTimestamp, compareLeadsNewestFirst } from '../lib/lead-sorting';
import type { Lead } from '../types/database';

describe('Approved Email Templates Suite', () => {
  // 1. Salutation Resolution Rules
  describe('1. Salutation Resolution Rules', () => {
    it('uses "Hi Dr. [SURNAME]" with valid surname and "Hi Doctor" with missing/empty surname', () => {
      expect(resolveDoctorSalutation('Hi', 'Silva')).toBe('Hi Dr. Silva');
      expect(resolveDoctorSalutation('Hi', '')).toBe('Hi Doctor');
      expect(resolveDoctorSalutation('Hi', null)).toBe('Hi Doctor');
      expect(resolveDoctorSalutation('Hi', 'null')).toBe('Hi Doctor');
      expect(resolveDoctorSalutation('Hi', 'undefined')).toBe('Hi Doctor');
    });

    it('uses "Hello Dr. [SURNAME]" with valid surname and "Hello Doctor" with missing/empty surname', () => {
      expect(resolveDoctorSalutation('Hello', 'Smith')).toBe('Hello Dr. Smith');
      expect(resolveDoctorSalutation('Hello', '')).toBe('Hello Doctor');
      expect(resolveDoctorSalutation('Hello', null)).toBe('Hello Doctor');
      expect(resolveDoctorSalutation('Hello', 'null')).toBe('Hello Doctor');
      expect(resolveDoctorSalutation('Hello', 'undefined')).toBe('Hello Doctor');
    });

    it('never renders "Hi Dr.", "Hello Dr.", "Dr. null", or first name only', () => {
      const invalid = [null, undefined, '', '   ', 'null', 'undefined'];
      for (const val of invalid) {
        const salHi = resolveDoctorSalutation('Hi', val as any);
        const salHello = resolveDoctorSalutation('Hello', val as any);
        expect(salHi).toBe('Hi Doctor');
        expect(salHello).toBe('Hello Doctor');
        expect(salHi).not.toMatch(/^Hi Dr\.\s*$/);
        expect(salHello).not.toMatch(/^Hello Dr\.\s*$/);
      }
    });
  });

  // 2. Periodontal Plastic Template
  describe('2. Periodontal Plastic Template', () => {
    const tpl = APPROVED_COURSE_TEMPLATES['periodontal_course_details'];

    it('has exact display name and subject', () => {
      expect(tpl.displayName).toBe('Periodontal Plastic');
      expect(tpl.subject).toBe('Periodontal Plastic Course Details – Hands-On Training in Rio');
    });

    it('has exact single PDF attachment', () => {
      expect(tpl.attachmentNames).toEqual(['_Perio and Peri-implant Plastic Surgery.pdf']);
    });

    it('contains exact approved body text and bold formatting', () => {
      const text = getApprovedPeriodontalText('Mourao');
      expect(text).toContain('Hi Dr. Mourao');
      expect(text).toContain('Thank you for your interest in our courses!');
      expect(text).toContain('UPCOMING 2026 DATE\n\nNovember 7 to 10 2026 | Rio de Janeiro\n\nTUITION: $9,900');
      expect(text).toContain('UPCOMING 2027 DATE\n\nMarch 1 to 4, 2027 | Rio de Janeiro\n\nTUITION: $9,900');
      expect(text).toContain('Early Bird: $400 OFF\n\nAvailable for the March course through December 31, 2026.');
      expect(text).toContain('Our course offer 36 CE credits.');
      expect(text).toContain('We also offer flexible interest-free payment plans options.');

      const html = getApprovedPeriodontalHtml('Mourao');
      expect(html).toContain('<b>Periodontal Plastic Surgery Intensive Training</b>');
      expect(html).toContain('<b>UPCOMING 2026 DATE</b>');
      expect(html).toContain('<b>TUITION: $9,900</b>');
      expect(html).toContain('<b>UPCOMING 2027 DATE</b>');
      expect(html).toContain('<b>Early Bird: $400 OFF</b>');
      expect(html).toContain('<b>Our course fee includes:</b>');
      expect(html).toContain('<b>Our course offer 36 CE credits.</b>');
      expect(html).toContain('<b>flexible interest-free payment plans options.</b>');
    });
  });

  // 3. Endodontics Template
  describe('3. Endodontics Template', () => {
    const tpl = APPROVED_COURSE_TEMPLATES['endodontic_course_details'];

    it('has exact display name and subject', () => {
      expect(tpl.displayName).toBe('Endodontics');
      expect(tpl.subject).toBe('Endodontics Course Details, Hands-On Training in Rio');
    });

    it('has exact single PDF attachment', () => {
      expect(tpl.attachmentNames).toEqual(['Endodontics course.pdf']);
    });

    it('contains exact approved body text, emojis, and bold formatting', () => {
      const text = getApprovedEndodonticText('Santos');
      expect(text).toContain('Hi Dr. Santos');
      expect(text).toContain('Thank you for your interest in our Endodontics Intensive Clinical Training.');
      expect(text).toContain('📅 Upcoming Date\n\nApril 26-29, 2027');
      expect(text).toContain('💳 Tuition: USD 9,600');
      expect(text).toContain('🎯 Early bird: USD 500 off if registered by\n\nNovember 30');
      expect(text).toContain('• 35 CE credits PACE approved');

      const html = getApprovedEndodonticHtml('Santos');
      expect(html).toContain('<b>live patients with expert mentorship</b>');
      expect(html).toContain('What makes this training <b>unique</b>:');
      expect(html).toContain('<b>Real patient</b> treatment during all 4 days of the course');
      expect(html).toContain('Direct <b>one-on-one mentorship</b> during your procedures');
      expect(html).toContain('<b>Customized clinical cases</b> selected according to your experience level');
      expect(html).toContain('<b>Highly exclusive program</b> – limited to 8 doctors.');
      expect(html).toContain('Over <b>4 intensive days</b> in Rio de Janeiro');
      expect(html).toContain('<b>The experience also includes:</b>');
      expect(html).toContain('• <b>35 CE credits PACE approved</b>');
      expect(html).toContain('<b>flexible interest-free payment plans options.</b>');
      expect(html).toContain('<b>call with our course coordinator</b>');
      expect(html).toContain('📅');
      expect(html).toContain('💳');
      expect(html).toContain('🎯');
    });
  });

  // 4. Intensive + Advanced Implant Shared Template
  describe('4. Intensive + Advanced Implant Shared Template', () => {
    const tpl = APPROVED_COURSE_TEMPLATES['implant_course_details'];

    it('has exact display name and subject', () => {
      expect(tpl.displayName).toBe('Intensive + Advanced Implant');
      expect(tpl.subject).toBe('Implant Course Details – Hands-On Training');
    });

    it('ALWAYS attaches BOTH PDFs on every send', () => {
      expect(tpl.attachmentNames).toEqual([
        'Intensive implant .pdf',
        'Advanced implant course (1).pdf',
      ]);
    });

    it('contains exact combined text and bold formatting for both courses', () => {
      const text = getApprovedImplantText('Almeida');
      expect(text).toContain('Hello Dr. Almeida');
      expect(text).toContain('INTENSIVE DENTAL IMPLANT COURSE');
      expect(text).toContain('ADVANCED IMPLANT EXPERIENCE');
      expect(text).toContain('100% CUSTOMIZED EXPERIENCE');
      expect(text).toContain('REAL PATIENT ONE-ON-ONE MENTORSHIP');
      expect(text).toContain('MENTORSHIP DOESN’T END WHEN THE COURSE ENDS');
      expect(text).toContain('UPCOMING 2026 DATE\n\nNovember 11 to 14, 2026 | Rio de Janeiro');
      expect(text).toContain('Intensive Dental Implant Course: $9,400\n\nAdvanced Implant Experience: $9,900');
      expect(text).toContain('UPCOMING 2027 DATE\n\nFebruary 24 to 27, 2027 | Rio de Janeiro');
      expect(text).toContain('Intensive Dental Implant Course: $9,700\n\nAdvanced Implant Experience: $10,200');
      expect(text).toContain('Early Bird: $600 OFF');

      const html = getApprovedImplantHtml('Almeida');
      expect(html).toContain('<b>Real Patient Surgeries, One-on-One Mentorship, and training that is 100% customized to your goals and experience level.</b>');
      expect(html).toContain('<b>INTENSIVE DENTAL IMPLANT COURSE</b>');
      expect(html).toContain('<b>ADVANCED IMPLANT EXPERIENCE</b>');
      expect(html).toContain('<b>100% CUSTOMIZED EXPERIENCE</b>');
      expect(html).toContain('<b>REAL PATIENT ONE-ON-ONE MENTORSHIP</b>');
      expect(html).toContain('<b>MENTORSHIP DOESN’T END WHEN THE COURSE ENDS</b>');
      expect(html).toContain('<b>UPCOMING 2026 DATE</b>');
      expect(html).toContain('<b>TUITION</b>');
      expect(html).toContain('<b>UPCOMING 2027 DATE</b>');
      expect(html).toContain('<b>Early Bird: $600 OFF</b>');
      expect(html).toContain('<b>YOUR COURSE PACKAGE INCLUDES</b>');
      expect(html).toContain('<b>at least 20 implants on real patients</b>');
      expect(html).toContain('<b>main surgeon from start to finish</b>');
      expect(html).toContain('<b>complex surgeries on real patients</b>');
      expect(html).toContain('<b>100% customized to your clinical goals</b>');
      expect(html).toContain('<b>You are the main surgeon for your cases</b>');
      expect(html).toContain('<b>6 participants per course</b>');
      expect(html).toContain('<b>$9,400</b>');
      expect(html).toContain('<b>$9,900</b>');
      expect(html).toContain('<b>$9,700</b>');
      expect(html).toContain('<b>$10,200</b>');
      expect(html).toContain('<b>flexible interest-free payment plans.</b>');
    });
  });

  // 5. Wisdom Template
  describe('5. Wisdom Surgery Template', () => {
    const tpl = APPROVED_COURSE_TEMPLATES['wisdom_course_details'];

    it('has exact display name and subject', () => {
      expect(tpl.displayName).toBe('Wisdom');
      expect(tpl.subject).toBe('Wisdom Surgery Details – Hands-On Training in Rio');
    });

    it('has exact single PDF attachment', () => {
      expect(tpl.attachmentNames).toEqual(['Third molar course.pdf']);
    });

    it('contains exact approved body text and bold formatting', () => {
      const text = getApprovedWisdomText('Costa');
      expect(text).toContain('Hello Dr. Costa');
      expect(text).toContain('Thank you for your interest in our Wisdom Teeth Extraction Course in Rio de Janeiro, Brazil!');
      expect(text).toContain('REAL PATIENT SURGERIES | YOU ARE THE MAIN SURGEON');
      expect(text).toContain('NEXT COURSES\n\nNovember 7–10, 2026\n\nMarch 1-4, 2027');
      expect(text).toContain('TUITION\n\nUSD 8,200');
      expect(text).toContain('YOUR COURSE PACKAGE INCLUDES');
      expect(text).toContain('We also offer flexible, interest-free payment plan options.');

      const html = getApprovedWisdomHtml('Costa');
      expect(html).toContain('<b>Wisdom Teeth Extraction Course in Rio de Janeiro, Brazil!</b>');
      expect(html).toContain('<b>4-day intensive clinical course with real patients</b>');
      expect(html).toContain('<b>one-on-one mentorship throughout the entire course.</b>');
      expect(html).toContain('<b>REAL PATIENT SURGERIES | YOU ARE THE MAIN SURGEON</b>');
      expect(html).toContain('<b>Perform at least 16 wisdom teeth extractions on real patients</b>');
      expect(html).toContain('<b>fully impacted, partially impacted, and erupted wisdom teeth</b>');
      expect(html).toContain('<b>main surgeon from start to finish</b>');
      expect(html).toContain('<b>one-on-one mentorship</b>');
      expect(html).toContain('<b>assisting you while you perform the extraction</b>');
      expect(html).toContain('<b>customized to your experience level and clinical goals</b>');
      expect(html).toContain('<b>100% CUSTOMIZED TO YOUR GOALS</b>');
      expect(html).toContain('<b>Zoom meeting with our coordinators</b>');
      expect(html).toContain('<b>Federal University in Rio de Janeiro, Brazil</b>');
      expect(html).toContain('<b>6 doctors per session</b>');
      expect(html).toContain('<b>MENTORSHIP DOESN’T END WHEN THE COURSE ENDS</b>');
      expect(html).toContain('<b>NEXT COURSES</b>');
      expect(html).toContain('<b>November 7–10, 2026</b>');
      expect(html).toContain('<b>March 1-4, 2027</b>');
      expect(html).toContain('<b>TUITION</b>');
      expect(html).toContain('<b>USD 8,200</b>');
      expect(html).toContain('• <b>36 PACE-approved CE credits</b>');
      expect(html).toContain('<b>flexible, interest-free payment plan options.</b>');
      expect(html).toContain('<b>Expert Dental Solutions</b>');
    });
  });

  // 6. Rehabilitation Template
  describe('6. Rehabilitation Template', () => {
    const tpl = APPROVED_COURSE_TEMPLATES['rehabilitation_course_details'];

    it('has exact display name and subject', () => {
      expect(tpl.displayName).toBe('Rehabilitation');
      expect(tpl.subject).toBe('Implant Rehabilitation Course Details – Hands-On Training');
    });

    it('has exact single PDF attachment', () => {
      expect(tpl.attachmentNames).toEqual(['Oral Rehabilitation Course.pdf']);
    });

    it('preserves minimal bold formatting (does not over-bold)', () => {
      const text = getApprovedRehabilitationText('Barbosa');
      expect(text).toContain('Hi Dr. Barbosa');
      expect(text).toContain('Our Advanced Implant Rehabilitation Experience is a four-day live-patient course');
      expect(text).toContain('Upcoming Course Date:\n\n• November 7 to 10, 2026, Rio de Janeiro');
      expect(text).toContain('Tuition:\n\n• USD 9,600');
      expect(text).toContain('Our course offers 36 CE Credits and is PACE Approved.');

      const html = getApprovedRehabilitationHtml('Barbosa');
      expect(html).toContain('<b>Advanced Implant Rehabilitation Experience</b>');
      expect(html).toContain('Our course offers <b>36 CE Credits</b> and is <b>PACE Approved.</b>');
      // Verify headings are NOT artificially bolded
      expect(html).not.toContain('<b>Upcoming Course Date:</b>');
      expect(html).not.toContain('<b>Tuition:</b>');
    });
  });

  // 7. Zygomatic Template Preserved Exactly
  describe('7. Zygomatic Approved Template', () => {
    const tpl = APPROVED_COURSE_TEMPLATES['zygomatic_course_details'];

    it('preserves existing approved attachment and subject', () => {
      expect(tpl.displayName).toBe('Zygomatic Course Details');
      expect(tpl.subject).toBe('Zygomatic Course Details – Hands-On Training in Rio');
      expect(tpl.attachmentNames).toEqual(['Zygomatic Course (2).pdf']);
    });

    it('preserves exact date and tuition in body text and html', () => {
      const text = getApprovedZygomaticText('Mourao');
      expect(text).toContain('Hello Dr. Mourao');
      expect(text).toContain('November 7-10, 2026');
      expect(text).toContain('$17,500');

      const html = getApprovedZygomaticHtml('Mourao');
      expect(html).toContain('Hello Dr. Mourao');
      expect(html).toContain('November 7-10, 2026');
      expect(html).toContain('$17,500');
    });
  });

  // 8. Returning Lead Resurfacing & Ordering
  describe('8. Returning Lead Resurfacing & Ordering', () => {
    it('prioritizes last_inbound_activity_at over created_at to resurface returning leads to the top of their pipeline stage', () => {
      const olderLead: Partial<Lead> = {
        id: 'lead-1',
        created_at: '2026-01-01T00:00:00Z',
        last_inbound_activity_at: '2026-09-29T12:00:00Z', // returned today
      };

      const newerLead: Partial<Lead> = {
        id: 'lead-2',
        created_at: '2026-09-28T10:00:00Z', // created yesterday
        last_inbound_activity_at: null,
      };

      const tsOlder = getLeadCanonicalTimestamp(olderLead as Lead);
      const tsNewer = getLeadCanonicalTimestamp(newerLead as Lead);

      expect(tsOlder).toBeGreaterThan(tsNewer);

      // Verify comparator sorts returning lead FIRST
      const sortResult = compareLeadsNewestFirst(olderLead as Lead, newerLead as Lead);
      expect(sortResult).toBeLessThan(0); // olderLead comes before newerLead
    });

    it('falls back to created_at when last_inbound_activity_at is null', () => {
      const lead: Partial<Lead> = {
        created_at: '2026-05-10T15:00:00Z',
        last_inbound_activity_at: null,
      };
      expect(getLeadCanonicalTimestamp(lead as Lead)).toBe(new Date('2026-05-10T15:00:00Z').getTime());
    });
  });
});
