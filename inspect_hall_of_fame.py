import os
import re
import sys
from collections import Counter

from supabase import create_client


VALID_SOURCE_TYPES = {"doi", "pdf_upload"}
UPLOAD_MARKERS = {"manual_upload", "uploaded_file", "upload", "manual"}


def normalize_doi(value):
    if not value:
        return ""

    trimmed = str(value).strip()
    if not trimmed:
        return ""

    lowered = trimmed.lower()
    if lowered in UPLOAD_MARKERS:
        return ""

    normalized = trimmed
    prefixes = (
        "doi:",
        "https://doi.org/",
        "http://doi.org/",
        "https://dx.doi.org/",
        "http://dx.doi.org/",
        "doi.org/",
        "dx.doi.org/",
    )
    for prefix in prefixes:
        if normalized.lower().startswith(prefix):
            normalized = normalized[len(prefix):].strip()
            break

    return normalized if re.match(r"^10\.\S+/\S+$", normalized, re.IGNORECASE) else ""


def normalize_source_type(value, doi=None):
    if value:
        normalized = str(value).strip().lower()
        if normalized in VALID_SOURCE_TYPES:
            return normalized
    return "doi" if normalize_doi(doi) else "pdf_upload"


def fetch_all_rows(client, table_name="images", batch_size=500):
    rows = []
    offset = 0

    while True:
        response = (
            client.table(table_name)
            .select("id,doi,source_type,storage_path,likes,created_at")
            .order("created_at", desc=True)
            .range(offset, offset + batch_size - 1)
            .execute()
        )
        batch = response.data or []
        rows.extend(batch)
        if len(batch) < batch_size:
            break
        offset += batch_size

    return rows


def compact_row(row):
    return (
        f"id={row.get('id')} "
        f"source_type={row.get('source_type')!r} "
        f"normalized={normalize_source_type(row.get('source_type'), row.get('doi'))!r} "
        f"doi={row.get('doi')!r} "
        f"likes={row.get('likes')} "
        f"path={row.get('storage_path')!r}"
    )


def print_section(title, rows, limit=10):
    print(f"\n{title}: {len(rows)}")
    for row in rows[:limit]:
        print(f"  - {compact_row(row)}")
    if len(rows) > limit:
        print(f"  ... {len(rows) - limit} more")


def main():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    table_name = os.environ.get("HALL_OF_FAME_TABLE", "images")

    if not url or not key:
        print("Missing SUPABASE_URL or SUPABASE_KEY.")
        print("Set them in the shell, then run: python inspect_hall_of_fame.py")
        return 1

    try:
        client = create_client(url, key)
        rows = fetch_all_rows(client, table_name=table_name)
    except Exception as exc:
        print(f"Failed to query Supabase table '{table_name}': {exc}")
        return 1

    explicit_counts = Counter()
    normalized_counts = Counter()

    missing_source_type = []
    invalid_source_type = []
    placeholder_doi = []
    likely_needs_source_backfill = []
    pdf_upload_with_doi = []

    for row in rows:
        raw_source_type = str(row.get("source_type") or "").strip().lower()
        normalized_doi = normalize_doi(row.get("doi"))
        normalized_source_type = normalize_source_type(row.get("source_type"), row.get("doi"))

        explicit_counts[raw_source_type or "<missing>"] += 1
        normalized_counts[normalized_source_type] += 1

        if not raw_source_type:
            missing_source_type.append(row)
        elif raw_source_type not in VALID_SOURCE_TYPES:
            invalid_source_type.append(row)

        if str(row.get("doi") or "").strip().lower() in UPLOAD_MARKERS:
            placeholder_doi.append(row)

        if normalized_doi and raw_source_type != "doi":
            likely_needs_source_backfill.append(row)

        if raw_source_type == "pdf_upload" and normalized_doi:
            pdf_upload_with_doi.append(row)

    print(f"Table: {table_name}")
    print(f"Total rows: {len(rows)}")

    print("\nExplicit source_type counts:")
    for key, count in explicit_counts.most_common():
        print(f"  - {key}: {count}")

    print("\nNormalized source_type counts:")
    for key, count in normalized_counts.most_common():
        print(f"  - {key}: {count}")

    print_section("Rows missing source_type", missing_source_type)
    print_section("Rows with invalid source_type", invalid_source_type)
    print_section("Rows with placeholder DOI markers", placeholder_doi)
    print_section("Rows with DOI-like values but not explicitly marked as doi", likely_needs_source_backfill)
    print_section("Rows explicitly marked pdf_upload but still carrying a DOI-like value", pdf_upload_with_doi)

    if likely_needs_source_backfill or pdf_upload_with_doi:
        print("\nManual review note:")
        print("  Rows that already contain a real DOI string may still need human review.")
        print("  The app can now hide badges based on source_type, but legacy provenance cannot be inferred perfectly.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
