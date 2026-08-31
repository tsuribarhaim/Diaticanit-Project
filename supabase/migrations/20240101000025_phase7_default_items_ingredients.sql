-- Phase 7 (Daily Report redesign): a saved list item can now bundle several
-- ingredient rows (e.g. "My Breakfast" = 2 eggs, a small salad, 1 toast, a
-- small yogurt) under one name, selectable as a single item later on. The
-- item's own name/kind/default_quantity/default_unit and pre-computed
-- nutrient columns still represent the bundle as a whole (unchanged
-- selection/scaling behavior in Daily Report) - `ingredients` is purely the
-- structured record of what was combined to produce those totals, used to
-- populate the edit form and show the breakdown in the saved list view.
alter table public.user_default_items
  add column if not exists ingredients jsonb not null default '[]'::jsonb;
