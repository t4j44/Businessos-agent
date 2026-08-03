-- ============================================================
-- Business OS — Onboarding fields
-- Run once in Supabase SQL Editor, after 001_initial_schema.sql
-- ============================================================

-- Onboarding collects industry/contact info that clients doesn't have yet.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS industry       TEXT,
  ADD COLUMN IF NOT EXISTS contact_email  TEXT,
  ADD COLUMN IF NOT EXISTS contact_phone  TEXT;

-- Onboarding has no auth yet, so a new client can't be tied to a user_id.
-- Re-add NOT NULL once auth is wired into the onboarding flow.
ALTER TABLE clients
  ALTER COLUMN user_id DROP NOT NULL;
