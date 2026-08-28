-- A named human to write to.
--
-- Prospected leads are businesses, not people: `leads.name` holds "Austin
-- Dental Care". Hunter Generate was being handed that as the recipient's name,
-- so cold emails opened "Hi Austin Dental Care," — obviously automated.
--
-- Hunter Enrich now looks for a real contact on the company's own site and
-- stores it here. Both columns stay NULL when no specific person is
-- identifiable; the email then opens without a name rather than inventing one.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS contact_name TEXT,
  ADD COLUMN IF NOT EXISTS contact_role TEXT;
