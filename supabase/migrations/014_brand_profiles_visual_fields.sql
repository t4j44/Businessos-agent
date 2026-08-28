-- Visual brand fields extracted by brand-scout from the client's own markup.
--
-- NOTE ON NUMBERING: there is no 013 in this repo. Migrations run 001-012 plus
-- this file, so nothing is missing — the gap is intentional to match the
-- requested filename.
--
-- brand_color_primary already exists (001) and is NOT redefined here. See the
-- warning at the bottom about its DEFAULT.

ALTER TABLE brand_profiles
  ADD COLUMN IF NOT EXISTS brand_color_secondary TEXT,
  ADD COLUMN IF NOT EXISTS brand_color_accent    TEXT,
  ADD COLUMN IF NOT EXISTS brand_font_primary    TEXT,
  ADD COLUMN IF NOT EXISTS brand_font_secondary  TEXT,
  ADD COLUMN IF NOT EXISTS visual_style          TEXT,
  ADD COLUMN IF NOT EXISTS photography_style     TEXT,
  ADD COLUMN IF NOT EXISTS existing_image_urls   TEXT[];

-- ---------------------------------------------------------------------------
-- IMPORTANT — brand_color_primary carries DEFAULT '#2563EB' from 001.
--
-- That default defeats "keep the existing colour if one is already stored":
-- every row has a value the moment it is inserted, so an extracted colour would
-- never be written and the palette would stay Business OS blue forever.
--
-- The agent therefore treats '#2563EB' as "never set" and overwrites it, while
-- preserving any other existing value as a deliberate founder choice.
--
-- Dropping the default makes that distinction real rather than a special case in
-- application code. Existing rows are untouched: this only affects future
-- inserts, and the widget config route already falls back to '#2563EB' when the
-- column is null.
ALTER TABLE brand_profiles ALTER COLUMN brand_color_primary DROP DEFAULT;
