-- Day 6 security verification queries for Supabase SQL editor
-- Run these after creating two users and at least one profile/document per user.
-- Execute each section while authenticated as the indicated user.

-- As User A: should return only User A rows
select user_id, age, gender from public.user_profile order by created_at desc;
select user_id, category, file_name, storage_path from public.user_documents order by created_at desc;

-- As User B: should return only User B rows
select user_id, age, gender from public.user_profile order by created_at desc;
select user_id, category, file_name, storage_path from public.user_documents order by created_at desc;

-- Negative checks as User B using known User A IDs should affect 0 rows
-- Replace placeholders with real IDs from User A data gathered in User A session.
update public.user_profile
set age = age + 1
where user_id = 'USER_A_UUID';

delete from public.user_documents
where id = 'USER_A_DOCUMENT_UUID';

-- Optional: confirm no rows were changed by negative checks.
