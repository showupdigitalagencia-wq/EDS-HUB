// =============================================================================
// Auth verification for Edge Functions
// =============================================================================

import { createUserClient, createAdminClient } from './supabase-client.ts';

export interface AuthResult {
  isAuthorized: boolean;
  userId: string | null;
  error: string | null;
  statusCode: number;
}

/**
 * Verifies that the request comes from an authenticated user
 * who is an active member of app_user.
 */
export async function verifyAuth(authHeader: string | null): Promise<AuthResult> {
  if (!authHeader) {
    return { isAuthorized: false, userId: null, error: 'Missing authorization header', statusCode: 401 };
  }

  try {
    // Verify the JWT and get user
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const userClient = createUserClient(authHeader);
    const { data: { user }, error: authError } = await userClient.auth.getUser(token);

    if (authError || !user) {
      return { isAuthorized: false, userId: null, error: 'Invalid or expired token', statusCode: 401 };
    }

    // Check if user is in app_user and active
    const adminClient = createAdminClient();
    const { data: appUser, error: appUserError } = await adminClient
      .from('app_user')
      .select('user_id, is_active')
      .eq('user_id', user.id)
      .maybeSingle();

    if (appUserError || !appUser) {
      return { isAuthorized: false, userId: user.id, error: 'User not authorized in app_user', statusCode: 403 };
    }

    if (!appUser.is_active) {
      return { isAuthorized: false, userId: user.id, error: 'User account is inactive', statusCode: 403 };
    }

    return { isAuthorized: true, userId: user.id, error: null, statusCode: 200 };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Auth verification failed';
    return { isAuthorized: false, userId: null, error: message, statusCode: 401 };
  }
}
