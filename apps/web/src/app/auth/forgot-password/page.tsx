import { cookies } from "next/headers";

import { ForgotPasswordForm } from "@/components/forgot-password-form";
import { normalizeLocale } from "@/lib/locale";

const LOCALE_COOKIE = "phc_locale";

export default async function ForgotPasswordPage() {
  const cookieStore = await cookies();
  const locale = normalizeLocale(cookieStore.get(LOCALE_COOKIE)?.value);

  return <ForgotPasswordForm locale={locale} />;
}
