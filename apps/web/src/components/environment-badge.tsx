export function EnvironmentBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700">
      {label}
    </span>
  );
}
