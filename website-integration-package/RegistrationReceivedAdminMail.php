<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Address;
use Illuminate\Mail\Mailables\Attachment;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Str;

class RegistrationReceivedAdminMail extends Mailable
{
    use Queueable, SerializesModels;

    /**
     * The registration data model or object.
     */
    public $registration;

    /**
     * Optional file attachment paths passed directly by controller.
     * In the actual RegistrationController, these are:
     * [
     *   storage_path('app/public/' . $validated['passport_path']),
     *   storage_path('app/public/' . $validated['dental_license_path']),
     * ]
     */
    public $fileAttachments;

    /**
     * Optional custom terms list.
     */
    public $termsList;

    /**
     * Optional custom confirmation text.
     */
    public $confirmationText;

    /**
     * Create a new message instance.
     *
     * @param mixed $registration Registration model or array
     * @param array $fileAttachments Physical file paths to attach
     * @param array $termsList Terms and conditions items
     * @param string|null $confirmationText Statement agreed by the registrant
     */
    public function __construct($registration, array $fileAttachments = [], array $termsList = [], ?string $confirmationText = null)
    {
        $this->registration = $registration;
        $this->fileAttachments = $fileAttachments;
        $this->termsList = $termsList;
        $this->confirmationText = $confirmationText;
    }

    /**
     * Get the message envelope.
     * Restores canonical official English subject.
     */
    public function envelope(): Envelope
    {
        $name = trim($this->registration->name ?? '');
        $course = trim($this->registration->course ?? '');

        // Official English subject format: "New Course Registration — {Name} — {Course}"
        $parts = ['New Course Registration'];

        if (!empty($name)) {
            $parts[] = $name;
        }

        if (!empty($course) && strtolower($course) !== 'course') {
            $parts[] = $course;
        }

        // Reply-To: Student's validated email address from registration
        $replyTo = [];
        $studentEmail = trim($this->registration->email ?? '');
        if (!empty($studentEmail) && filter_var($studentEmail, FILTER_VALIDATE_EMAIL)) {
            $replyTo[] = new Address($studentEmail, !empty($name) ? $name : null);
        }

        return new Envelope(
            subject: implode(' — ', $parts),
            replyTo: $replyTo,
        );
    }

    /**
     * Get the message content definition.
     * Renders official English admin registration view.
     */
    public function content(): Content
    {
        return new Content(
            view: 'emails.registration-admin',
            with: [
                'registration'     => $this->registration,
                'termsList'        => $this->termsList,
                'confirmationText' => $this->confirmationText,
            ],
        );
    }

    /**
     * Get the attachments for the message.
     * Preserves exact controller attachment paths (storage_path('app/public/...')).
     */
    public function attachments(): array
    {
        $attachments = [];

        // 1. Existing controller passes absolute paths directly in $fileAttachments
        if (!empty($this->fileAttachments) && is_array($this->fileAttachments)) {
            foreach ($this->fileAttachments as $file) {
                if ($file instanceof Attachment) {
                    $attachments[] = $file;
                } elseif (is_string($file) && file_exists($file)) {
                    $attachments[] = Attachment::fromPath($file);
                }
            }
        }

        // 2. Safe fallback if attachments array was omitted: resolve from public storage disk paths
        if (empty($attachments) && is_object($this->registration)) {
            $nameSlug = Str::slug($this->registration->name ?? 'registrant');

            // Passport (stored in uploads/passports on public disk)
            if (!empty($this->registration->passport_path)) {
                $passportFile = storage_path('app/public/' . $this->registration->passport_path);
                if (file_exists($passportFile)) {
                    $ext = pathinfo($passportFile, PATHINFO_EXTENSION) ?: 'pdf';
                    $attachments[] = Attachment::fromPath($passportFile)
                        ->as('Passport_' . $nameSlug . '.' . $ext);
                }
            }

            // Dental License (stored in uploads/licenses on public disk)
            $licenseField = $this->registration->dental_license_path ?? ($this->registration->license_path ?? null);
            if (!empty($licenseField)) {
                $licenseFile = storage_path('app/public/' . $licenseField);
                if (file_exists($licenseFile)) {
                    $ext = pathinfo($licenseFile, PATHINFO_EXTENSION) ?: 'pdf';
                    $attachments[] = Attachment::fromPath($licenseFile)
                        ->as('Dental_License_' . $nameSlug . '.' . $ext);
                }
            }
        }

        return $attachments;
    }
}
