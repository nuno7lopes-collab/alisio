begin;

create table if not exists public.alisio_sharing_policies (
  owner_key text primary key,
  allow_external_use boolean not null default false,
  resource_policies jsonb,
  updated_at timestamptz not null default now(),
  updated_by_key text not null,
  updated_by_scope text not null,
  updated_by_label text not null,
  updated_by_email text
);

create table if not exists public.alisio_sharing_targets (
  target_id text primary key,
  label text not null,
  platform text,
  source_kind text not null,
  connected boolean not null default false,
  current boolean not null default false,
  owner_key text not null,
  owner_scope text not null,
  owner_label text not null,
  owner_email text,
  registered_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.alisio_sharing_requests (
  request_id text primary key,
  target_id text not null,
  target_label text not null,
  target_platform text,
  target_source_kind text not null,
  requester_key text not null,
  requester_scope text not null,
  requester_label text not null,
  requester_email text,
  owner_key text not null,
  owner_scope text not null,
  owner_label text not null,
  owner_email text,
  scopes text[] not null default '{}'::text[],
  status text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  grant_id text
);

create table if not exists public.alisio_sharing_grants (
  grant_id text primary key,
  request_id text not null,
  target_id text not null,
  target_label text not null,
  target_platform text,
  target_source_kind text not null,
  owner_key text not null,
  owner_scope text not null,
  owner_label text not null,
  owner_email text,
  grantee_key text not null,
  grantee_scope text not null,
  grantee_label text not null,
  grantee_email text,
  scopes text[] not null default '{}'::text[],
  approved_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists public.alisio_sharing_audit (
  entry_id text primary key,
  action text not null,
  actor_key text not null,
  actor_scope text not null,
  actor_label text not null,
  actor_email text,
  target_id text,
  target_label text,
  request_id text,
  grant_id text,
  summary text not null,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'alisio_sharing_policies_updated_by_scope_check'
  ) then
    alter table public.alisio_sharing_policies
      add constraint alisio_sharing_policies_updated_by_scope_check
      check (updated_by_scope in ('user', 'organization'));
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'alisio_sharing_targets_source_kind_check'
  ) then
    alter table public.alisio_sharing_targets
      add constraint alisio_sharing_targets_source_kind_check
      check (source_kind in ('current', 'node'));
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'alisio_sharing_targets_owner_scope_check'
  ) then
    alter table public.alisio_sharing_targets
      add constraint alisio_sharing_targets_owner_scope_check
      check (owner_scope in ('user', 'organization'));
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'alisio_sharing_requests_target_source_kind_check'
  ) then
    alter table public.alisio_sharing_requests
      add constraint alisio_sharing_requests_target_source_kind_check
      check (target_source_kind in ('current', 'node'));
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'alisio_sharing_requests_requester_scope_check'
  ) then
    alter table public.alisio_sharing_requests
      add constraint alisio_sharing_requests_requester_scope_check
      check (requester_scope in ('user', 'organization'));
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'alisio_sharing_requests_owner_scope_check'
  ) then
    alter table public.alisio_sharing_requests
      add constraint alisio_sharing_requests_owner_scope_check
      check (owner_scope in ('user', 'organization'));
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'alisio_sharing_requests_status_check'
  ) then
    alter table public.alisio_sharing_requests
      add constraint alisio_sharing_requests_status_check
      check (status in ('pending', 'approved', 'denied', 'revoked', 'rejected'));
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'alisio_sharing_grants_target_source_kind_check'
  ) then
    alter table public.alisio_sharing_grants
      add constraint alisio_sharing_grants_target_source_kind_check
      check (target_source_kind in ('current', 'node'));
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'alisio_sharing_grants_owner_scope_check'
  ) then
    alter table public.alisio_sharing_grants
      add constraint alisio_sharing_grants_owner_scope_check
      check (owner_scope in ('user', 'organization'));
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'alisio_sharing_grants_grantee_scope_check'
  ) then
    alter table public.alisio_sharing_grants
      add constraint alisio_sharing_grants_grantee_scope_check
      check (grantee_scope in ('user', 'organization'));
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'alisio_sharing_audit_actor_scope_check'
  ) then
    alter table public.alisio_sharing_audit
      add constraint alisio_sharing_audit_actor_scope_check
      check (actor_scope in ('user', 'organization'));
  end if;
end
$$;

create index if not exists alisio_sharing_targets_owner_key_idx
  on public.alisio_sharing_targets (owner_key);

create index if not exists alisio_sharing_requests_owner_key_idx
  on public.alisio_sharing_requests (owner_key);

create index if not exists alisio_sharing_requests_requester_key_idx
  on public.alisio_sharing_requests (requester_key);

create index if not exists alisio_sharing_requests_target_id_idx
  on public.alisio_sharing_requests (target_id);

create index if not exists alisio_sharing_grants_owner_key_idx
  on public.alisio_sharing_grants (owner_key);

create index if not exists alisio_sharing_grants_grantee_key_idx
  on public.alisio_sharing_grants (grantee_key);

