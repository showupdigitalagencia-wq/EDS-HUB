# Padronização Visual & Assuntos de E-mail EDS (Expert Dental Solutions)

Este documento especifica a identidade visual e o formato padronizado de assuntos para os 4 tipos de e-mails operacionais do ecossistema EDS, com **isolamento estrito entre os e-mails administrativos oficiais do Laravel (HostGator) e as notificações operacionais do EDS HUB (CRM)**.

---

## 1. Identidade Visual EDS

- **Logo Oficial:** `https://www.expdentalsolutions.com/storage/site/fJOJt2KVIZpwj4mHb7QQ.png`
- **Largura da Logo:** `150px` – `160px`
- **Cor Primária (Navy):** `#08254f`
- **Cor de Fundo:** `#f8fafc` (container externo) e `#ffffff` (card principal)
- **Bordas:** `#e2e8f0` com cantos arredondados (`border-radius: 8px`)
- **Largura Máxima:** `650px` (responsivo para mobile)
- **Tipografia:** `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`

---

## 2. Padrão de Assuntos & Canais Independentes

Existem **4 canais independentes** que NUNCA devem ser misturados ou substituídos:

| Canal | Tipo de E-mail | Emissor | Idioma | Destinatário | Assunto Canônico |
|---|---|---|---|---|---|
| **Canal 1 (Site Oficial Admin)** | **Official Website Admin Email** | **Laravel (HostGator)** | **INGLÊS** | `info@expdentalsolutions.com` | `New Course Registration — {Name} — {Course}` |
| **Canal 2 (Aluno)** | **Student Official Confirmation** | **Laravel (HostGator)** | **INGLÊS** | Aluno (`$registration->email`) | `Thank You for Registering — Expert Dental Solutions` |
| **Canal 3 (Marketing/CRM)** | **HubSpot Tracking** | **HubSpot JS / API** | N/A | HubSpot Portal | Rastreamento nativo HubSpot |
| **Canal 4 (CRM Operacional)** | **EDS HUB Operational Alert** | **EDS HUB (Supabase)** | **Português** | Equipe Interna EDS | `[EDS] Nova matrícula concluída — {Lead Name} — {Course} — {Turma}` |

---

## 3. Instruções Críticas para o Servidor HostGator (Laravel)

> [!CAUTION]
> **REGRA ARQUITETURAL INVIOLÁVEL:**  
> O e-mail administrativo oficial do Laravel (`RegistrationReceivedAdminMail`) é o documento oficial de inscrição do site, em **INGLÊS**, contendo todos os dados do formulário, Termos e Condições, Confirmação do Aluno e anexos físicos (Passaporte e Licença Odontológica).  
> **ELE NUNCA DEVE SER SUBSTITUÍDO PELO TEMPLATE OPERACIONAL PORTUGUÊS DO CRM.**

### Arquivo 1: `app/Mail/RegistrationReceivedAdminMail.php`

Restaura o assunto oficial em inglês e mapeia os anexos físicos locais:

```php
<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Attachment;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Str;

class RegistrationReceivedAdminMail extends Mailable
{
    use Queueable, SerializesModels;

    public $registration;
    public $fileAttachments;
    public $termsList;
    public $confirmationText;

    public function __construct($registration, array $fileAttachments = [], array $termsList = [], ?string $confirmationText = null)
    {
        $this->registration = $registration;
        $this->fileAttachments = $fileAttachments;
        $this->termsList = $termsList;
        $this->confirmationText = $confirmationText;
    }

    public function envelope(): Envelope
    {
        $name = trim($this->registration->name ?? '');
        $course = trim($this->registration->course ?? '');

        // Assunto oficial em inglês: "New Course Registration — {Name} — {Course}"
        $parts = ['New Course Registration'];

        if (!empty($name)) {
            $parts[] = $name;
        }

        if (!empty($course) && strtolower($course) !== 'course') {
            $parts[] = $course;
        }

        return new Envelope(
            subject: implode(' — ', $parts),
        );
    }

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

    public function attachments(): array
    {
        $attachments = [];

        if (!empty($this->fileAttachments) && is_array($this->fileAttachments)) {
            foreach ($this->fileAttachments as $file) {
                if ($file instanceof Attachment) {
                    $attachments[] = $file;
                } elseif (is_string($file) && file_exists($file)) {
                    $attachments[] = Attachment::fromPath($file);
                }
            }
        }

        if (empty($attachments) && is_object($this->registration)) {
            $nameSlug = Str::slug($this->registration->name ?? 'registrant');

            if (!empty($this->registration->passport_path)) {
                $passportFile = storage_path('app/public/' . $this->registration->passport_path);
                if (file_exists($passportFile)) {
                    $ext = pathinfo($passportFile, PATHINFO_EXTENSION) ?: 'pdf';
                    $attachments[] = Attachment::fromPath($passportFile)
                        ->as('Passport_' . $nameSlug . '.' . $ext);
                }
            }

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
```

### Arquivo 2: `resources/views/emails/registration-admin.blade.php`

Utilize o arquivo oficial restaurado em **inglês**:  
`website-integration-package/registration-admin.blade.php`

Ele contém:
- Idioma estritamente em **Inglês** (`lang="en"`)
- Cabeçalho oficial "New Course Registration — Expert Dental Solutions"
- Tabela completa de dados pessoais e profissionais
- Lista completa dos 6 itens dos Termos e Condições
- Declaração de confirmação do aluno
- Assinatura digital e data
- Aviso explícito de anexos (Passaporte e Licença Odontológica anexados ao e-mail)
- Destinatário administrativo oficial: `info@expdentalsolutions.com`

---

## 4. Destinatário Administrativo

O envio no controller existente do site continua exatamente como implementado:

```php
Mail::to(config('mail.admin_address', 'info@expdentalsolutions.com'))->send(
    new RegistrationReceivedAdminMail($registration, [
        storage_path('app/public/' . $validated['passport_path']),
        storage_path('app/public/' . $validated['dental_license_path']),
    ])
);
```
