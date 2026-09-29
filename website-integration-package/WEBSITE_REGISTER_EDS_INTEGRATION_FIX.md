# EDS HUB — PACOTE DE INTEGRAÇÃO OFICIAL DO FORMULÁRIO DE REGISTRO
## Correção e Sincronização em Produção: `https://www.expdentalsolutions.com/register`

> **Destinatário:** Desenvolvedor responsável pelo website `expdentalsolutions.com`  
> **Sistema CRM Destino:** EDS HUB (Expert Dental Solutions CRM)  
> **Ambiente de Produção Supabase:** `https://xogcexclqiornuscsdmn.supabase.co`  
> **Status:** AGUARDANDO IMPLEMENTAÇÃO NO WEBSITE EXTERNO  
> **Data:** Setembro de 2026

---

## 1. Diagnóstico Real do Problema

Durante a auditoria técnica direta e o teste manual do cliente na página de produção:
`https://www.expdentalsolutions.com/register`

Foram identificados os seguintes fatos:

1. **Ausência de Integração com o EDS HUB:**  
   No código JavaScript da página atual (linhas 845 a 854 do template renderizado), o formulário `#registerForm` envia os dados exclusivamente via AJAX (`fetch`) para a própria rota local do Laravel: `https://www.expdentalsolutions.com/register`.  
   **Nenhum dado é enviado para os endpoints de ingestão do EDS HUB.**

2. **Perda Completa de Inscrições Incompletas e Erros de Submissão:**  
   O formulário atual exige validações rigorosas no backend Laravel (Google reCAPTCHA `g-recaptcha-response`, upload de passaporte `passport`, upload de licença dental `dental_license`, tamanho de jaleco `coat_size`, etc.).  
   Se um visitante preenche Nome, E-mail, Telefone e Curso, mas:
   - Abandona a página antes de enviar; ou
   - O reCAPTCHA expira/falha; ou
   - O upload de arquivo ultrapassa o limite ou falha; ou
   - Ocorre um erro de validação (HTTP 422) ou erro de servidor (HTTP 500);  
   **O contato desse dentista é 100% perdido**, pois o EDS HUB não é notificado da tentativa.

3. **Arquitetura Externa Independente:**  
   O site é uma aplicação Laravel hospedada em servidor cPanel (`/home2/expden18/public_html`). O código do site não reside no repositório do EDS HUB, exigindo a inclusão deste pacote diretamente na base de código do site.

---

## 2. O Que Precisa Ser Alterado

Para que o formulário funcione perfeitamente ponta a ponta:

1. **Captura de Inscrição Incompleta (Abandono):**  
   Quando o visitante digita E-mail ou Telefone e escolhe um Curso no select, um evento assíncrono (com debounce de 1,5s) deve registrar a intenção no endpoint `capture-incomplete-enrollment`. Isso cria o lead em `Novo Lead` no EDS HUB e gera uma tarefa interna de acompanhamento imediato com alerta push:  
   `"Inscrição não concluída — [Nome] tentou se inscrever em [Curso]. Verifique o formulário e faça o acompanhamento."`

2. **Captura de Falha de Envio:**  
   Se o usuário clica em Enviar e o servidor do site retorna erro (ex: reCAPTCHA inválido, arquivo rejeitado, 422, 500 ou queda de conexão), a tentativa com os dados já preenchidos deve ser registrada no EDS HUB com status `submission_failed` para que a equipe possa entrar em contato e ajudar na matrícula.

3. **Sincronização de Inscrição Concluída:**  
   Quando a inscrição é salva com sucesso no Laravel (HTTP 200), os dados comerciais da inscrição devem ser enviados ao endpoint `submit-public-form`. Isso:
   - Cria o Lead ou vincula ao Lead existente (sem duplicar);
   - Preserva o histórico e adiciona o novo curso caso o lead já exista;
   - Faz o card subir para o topo da coluna no Pipeline (`last_inbound_activity_at`);
   - Resolve automaticamente qualquer alerta/tarefa de tentativa incompleta anterior;
   - Registra todos os campos do formulário para visualização em **"Formulário do Lead"** no CRM.

4. **Preservação Estrita de Privacidade e Segurança:**  
   - Arquivos físicos (`passport`, `dental_license`) permanecem no servidor do site e **NÃO** devem ser enviados ao EDS HUB.
   - Condições médicas (`medical_conditions`) e restrições alimentares (`dietary`) são confidenciais e **NÃO** devem ser enviadas ao EDS HUB.
   - Apenas campos comerciais e de qualificação são sincronizados.

---

## 3. Arquitetura de Integração: Escolha da Abordagem

O desenvolvedor pode optar por uma das duas abordagens abaixo. **A OPÇÃO B (Híbrida) é fortemente recomendada**:

