/**
 * The unified chat's "help" domain (Phase D of the chat redesign) grounds
 * every answer in this one hand-written reference instead of letting the
 * model improvise about screens/features it might get wrong or that don't
 * exist yet (see the ai-chat-context-grounding standing rule) - kept as
 * plain English prose (not bilingual) since it's prompt context, not
 * user-facing UI text; the AI itself replies in the user's own locale (see
 * answerHelpQuestion's own prompt instruction), matching how
 * profile-chat.ts and targets negotiation already handle this. Update this
 * alongside any real change to what a screen does or where it lives -
 * stale grounding content is worse than none, since Daffy will state it
 * with full confidence either way.
 */
export const APP_HELP_CONTENT = `
Daffy is a personal health-tracking app. Every screen below lives under /app/... and the AI chat bubble (the one this conversation is happening in) is available from every screen except Daily Report (which has its own docked chat) and onboarding.

HOME (/app) - The main dashboard after sign-in. Shows Calories and Protein progress rings compared against the user's active targets, over Today / 7 / 30 / 90-day ranges, plus a Weekly Exercise Consistency ring and an AI Coach card summarizing recent progress in plain language. If the user has no active target plan yet, this screen prompts them to set targets first instead of showing rings.

DAILY REPORT (/app/daily-report) - Where the user logs what they actually ate, drank, or did for exercise, and sees today's (or a past day's) totals against their targets. Logging can be done by typing a free-text description (its own chat panel on this page understands natural language and can also take a photo of a meal), or via one-click "saved list" items. This page has ITS OWN separate chat panel (not the app-wide one) with photo upload and saved-list picking built in - if the user is on this page, tell them to use ITS chat rather than pointing them elsewhere. From any OTHER screen, the app-wide chat bubble (here) can also log a quick text description directly - the user doesn't need to navigate to Daily Report just to log something.

MANAGE SAVED LIST (/app/daily-report/defaults) - Lets the user set up reusable items (a single item like "Water", or a bundle of several ingredients grouped under one name like "My Breakfast") for one-click logging on the Daily Report page, instead of retyping the same meal every day. Reached via the main nav; add, edit, activate/deactivate, or delete items there.

TARGETS (/app/targets) - Shows the user's standing daily nutrient targets (calories, protein, carbs, fat, and other nutrients) plus weight/sleep/step targets, all currently locked in and in effect. Changing a target (from any screen, via this chat) previews the change as a diff before it's applied - nothing changes until the user approves it. If a change is out of a safe range, Daffy explains why and won't apply it directly.

PROFILE (/app/profile) - The user's personal/biometric info: name, date of birth, biological sex, height, current weight (not a target - a target belongs to the Targets page), activity level, dietary preference, nutritional goal, allergies, habits (smoking/alcohol), pregnancy/lactation status, medical conditions, medications, and exercise preferences. Medical document upload (e.g. lab results) also lives here, under the Medical Documents step - there's no separate "Documents" page in the main nav. This chat can view and change most of these fields directly (except medical conditions, medications, exercise schedule, and app language - those need the Profile page itself, since medical info changes go through an extra AI-consent step there for safety). Changing something here that affects target generation (like weight, activity level, or dietary preference) flags a reminder that shows up here in chat next time it's opened, offering to review and update targets accordingly.

NOTIFICATIONS (/app/notifications) - A combined list of (a) concerns the AI coach flagged about the user's targets, and (b) info updates, including support-ticket status changes. Reached via the bell icon in the nav.

SETTINGS (/app/settings) - Language (English/Hebrew), light/dark theme, changing password, and passkey management (Face ID / Touch ID / Windows Hello / security key as a password alternative).

SUPPORT TICKETS (/app/tickets, and "New Ticket" at /app/tickets/new) - Where the user reports a bug or requests a new feature. "My Tickets" lists what they've submitted with status. The EASIEST way to file one is right here in this chat: just describe the bug or the feature you'd like, and Daffy will draft a ticket (subject, type, area, priority, description) for you to review and submit with one tap - no need to go to the ticket form unless you'd rather fill it in by hand, or want to attach a file/screenshot (chat can't attach files yet, so for that, use the ticket form directly).

ACCOUNT - Sign out is available from the main nav. Passkey setup (Face ID/Touch ID/Windows Hello) can be enrolled from Settings, or dismissed from a one-time prompt banner on Home.

GENERAL: All AI features in this app (target negotiation, this chat, Daily Report parsing) require the user to have accepted AI-assistance consent, asked for during onboarding. This app is informational support only, not a substitute for professional medical advice - always say so if a question strays into medical/diagnostic territory.
`.trim();
