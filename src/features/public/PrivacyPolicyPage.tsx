import { Link } from 'react-router-dom';
import edsLogo from '../../assets/eds-logo.png';
import { ShieldCheck, ExternalLink, Lock } from 'lucide-react';

export function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col justify-between">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 py-4 px-6 sticky top-0 z-20 shadow-sm">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <a
            href="https://expdentalsolutions.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 transition-opacity hover:opacity-90"
          >
            <img
              src={edsLogo}
              alt="Expert Dental Solutions"
              className="h-10 w-auto object-contain"
            />
          </a>
          <div className="flex items-center gap-4 text-xs font-medium text-slate-500">
            <span className="hidden sm:inline">EDS Hub Leads</span>
            <span className="inline-flex items-center gap-1 text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
              <ShieldCheck className="w-3.5 h-3.5" />
              Verified App
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-6 py-10 sm:py-14">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-12">
          {/* Title Area */}
          <div className="border-b border-slate-100 pb-6 mb-8">
            <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#08254f] bg-blue-50 px-3 py-1 rounded-md mb-3">
              <Lock className="w-3.5 h-3.5" />
              Privacy &amp; Data Protection
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
              Privacy Policy
            </h1>
            <p className="text-sm text-slate-500 mt-2">
              Last updated: October 1, 2026
            </p>
          </div>

          {/* Document Body */}
          <div className="space-y-6 text-slate-700 text-sm sm:text-base leading-relaxed">
            <p>
              This Privacy Policy explains how <strong>EXPERT DENTAL SOLUTIONS LLC</strong> (&quot;Expert Dental Solutions&quot;, &quot;we&quot;, &quot;us&quot;, or &quot;our&quot;) collects, uses, processes, stores, and safeguards personal information through <strong>EDS Hub Leads</strong> (and EDS Hub), our internal lead management and customer relationship management application.
            </p>

            <p>
              We are committed to respecting your privacy and protecting the information you provide when interacting with our educational courses, clinical training programs, advertisements, and communication channels.
            </p>

            {/* Information We Collect */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 my-6">
              <h2 className="text-base sm:text-lg font-semibold text-slate-900 mb-3">
                1. Information We Collect and Sources
              </h2>
              <p className="text-slate-700 mb-3">
                EDS Hub Leads receives and processes business and contact information from individuals who voluntarily express interest in our programs or services. We may collect information through the following sources:
              </p>
              <ul className="list-disc list-inside space-y-1.5 text-slate-700 pl-1 mb-4">
                <li>Meta Lead Ads (Facebook and Instagram lead ads);</li>
                <li>Facebook and Instagram lead forms and direct inquiries;</li>
                <li>Website contact and registration forms;</li>
                <li>HubSpot CRM integrations;</li>
                <li>Customer communications via email, telephone, SMS, or messaging applications.</li>
              </ul>
              <p className="text-slate-700 mb-2">
                Typical data collected may include:
              </p>
              <ul className="list-disc list-inside space-y-1 text-slate-700 pl-1">
                <li><strong>Full name:</strong> to identify and address you;</li>
                <li><strong>Email address:</strong> for course information and follow-up communications;</li>
                <li><strong>Phone number:</strong> for phone and SMS follow-up regarding your inquiries;</li>
                <li><strong>Course interest:</strong> specific clinical training or educational programs of interest;</li>
                <li><strong>Preferred contact method:</strong> communication preferences specified by you;</li>
                <li><strong>Form responses:</strong> answers provided on intake, contact, or registration forms;</li>
                <li><strong>Interaction history:</strong> records of customer service notes, consultations, and requests;</li>
                <li><strong>Communication history:</strong> records of emails, calls, or SMS exchanges;</li>
                <li><strong>Lead source and metadata:</strong> campaign, form, and timestamp information.</li>
              </ul>
            </div>

            {/* Purposes of Processing */}
            <div className="space-y-3">
              <h2 className="text-base sm:text-lg font-semibold text-slate-900">
                2. Purposes of Data Processing
              </h2>
              <p>
                We process your personal information exclusively for legitimate business and customer relationship management purposes, including:
              </p>
              <ul className="list-disc list-inside space-y-1.5 text-slate-700 pl-1">
                <li>Responding to your inquiries and consultation requests;</li>
                <li>Managing leads and organizing prospective student records;</li>
                <li>Providing requested course information, curriculum details, schedules, and tuition;</li>
                <li>Customer relationship management and ongoing operational support;</li>
                <li>Follow-up communications regarding expressed educational interests;</li>
                <li>Enrollment support, document verification, and registration assistance;</li>
                <li>Operational communications such as scheduling confirmations and administrative notices;</li>
                <li>Analytics and service improvement to enhance our training programs and customer experience.</li>
              </ul>
            </div>

            {/* Non-Sale Callout */}
            <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-xl text-emerald-950 font-medium">
              We do not sell personal data to advertisers, data brokers, or any other third parties. Personal information is processed solely for legitimate business and customer relationship purposes.
            </div>

            {/* Meta/Facebook Data Section */}
            <div className="space-y-3">
              <h2 className="text-base sm:text-lg font-semibold text-slate-900">
                3. Meta / Facebook Data
              </h2>
              <p>
                When you submit your contact details through a Meta Lead Ad or Facebook/Instagram lead form connected to Expert Dental Solutions, that information is ingested directly into EDS Hub Leads for the sole purpose of responding to your inquiry about our clinical courses and services.
              </p>
              <p>
                We handle all Meta lead data in full compliance with Meta&apos;s Platform Terms and Developer Policies. Meta lead information is never shared with unauthorized third parties or used for purposes other than responding to your inquiry and facilitating your customer relationship with Expert Dental Solutions.
              </p>
            </div>

            {/* Third-Party Service Providers */}
            <div className="space-y-3">
              <h2 className="text-base sm:text-lg font-semibold text-slate-900">
                4. Third-Party Service Providers
              </h2>
              <p>
                Access to EDS Hub Leads is strictly restricted to authorized users and trusted service providers necessary to operate our platform and deliver services to you. These providers may include secure cloud database infrastructure providers (Supabase), CRM systems (HubSpot), and transactional communication services (Resend).
              </p>
              <p>
                All service providers are bound by confidentiality obligations and are only permitted to process data on our behalf in accordance with our instructions and applicable privacy laws.
              </p>
            </div>

            {/* Data Retention */}
            <div className="space-y-3">
              <h2 className="text-base sm:text-lg font-semibold text-slate-900">
                5. Data Retention
              </h2>
              <p>
                We retain personal data only for as long as necessary to fulfill the legitimate business purposes outlined in this Privacy Policy, provide requested educational support, comply with legal and regulatory obligations, resolve disputes, and maintain accurate business records. When personal information is no longer needed, it is securely deleted or anonymized.
              </p>
            </div>

            {/* Data Security */}
            <div className="space-y-3">
              <h2 className="text-base sm:text-lg font-semibold text-slate-900">
                6. Data Security
              </h2>
              <p>
                We implement reasonable technical and organizational safeguards designed to protect your personal information against unauthorized access, loss, misuse, alteration, or disclosure. These safeguards include encrypted data transmission (HTTPS/TLS), role-based access restrictions, authenticated access controls, and secure database hosting environments.
              </p>
            </div>

            {/* User Rights */}
            <div className="space-y-3">
              <h2 className="text-base sm:text-lg font-semibold text-slate-900">
                7. User Rights
              </h2>
              <p>
                You have the right to request access to the personal data we hold about you, request corrections to any inaccurate or incomplete information, or request the deletion of your personal data from our systems.
              </p>
            </div>

            {/* Data Deletion */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
              <h2 className="text-base sm:text-lg font-semibold text-slate-900 mb-2">
                8. Data Deletion
              </h2>
              <p className="text-slate-700 mb-3">
                Users may request deletion of their personal data at any time. For full instructions on how to submit a deletion request and what information to provide, please visit our dedicated page:
              </p>
              <Link
                to="/data-deletion"
                className="inline-flex items-center gap-1.5 text-[#08254f] font-semibold hover:text-[#449bd5] underline transition-colors"
              >
                Data Deletion Instructions (/data-deletion)
              </Link>
            </div>

            {/* Terms of Service Link */}
            <div className="space-y-2">
              <h2 className="text-base sm:text-lg font-semibold text-slate-900">
                9. Terms of Service
              </h2>
              <p>
                Your use of our forms and related services is also governed by our{' '}
                <Link
                  to="/terms-of-service"
                  className="text-[#08254f] font-semibold hover:text-[#449bd5] underline transition-colors"
                >
                  Terms of Service
                </Link>
                .
              </p>
            </div>

            {/* Changes to this Policy */}
            <div className="space-y-2">
              <h2 className="text-base sm:text-lg font-semibold text-slate-900">
                10. Changes to This Policy
              </h2>
              <p>
                Expert Dental Solutions may update this Privacy Policy from time to time. Any changes will be published directly on this page with an updated &quot;Last updated&quot; date.
              </p>
            </div>

            {/* Contact Information */}
            <div className="pt-6 border-t border-slate-100 mt-8">
              <h2 className="text-base sm:text-lg font-semibold text-slate-900 mb-2">
                11. Contact Information
              </h2>
              <p className="text-slate-600">
                For questions regarding this Privacy Policy, your personal data, or our data practices, please contact Expert Dental Solutions through the official contact information available on:
              </p>
              <a
                href="https://expdentalsolutions.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[#08254f] font-semibold hover:text-[#449bd5] mt-2 underline transition-colors"
              >
                https://expdentalsolutions.com
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-6 px-6 text-center text-xs text-slate-500">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <p>© 2026 Expert Dental Solutions. All rights reserved.</p>
          <div className="flex items-center gap-6">
            <Link
              to="/terms-of-service"
              className="text-slate-500 hover:text-slate-700 hover:underline"
            >
              Terms of Service
            </Link>
            <Link
              to="/privacy-policy"
              className="text-slate-700 font-medium hover:underline"
            >
              Privacy Policy
            </Link>
            <Link
              to="/data-deletion"
              className="text-slate-500 hover:text-slate-700 hover:underline"
            >
              Data Deletion
            </Link>
            <a
              href="https://expdentalsolutions.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-500 hover:text-slate-700 hover:underline"
            >
              Official Website
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
