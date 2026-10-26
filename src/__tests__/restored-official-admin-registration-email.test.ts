import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Restored Official Website Admin Registration Email Audit', () => {
  const bladePath = path.resolve(__dirname, '../../website-integration-package/registration-admin.blade.php');
  const mailablePath = path.resolve(__dirname, '../../website-integration-package/RegistrationReceivedAdminMail.php');

  const bladeContent = fs.readFileSync(bladePath, 'utf8');
  const mailableContent = fs.readFileSync(mailablePath, 'utf8');

  // ===========================================================================
  // 1. LANGUAGE & BRANDING AUDIT (STRICT ENGLISH)
  // ===========================================================================
  describe('Official Language & Branding Integrity', () => {
    it('is strictly written in English with lang="en"', () => {
      expect(bladeContent).toContain('<html lang="en">');
      expect(bladeContent).toContain('New Course Registration');
      expect(bladeContent).toContain('Official Admin Record');
      expect(bladeContent).toContain('Expert Dental Solutions');
    });

    it('contains ZERO Portuguese operational CRM text', () => {
      // Must not contain operational Portuguese phrases that were in the accidental replacement
      expect(bladeContent).not.toContain('Nova matrícula concluída');
      expect(bladeContent).not.toContain('Dados do Aluno');
      expect(bladeContent).not.toContain('Dados Profissionais');
      expect(bladeContent).not.toContain('Informações Adicionais');
      expect(bladeContent).not.toContain('Inscrição finalizada com sucesso');
      expect(bladeContent).not.toContain('Não informado');
      expect(bladeContent).not.toContain('Não informada');
    });
  });

  // ===========================================================================
  // 2. FULL REGISTRATION DATA COVERAGE
  // ===========================================================================
  describe('Full Registration Form Data Fields', () => {
    it('contains all personal information fields', () => {
      expect(bladeContent).toContain('Full Name');
      expect(bladeContent).toContain('$registration->name');
      expect(bladeContent).toContain('Email Address');
      expect(bladeContent).toContain('$registration->email');
      expect(bladeContent).toContain('Mobile Phone');
      expect(bladeContent).toContain('$registration->phone');
      expect(bladeContent).toContain('Name for Certificate');
      expect(bladeContent).toContain('$registration->certificate_name');
      expect(bladeContent).toContain('AGD Number');
      expect(bladeContent).toContain('$registration->agd_number');
    });

    it('contains all emergency contact & medical fields', () => {
      expect(bladeContent).toContain('Emergency Contact');
      expect(bladeContent).toContain('Emergency Contact Phone');
      expect(bladeContent).toContain('$registration->emergency_phone');
      expect(bladeContent).toContain('Medical Conditions');
      expect(bladeContent).toContain('$registration->medical_conditions');
    });

    it('contains all professional details fields', () => {
      expect(bladeContent).toContain('Professional Details');
      expect(bladeContent).toContain('Specialty');
      expect(bladeContent).toContain('$registration->specialty');
      expect(bladeContent).toContain('Years in Practice');
      expect(bladeContent).toContain('$registration->years_in_practice');
      expect(bladeContent).toContain('Surgical Experience');
      expect(bladeContent).toContain('$registration->surgical_experience');
    });

    it('contains all additional information fields', () => {
      expect(bladeContent).toContain('Additional Information');
      expect(bladeContent).toContain('White Coat Size');
      expect(bladeContent).toContain('$registration->coat_size');
      expect(bladeContent).toContain('Dietary Restrictions');
      expect(bladeContent).toContain('$registration->dietary');
      expect(bladeContent).toContain('How Did You Hear About Us');
      expect(bladeContent).toContain('$registration->heard_from');
      expect(bladeContent).toContain('Referral Name');
      expect(bladeContent).toContain('$registration->referral_name');
    });

    it('contains course, tuition, and promo code fields', () => {
      expect(bladeContent).toContain('Courses and Tuition');
      expect(bladeContent).toContain('Selected Course');
      expect(bladeContent).toContain('$registration->course');
      expect(bladeContent).toContain('Promo Code');
      expect(bladeContent).toContain('$registration->promo_code');
    });

    it('contains digital signature and date fields', () => {
      expect(bladeContent).toContain('Signature &amp; Verification');
      expect(bladeContent).toContain('Digital Signature');
      expect(bladeContent).toContain('$registration->signature');
      expect(bladeContent).toContain('Date of Signature');
      expect(bladeContent).toContain('$registration->date');
    });
  });

  // ===========================================================================
  // 3. TERMS AND CONDITIONS & CONFIRMATION
  // ===========================================================================
  describe('Terms and Conditions & Registrant Confirmation', () => {
    it('contains all 6 factual Terms and Conditions clauses', () => {
      expect(bladeContent).toContain('I understand that travel to and from Brazil is my responsibility.');
      expect(bladeContent).toContain('transportation between the airport and the hotel');
      expect(bladeContent).toContain('four-star hotel with breakfast is provided');
      expect(bladeContent).toContain('depending on my nationality, I may need a visa.');
      expect(bladeContent).toContain('travel health insurance is highly recommended.');
      expect(bladeContent).toContain('Refunds are available for cancellations made 45 days prior to the course.');
      expect(bladeContent).toContain('administrative fee of $1,200');
    });

    it('contains the exact official Registrant Confirmation text', () => {
      expect(bladeContent).toContain('Registrant Confirmation');
      expect(bladeContent).toContain('I confirm that I have read, understand, and agree to the Terms and Conditions of the course, including the cancellation and refund policy.');
      expect(bladeContent).toContain('Accepted &amp; Confirmed by Registrant');
    });
  });

  // ===========================================================================
  // 4. ATTACHMENTS & RECIPIENT RESOLUTION
  // ===========================================================================
  describe('Physical File Attachments & Admin Recipient', () => {
    it('explicitly lists Attached Passport and Attached Dental License in the template', () => {
      expect(bladeContent).toContain('Attached Passport');
      expect(bladeContent).toContain('Attached Dental License');
      expect(bladeContent).toContain('Attached to this email');
      expect(bladeContent).toContain('$registration->passport_path');
      expect(bladeContent).toContain('$registration->license_path');
    });

    it('directs the official administrative copy to info@expdentalsolutions.com', () => {
      expect(bladeContent).toContain('info@expdentalsolutions.com');
    });
  });

  // ===========================================================================
  // 5. LARAVEL MAILABLE CLASS AUDIT
  // ===========================================================================
  describe('RegistrationReceivedAdminMail Mailable Class', () => {
    it('restores the canonical English official subject in envelope()', () => {
      expect(mailableContent).toContain("New Course Registration");
      expect(mailableContent).not.toContain("[EDS] Nova matrícula concluída");
    });

    it('points content() to emails.registration-admin view', () => {
      expect(mailableContent).toContain("view: 'emails.registration-admin'");
    });

    it('preserves attachments() from controller array and public storage disk without Supabase redirection', () => {
      expect(mailableContent).toContain("Attachment::fromPath($file)");
      expect(mailableContent).toContain("storage_path('app/public/' . $this->registration->passport_path)");
      expect(mailableContent).toContain("Passport_");
      expect(mailableContent).toContain("Dental_License_");
    });

    it('passes $registration, $termsList, and $confirmationText to the view', () => {
      expect(mailableContent).toMatch(/'registration'\s*=>\s*\$this->registration/);
      expect(mailableContent).toMatch(/'termsList'\s*=>\s*\$this->termsList/);
      expect(mailableContent).toMatch(/'confirmationText'\s*=>\s*\$this->confirmationText/);
    });

    it('configures Reply-To header to the registrant validated email without changing sender or admin recipient', () => {
      // 1. Checks Address import
      expect(mailableContent).toContain('use Illuminate\\Mail\\Mailables\\Address;');

      // 2. Checks replyTo parameter in Envelope
      expect(mailableContent).toContain('replyTo: $replyTo');

      // 3. Validates email using filter_var
      expect(mailableContent).toContain('filter_var($studentEmail, FILTER_VALIDATE_EMAIL)');

      // 4. Resolves from registration model
      expect(mailableContent).toContain('$this->registration->email');

      // 5. Does NOT add student as direct To recipient or CC/BCC
      expect(mailableContent).not.toContain("to: $this->registration->email");
      expect(mailableContent).not.toContain("cc: $this->registration->email");
      expect(mailableContent).not.toContain("bcc: $this->registration->email");
    });
  });
});
