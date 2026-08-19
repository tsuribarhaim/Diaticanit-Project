# Phase 1 Acceptance Checklist

## Functional
- User can sign up successfully.
- User can sign in and sign out.
- Authenticated user can access onboarding form.
- User can create profile with required fields.
- User can view profile summary page.
- User can edit and save profile fields.
- User can upload supported file types.
- User can see own uploaded file list.
- User can delete own uploaded file entry.

## Data Integrity
- Profile row contains correct user_id.
- Profile updates change updated_at timestamp.
- Uploaded file metadata row includes user_id and storage_path.
- Deleted file is removed from storage and metadata state is consistent.

## Security
- Unauthenticated users cannot access protected pages.
- User A cannot read or edit User B profile.
- User A cannot list/download/delete User B files.
- RLS is enabled on all Phase 1 tables.

## Validation and UX
- Invalid profile payloads are rejected gracefully.
- Oversized and unsupported file uploads are rejected.
- Loading and failure states are visible and actionable.
- Mobile layout is usable on small screens.

## Exit Decision
- All checklist items pass in staging.
- No high-severity security issues remain.
- Product owner approves the demo flow.
