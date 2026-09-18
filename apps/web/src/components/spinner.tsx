/** Shared spinner glyph - same shape already duplicated locally in a few
 * chat/submit-button components (targets-chat-workspace.tsx,
 * daily-report-chat-panel.tsx, daily-report-submit-button.tsx); pulled out
 * here as the canonical version for new cross-cutting uses (e.g. loading.tsx
 * route-transition indicators) rather than adding yet another copy. */
export function Spinner({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}