create index if not exists alisio_sharing_grants_target_id_idx
  on public.alisio_sharing_grants (target_id);

create index if not exists alisio_sharing_audit_request_id_idx
  on public.alisio_sharing_audit (request_id);

create index if not exists alisio_sharing_audit_grant_id_idx
  on public.alisio_sharing_audit (grant_id);

alter table public.alisio_sharing_policies enable row level security;
alter table public.alisio_sharing_policies force row level security;
alter table public.alisio_sharing_targets enable row level security;
alter table public.alisio_sharing_targets force row level security;
alter table public.alisio_sharing_requests enable row level security;
alter table public.alisio_sharing_requests force row level security;
alter table public.alisio_sharing_grants enable row level security;
alter table public.alisio_sharing_grants force row level security;
alter table public.alisio_sharing_audit enable row level security;
alter table public.alisio_sharing_audit force row level security;

do $$
declare
  policy_name text;
  table_name text;
begin
  for table_name in
    select unnest(array[
      'alisio_sharing_policies',
      'alisio_sharing_targets',
      'alisio_sharing_requests',
      'alisio_sharing_grants',
      'alisio_sharing_audit'
    ])
  loop
    for policy_name in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = table_name
    loop
      execute format('drop policy if exists %I on public.%I', policy_name, table_name);
    end loop;
  end loop;
end
$$;

create policy "alisio_sharing_policies_select_authenticated"
on public.alisio_sharing_policies
for select
to authenticated
using (true);

create policy "alisio_sharing_policies_insert_owner"
on public.alisio_sharing_policies
for insert
to authenticated
with check (
  owner_key = ('user:' || auth.uid()::text)
  and updated_by_key = ('user:' || auth.uid()::text)
);

create policy "alisio_sharing_policies_update_owner"
on public.alisio_sharing_policies
for update
to authenticated
using (owner_key = ('user:' || auth.uid()::text))
with check (
  owner_key = ('user:' || auth.uid()::text)
  and updated_by_key = ('user:' || auth.uid()::text)
);

create policy "alisio_sharing_targets_select_authenticated"
on public.alisio_sharing_targets
for select
to authenticated
using (true);

create policy "alisio_sharing_targets_insert_owner"
on public.alisio_sharing_targets
for insert
to authenticated
with check (owner_key = ('user:' || auth.uid()::text));

create policy "alisio_sharing_targets_update_owner"
on public.alisio_sharing_targets
for update
to authenticated
using (owner_key = ('user:' || auth.uid()::text))
with check (owner_key = ('user:' || auth.uid()::text));

create policy "alisio_sharing_requests_select_participants"
on public.alisio_sharing_requests
for select
to authenticated
using (
  requester_key = ('user:' || auth.uid()::text)
  or owner_key = ('user:' || auth.uid()::text)
);

create policy "alisio_sharing_requests_insert_requester"
on public.alisio_sharing_requests
for insert
to authenticated
with check (requester_key = ('user:' || auth.uid()::text));

create policy "alisio_sharing_requests_update_participants"
on public.alisio_sharing_requests
for update
to authenticated
using (
  requester_key = ('user:' || auth.uid()::text)
  or owner_key = ('user:' || auth.uid()::text)
)
with check (
  requester_key = ('user:' || auth.uid()::text)
  or owner_key = ('user:' || auth.uid()::text)
);

create policy "alisio_sharing_grants_select_participants"
on public.alisio_sharing_grants
for select
to authenticated
using (
  owner_key = ('user:' || auth.uid()::text)
  or grantee_key = ('user:' || auth.uid()::text)
);

create policy "alisio_sharing_grants_insert_participants"
on public.alisio_sharing_grants
for insert
to authenticated
with check (
  owner_key = ('user:' || auth.uid()::text)
  or grantee_key = ('user:' || auth.uid()::text)
);

create policy "alisio_sharing_grants_update_participants"
on public.alisio_sharing_grants
for update
to authenticated
using (
  owner_key = ('user:' || auth.uid()::text)
  or grantee_key = ('user:' || auth.uid()::text)
)
with check (
  owner_key = ('user:' || auth.uid()::text)
  or grantee_key = ('user:' || auth.uid()::text)
);

create policy "alisio_sharing_audit_select_authenticated"
on public.alisio_sharing_audit
for select
to authenticated
using (true);

create policy "alisio_sharing_audit_insert_actor"
on public.alisio_sharing_audit
for insert
to authenticated
with check (actor_key = ('user:' || auth.uid()::text));

revoke all on public.alisio_sharing_policies from anon;
revoke all on public.alisio_sharing_targets from anon;
revoke all on public.alisio_sharing_requests from anon;
revoke all on public.alisio_sharing_grants from anon;
revoke all on public.alisio_sharing_audit from anon;

grant select, insert, update on public.alisio_sharing_policies to authenticated;
grant select, insert, update on public.alisio_sharing_targets to authenticated;
grant select, insert, update on public.alisio_sharing_requests to authenticated;
grant select, insert, update on public.alisio_sharing_grants to authenticated;
grant select, insert on public.alisio_sharing_audit to authenticated;

commit;
