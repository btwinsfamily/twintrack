-- Run once in Supabase SQL Editor. Do not put a service-role key in the frontend.

create table public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create table public.family_members (
  family_id uuid not null references public.families(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','caregiver')),
  joined_at timestamptz not null default now(),
  primary key (family_id,user_id)
);
create table public.babies (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  birth_date date,
  birth_time time(0) without time zone check (birth_time < time '24:00'),
  check (birth_time is null or birth_date is not null),
  created_at timestamptz not null default now(),
  unique (id,family_id)
);
-- Preserve recorded local birth date/time once both have been saved.
create function public.protect_baby_birth() returns trigger
language plpgsql set search_path = '' as $$
begin
 if old.birth_time is not null and
    (new.birth_date is distinct from old.birth_date or new.birth_time is distinct from old.birth_time) then
   raise exception 'Recorded birth date and time cannot be changed';
 end if;
 return new;
end $$;
create trigger baby_birth_protect before update on public.babies
for each row execute function public.protect_baby_birth();

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null,
  baby_id uuid not null,
  kind text not null check (kind in ('feed','diaper','sleep','medicine','note')),
  started_at timestamptz not null,
  ended_at timestamptz,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details)='object' and pg_column_size(details) <= 8192),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (baby_id,family_id) references public.babies(id,family_id) on delete cascade,
  check (ended_at is null or ended_at >= started_at),
  check (kind <> 'sleep' or ended_at is null or ended_at <= started_at + interval '48 hours')
);
create table public.growth (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null,
  baby_id uuid not null,
  measured_at timestamptz not null default now(),
  weight_kg numeric(5,3) check (weight_kg > 0 and weight_kg < 40),
  length_cm numeric(5,1) check (length_cm > 0 and length_cm < 160),
  head_cm numeric(4,1) check (head_cm > 0 and head_cm < 80),
  note text check (length(note) <= 500),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (baby_id,family_id) references public.babies(id,family_id) on delete cascade,
  check (weight_kg is not null or length_cm is not null or head_cm is not null)
);
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  email text not null,
  token_hash text not null unique,
  created_by uuid not null references auth.users(id),
  expires_at timestamptz not null default now() + interval '7 days',
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.activities(baby_id,started_at desc);
create index on public.growth(baby_id,measured_at desc);
create index on public.invitations(token_hash) where used_at is null;

-- SECURITY DEFINER helpers avoid recursive membership RLS.
create function public.is_family_member(fid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.family_members m where m.family_id = fid and m.user_id = (select auth.uid()));
$$;
create function public.is_family_owner(fid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.family_members m where m.family_id = fid and m.user_id = (select auth.uid()) and m.role='owner');
$$;
revoke all on function public.is_family_member(uuid) from public;
revoke all on function public.is_family_owner(uuid) from public;
grant execute on function public.is_family_member(uuid), public.is_family_owner(uuid) to authenticated;

create function public.on_family_created() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 insert into public.family_members(family_id,user_id,role) values(new.id,new.created_by,'owner');
 return new;
end $$;
create trigger family_created after insert on public.families for each row execute function public.on_family_created();

create function public.touch_activity() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;
create trigger activity_updated before update on public.activities for each row execute function public.touch_activity();

-- Prevent reassignment of identity/ownership fields through UPDATE.
create function public.protect_activity_identity() returns trigger language plpgsql set search_path = '' as $$
begin
 if new.family_id <> old.family_id or new.baby_id <> old.baby_id or new.created_by <> old.created_by or new.created_at <> old.created_at then
   raise exception 'Activity identity fields are immutable';
 end if;
 return new;
end $$;
create trigger activity_protect before update on public.activities for each row execute function public.protect_activity_identity();

alter table public.families enable row level security;
alter table public.family_members enable row level security;
alter table public.babies enable row level security;
alter table public.activities enable row level security;
alter table public.growth enable row level security;
alter table public.invitations enable row level security;

create policy families_select on public.families for select to authenticated using (public.is_family_member(id));
create policy families_insert on public.families for insert to authenticated with check (created_by = (select auth.uid()));
create policy members_select on public.family_members for select to authenticated using (public.is_family_member(family_id));
create policy babies_select on public.babies for select to authenticated using (public.is_family_member(family_id));
create policy babies_insert on public.babies for insert to authenticated with check (public.is_family_owner(family_id));
create policy babies_update on public.babies for update to authenticated using (public.is_family_owner(family_id)) with check (public.is_family_owner(family_id));
create policy activities_select on public.activities for select to authenticated using (public.is_family_member(family_id));
create policy activities_insert on public.activities for insert to authenticated with check (public.is_family_member(family_id) and created_by=(select auth.uid()));
create policy activities_update on public.activities for update to authenticated using (public.is_family_member(family_id)) with check (public.is_family_member(family_id));
create policy activities_delete on public.activities for delete to authenticated using (public.is_family_member(family_id));
create policy growth_select on public.growth for select to authenticated using (public.is_family_member(family_id));
create policy growth_insert on public.growth for insert to authenticated with check (public.is_family_member(family_id) and created_by=(select auth.uid()));
create policy growth_delete on public.growth for delete to authenticated using (public.is_family_member(family_id));
-- Invitations have no client-side direct access: token verification is server-side only.

create function public.create_family_invite(fid uuid, invited_email text, invite_token_hash text)
returns void language plpgsql security definer set search_path = '' as $$
begin
 if not public.is_family_owner(fid) then raise exception 'Only family owners may invite'; end if;
 if invited_email is null or invited_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Invalid email'; end if;
 if invite_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid token hash'; end if;
 insert into public.invitations(family_id,email,token_hash,created_by)
 values(fid,lower(trim(invited_email)),invite_token_hash,auth.uid());
end $$;
create function public.redeem_family_invite(invite_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare inv public.invitations%rowtype; actual_email text; fid uuid;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 if invite_token !~ '^[a-f0-9]{64}$' then raise exception 'Invalid invitation'; end if;
 actual_email := lower(coalesce(auth.jwt()->>'email',''));
 select * into inv from public.invitations
 where token_hash=encode(pg_catalog.sha256(pg_catalog.convert_to(invite_token,'UTF8')),'hex') and used_at is null and expires_at>now()
 for update;
 if not found or actual_email <> inv.email then raise exception 'Invalid, expired or wrong-account invitation'; end if;
 insert into public.family_members(family_id,user_id,role) values(inv.family_id,auth.uid(),'caregiver')
 on conflict(family_id,user_id) do nothing;
 update public.invitations set used_at=now() where id=inv.id;
 fid := inv.family_id;
 return fid;
end $$;
revoke all on function public.create_family_invite(uuid,text,text), public.redeem_family_invite(text) from public;
grant execute on function public.create_family_invite(uuid,text,text), public.redeem_family_invite(text) to authenticated;

-- Enable real-time events; read visibility remains controlled by RLS.
alter publication supabase_realtime add table public.activities;
alter publication supabase_realtime add table public.growth;
