import { Link } from 'react-router-dom';
import edsLogo from '../../assets/eds-logo.png';
import { ShieldCheck, ExternalLink, FileText } from 'lucide-react';

export function TermsOfServicePage() {
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
              <FileText className="w-3.5 h-3.5" />
              Legal Documentation
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
              Terms of Service
            </h1>
            <p className="text-sm text-slate-500 mt-2">
              Last updated: October 1, 2026
            </p>
          </div>

          {/* Document Body */}
          <div className="space-y-6 text-slate-700 text-sm sm:text-base leading-relaxed">
            <p>
              These Terms of Service govern the use of <strong>EDS Hub Leads</strong>, an internal lead management and customer relationship system used by <strong>Expert Dental Solutions</strong>.
            </p>

            <p>
              EDS Hub Leads is designed to receive, organize, process, and manage information submitted through advertising campaigns, lead forms, website forms, and related communication channels.
            </p>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 my-6">
              <p className="font-semibold text-slate-900 mb-3">
                By submitting your information through a form connected to Expert Dental Solutions, you acknowledge that the information you provide may be processed for legitimate business purposes, including:
              </p>
              <ul className="list-disc list-inside space-y-2 text-slate-700 pl-1">
                <li>responding to your inquiry;</li>
                <li>providing information about courses, training programs, services, or events;</li>
                <li>contacting you through email, phone, SMS, or other communication channels selected by you;</li>
                <li>organizing and managing your inquiry within our CRM system;</li>
                <li>improving customer service and business operations.</li>
              </ul>
            </div>

            <div className="p-4 bg-emerald-50/60 border border-emerald-200 rounded-xl text-emerald-900 font-medium">
              We do not sell personal information to third parties.
            </div>

            <p>
              Access to EDS Hub Leads is restricted to authorized users and service providers involved in managing Expert Dental Solutions&apos; operations.
            </p>

            <p>
              Users are responsible for providing accurate information when submitting forms.
            </p>

            <p>
              Expert Dental Solutions may update these Terms from time to time. Any updates will be published on this page.
            </p>

            <div className="pt-6 border-t border-slate-100 mt-8">
              <p className="text-slate-800 font-semibold mb-2">
                Questions & Inquiries
              </p>
              <p className="text-slate-600">
                For questions regarding these Terms, please contact Expert Dental Solutions through the official contact information available on:
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
              className="text-slate-700 font-medium hover:underline"
            >
              Terms of Service
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
