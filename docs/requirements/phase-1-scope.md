# Phase 1 Scope (MVP Skeleton Only)

## Objective
Deliver a secure, production-ready skeleton that allows:
- user registration/login
- onboarding profile capture
- profile view/edit
- file upload and metadata management

No AI logic in this phase.

## In Scope (Build Now)

### 1) Core Platform
- Next.js app (mobile-first baseline)
- Supabase project
- Vercel deployment pipeline
- Environment configuration and secrets management

### 2) Authentication
- Supabase Auth (Email/Password and/or Google)
- Protected routes for authenticated users
- Session handling and logout flow

### 3) Minimum Database Tables (Phase 1 only)

#### public.user_profile
Purpose: user physiological profile and preferences.

Recommended fields:
- id UUID PK default gen_random_uuid()
- user_id UUID unique not null references auth.users(id) on delete cascade
- age INT not null
- gender TEXT not null
- height_cm NUMERIC(5,2) not null
- weight_kg NUMERIC(5,2) not null
- activity_level TEXT not null
- allergies TEXT[] default '{}'
- medical_conditions TEXT[] default '{}'
- created_at timestamptz default now()
- updated_at timestamptz default now()

#### public.user_documents
Purpose: uploaded file registry (metadata only).

Recommended fields:
- id UUID PK default gen_random_uuid()
- user_id UUID not null references auth.users(id) on delete cascade
- category TEXT not null (for example: lab_report, prescription, other)
- file_name TEXT not null
- mime_type TEXT
- file_size_bytes BIGINT
- storage_path TEXT not null
- status TEXT not null default 'uploaded'  (uploaded, deleted)
- created_at timestamptz default now()
- updated_at timestamptz default now()

Optional in Phase 1 (only if manual data entry is required now):

#### public.user_lab_results
Purpose: manual user-entered lab values without AI extraction.

If not needed immediately, defer to Phase 2.

### 4) Storage
- Supabase Storage bucket for private user files (for example: user-documents)
- Per-user access policy (user can access only own files)
- Max file size and file type restrictions

### 5) Security (Mandatory)
- RLS enabled on all Phase 1 tables
- Policies for select/insert/update/delete where auth.uid() = user_id
- No cross-user access

### 6) Application Screens
- Public landing page
- Auth pages (sign in / sign up)
- Onboarding profile form
- User home page (profile summary)
- Profile edit page
- Upload page/list (upload, list, delete metadata)

### 7) Validation and UX Baseline
- Client/server validation for profile fields
- Validation for upload types and size
- Loading, success, and error states
- Basic mobile usability

### 8) Minimal Observability and Audit
- Basic error logging for API failures
- Track created_at/updated_at in tables
- Optional: simple activity log (profile updated, file uploaded)

### 9) Testing and Acceptance
- Smoke test: register user -> complete profile -> upload file -> edit profile -> re-open and verify persistence
- Security test: second user cannot read first user profile/documents

## Out of Scope (Do Not Build in Phase 1)
- AI extraction from free text or files
- Targets engine (BMR/TDEE + dynamic clinical constraints)
- meal_entries free-text nutrition logging
- recommendations and daily analytics views
- IoT / wearable integrations

## Recommended Deliverables
1. Database migration scripts (only Phase 1 tables + RLS policies)
2. Storage bucket setup + policies
3. Auth + protected routing
4. Onboarding, profile home, profile edit, upload pages
5. API/server actions for profile and document metadata CRUD
6. Phase 1 test checklist and demo script

## Suggested Definition of Done
- New user can sign up/login
- User can submit and update profile
- User can upload files and see own file list
- Data is persisted and isolated by user_id
- All routes and operations pass basic smoke/security tests
