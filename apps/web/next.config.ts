import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets phones/other devices on the local network load HMR and dev-overlay
  // assets when testing against `dev:3001` via this machine's LAN IP,
  // instead of Next.js silently blocking those cross-origin dev requests.
  allowedDevOrigins: ["192.168.86.*"],
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
