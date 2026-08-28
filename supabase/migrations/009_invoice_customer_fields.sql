-- Invoice customer + due-date columns.
--
-- 001_initial_schema.sql declares `invoices` with only contact_id and
-- stripe_invoice_id to identify who owes the money. But existing code already
-- reads columns that were never declared:
--
--   src/app/api/dashboard/invoices/route.ts   → customer_name, customer_email, due_date
--   src/app/api/agents/invoice-chase/run/route.ts → customer_name, customer_email
--
-- and the invoice email needs customer_email and due_date to send at all.
-- Idempotent, so it is safe whether or not these were added by hand earlier.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS customer_name  TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS customer_email TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS due_date       DATE;

-- The chase batch filters by client and orders by days_overdue on every run.
CREATE INDEX IF NOT EXISTS idx_invoices_client_overdue
  ON invoices (client_id, days_overdue DESC);
