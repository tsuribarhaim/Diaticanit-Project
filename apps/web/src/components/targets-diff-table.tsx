import { tr, type AppLocale } from "@/lib/locale";
import type { MetricDiffRow } from "@/lib/targets-diff";

export function TargetsDiffTable({ rows, locale }: { rows: MetricDiffRow[]; locale: AppLocale }) {
  return (
    <div className="rounded-lg border border-teal-200 bg-teal-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-teal-800">{tr(locale, "What changed", "מה השתנה")}</p>
      <div className="mt-2 overflow-x-auto rounded-md border border-teal-200 bg-white">
        <table className="w-full min-w-[420px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-teal-200 bg-teal-100/60 text-xs font-semibold uppercase tracking-wide text-teal-800">
              <th scope="col" className="px-3 py-2">
                {tr(locale, "Target item", "פריט יעד")}
              </th>
              <th scope="col" className="px-3 py-2">
                {tr(locale, "Previous goal", "יעד קודם")}
              </th>
              <th scope="col" className="px-3 py-2">
                {tr(locale, "Updated goal", "יעד מעודכן")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.labelEn} className="border-b border-teal-100 last:border-0">
                <td className="px-3 py-2 font-medium text-slate-900">{tr(locale, row.labelEn, row.labelHe)}</td>
                <td className="px-3 py-2 text-slate-500">{row.before}</td>
                <td className="px-3 py-2 font-semibold text-teal-800">{row.after}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
