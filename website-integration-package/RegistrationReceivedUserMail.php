<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class RegistrationReceivedUserMail extends Mailable
{
    use Queueable, SerializesModels;

    /**
     * The registration data model or object.
     */
    public $registration;

    /**
     * Create a new message instance.
     *
     * @param mixed $registration Registration model or array
     */
    public function __construct($registration)
    {
        $this->registration = $registration;
    }

    /**
     * Get the message envelope.
     * Canonical official English subject for student confirmation.
     */
    public function envelope(): Envelope
    {
        return new Envelope(
            subject: 'Thank You for Registering — Expert Dental Solutions',
        );
    }

    /**
     * Get the message content definition.
     * Renders official student registration confirmation template.
     */
    public function content(): Content
    {
        return new Content(
            view: 'emails.registration-user',
            with: [
                'registration' => $this->registration,
            ],
        );
    }

    /**
     * Get the attachments for the message.
     * CANONICAL ARCHITECTURE RULE:
     * The student confirmation email MUST NEVER contain Passport or Dental License attachments.
     * Attachments are reserved exclusively for the official administrative record (RegistrationReceivedAdminMail).
     *
     * @return array
     */
    public function attachments(): array
    {
        return [];
    }
}
