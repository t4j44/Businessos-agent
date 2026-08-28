-- Storage bucket for onboarding brand assets (logos, brand guidelines, PDFs).
--
-- src/app/api/onboarding/upload/route.ts writes every uploaded file into a
-- bucket named 'brand-assets', but nothing in this repo ever created it, so
-- every upload came back "Bucket not found". This provisions it.
--
-- Private on purpose: the upload route hands back time-limited signed URLs
-- rather than permanent public links.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'brand-assets',
  'brand-assets',
  FALSE,
  10485760,  -- 10MB, matching MAX_BYTES in the upload route
  ARRAY[
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/svg+xml',
    'application/pdf'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- No RLS policies are required for the current flow. The upload route uses
-- supabaseAdmin (service role), which bypasses storage RLS, and reads go
-- through signed URLs. Policies are only needed if the browser ever talks to
-- this bucket directly with the anon/authenticated key — the optional block
-- below covers that case, scoping each client to its own `${client_id}/` folder
-- (the path layout the upload route already writes).

-- DROP POLICY IF EXISTS "brand assets: own folder read"  ON storage.objects;
-- DROP POLICY IF EXISTS "brand assets: own folder write" ON storage.objects;
--
-- CREATE POLICY "brand assets: own folder read"
--   ON storage.objects FOR SELECT TO authenticated
--   USING (
--     bucket_id = 'brand-assets'
--     AND (storage.foldername(name))[1] IN (
--       SELECT id::text FROM clients WHERE user_id = auth.uid()
--     )
--   );
--
-- CREATE POLICY "brand assets: own folder write"
--   ON storage.objects FOR INSERT TO authenticated
--   WITH CHECK (
--     bucket_id = 'brand-assets'
--     AND (storage.foldername(name))[1] IN (
--       SELECT id::text FROM clients WHERE user_id = auth.uid()
--     )
--   );
