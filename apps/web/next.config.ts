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
    // Separate from (and enforced before) serverActions.bodySizeLimit above
    // - this app's proxy/middleware sees every request first, and Next's
    // own default cap there is a lower, independent 10 MB, regardless of
    // the Server Action's own configured limit. A request over it doesn't
    // get a clean "too large" response - it gets silently truncated
    // mid-body, which then crashes the multipart parser with "Unexpected
    // end of form" once the (now-corrupt) body reaches the action, instead
    // of ever running that action's own size-limit check. Hit for real
    // trying to upload a profile picture: a phone photo can easily run past
    // 10 MB even though the app's own avatar limit is 5 MB. (The older name
    // for this, middlewareClientMaxBodySize, is deprecated in this Next
    // version in favor of proxyClientMaxBodySize - matches the "middleware"
    // file convention itself also being deprecated in favor of "proxy"
    // here.) Set comfortably above every per-feature limit (5 MB avatars,
    // 10 MB documents/meal photos) plus multipart boundary/field overhead,
    // so a too-large upload always reaches its own action's clean
    // validation message instead of crashing here first.
    proxyClientMaxBodySize: "15mb",
  },
};

export default nextConfig;
