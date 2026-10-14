import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * TCK-3: where the reset email's link lands. The one-time token_hash is checked here on the server (verifyOtp), which signs
 * the person in for the reset and stores the session in cookies - so the link works in whatever browser or device opens the
 * email. Then the new-password form. A used or expired link goes to the same form, which shows "request a new link".
 */
export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  const target = request.nextUrl.clone();
  target.search = "";

  if (tokenHash && type === "recovery") {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
    if (!error) {
      target.pathname = "/auth/reset-password";
      return NextResponse.redirect(target);
    }
  }
  target.pathname = "/auth/reset-password";
  target.searchParams.set("link", "invalid");
  return NextResponse.redirect(target);
}