| Critério | OPÇÃO A: Somente Frontend (JavaScript) | OPÇÃO B: Híbrida (Recomendada) |
| :--- | :--- | :--- |
| **Tentativa Incompleta / Abandono** | Frontend JS → Endpoint EDS HUB | Frontend JS → Endpoint EDS HUB |
| **Inscrição Concluída** | Frontend JS após HTTP 200 do Laravel | Backend Laravel → Endpoint EDS HUB |
| **Resiliência de Rede** | Boa (sujeita a fechamento imediato de aba) | **Máxima** (sync server-to-server imune a fechamento de aba) |
| **Tempo de Implementação** | 10 minutos (1 script + hook) | 20 minutos (1 script + 1 service PHP) |

---

## 4. Endpoints e Credenciais de Produção

### Endpoint 1: Tentativa Incompleta / Falha
- **URL:** `https://xogcexclqiornuscsdmn.supabase.co/functions/v1/capture-incomplete-enrollment`
- **Método:** `POST`
- **Headers:**
  ```http
  Content-Type: application/json
  apikey: sb_publishable_AyrxHrDnvNXwKvk1kBDqng_TgqHMPdw
  ```

### Endpoint 2: Formulário Concluído
- **URL:** `https://xogcexclqiornuscsdmn.supabase.co/functions/v1/submit-public-form`
- **Método:** `POST`
- **Headers:**
  ```http
  Content-Type: application/json
  apikey: sb_publishable_AyrxHrDnvNXwKvk1kBDqng_TgqHMPdw
  ```

> [!IMPORTANT]
> **Segurança de Chaves:**  
> A chave `sb_publishable_AyrxHrDnvNXwKvk1kBDqng_TgqHMPdw` é uma chave pública segura (publishable anon key).  
> **NUNCA** utilize `service_role` ou senhas de banco de dados no frontend ou no código do site.

---

## 5. Mapeamento Canônico de Cursos

O select `course` do formulário real contém strings com datas e valores. O script e o controller mapeiam automaticamente para os códigos canônicos do EDS HUB:

| Opção no Select do Site (`name="course"`) | Código no EDS HUB (`course_code`) | Curso Canônico |
| :--- | :--- | :--- |
| `Dental Implant Intensive Course - November 11-14, 2026 \| Tuition: $9,400` | `IDIT-01` | Intensive Dental Implant Training |
| `Dental Implant Intensive Course - February 24 - 27, 2027 \| Tuition: $9,700` | `IDIT-01` | Intensive Dental Implant Training |
| `Dental Implant Advanced Course - November 11-14, 2026 \| Tuition: $9,900` | `ADIE-01` | Advanced Dental Implant Experience |
| `Dental Implant Advanced Course - February 24–27, 2027 \| Tuition: $10,200` | `ADIE-01` | Advanced Dental Implant Experience |
| `Intensive Molar Endodontics Training - April 26-29, 2027 \| Tuition: $9,600` | `ET-01` | Endodontics Training |
| `Zygomatic Implant Course - November 7-10, 2026 \| Tuition: $17,500` | `ZIT-01` | Zygomatic Implant Training |
| `Zygomatic Implant Course - March 1–4, 2027 \| Tuition: $17,500` | `ZIT-01` | Zygomatic Implant Training |
| `Wisdom Teeth Training - November 7-10, 2026 \| Tuition: $8,200` | `WTT-01` | Wisdom Teeth Training |
| `Wisdom Teeth Training - March 1 - 4, 2027 \| Tuition: $8,200` | `WTT-01` | Wisdom Teeth Training |
| `Advanced Implant Rehabilitation Experience - November 7-10, 2026 \| Tuition: $9,600` | `AIRE-01` | Advanced Implant Rehabilitation Experience |
| `Advanced Implant Rehabilitation Experience - March 1–4, 2027 \| Tuition: $9,600` | `AIRE-01` | Advanced Implant Rehabilitation Experience |
| `Perioplastic Surgery - November 7-10, 2026 \| Tuition: $9,900` | `PST-01` | Periodontal Plastic Surgery Training |
| `Perioplastic Surgery - March 1–4, 2027 \| Tuition: $9,900` | `PST-01` | Periodontal Plastic Surgery Training |
| `Zygomatic Implant Course (Observers - CE not included) \| Tuition: $6,500` | `ZIT-01` | Zygomatic Implant Training |
| `Maxillofacial Anomalies Course \| Tuition: $31,900` | `MAX-01` | Maxillofacial Anomalies |

---

## 6. Schema dos Payloads de Dados

### 6.1 Payload de Formulário Concluído (`submit-public-form`)

