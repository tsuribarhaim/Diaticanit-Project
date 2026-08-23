-- Phase 5 follow-up: capture magnitude for selected substance-use habits.

alter table if exists public.user_profile
  add column if not exists alcohol_times_per_week numeric,
  add column if not exists smoking_packs_per_day numeric;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_profile_alcohol_times_per_week_check'
      and conrelid = 'public.user_profile'::regclass
  ) then
    alter table public.user_profile
      add constraint user_profile_alcohol_times_per_week_check
      check (
        alcohol_times_per_week is null
        or (alcohol_times_per_week >= 0 and alcohol_times_per_week <= 200)
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_profile_smoking_packs_per_day_check'
      and conrelid = 'public.user_profile'::regclass
  ) then
    alter table public.user_profile
      add constraint user_profile_smoking_packs_per_day_check
      check (
        smoking_packs_per_day is null
        or (smoking_packs_per_day >= 0 and smoking_packs_per_day <= 20)
      );
  end if;
end;
$$;
