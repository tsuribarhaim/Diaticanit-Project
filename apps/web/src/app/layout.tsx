import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Personal Health Companion",
  description: "Phase 1 secure onboarding and document hub",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        {children}
        <footer className="mt-auto border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-500">
          <span className="font-semibold text-slate-700">Bites &amp; Bytes</span>
          {" – Your 24/7 AI Health Companion"}
        </footer>
      </body>
    </html>
  );
}
