<?php

/**
 * =============================================================================
 * EDS HUB Website Registration Integration — Laravel Backend Package
 * Target Form: https://www.expdentalsolutions.com/register
 * Platform: Laravel 10+ / PHP 8.1+
 * 
 * Este arquivo contém duas partes:
 * PARTE 1: A classe de serviço `EdsHubSyncService` (salvar em `app/Services/EdsHubSyncService.php`)
 * PARTE 2: O método do Controller de Registro adaptado (salvar em `app/Http/Controllers/RegisterController.php`)
 * =============================================================================
 */

// =============================================================================
// PARTE 1: CLASSE DE SERVIÇO DE SINCRONIZAÇÃO COM O EDS HUB
// Arquivo de destino: app/Services/EdsHubSyncService.php
// =============================================================================

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Http\Request;

class EdsHubSyncService
{
    /**
     * Endpoint oficial de produção do EDS HUB para formulários concluídos.
     */
    private const EDS_HUB_URL = 'https://xogcexclqiornuscsdmn.supabase.co/functions/v1/submit-public-form';

    /**
     * Chave de API pública (publishable anon key).
     * Segura para requisições de ingestão pública.
     */
    private const EDS_HUB_ANON_KEY = 'sb_publishable_AyrxHrDnvNXwKvk1kBDqng_TgqHMPdw';

    /**
     * Identificador do formulário no EDS HUB.
     */
    private const FORM_SLUG = 'website-register';

    /**
     * Mapeamento exato entre as opções do select `course` do site e os códigos canônicos do EDS HUB.
     */
    private static array $courseMap = [
        'dental implant intensive'        => 'IDIT-01',
        'dental implant advanced'         => 'ADIE-01',
        'zygomatic implant'               => 'ZIT-01',
        'wisdom teeth'                    => 'WTT-01',
        'advanced implant rehabilitation' => 'AIRE-01',
        'perioplastic surgery'            => 'PST-01',
        'periodontal surgery'             => 'PST-01',
        'intensive molar endodontics'     => 'ET-01',
        'endodontics training'            => 'ET-01',
        'maxillofacial anomalies'         => 'MAX-01',
    ];

    /**
     * Resolve o código do curso a partir do texto selecionado no formulário.
     */
    public static function resolveCourseCode(?string $rawCourse): ?string
    {
        if (empty($rawCourse)) {
            return null;
        }

        $lower = strtolower($rawCourse);
        foreach (self::$courseMap as $needle => $code) {
            if (str_contains($lower, $needle)) {
                return $code;
            }
        }

        return null;
    }

    /**
     * Sincroniza a inscrição concluída com o EDS HUB.
     * Deve ser chamada APÓS o aluno ser salvo com sucesso no banco de dados local.
     *
     * @param Request $request
     * @return array Resposta da sincronização
     */
    public static function syncCompletedRegistration(Request $request): array
    {
        // 1. Recuperar ou gerar identificador de tentativa
        $attemptId = $request->input('eds_form_attempt_id');
        if (empty($attemptId)) {
            $attemptId = 'att_' . time() . '_' . bin2hex(random_bytes(4));
        }

        $idempotencyKey = 'comp_' . $attemptId;

        // 2. Extrair primeiro e último nome
        $fullName = trim((string)$request->input('name', ''));
        $firstName = 'Lead';
        $lastName = null;
        if (!empty($fullName)) {
            $parts = explode(' ', $fullName, 2);
            $firstName = $parts[0];
            $lastName = $parts[1] ?? null;
        }

        // 3. Normalizar telefone (apenas números e prefixo +)
        $rawPhone = (string)$request->input('phone', '');
        $phone = preg_replace('/[^\d+]/', '', $rawPhone);
        if (!empty($phone) && !str_starts_with($phone, '+') && strlen($phone) >= 10) {
            $phone = '+' . $phone;
        }

        $rawCourse = (string)$request->input('course', '');
        $courseCode = self::resolveCourseCode($rawCourse);

        // 4. Montar Payload estritamente comercial
        // NOTA DE PRIVACIDADE: passport, dental_license, medical_conditions e dietary
        // NUNCA são incluídos neste payload.
        $payload = [
            'form_slug'           => self::FORM_SLUG,
            'idempotency_key'     => $idempotencyKey,
            'external_attempt_id' => $attemptId,
            'name'                => $fullName,
            'first_name'          => $firstName,
            'last_name'           => $lastName,
            'email'               => strtolower(trim((string)$request->input('email', ''))),
            'phone'               => $phone ?: null,
            'contact_preference'  => 'email',
            'course'              => $rawCourse,
            'course_code'         => $courseCode,
            'certificate_name'    => trim((string)$request->input('certificate_name', '')),
            'agd_number'          => trim((string)$request->input('agd_number', '')),
            'specialty'           => $request->input('specialty'),
            'years_in_practice'   => $request->input('years_in_practice'),
            'surgical_experience' => $request->input('surgical_experience'),
            'coat_size'           => trim((string)$request->input('coat_size', '')),
            'heard_from'          => $request->input('heard_from'),
            'referral_name'       => trim((string)$request->input('referral_name', '')),
            'promo_code'          => trim((string)$request->input('promo_code', '')),
            'terms_accepted'      => (bool)$request->input('terms_accepted', true),
            'source_page'         => $request->fullUrl(),
            'utm_source'          => $request->input('utm_source'),
            'utm_medium'          => $request->input('utm_medium'),
            'utm_campaign'        => $request->input('utm_campaign'),
            'utm_term'            => $request->input('utm_term'),
            'utm_content'         => $request->input('utm_content'),
        ];

        try {
            $response = Http::withHeaders([
                'Content-Type' => 'application/json',
                'apikey'       => self::EDS_HUB_ANON_KEY,
            ])
            ->timeout(6) // Timeout não-bloqueante de 6 segundos
            ->post(self::EDS_HUB_URL, $payload);

            if ($response->successful()) {
                Log::info('[EDS HUB] Inscrição sincronizada com sucesso', [
                    'attempt_id' => $attemptId,
                    'email'      => $payload['email'],
                    'status'     => $response->status(),
                    'body'       => $response->json(),
                ]);
                return ['success' => true, 'data' => $response->json()];
            }

            Log::warning('[EDS HUB] Sincronização retornou status não-200', [
                'attempt_id' => $attemptId,
                'status'     => $response->status(),
                'body'       => $response->body(),
            ]);
            return ['success' => false, 'error' => $response->body()];
        } catch (\Throwable $e) {
            // Em caso de falha de conexão com o CRM, NÃO bloqueia o sucesso do aluno no site
            Log::error('[EDS HUB] Exceção ao sincronizar com EDS HUB: ' . $e->getMessage(), [
                'attempt_id' => $attemptId,
                'trace'      => $e->getTraceAsString(),
            ]);
            return ['success' => false, 'error' => $e->getMessage()];
        }
    }
}


