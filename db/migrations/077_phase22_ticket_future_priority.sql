-- Phase 22 follow-up (TCK-33): a "future" ticket priority for things that
-- matter but aren't urgent, so they aren't filed as "low" or parked as
-- the "deferred" status (which also covers unclear/disputed tickets).
--
-- 044 declared the check inline, so Postgres named it itself (normally
-- tickets_priority_check). Rather than trust that name - a wrong one would
-- make "drop if exists" a silent no-op and leave the old check in place -
-- every check constraint on tickets that tests the priority column is
-- dropped, then the new one is added under a known name.
do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.tickets'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%priority%'
  loop
    execute format('alter table public.tickets drop constraint %I', constraint_name);
  end loop;
end $$;

alter table public.tickets
  add constraint tickets_priority_check
  check (priority in ('future', 'low', 'medium', 'high', 'urgent'));
