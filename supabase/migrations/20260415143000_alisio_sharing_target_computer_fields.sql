begin;

alter table if exists public.alisio_sharing_targets
  add column if not exists computer_id text;

alter table if exists public.alisio_sharing_targets
  add column if not exists computer_label text;

commit;
