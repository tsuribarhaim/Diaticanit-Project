import { cookies } from "next/headers";

import { ResetPasswordForm } from "@/components/reset-password-form";
import { normalizeLocale } from "@/lib/locale";

const LOCALE_COOKIE = "phc_locale";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ link?: string }> }) {
  const cookieStore = await cookies();
  const locale = normalizeLocale(cookieStore.get(LOCALE_COOKIE)?.value);
  // /auth/confirm sends ?link=invalid for a used or expired reset link (TCK-3).
  const linkInvalid = (await searchParams).link === "invalid";

  return <ResetPasswordForm locale={locale} linkInvalid={linkInvalid} />;
}
