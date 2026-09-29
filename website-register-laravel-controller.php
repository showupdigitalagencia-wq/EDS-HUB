<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Http\Request;

/**
 * Class EdsHubSyncService
 * 
 * Synchronizes registrations from the public website (Laravel) to EDS HUB CRM.
 * Location: app/Services/EdsHubSyncService.php
 */
class EdsHubSyncService
{
    /**
     * Public EDS HUB endpoint and publishable key.
     * These can also be configured in config/services.php or .env:
     * EDS_HUB_URL=https://xogcexclqiornuscsdmn.supabase.co
     * EDS_HUB_ANON_KEY=sb_publishable_AyrxHrDnvNXwKvk1kBDqng_TgqHMPdw
     */
    private const DEFAULT_URL = 'https://xogcexclqiornuscsdmn.supabase.co/functions/v1/submit-public-form';
    private const DEFAULT_ANON_KEY = 'sb_publishable_AyrxHrDnvNXwKvk1kBDqng_TgqHMPdw';
    private const FORM_SLUG = 'website-register';

    /**
     * Map website course selection strings to canonical EDS HUB course codes.
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
     * Resolve canonical course code from raw course string.
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
     * Synchronize a completed registration to EDS HUB.
     * 
     * Call this in your RegistrationController after saving the student record locally.
     *
     * @param Request $request The incoming registration request
     * @return array Response from EDS HUB
     */
    public static function syncCompletedRegistration(Request $request): array
    {
        $endpoint = config('services.eds_hub.url', self::DEFAULT_URL);
        $anonKey  = config('services.eds_hub.anon_key', self::DEFAULT_ANON_KEY);

        $attemptId = $request->input('eds_form_attempt_id') ?: ('att_' . time() . '_' . bin2hex(random_bytes(4)));
        $idempotencyKey = 'comp_' . $attemptId;

        // Parse first and last name
        $fullName = trim($request->input('name', ''));
        $firstName = 'Lead';
        $lastName = null;
        if (!empty($fullName)) {
            $parts = explode(' ', $fullName, 2);
            $firstName = $parts[0];
            $lastName = $parts[1] ?? null;
        }

        $rawCourse = $request->input('course', '');
        $courseCode = self::resolveCourseCode($rawCourse);

        // Sanitize phone
        $phone = preg_replace('/[^\d+]/', '', (string)$request->input('phone', ''));
        if (!empty($phone) && !str_starts_with($phone, '+') && strlen($phone) >= 10) {
            $phone = '+' . $phone;
        }

        // Build sanitized payload (STRICT PRIVACY: Exclude passwords, card numbers, medical notes, file uploads)
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
            'specialty'           => $request->input('specialty'),
            'years_in_practice'   => $request->input('years_in_practice'),
            'surgical_experience' => $request->input('surgical_experience'),
            'agd_number'          => $request->input('agd_number'),
            'heard_from'          => $request->input('heard_from'),
            'referral_name'       => $request->input('referral_name'),
            'promo_code'          => $request->input('promo_code'),
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
                'apikey'       => $anonKey,
            ])
            ->timeout(6)
            ->post($endpoint, $payload);

            if ($response->successful()) {
                Log::info('[EDS HUB] Registration synchronized successfully', [
                    'attempt_id' => $attemptId,
                    'status'     => $response->status(),
                    'data'       => $response->json(),
                ]);
                return ['success' => true, 'data' => $response->json()];
            }

            Log::warning('[EDS HUB] Synchronization returned non-200', [
                'status' => $response->status(),
                'body'   => $response->body(),
            ]);
            return ['success' => false, 'error' => $response->body()];
        } catch (\Throwable $e) {
            Log::error('[EDS HUB] Failed to sync registration: ' . $e->getMessage(), [
                'trace' => $e->getTraceAsString(),
            ]);
            // Non-blocking: failure to sync to CRM should not abort student's local registration
            return ['success' => false, 'error' => $e->getMessage()];
        }
    }
}
