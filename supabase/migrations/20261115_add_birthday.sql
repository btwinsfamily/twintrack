-- Existing installations: run this migration in Supabase SQL Editor before deploying the app.
-- Existing date-only values are preserved and can be completed once with a time.
begin;
alter table public.babies
 add column birth_time time(0) without time zone check (birth_time < time '24:00'),
 add constraint babies_birth_time_requires_date check (birth_time is null or birth_date is not null);

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

commit;