// =============================================================================
// PARTE 2: EXEMPLO DE CONTROLLER LARAVEL ATUALIZADO
// Arquivo de destino: app/Http/Controllers/RegisterController.php
// =============================================================================

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Facades\Storage;
use App\Services\EdsHubSyncService;
// use App\Models\Registration; // Modelo local de inscrições do site

class RegisterController extends Controller
{
    /**
     * Processa a submissão do formulário de registro.
     * Rota: POST /register
     */
    public function submit(Request $request)
    {
        // 1. Validação estrita dos campos do formulário real
        $validator = Validator::make($request->all(), [
            'name'                 => 'required|string|max:255',
            'email'                => 'required|email|max:255|confirmed',
            'phone'                => 'required|string|max:50',
            'emergency_phone'      => 'required|string|max:50',
            'specialty'            => 'required|string',
            'years_in_practice'    => 'required|string',
            'surgical_experience'  => 'required|string',
            'coat_size'            => 'required|string|max:20',
            'heard_from'           => 'required|string',
            'course'               => 'required|string',
            'terms_accepted'       => 'accepted',
            'signature'            => 'required|string|max:255',
            'date'                 => 'required|string',
            'passport'             => 'required|file|mimes:pdf,jpg,jpeg,png|max:5120',
            'dental_license'       => 'required|file|mimes:pdf,jpg,jpeg,png|max:5120',
            'g-recaptcha-response' => 'required', // Validação do Google reCAPTCHA
        ], [
            'emergency_phone.required'      => 'Emergency phone is required.',
            'specialty.required'            => 'Please select a valid specialty.',
            'years_in_practice.required'    => 'Please select a valid option.',
            'surgical_experience.required'  => 'Please select a valid option.',
            'coat_size.required'            => 'White coat size is required.',
            'heard_from.required'           => 'Please select how you heard about us.',
            'course.required'               => 'Please select a valid course.',
            'passport.required'             => 'Passport attachment is required.',
            'dental_license.required'       => 'Dental licence attachment is required.',
            'g-recaptcha-response.required' => 'Please confirm you are not a robot.',
            'terms_accepted.accepted'       => 'You must accept the terms and conditions.',
            'signature.required'            => 'Signature is required.',
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'message' => 'Please fix the errors below.',
                'errors'  => $validator->errors()
            ], 422);
        }

        // 2. Salvar arquivos físicos localmente no servidor do site
        // (Arquivos permanecem no servidor local e NÃO vão para o EDS HUB)
        $passportPath = $request->file('passport')->store('registrations/passports', 'private');
        $licensePath  = $request->file('dental_license')->store('registrations/licenses', 'private');

        // 3. Salvar registro no banco de dados local do Laravel
        /*
        $registration = Registration::create([
            'name'                 => $request->name,
            'email'                => $request->email,
            'phone'                => $request->phone,
            'certificate_name'     => $request->certificate_name,
            'agd_number'           => $request->agd_number,
            'medical_conditions'   => $request->medical_conditions,
            'emergency_phone'      => $request->emergency_phone,
            'specialty'            => $request->specialty,
            'years_in_practice'    => $request->years_in_practice,
            'surgical_experience'  => $request->surgical_experience,
            'dietary'              => $request->dietary,
            'coat_size'            => $request->coat_size,
            'heard_from'           => $request->heard_from,
            'referral_name'        => $request->referral_name,
            'course'               => $request->course,
            'promo_code'           => $request->promo_code,
            'terms_accepted'       => true,
            'signature'            => $request->signature,
            'date'                 => $request->date,
            'passport_path'        => $passportPath,
            'license_path'         => $licensePath,
            'eds_form_attempt_id'  => $request->input('eds_form_attempt_id'),
        ]);
        */

        // 4. SINCRONIZAR COM O EDS HUB (OPÇÃO B - HÍBRIDA RECOMENDADA)
        // Disparo seguro e não-bloqueante para o CRM
        EdsHubSyncService::syncCompletedRegistration($request);

        // 5. Retornar resposta JSON de sucesso para o frontend redirecionar
        return response()->json([
            'success'  => true,
            'message'  => 'Your registration has been submitted successfully!',
            'redirect' => url('/thank-you')
        ], 200);
    }
}
