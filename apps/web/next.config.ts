import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets phones/other devices on the local network load HMR and dev-overlay
  // assets when testing against `dev:3001` via this machine's LAN IP,
  // instead of Next.js silently blocking those cross-origin dev requests.
  allowedDevOrigins: ["192.168.86.*"],
  // The "N" dev-tools button Next.js itself floats over every page in
  // development (route info / build-activity indicator - not anything this
  // app renders) defaults to the bottom-left corner, which sat right on top
  // of AppBottomNav's Daily Report icon and made it hard to tap. Only the
  // four corners are selectable (no arbitrary/mid position), and both
  // bottom corners are now taken by this app's own floating controls (the
  // daily-report save icon at bottom-left, the chat toggle at bottom-right)
  // - top-right is clear of everything else on every page.
  devIndicators: {
    position: "top-right",
  },
  experimental: {
    serverActions: {
      // Document uploads and meal photos are capped at 10 MB at the
      // application level (MAX_DOCUMENT_SIZE_BYTES / MAX_MEAL_PHOTO_BYTES);
      // Next's own default Server Action body limit is 1 MB, which silently
      // 500s real camera photos before that application-level check ever
      // runs. Leave headroom for multipart boundary/field overhead.
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;
