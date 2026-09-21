import { cookies } from "next/headers";

import { ResetPasswordForm } from "@/components/reset-password-form";
import { normalizeLocale } from "@/lib/locale";

const LOCALE_COOKIE = "phc_locale";

export default async function ResetPasswordPage() {
  const cookieStore = await cookies();
  const locale = normalizeLocale(cookieStore.get(LOCALE_COOKIE)?.value);

  return <ResetPasswordForm locale={locale} />;
}
