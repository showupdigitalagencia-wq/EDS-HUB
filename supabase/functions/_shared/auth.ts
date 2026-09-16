// =============================================================================
// Auth verification for Edge Functions
// =============================================================================

import { createUserClient, createAdminClient } from './supabase-client.ts';

interface AuthResult {
  isAuthorized: boolean;
  userId: string | null;
  error: string | null;
}

/**
 * Verifies that the request comes from an authenticated user
 * who is an active member of app_user.
 */
export async function verifyAuth(authHeader: string | null): Promise<AuthResult> {
  if (!authHeader) {
    return { isAuthorized: false, userId: null, error: 'Missing authorization header' };
  }

  try {
    // Verify the JWT and get user
    const userClient = createUserClient(authHeader);
    const { data: { user }, error: authError } = await userClient.auth.getUser();

    if (authError || !user) {
      return { isAuthorized: false, userId: null, error: 'Invalid or expired token' };
    }

    // Check if user is in app_user and active
    const adminClient = createAdminClient();
    const { data: appUser, error: appUserError } = await adminClient
      .from('app_user')
      .select('user_id, is_active')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single();

    if (appUserError || !appUser) {
      return { isAuthorized: false, userId: user.id, error: 'User not authorized in app_user' };
    }

    return { isAuthorized: true, userId: user.id, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Auth verification failed';
    return { isAuthorized: false, userId: null, error: message };
  }
}
