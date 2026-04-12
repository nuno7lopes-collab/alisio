begin;

create table if not exists public.alisio_memory_snapshots (
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  profile_id text not null,
  workspace_scope text not null,
  backend text not null,
  projection_interface text not null default 'markdown-repo',
  sync_mode text not null default 'local-first',
  last_writer_device_id text not null,
  last_writer_state_dir text,
  content_hash text not null,
  snapshot jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (owner_user_id, profile_id, workspace_scope)
);

create table if not exists public.alisio_memory_snapshot_backups (
  backup_id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  profile_id text not null,
  workspace_scope text not null,
  writer_device_id text not null,
  writer_state_dir text,
  content_hash text not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'alisio_memory_snapshots_backend_check'
  ) then
    alter table public.alisio_memory_snapshots
      add constraint alisio_memory_snapshots_backend_check
      check (backend in ('builtin', 'qmd'));
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'alisio_memory_snapshots_projection_interface_check'
  ) then
    alter table public.alisio_memory_snapshots
      add constraint alisio_memory_snapshots_projection_interface_check
      check (projection_interface = 'markdown-repo');
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'alisio_memory_snapshots_sync_mode_check'
  ) then
    alter table public.alisio_memory_snapshots
      add constraint alisio_memory_snapshots_sync_mode_check
      check (sync_mode = 'local-first');
  end if;
end
$$;

create index if not exists alisio_memory_snapshot_backups_owner_scope_idx
  on public.alisio_memory_snapshot_backups (owner_user_id, profile_id, workspace_scope, created_at desc);

alter table public.alisio_memory_snapshots enable row level security;
alter table public.alisio_memory_snapshots force row level security;
alter table public.alisio_memory_snapshot_backups enable row level security;
alter table public.alisio_memory_snapshot_backups force row level security;

do $$
declare
  policy_name text;
begin
  for policy_name in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'alisio_memory_snapshots'
  loop
    execute format('drop policy if exists %I on public.alisio_memory_snapshots', policy_name);
  end loop;
end
$$;

do $$
declare
  policy_name text;
begin
  for policy_name in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'alisio_memory_snapshot_backups'
  loop
    execute format('drop policy if exists %I on public.alisio_memory_snapshot_backups', policy_name);
  end loop;
end
$$;

create policy "alisio_memory_snapshots_select_own"
on public.alisio_memory_snapshots
for select
to authenticated
using (auth.uid() = owner_user_id);

create policy "alisio_memory_snapshots_insert_own"
on public.alisio_memory_snapshots
for insert
to authenticated
with check (auth.uid() = owner_user_id);

create policy "alisio_memory_snapshots_update_own"
on public.alisio_memory_snapshots
for update
to authenticated
using (auth.uid() = owner_user_id)
with check (auth.uid() = owner_user_id);

create policy "alisio_memory_snapshot_backups_select_own"
on public.alisio_memory_snapshot_backups
for select
to authenticated
using (auth.uid() = owner_user_id);

create policy "alisio_memory_snapshot_backups_insert_own"
on public.alisio_memory_snapshot_backups
for insert
to authenticated
with check (auth.uid() = owner_user_id);

revoke all on public.alisio_memory_snapshots from anon;
revoke all on public.alisio_memory_snapshot_backups from anon;
grant select, insert, update on public.alisio_memory_snapshots to authenticated;
grant select, insert on public.alisio_memory_snapshot_backups to authenticated;

commit;
