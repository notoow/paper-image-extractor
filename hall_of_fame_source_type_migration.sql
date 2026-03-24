-- Add provenance tracking for Hall of Fame images.
-- This lets the app hide DOI badges for PDF-upload-based entries.
--
-- Important limitation:
-- If an old PDF-upload row was mistakenly saved with a real DOI string,
-- SQL alone cannot reliably infer that it came from a PDF upload.
-- Those rows should be reviewed with inspect_hall_of_fame.py.

alter table public.images
add column if not exists source_type text;

-- Clean up placeholder DOI markers that should never be shown as real DOI data.
update public.images
set doi = null
where lower(trim(coalesce(doi, ''))) in ('manual_upload', 'uploaded_file', 'upload', 'manual');

-- Backfill source_type for obvious cases.
update public.images
set source_type = case
    when lower(trim(coalesce(source_type, ''))) in ('doi', 'pdf_upload')
        then lower(trim(source_type))
    when coalesce(doi, '') ~* '^(doi:\s*)?10\.\S+/\S+$'
        then 'doi'
    when coalesce(doi, '') ~* '^https?://(dx\.)?doi\.org/10\.\S+/\S+$'
        then 'doi'
    when coalesce(doi, '') ~* '^(dx\.)?doi\.org/10\.\S+/\S+$'
        then 'doi'
    else 'pdf_upload'
end
where source_type is null
   or lower(trim(source_type)) not in ('doi', 'pdf_upload');

alter table public.images
add constraint images_source_type_check
check (source_type in ('doi', 'pdf_upload')) not valid;

alter table public.images
validate constraint images_source_type_check;

create index if not exists images_source_type_idx
on public.images (source_type);
