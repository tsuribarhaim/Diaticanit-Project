import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Personal Health Companion",
  description: "Phase 1 secure onboarding and document hub",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
