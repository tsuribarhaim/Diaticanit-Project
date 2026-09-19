import { NextResponse } from "next/server";

// Always server-rendered fresh, never cached - AppUpdateBanner polls this to
// detect a new deploy while the PWA is already open (see that component's
// own comment for why this, not just service-worker update events, is the
// primary update-detection mechanism on iOS/Android home-screen installs).
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { version: process.env.NEXT_PUBLIC_APP_VERSION ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
