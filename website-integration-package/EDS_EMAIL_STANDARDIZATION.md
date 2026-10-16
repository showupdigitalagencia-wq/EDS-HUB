# Padronização Visual & Assuntos de E-mail EDS (Expert Dental Solutions)

Este documento especifica a identidade visual e o formato padronizado de assuntos para os 4 tipos de e-mails operacionais do ecossistema EDS.

---

## 1. Identidade Visual EDS

- **Logo Oficial:** `https://www.expdentalsolutions.com/storage/site/fJOJt2KVIZpwj4mHb7QQ.png`
- **Largura da Logo:** `150px`
- **Cor Primária (Navy):** `#08254f`
- **Cor de Fundo:** `#f8fafc` (container externo) e `#ffffff` (card principal)
- **Bordas:** `#e2e8f0` com cantos arredondados (`border-radius: 8px`)
- **Largura Máxima:** `600px` (responsivo para mobile)
- **Tipografia:** `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`

---

## 2. Padrão de Assuntos Operacionais

Todos os e-mails operacionais utilizam o prefixo obrigatório `[EDS]`:

| Tipo de E-mail | Sistema Emissor | Assunto Padronizado |
|---|---|---|
| **1. Contact Us** | EDS HUB (Edge Function) | `[EDS] Novo contato pelo site — {Lead Name}` |
| **2. Request Course Info** | EDS HUB (Edge Function) | `[EDS] Pedido de informações — {Lead Name} — {Course}` |
| **3. Incomplete Registration** | EDS HUB (Edge Function) | `[EDS] Matrícula não concluída — {Lead Name} — {Course}` |
| **4. Completed Registration** | **Laravel (HostGator)** | `[EDS] Nova matrícula concluída — {Lead Name} — {Course} — {Turma}` |

### Regras de Formatação dos Assuntos:
- Parâmetros ausentes, `null`, `undefined` ou UUIDs são omitidos automaticamente sem deixar separadores vazios (` — `).
- Se a turma não for especificada, omite a turma.
- Se o curso não for especificado, omite o curso.

---

## 3. Instruções para o Servidor HostGator (Laravel)

> **ATENÇÃO: A emissão de e-mails de Matrícula Concluída permanece 100% no Laravel (HostGator).**  
> O EDS HUB não dispara nem duplica este e-mail.  
> As regras de anexos físicos (Passaporte e Licença Odontológica) e destinatário único do cliente são preservadas.

### Passo 1: Atualizar o Assunto no Mailable Laravel
No arquivo `app/Mail/RegistrationReceivedAdminMail.php` (ou equivalente no Laravel do site):

```php
public function envelope(): Envelope
{
    $parts = ['[EDS] Nova matrícula concluída'];
    
    $name = trim($this->registration->name ?? '');
    if (!empty($name)) {
        $parts[] = $name;
    }
    
    $course = trim($this->registration->course ?? '');
    if (!empty($course) && strtolower($course) !== 'curso') {
        $parts[] = $course;
    }
    
    $turma = trim($this->registration->turma ?? '');
    if (!empty($turma)) {
        $parts[] = $turma;
    }

    $subject = implode(' — ', $parts);

    return new Envelope(
        subject: $subject,
    );
}
```

### Passo 2: Atualizar o Template Blade
Copie o conteúdo de `website-integration-package/completed-registration-email.blade.php` para a view do Mailable (por exemplo, `resources/views/emails/registration-received-admin.blade.php`).

### Passo 3: Garantir Anexos e Destinatário
Mantenha os anexos físicos configurados no método `attachments()`:
```php
public function attachments(): array
{
    return [
        Attachment::fromStorageDisk('private', $this->registration->passport_path)
            ->as('Passaporte_' . Str::slug($this->registration->name) . '.' . pathinfo($this->registration->passport_path, PATHINFO_EXTENSION)),
        Attachment::fromStorageDisk('private', $this->registration->license_path)
            ->as('Licenca_Odontologica_' . Str::slug($this->registration->name) . '.' . pathinfo($this->registration->license_path, PATHINFO_EXTENSION)),
    ];
}
```

E o destinatário único para o endereço aprovado da administração:
```php
Mail::to('info@expdentalsolutions.com')->send(new RegistrationReceivedAdminMail($registration));
```
