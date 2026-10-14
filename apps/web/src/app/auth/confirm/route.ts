import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** A redirect to a path on the same site. The Location is relative on purpose: an absolute one built from the request URL
 * said "localhost" on the dev server, which on a phone opening the laptop's network address points at the phone itself. */
const goTo = (path: string) => new NextResponse(null, { status: 303, headers: { Location: path, "Cache-Control": "no-store" } });

/**
 * TCK-3: where the reset email's link lands. The one-time token_hash is checked here on the server (verifyOtp), which signs
 * the person in for the reset and stores the session in cookies - so the link works in whatever browser or device opens the
 * email. Then the new-password form. A used or expired link goes to the same form, which shows "request a new link".
 */
export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");

  if (tokenHash && type === "recovery") {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
    if (!error) return goTo("/auth/reset-password");
  }
  return goTo("/auth/reset-password?link=invalid");
}
