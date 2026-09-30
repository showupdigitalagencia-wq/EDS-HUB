-- =============================================================================
-- Migration 00093: Add Titan Sent Folder Sync Columns to Outbound Messages
-- =============================================================================
-- Tracks IMAP synchronization of Resend outbound emails to Titan mailbox
-- (info@expdentalsolutions.com / Sent).
-- Completely isolated from Resend email delivery status.
-- =============================================================================

ALTER TABLE public.outbound_messages
  ADD COLUMN IF NOT EXISTS titan_sync_status TEXT DEFAULT 'pending'
    CHECK (titan_sync_status IN ('pending', 'synced', 'failed', 'skipped', 'not_applicable')),
  ADD COLUMN IF NOT EXISTS titan_synced_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS titan_sync_error TEXT NULL,
  ADD COLUMN IF NOT EXISTS titan_sent_folder TEXT NULL;

COMMENT ON COLUMN public.outbound_messages.titan_sync_status IS
  'Status of syncing the exact MIME copy of outbound email to Titan Sent mailbox. Fully isolated from Resend delivery status.';

CREATE INDEX IF NOT EXISTS idx_outbound_messages_titan_status
  ON public.outbound_messages(titan_sync_status)
  WHERE channel = 'email';
