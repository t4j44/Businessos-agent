#!/usr/bin/env bash
#
# Overture Maps Places → CSV, for bulk import into the overture_places table.
#
# RUN THIS MANUALLY. It is not part of the build and nothing in the app calls
# it. It streams several hundred MB from S3 and takes a few minutes.
#
# ── RELEASE DATE ──────────────────────────────────────────────────────────
# Overture publishes monthly. The release below is pinned so a re-run is
# reproducible; update RELEASE to the newest release when refreshing the data.
# Release identifiers look like YYYY-MM-DD.N.
#
# ── LICENCE ───────────────────────────────────────────────────────────────
# Overture Places is CDLA Permissive 2.0 — storage, modification and commercial
# use are permitted with attribution. The attribution notice is rendered by
# src/components/Attribution.tsx on the Hunter page and must stay there.
#
# Usage:
#   ./scripts/overture-etl.sh TX "dentist,dental_clinic"
#   ./scripts/overture-etl.sh CA "restaurant"

set -euo pipefail

RELEASE="2026-08-19.0"

# ── DuckDB present? ───────────────────────────────────────────────────────
if ! command -v duckdb >/dev/null 2>&1; then
  echo "DuckDB is not installed."
  echo
  case "$(uname -s)" in
    Darwin)  echo "  brew install duckdb" ;;
    Linux)   echo "  curl -L https://install.duckdb.org | sh"
             echo "  (or: sudo snap install duckdb)" ;;
    MINGW*|MSYS*|CYGWIN*)
             echo "  winget install DuckDB.cli"
             echo "  (or: scoop install duckdb)" ;;
    *)       echo "  See the DuckDB installation page for your platform." ;;
  esac
  echo
  exit 1
fi

# ── Arguments ─────────────────────────────────────────────────────────────
if [ "$#" -lt 2 ]; then
  echo "Usage: $0 <STATE_CODE> <comma-separated categories>"
  echo "Example: $0 TX \"dentist,dental_clinic\""
  exit 1
fi

STATE="$(echo "$1" | tr '[:lower:]' '[:upper:]')"
CATEGORIES_RAW="$2"

if ! echo "$STATE" | grep -qE '^[A-Z]{2}$'; then
  echo "State must be a two-letter code, e.g. TX. Got: $STATE"
  exit 1
fi

# "dentist,dental_clinic" → "'dentist','dental_clinic"'
# Whitespace around commas is tolerated; empty entries are dropped.
CATEGORIES=$(
  echo "$CATEGORIES_RAW" \
    | tr ',' '\n' \
    | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' \
    | grep -v '^$' \
    | sed "s/'/''/g; s/^/'/; s/$/'/" \
    | paste -sd, -
)

if [ -z "$CATEGORIES" ]; then
  echo "No usable categories parsed from: $CATEGORIES_RAW"
  exit 1
fi

OUTFILE="overture_${STATE}.csv"

echo "Release:    $RELEASE"
echo "State:      $STATE"
echo "Categories: $CATEGORIES"
echo "Output:     $OUTFILE"
echo
echo "Streaming from S3 — this takes a few minutes..."
echo

# ── Extract ───────────────────────────────────────────────────────────────
# Column order matches the overture_places table so the CSV import maps 1:1.
duckdb -c "
INSTALL spatial; LOAD spatial;
INSTALL httpfs;  LOAD httpfs;
SET s3_region='us-west-2';

COPY (
  SELECT
    id                                  AS overture_id,
    names.primary                       AS name,
    categories.primary                  AS category,
    websites[1]                         AS website,
    phones[1]                           AS phone,
    emails[1]                           AS email,
    addresses[1].freeform               AS address,
    addresses[1].locality               AS city,
    addresses[1].region                 AS state,
    addresses[1].postcode               AS postcode,
    ST_Y(ST_GeomFromWKB(geometry))      AS latitude,
    ST_X(ST_GeomFromWKB(geometry))      AS longitude,
    confidence
  FROM read_parquet(
    's3://overturemaps-us-west-2/release/${RELEASE}/theme=places/type=place/*',
    hive_partitioning=1
  )
  WHERE addresses[1].region = '${STATE}'
    AND categories.primary IN (${CATEGORIES})
    AND confidence > 0.6
    AND websites[1] IS NOT NULL
) TO '${OUTFILE}' (FORMAT CSV, HEADER);
"

# ── Report ────────────────────────────────────────────────────────────────
if [ ! -f "$OUTFILE" ]; then
  echo "No output file was produced."
  exit 1
fi

# Subtract the header row.
ROWS=$(($(wc -l < "$OUTFILE") - 1))
SIZE=$(du -h "$OUTFILE" | cut -f1)

echo
echo "Done."
echo "  Rows: $ROWS"
echo "  Size: $SIZE"
echo "  File: $OUTFILE"
echo

if [ "$ROWS" -le 0 ]; then
  echo "No rows matched. Check the category names against Overture's category"
  echo "list — they are snake_case, e.g. 'dentist', not 'Dentists'."
  exit 0
fi

echo "Next step — import into Supabase:"
echo
echo "  Table Editor → overture_places → Import data from CSV"
echo "  Select: $OUTFILE"
echo
echo "The CSV column order matches the table, so the mapping is 1:1."
