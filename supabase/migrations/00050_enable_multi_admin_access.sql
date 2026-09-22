-- =============================================================================
-- Migration 00050: Enable Multi-Admin Access & Link Client Admin
-- =============================================================================
-- Drops the legacy singleton constraint on public.app_user to support multiple
-- concurrent active administrative users with independent credentials and audit trails.
-- Safely links the second administrative user (info@expdentalsolutions.com) to
-- public.app_user if a corresponding auth.users record already exists.
-- Does NOT fabricate auth records, embed passwords, or fail if auth user is pending.
-- =============================================================================

-- 1. Remove singleton constraints from public.app_user
ALTER TABLE public.app_user DROP CONSTRAINT IF EXISTS app_user_singleton_unique;
ALTER TABLE public.app_user DROP CONSTRAINT IF EXISTS app_user_singleton;
ALTER TABLE public.app_user ALTER COLUMN singleton_key DROP NOT NULL;
ALTER TABLE public.app_user ALTER COLUMN singleton_key DROP DEFAULT;

-- 2. Link Client Admin (info@expdentalsolutions.com) to public.app_user if Auth user exists
-- Using subquery against auth.users to dynamically retrieve the auth UID safely.
-- If the auth user does not yet exist in auth.users, this query inserts 0 rows and succeeds cleanly.
INSERT INTO public.app_user (user_id, email, display_name, is_active)
SELECT 
    id AS user_id,
    'info@expdentalsolutions.com' AS email,
    'Expert Dental Solutions Admin' AS display_name,
    true AS is_active
FROM auth.users
WHERE email = 'info@expdentalsolutions.com'
ON CONFLICT (user_id) DO UPDATE 
SET is_active = true,
    email = EXCLUDED.email,
    updated_at = now();

-- 3. Update Documentation & Comments
COMMENT ON TABLE public.app_user IS 
  'Application administrative users. Supports multiple active users with full administrative access governed by is_active_app_user().';

COMMENT ON COLUMN public.app_user.is_active IS 
  'Flag controlling system access. When false, user is immediately blocked from all tables and RPCs without losing audit history.';
