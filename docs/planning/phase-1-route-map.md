# Phase 1 Route and Component Map

## Public Routes
- / : landing page (value proposition + sign in/sign up CTA)
- /auth/sign-in
- /auth/sign-up

## Protected Routes
- /app : user home page (profile snapshot + quick actions)
- /app/onboarding : first-time profile setup form
- /app/profile : profile details page
- /app/profile/edit : profile edit form
- /app/documents : upload and document list

## Components
- AuthGuard
- AppShellMobile
- ProfileForm
- ProfileSummaryCard
- UploadDropzone
- DocumentList
- EmptyState
- ToastFeedback

## Server Actions / API Endpoints
- createProfile
- getProfile
- updateProfile
- uploadDocument
- listDocuments
- deleteDocument

## State/Flow Rules
- If authenticated user has no profile, redirect /app -> /app/onboarding.
- If profile exists, redirect /app/onboarding -> /app.
- Upload path format: user-documents/<user_id>/<timestamp>-<safe_file_name>
- Delete flow removes storage object first, then removes metadata row.

## Required Guards
- All /app/* routes require auth.
- Server actions enforce user_id from auth context, never from client payload.
