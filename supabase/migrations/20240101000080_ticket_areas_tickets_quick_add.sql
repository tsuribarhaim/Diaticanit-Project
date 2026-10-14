-- TCK-29: two more ticket areas the testers asked for - "Tickets" (the support tickets screens themselves) and "Quick add"
-- (the saved list / quick add). 044 declared the area check inline, so Postgres named it; as in 077 the check is found by
-- what it holds rather than by that generated name, dropped, and added again with the new values.
-- Matched on the list itself ('account_auth' appears only there): 062's draft check also mentions area and must stay.
do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.tickets'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%''account_auth''%'
  loop
    execute format('alter table public.tickets drop constraint %I', constraint_name);
  end loop;
end $$;

alter table public.tickets
  add constraint tickets_area_check
  check (area in (
    'home', 'daily_report', 'targets', 'profile', 'documents', 'health_labs',
    'notifications', 'settings', 'account_auth', 'tickets', 'quick_add', 'other'
  ));
