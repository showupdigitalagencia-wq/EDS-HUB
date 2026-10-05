// =============================================================================
// Storage Retry Helper with Bounded Exponential Backoff & Error Classification
// =============================================================================
// Provides safe, bounded retry for downloading required course brochure PDFs.
// Strictly fast-fails on deterministic errors (404, 401, 403, invalid path).
// Retries transient errors (5xx, gateway timeout, socket reset, fetch failure).
// =============================================================================

export interface DownloadCoursePdfParams {
  // deno-lint-ignore no-explicit-any
  db: any;
  bucket: string;
  storagePath: string;
  materialId?: string | null;
  courseCode?: string | null;
  maxAttempts?: number;
  backoffDelaysMs?: number[];
  logger?: {
    log: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
}

export interface DownloadCoursePdfResult {
  data: Blob | null;
  // deno-lint-ignore no-explicit-any
  error: any | null;
  attempts: number;
}

/**
 * Classifies whether an error from Supabase Storage is deterministic (non-retryable).
 * Non-retryable errors include missing objects (404), permission errors (401/403),
 * invalid buckets/paths, and bad/malformed requests (400).
 */
// deno-lint-ignore no-explicit-any
export function isDeterministicStorageError(error: any): boolean {
  if (!error) return false;

  const status = error.status || error.statusCode || error.status_code;
  if (status === 404 || status === 400 || status === 401 || status === 403) {
    return true;
  }

  const msg = String(error.message || error.error || error || '').toLowerCase();

  // Missing object, bucket, or key (404 equivalent)
  if (
    msg.includes('not found') ||
    msg.includes('not_found') ||
    msg.includes('nosuchkey') ||
    msg.includes('does not exist') ||
    msg.includes('invalid bucket') ||
    msg.includes('invalid path') ||
    msg.includes('resource was not found')
  ) {
    return true;
  }

  // Permission / Authorization (401 / 403 equivalent)
  if (
    msg.includes('permission denied') ||
    msg.includes('unauthorized') ||
    msg.includes('forbidden') ||
    msg.includes('access denied') ||
    msg.includes('jwt expired') ||
    msg.includes('invalid signature')
  ) {
    return true;
  }

  // Malformed / Bad request (400 equivalent)
  if (msg.includes('bad request') || msg.includes('malformed') || msg.includes('invalid parameter')) {
    return true;
  }

  return false;
}

/**
 * Classifies whether an error from Supabase Storage is transient (retryable).
 * Transient errors include 5xx server/gateway errors, request timeouts (408),
 * rate limits (429), socket resets, connection drops, and fetch failures.
 */
// deno-lint-ignore no-explicit-any
export function isTransientStorageError(error: any): boolean {
  if (!error) return false;
  if (isDeterministicStorageError(error)) return false;

  const status = error.status || error.statusCode || error.status_code;
  if (typeof status === 'number') {
    if (status >= 500 && status <= 599) return true;
    if (status === 408 || status === 429) return true;
  }

  const msg = String(error.message || error.error || error || '').toLowerCase();
  if (
    msg.includes('network') ||
    msg.includes('fetch failed') ||
    msg.includes('socket') ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('gateway') ||
    msg.includes('connection') ||
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('etimedout') ||
    msg.includes('abort') ||
    msg.includes('reset') ||
    msg.includes('server error') ||
    msg.includes('empty')
  ) {
    return true;
  }

  // Default: if not identified as deterministic, treat as transient for a bounded retry
  return true;
}

/**
 * Downloads a course brochure PDF from Supabase Storage with bounded exponential retry.
 * 
 * Schedule:
 * - Attempt 1: immediate
 * - If transient failure: wait ~500ms
 * - Attempt 2: retry
 * - If transient failure: wait ~1500ms
 * - Attempt 3: final retry
 * - Then stop (max 3 attempts).
 * 
 * Deterministic failures (404, 401, 403, invalid path) fail immediately without retrying.
 * 
 * Safe internal logging records:
 * - material_id
 * - course code
 * - storage bucket
 * - storage path
 * - attempt number
 * - classification (transient_retryable vs deterministic_non_retryable)
 * - final success or failure
 * 
 * Strict Security: Never logs auth tokens, service role keys, secrets, or signed URLs.
 */
export async function downloadCourseMaterialWithRetry(
  params: DownloadCoursePdfParams
): Promise<DownloadCoursePdfResult> {
  const {
    db,
    bucket,
    storagePath,
    materialId,
    courseCode,
    maxAttempts = 3,
    backoffDelaysMs = [500, 1500],
    logger = console,
  } = params;

  // deno-lint-ignore no-explicit-any
  let lastError: any = null;
  let attemptsMade = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    attemptsMade = attempt;
    try {
      const { data, error } = await db.storage
        .from(bucket)
        .download(storagePath);

      if (!error && data && data.size > 0) {
        logger.log(
          JSON.stringify({
            event: 'course_material_download_success',
            material_id: materialId || null,
            course_code: courseCode || null,
            storage_bucket: bucket,
            storage_path: storagePath,
            attempt,
            blob_size_bytes: data.size,
            status: 'success',
          })
        );
        return { data, error: null, attempts: attempt };
      }

      lastError = error || new Error(`Downloaded blob is empty (size: ${data?.size ?? 0})`);
    } catch (err: unknown) {
      lastError = err;
    }

    const isDeterministic = isDeterministicStorageError(lastError);
    const classification = isDeterministic ? 'deterministic_non_retryable' : 'transient_retryable';

    logger.warn(
      JSON.stringify({
        event: 'course_material_download_attempt_failed',
        material_id: materialId || null,
        course_code: courseCode || null,
        storage_bucket: bucket,
        storage_path: storagePath,
        attempt,
        max_attempts: maxAttempts,
        classification,
        error_message: String(lastError?.message || lastError || 'Unknown error').slice(0, 200),
        error_status: lastError?.status || lastError?.statusCode || null,
      })
    );

    if (isDeterministic || attempt >= maxAttempts) {
      break;
    }

    const delayMs = backoffDelaysMs[attempt - 1] ?? 1500;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  logger.error(
    JSON.stringify({
      event: 'course_material_download_final_failure',
      material_id: materialId || null,
      course_code: courseCode || null,
      storage_bucket: bucket,
      storage_path: storagePath,
      total_attempts_made: attemptsMade,
      status: 'failure',
      final_error: String(lastError?.message || lastError || 'Unknown error').slice(0, 200),
    })
  );

  return { data: null, error: lastError, attempts: attemptsMade };
}
