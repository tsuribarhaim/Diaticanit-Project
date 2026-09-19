import type { Metadata, Viewport } from "next";
import "./globals.css";

import { NumberInputScrollGuard } from "@/components/number-input-scroll-guard";

export const metadata: Metadata = {
  title: "Daffy",
  description: "Daffy - Daily AI For Future You. Your daily AI health companion for nutrition, exercise, and habits.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Daffy",
  },
};

export const viewport: Viewport = {
  themeColor: "#317091",
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <NumberInputScrollGuard />
        {children}
        <footer className="mt-auto border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-500">
          <span className="font-semibold text-slate-700">Daffy</span>
          {" – Daily AI For Future You"}
        </footer>
      </body>
    </html>
  );
}
