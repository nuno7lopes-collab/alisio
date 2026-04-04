begin;

alter table if exists public.alisio_profiles
  add column if not exists updated_at timestamptz not null default now();

update public.alisio_profiles
set
  email = lower(trim(email)),
  username = lower(trim(username)),
  plan = case
    when lower(trim(coalesce(plan, ''))) in ('plus', 'plus plan') then 'plus'
    else 'free'
  end;

with normalized_usernames as (
  select
    user_id,
    case
      when lower(trim(coalesce(username, ''))) ~ '^[a-z0-9._]{4,15}$' then lower(trim(username))
      else left(
        coalesce(
          nullif(regexp_replace(lower(trim(coalesce(username, ''))), '[^a-z0-9._]+', '', 'g'), ''),
          'user'
        ),
        9
      ) || '_' || left(replace(user_id::text, '-', ''), 5)
    end as normalized_username
  from public.alisio_profiles
)
update public.alisio_profiles profile
set username = normalized_usernames.normalized_username
from normalized_usernames
where profile.user_id = normalized_usernames.user_id
  and profile.username is distinct from normalized_usernames.normalized_username;

do $$
begin
  if exists (
    select 1
    from public.alisio_profiles
    group by lower(trim(username))
    having count(*) > 1
  ) then
    raise exception
      'alisio_profiles contains usernames that collide after lowercase normalization; resolve duplicates before applying SaaS constraints';
  end if;
end
$$;

alter table public.alisio_profiles
  alter column email set not null,
  alter column display_name set not null,
  alter column username set not null,
  alter column avatar_label set not null,
  alter column joined_at set not null,
  alter column plan set not null,
  alter column plan set default 'free',
  alter column profile_completed set not null,
  alter column profile_completed set default false,
  alter column updated_at set default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'alisio_profiles_username_format_check'
  ) then
    alter table public.alisio_profiles
      add constraint alisio_profiles_username_format_check
      check (username ~ '^[a-z0-9._]{4,15}$');
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'alisio_profiles_display_name_not_blank_check'
  ) then
    alter table public.alisio_profiles
      add constraint alisio_profiles_display_name_not_blank_check
      check (length(trim(display_name)) > 0);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'alisio_profiles_avatar_label_length_check'
  ) then
    alter table public.alisio_profiles
      add constraint alisio_profiles_avatar_label_length_check
      check (length(trim(avatar_label)) between 1 and 2);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'alisio_profiles_plan_check'
  ) then
    alter table public.alisio_profiles
      add constraint alisio_profiles_plan_check
      check (plan in ('free', 'plus'));
  end if;
end
$$;

create unique index if not exists alisio_profiles_username_unique_idx
  on public.alisio_profiles (username);

create or replace function public.alisio_apply_profile_invariants()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  auth_email text;
  auth_user_id uuid;
  is_service_role boolean;
begin
  is_service_role := coalesce(auth.role(), '') = 'service_role';
  auth_user_id := auth.uid();

  if not is_service_role then
    if auth_user_id is null then
      raise exception 'authenticated Alisio profile writes require auth.uid()';
    end if;
    if tg_op = 'INSERT' and new.user_id is null then
      new.user_id := auth_user_id;
    end if;
    if new.user_id is distinct from auth_user_id then
      raise exception 'cannot write an Alisio profile for another user';
    end if;
  end if;

  select lower(email)
  into auth_email
  from auth.users
  where id = new.user_id;

  if auth_email is null then
    raise exception 'missing auth.users row for Alisio profile %', new.user_id;
  end if;

  new.email := auth_email;
  new.username := lower(trim(new.username));
  new.display_name := trim(new.display_name);
  new.avatar_label := upper(left(trim(new.avatar_label), 2));
  new.avatar_url := nullif(trim(coalesce(new.avatar_url, '')), '');
  new.plan := case
    when lower(trim(coalesce(new.plan, ''))) = 'plus' then
      case when is_service_role then 'plus' else coalesce(old.plan, 'free') end
    else
      case
        when tg_op = 'INSERT' then 'free'
        when is_service_role then 'free'
        else coalesce(old.plan, 'free')
      end
  end;
  new.joined_at := case
    when tg_op = 'INSERT' then coalesce(new.joined_at, now())
    else old.joined_at
  end;
  new.updated_at := now();

  return new;
end
$$;

drop trigger if exists alisio_profiles_invariants on public.alisio_profiles;
create trigger alisio_profiles_invariants
before insert or update on public.alisio_profiles
for each row
execute function public.alisio_apply_profile_invariants();

alter table public.alisio_profiles enable row level security;
alter table public.alisio_profiles force row level security;

do $$
declare
  policy_name text;
begin
  for policy_name in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'alisio_profiles'
  loop
    execute format('drop policy if exists %I on public.alisio_profiles', policy_name);
  end loop;
end
$$;

create policy "alisio_profiles_select_own"
on public.alisio_profiles
for select
to authenticated
using (auth.uid() = user_id);

create policy "alisio_profiles_insert_own"
on public.alisio_profiles
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "alisio_profiles_update_own"
on public.alisio_profiles
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

revoke all on public.alisio_profiles from anon;
grant select, insert, update on public.alisio_profiles to authenticated;

commit;
