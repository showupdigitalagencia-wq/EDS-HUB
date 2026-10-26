<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>New Course Registration — {{ $registration->name ?? 'Applicant' }}</title>
  <style type="text/css">
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }
    @media only screen and (max-width: 620px) {
      .eds-container { width: 100% !important; max-width: 100% !important; }
      .eds-content-padding { padding: 16px !important; }
      .eds-title { font-size: 18px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a; line-height: 1.5;">
  <!-- Preheader text for email preview -->
  <div style="display: none; max-height: 0px; overflow: hidden; font-size: 1px; line-height: 1px; color: #f8fafc;">
    Official Course Registration — {{ $registration->name ?? 'Applicant' }} — {{ $registration->course ?? 'Expert Dental Solutions' }}
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f8fafc; padding: 24px 8px;">
    <tr>
      <td align="center">
        <!-- Main Card Container -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="eds-container" style="max-width: 650px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.05);">
          
          <!-- Official Brand Header -->
          <tr>
            <td style="padding: 24px 28px 18px 28px; background-color: #ffffff; border-bottom: 2px solid #08254f; text-align: left;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="vertical-align: middle;">
                    <a href="https://www.expdentalsolutions.com" target="_blank" style="text-decoration: none; display: inline-block;">
                      <img src="https://www.expdentalsolutions.com/storage/site/fJOJt2KVIZpwj4mHb7QQ.png" alt="Expert Dental Solutions" width="160" style="display: block; width: 160px; max-width: 160px; height: auto; border: 0;" />
                    </a>
                    <div style="font-size: 12px; font-weight: 700; color: #08254f; letter-spacing: 0.5px; text-transform: uppercase; margin-top: 6px;">
                      Expert Dental Solutions
                    </div>
                  </td>
                  <td align="right" style="vertical-align: middle;">
                    <span style="display: inline-block; padding: 5px 12px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; background-color: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; border-radius: 12px;">
                      Official Admin Record
                    </span>
                  </td>
                </tr>
              </table>
              <div class="eds-title" style="margin-top: 14px; font-size: 20px; font-weight: 700; color: #08254f; line-height: 1.3;">
                New Course Registration
              </div>
              <div style="font-size: 13px; color: #64748b; margin-top: 2px;">
                Completed online registration submitted via official website.
              </div>
            </td>
          </tr>

          <!-- Summary Callout -->
          <tr>
            <td style="padding: 20px 28px 0 28px;" class="eds-content-padding">
              <div style="background-color: #f8fafc; border-left: 4px solid #08254f; border-radius: 6px; padding: 14px 18px;">
                <div style="font-size: 18px; font-weight: 700; color: #0f172a; line-height: 1.2;">
                  {{ $registration->name ?? 'Applicant' }}
                </div>
                @if(!empty($registration->course))
                <div style="margin-top: 6px; font-size: 14px; font-weight: 600; color: #08254f;">
                  <span style="display: inline-block; padding: 2px 8px; background-color: #e0e7ff; color: #3730a3; border-radius: 4px; font-size: 11px; margin-right: 6px; text-transform: uppercase;">Course</span>
                  {{ $registration->course }}
                </div>
                @endif
                <div style="margin-top: 6px; font-size: 12px; color: #64748b;">
                  Submitted on: <strong>{{ $registration->date ?? (isset($registration->created_at) ? $registration->created_at : date('F j, Y')) }}</strong>
                </div>
              </div>
            </td>
          </tr>

          <!-- Form Details Sections -->
          <tr>
            <td style="padding: 0 28px 24px 28px;" class="eds-content-padding">

              <!-- 1. PERSONAL INFORMATION -->
              <div style="margin-top: 24px;">
                <div style="font-size: 12px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; color: #08254f; padding-bottom: 6px; border-bottom: 2px solid #e2e8f0;">
                  Personal Information
                </div>
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse; margin-top: 6px;">
                  <tbody>
                    <tr>
                      <td style="padding: 8px 10px; font-size: 13px; color: #64748b; width: 38%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 500;">Full Name</td>
                      <td style="padding: 8px 10px; font-size: 13px; color: #0f172a; width: 62%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 600;">{{ $registration->name ?? 'N/A' }}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 10px; font-size: 13px; color: #64748b; width: 38%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 500;">Email Address</td>
                      <td style="padding: 8px 10px; font-size: 13px; color: #0f172a; width: 62%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 600;">
                        <a href="mailto:{{ $registration->email ?? '' }}" style="color: #2563eb; text-decoration: none;">{{ $registration->email ?? 'N/A' }}</a>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 10px; font-size: 13px; color: #64748b; width: 38%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 500;">Mobile Phone</td>
                      <td style="padding: 8px 10px; font-size: 13px; color: #0f172a; width: 62%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 600;">{{ $registration->phone ?? 'N/A' }}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 10px; font-size: 13px; color: #64748b; width: 38%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 500;">Name for Certificate</td>
                      <td style="padding: 8px 10px; font-size: 13px; color: #0f172a; width: 62%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 600;">{{ $registration->certificate_name ?? ($registration->name ?? 'N/A') }}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 10px; font-size: 13px; color: #64748b; width: 38%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 500;">AGD Number</td>
                      <td style="padding: 8px 10px; font-size: 13px; color: #0f172a; width: 62%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 600;">{{ $registration->agd_number ?? 'N/A' }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <!-- 2. EMERGENCY CONTACT -->
              <div style="margin-top: 22px;">
                <div style="font-size: 12px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; color: #08254f; padding-bottom: 6px; border-bottom: 2px solid #e2e8f0;">
                  Emergency Contact
                </div>
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse; margin-top: 6px;">
                  <tbody>
                    <tr>
                      <td style="padding: 8px 10px; font-size: 13px; color: #64748b; width: 38%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 500;">Emergency Contact Phone</td>
                      <td style="padding: 8px 10px; font-size: 13px; color: #0f172a; width: 62%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 600;">{{ $registration->emergency_phone ?? 'N/A' }}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 10px; font-size: 13px; color: #64748b; width: 38%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 500;">Medical Conditions</td>
                      <td style="padding: 8px 10px; font-size: 13px; color: #0f172a; width: 62%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 600;">{{ $registration->medical_conditions ?? 'None reported' }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <!-- 3. PROFESSIONAL DETAILS -->
              <div style="margin-top: 22px;">
                <div style="font-size: 12px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; color: #08254f; padding-bottom: 6px; border-bottom: 2px solid #e2e8f0;">
                  Professional Details
                </div>
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse; margin-top: 6px;">
                  <tbody>
                    <tr>
                      <td style="padding: 8px 10px; font-size: 13px; color: #64748b; width: 38%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 500;">Specialty</td>
                      <td style="padding: 8px 10px; font-size: 13px; color: #0f172a; width: 62%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 600;">{{ $registration->specialty ?? 'N/A' }}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 10px; font-size: 13px; color: #64748b; width: 38%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 500;">Years in Practice</td>
                      <td style="padding: 8px 10px; font-size: 13px; color: #0f172a; width: 62%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 600;">{{ $registration->years_in_practice ?? 'N/A' }}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 10px; font-size: 13px; color: #64748b; width: 38%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 500;">Surgical Experience</td>
                      <td style="padding: 8px 10px; font-size: 13px; color: #0f172a; width: 62%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 600;">{{ $registration->surgical_experience ?? 'N/A' }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <!-- 4. ADDITIONAL INFORMATION -->
              <div style="margin-top: 22px;">
                <div style="font-size: 12px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; color: #08254f; padding-bottom: 6px; border-bottom: 2px solid #e2e8f0;">
                  Additional Information
                </div>
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse; margin-top: 6px;">
                  <tbody>
                    <tr>
                      <td style="padding: 8px 10px; font-size: 13px; color: #64748b; width: 38%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 500;">White Coat Size</td>
                      <td style="padding: 8px 10px; font-size: 13px; color: #0f172a; width: 62%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 600;">{{ $registration->coat_size ?? 'N/A' }}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 10px; font-size: 13px; color: #64748b; width: 38%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 500;">Dietary Restrictions</td>
                      <td style="padding: 8px 10px; font-size: 13px; color: #0f172a; width: 62%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 600;">{{ $registration->dietary ?? 'None reported' }}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 10px; font-size: 13px; color: #64748b; width: 38%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 500;">How Did You Hear About Us</td>
                      <td style="padding: 8px 10px; font-size: 13px; color: #0f172a; width: 62%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 600;">{{ $registration->heard_from ?? 'N/A' }}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 10px; font-size: 13px; color: #64748b; width: 38%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 500;">Referral Name</td>
                      <td style="padding: 8px 10px; font-size: 13px; color: #0f172a; width: 62%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 600;">{{ $registration->referral_name ?? 'N/A' }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <!-- 5. COURSES AND TUITION -->
              <div style="margin-top: 22px;">
                <div style="font-size: 12px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; color: #08254f; padding-bottom: 6px; border-bottom: 2px solid #e2e8f0;">
                  Courses and Tuition
                </div>
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse; margin-top: 6px;">
                  <tbody>
                    <tr>
                      <td style="padding: 8px 10px; font-size: 13px; color: #64748b; width: 38%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 500;">Selected Course &amp; Tuition</td>
                      <td style="padding: 8px 10px; font-size: 13px; color: #0f172a; width: 62%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 600;">{{ $registration->course ?? 'N/A' }}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 10px; font-size: 13px; color: #64748b; width: 38%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 500;">Promo Code</td>
                      <td style="padding: 8px 10px; font-size: 13px; color: #0f172a; width: 62%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 600;">{{ $registration->promo_code ?? 'None' }}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 10px; font-size: 13px; color: #64748b; width: 38%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 500;">Payment Method Notice</td>
                      <td style="padding: 8px 10px; font-size: 13px; color: #0f172a; width: 62%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 500; font-style: italic;">
                        Our team will reach out to assist the registrant further with the course payment.
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <!-- 6. TERMS AND CONDITIONS -->
              <div style="margin-top: 22px;">
                <div style="font-size: 12px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; color: #08254f; padding-bottom: 6px; border-bottom: 2px solid #e2e8f0;">
                  Terms and Conditions
                </div>
                <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 14px 16px; margin-top: 8px;">
                  @php
                    $defaultTerms = [
                      'I understand that travel to and from Brazil is my responsibility.',
                      'I understand that transportation between the airport and the hotel (round trip) and between the hotel and the training location (daily round trip) is provided by Expert Dental Solutions.',
                      'I understand that a four-star hotel with breakfast is provided by Expert Dental Solutions.',
                      'I understand that depending on my nationality, I may need a visa.',
                      'I understand that travel health insurance is highly recommended.',
                      'Refunds are available for cancellations made 45 days prior to the course. All cancellations are subject to a non-refundable administrative fee of $1,200. Cancellations made less than 45 days before the course start date are non-refundable.'
                    ];
                    $activeTerms = (!empty($termsList) && is_array($termsList)) ? $termsList : $defaultTerms;
                  @endphp

                  @foreach($activeTerms as $term)
                  <div style="margin-bottom: 10px; font-size: 12px; color: #334155; line-height: 1.4;">
                    <span style="color: #08254f; font-weight: 700; margin-right: 6px;">&#10003;</span>
                    {{ $term }}
                  </div>
                  @endforeach
                </div>
              </div>

              <!-- 7. REGISTRANT CONFIRMATION -->
              <div style="margin-top: 22px;">
                <div style="font-size: 12px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; color: #08254f; padding-bottom: 6px; border-bottom: 2px solid #e2e8f0;">
                  Registrant Confirmation
                </div>
                <div style="background-color: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 6px; padding: 14px 16px; margin-top: 8px;">
                  <div style="font-size: 13px; color: #065f46; font-weight: 600; line-height: 1.4;">
                    {{ $confirmationText ?? 'I confirm that I have read, understand, and agree to the Terms and Conditions of the course, including the cancellation and refund policy.' }}
                  </div>
                  <div style="margin-top: 6px; font-size: 12px; color: #047857;">
                    Status: <strong>Accepted &amp; Confirmed by Registrant</strong>
                  </div>
                </div>
              </div>

              <!-- 8. SIGNATURE AND ATTACHMENTS -->
              <div style="margin-top: 22px;">
                <div style="font-size: 12px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; color: #08254f; padding-bottom: 6px; border-bottom: 2px solid #e2e8f0;">
                  Signature &amp; Verification
                </div>
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse; margin-top: 6px;">
                  <tbody>
                    <tr>
                      <td style="padding: 8px 10px; font-size: 13px; color: #64748b; width: 38%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 500;">Digital Signature</td>
                      <td style="padding: 8px 10px; font-size: 14px; font-family: Georgia, serif; font-style: italic; color: #08254f; width: 62%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 700;">{{ $registration->signature ?? 'N/A' }}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 10px; font-size: 13px; color: #64748b; width: 38%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 500;">Date of Signature</td>
                      <td style="padding: 8px 10px; font-size: 13px; color: #0f172a; width: 62%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 600;">{{ $registration->date ?? 'N/A' }}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 10px; font-size: 13px; color: #64748b; width: 38%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 500;">Attached Passport</td>
                      <td style="padding: 8px 10px; font-size: 13px; color: #0f172a; width: 62%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 600;">
                        <span style="color: #059669; font-weight: 700;">&#128206; Attached to this email</span>
                        @if(!empty($registration->passport_path))
                        <div style="font-size: 11px; color: #64748b; font-weight: normal; margin-top: 2px;">{{ basename($registration->passport_path) }}</div>
                        @endif
                      </td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 10px; font-size: 13px; color: #64748b; width: 38%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 500;">Attached Dental License</td>
                      <td style="padding: 8px 10px; font-size: 13px; color: #0f172a; width: 62%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 600;">
                        <span style="color: #059669; font-weight: 700;">&#128206; Attached to this email</span>
                        @php
                          $licenseFile = $registration->dental_license_path ?? ($registration->license_path ?? null);
                        @endphp
                        @if(!empty($licenseFile))
                        <div style="font-size: 11px; color: #64748b; font-weight: normal; margin-top: 2px;">{{ basename($licenseFile) }}</div>
                        @endif
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f1f5f9; padding: 18px 28px; text-align: center; border-top: 1px solid #e2e8f0;">
              <div style="font-size: 11px; color: #64748b; line-height: 1.5;">
                This is an official automated administrative notification generated by the Expert Dental Solutions registration system.<br>
                Recipient: <a href="mailto:info@expdentalsolutions.com" style="color: #08254f; font-weight: 600; text-decoration: none;">info@expdentalsolutions.com</a> &bull;
                Website: <a href="https://www.expdentalsolutions.com" target="_blank" style="color: #08254f; text-decoration: none;">www.expdentalsolutions.com</a>
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
