import type { MetadataRoute } from "next";

/**
 * Next's manifest.ts convention auto-serves this at /manifest.webmanifest
 * and injects the <link rel="manifest"> tag itself - no manual public JSON
 * file or layout.tsx wiring needed. start_url points at /app (not /) since
 * that's the real landing experience once signed in; an unauthenticated
 * visitor launching from the home-screen icon still just lands on the
 * normal sign-in redirect from there, same as any other /app navigation.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Daffy - Daily AI For Future You",
    short_name: "Daffy",
    description: "Your daily AI health companion - nutrition, exercise, and habit targets that adapt with you.",
    start_url: "/app",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#317091",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
