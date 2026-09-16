-- =============================================================================
-- Migration 001: app_user
-- =============================================================================
-- Single-user table linked to auth.users.
-- The singleton_key constraint ensures only ONE user can exist.
-- =============================================================================

CREATE TABLE public.app_user (
  user_id     UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  singleton_key INTEGER NOT NULL DEFAULT 1
    CONSTRAINT app_user_singleton CHECK (singleton_key = 1)
    CONSTRAINT app_user_singleton_unique UNIQUE,
  email       TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.app_user IS
  'Single application user. The singleton_key constraint ensures only one user can exist.';
COMMENT ON COLUMN public.app_user.singleton_key IS
  'Always 1. UNIQUE constraint prevents more than one row.';