```json
{
  "form_slug": "website-register",
  "idempotency_key": "comp_att_1790692798814_abc123",
  "external_attempt_id": "att_1790692798814_abc123",
  "name": "Dr. John Smith",
  "first_name": "John",
  "last_name": "Smith",
  "email": "john.smith@example.com",
  "phone": "+19415550199",
  "contact_preference": "email",
  "course": "Wisdom Teeth Training - November 7-10, 2026 | Tuition: $8,200",
  "course_code": "WTT-01",
  "certificate_name": "Dr. John A. Smith, DDS",
  "agd_number": "AGD-987654",
  "specialty": "General Practitioner",
  "years_in_practice": "5-9 years",
  "surgical_experience": "Moderate surgical experience",
  "coat_size": "L",
  "heard_from": "Google",
  "referral_name": "Dr. Carlos Santos",
  "promo_code": "EDS2026",
  "terms_accepted": true,
  "source_page": "https://www.expdentalsolutions.com/register",
  "utm_source": "google",
  "utm_medium": "cpc",
  "utm_campaign": "wisdom_teeth_2026",
  "utm_term": "hands-on wisdom course",
  "utm_content": "hero_apply_button"
}
```

### 6.2 Campos Estritamente Proibidos (NÃO ENVIAR)
- `passport` (binário do passaporte)
- `dental_license` (binário da licença)
- `medical_conditions` (dados médicos)
- `dietary` (restrições alimentares)
- `emergency_phone` (telefone de emergência de terceiros)
- `_token` (token CSRF interno do Laravel)
- Senhas ou tokens de sessão

---

## 7. Passo a Passo de Implementação (Opção Recomendada: B - Híbrida)

### Passo 1: Copiar o Script JavaScript
Copie o arquivo `eds-register-integration.js` para a pasta pública do seu projeto Laravel:
`public/js/eds-register-integration.js`

### Passo 2: Incluir no Template Blade
No arquivo da view de registro (ex: `resources/views/register.blade.php`), adicione a chamada do script antes do fechamento de `</body>`:
```html
<script src="{{ asset('js/eds-register-integration.js') }}" defer></script>
```

*(O script injeta automaticamente o campo `<input type="hidden" name="eds_form_attempt_id">` no `#registerForm` e cuida de capturar tentativas incompletas enquanto o dentista digita).*

### Passo 3: Adicionar a Classe de Sincronização PHP
Copie a classe `EdsHubSyncService.php` (fornecida no arquivo `website-register-laravel-controller.php`) para:
`app/Services/EdsHubSyncService.php`

### Passo 4: Chamar a Sincronização no Controller
No seu controller de registro (ex: `app/Http/Controllers/RegisterController.php`), logo após validar os dados, salvar o aluno no banco local e fazer o upload do passaporte/licença, insira:

```php
use App\Services\EdsHubSyncService;

// ... após salvar no banco de dados local ...
EdsHubSyncService::syncCompletedRegistration($request);

return response()->json([
    'success' => true,
    'redirect' => url('/thank-you'),
    'message' => 'Registration completed successfully.'
]);
```

---

## 8. Tratamento de Erros e Idempotência

1. **Idempotência Garantida:**  
   O campo `idempotency_key` garante que submissões repetidas (por clique duplo ou retry de rede) não criem leads ou matrículas duplicadas.

2. **Deduplicação de Leads Existentes:**  
   Se o e-mail ou telefone já pertencer a um lead existente no EDS HUB:
   - Nenhum lead duplicado é criado.
   - O novo curso é adicionado aos interesses do lead.
   - O lead volta ao topo da coluna no Pipeline via `last_inbound_activity_at`.
   - Um indicador de `"Novo formulário"` é acionado no card.

3. **Falhas de Rede São Não-Bloqueantes:**  
   O método `syncCompletedRegistration` possui timeout de 6 segundos e tratamento com `try/catch`. Caso o EDS HUB esteja temporariamente inacessível, o registro do aluno no site continua funcionando e o aluno é redirecionado para a página de obrigado normalmente.

---

## 9. Arquivos Prontos Fornecidos Neste Pacote

1. `WEBSITE_REGISTER_EDS_INTEGRATION_FIX.md` (Este documento explicativo)
2. `eds-register-integration.js` (Script JavaScript de produção)
3. `website-register-laravel-controller.php` (Service PHP e exemplo de Controller)
4. `website-register-test-payload.json` (Exemplo canônico de payload JSON)
5. `website-register-blade-snippet.blade.php` (Snippet exato para colar na view Blade)
6. `website-register-route-snippet.php` (Snippet de rota para conferência)
7. `VALIDATION_CHECKLIST.md` (Checklist de validação pós-deploy)
