begin;

alter table if exists public.alisio_profiles
  add column if not exists agent_name text,
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists marketing_opt_in boolean not null default false,
  add column if not exists birthdate date;

update public.alisio_profiles
set marketing_opt_in = false
where marketing_opt_in is null;

alter table public.alisio_profiles
  alter column marketing_opt_in set default false,
  alter column marketing_opt_in set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'alisio_profiles_agent_name_length_check'
  ) then
    alter table public.alisio_profiles
      add constraint alisio_profiles_agent_name_length_check
      check (agent_name is null or length(trim(agent_name)) between 1 and 40);
  end if;
end
$$;

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
  new.agent_name := nullif(trim(coalesce(new.agent_name, '')), '');
  new.avatar_label := upper(left(trim(new.avatar_label), 2));
  new.avatar_url := nullif(trim(coalesce(new.avatar_url, '')), '');
  new.marketing_opt_in := coalesce(new.marketing_opt_in, false);
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

commit;
