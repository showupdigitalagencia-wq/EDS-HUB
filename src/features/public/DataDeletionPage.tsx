import { Link } from 'react-router-dom';
import edsLogo from '../../assets/eds-logo.png';
import { ShieldCheck, ExternalLink, Trash2 } from 'lucide-react';

export function DataDeletionPage() {
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
            <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-rose-700 bg-rose-50 px-3 py-1 rounded-md mb-3">
              <Trash2 className="w-3.5 h-3.5" />
              User Rights & Privacy
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
              Data Deletion Instructions
            </h1>
            <p className="text-sm text-slate-500 mt-2">
              Last updated: October 1, 2026
            </p>
          </div>

          {/* Document Body */}
          <div className="space-y-6 text-slate-700 text-sm sm:text-base leading-relaxed">
            <p>
              If you have submitted personal information to <strong>Expert Dental Solutions</strong> through Facebook, Instagram, a lead form, our website, or another connected service, you may request deletion of your personal data.
            </p>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 my-6">
              <p className="font-semibold text-slate-900 mb-2">
                How to Request Deletion:
              </p>
              <p className="text-slate-600 mb-3">
                To request deletion, please contact Expert Dental Solutions using the official contact information available on:
              </p>
              <a
                href="https://expdentalsolutions.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[#08254f] font-semibold hover:text-[#449bd5] underline transition-colors"
              >
                https://expdentalsolutions.com
                <ExternalLink className="w-4 h-4" />
              </a>

              <div className="mt-5 pt-4 border-t border-slate-200">
                <p className="font-semibold text-slate-900 mb-2">
                  Your request should include enough information for us to identify your record, such as:
                </p>
                <ul className="list-disc list-inside space-y-1.5 text-slate-700 pl-1">
                  <li>full name;</li>
                  <li>email address used when submitting the form;</li>
                  <li>phone number used when submitting the form.</li>
                </ul>
              </div>
            </div>

            <p>
              Once the request is verified, we will process the deletion of personal data stored within <strong>EDS Hub Leads</strong> and related internal systems, subject to any information that must be retained for legal, regulatory, fraud prevention, or legitimate business record-keeping purposes.
            </p>

            <p>
              We may contact the requester to confirm identity before completing the deletion request.
            </p>

            <div className="p-4 bg-blue-50/70 border border-blue-200 rounded-xl text-[#08254f] text-sm">
              Requests are handled within a reasonable period in accordance with applicable privacy laws.
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
              to="/data-deletion"
              className="text-slate-700 font-medium hover:underline"
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
