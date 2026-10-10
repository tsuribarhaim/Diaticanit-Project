import { tr, type AppLocale } from "@/lib/locale";

/** Common typos of big mail providers: a domain that exists but is not the one meant. The DNS check below cannot catch these when someone
 * has registered the typo, so the obvious ones are named. Key = the typo, value = what was probably meant. */
const DOMAIN_TYPOS: Record<string, string> = {
  "gmial.com": "gmail.com",
  "gmai.com": "gmail.com",
  "gmail.co": "gmail.com",
  "gamil.com": "gmail.com",
  "gmail.con": "gmail.com",
  "hotmial.com": "hotmail.com",
  "hotmail.con": "hotmail.com",
  "yahooo.com": "yahoo.com",
  "yaho.com": "yahoo.com",
  "outlok.com": "outlook.com",
  "iclod.com": "icloud.com",
  "icloud.con": "icloud.com",
};

export type InviteEmailCheck = { ok: true; email: string; domain: string } | { ok: false; error: string };

/** Format check only (no network): one address, a name, an @, a domain with a dot, no spaces. Returns the lowercase address the sign-up
 * check compares against (signUpAction lowercases what the user types and needs an exact match). */
export function checkInviteEmailFormat(raw: string, locale: AppLocale): InviteEmailCheck {
  const email = raw.trim().toLowerCase();
  if (!email) return { ok: false, error: tr(locale, "Please type an email address.", "יש להקליד כתובת אימייל.") };
  if (/\s/.test(email) || /[,;]/.test(email)) {
    return { ok: false, error: tr(locale, "Please enter one email address, with no spaces or commas.", "יש להזין כתובת אימייל אחת, ללא רווחים או פסיקים.") };
  }
  if (email.length > 254 || !/^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(email) || email.includes("..") || email.startsWith(".")) {
    return {
      ok: false,
      error: tr(
        locale,
        "This does not look like an email address. It needs a name, an @ and a domain, like name@example.com.",
        "זו לא נראית כתובת אימייל תקינה. היא צריכה שם, @ ודומיין, למשל name@example.com.",
      ),
    };
  }
  const domain = email.split("@")[1];
  const meant = DOMAIN_TYPOS[domain];
  if (meant) {
    return {
      ok: false,
      error: tr(locale, `The domain ${domain} cannot receive email. Did you mean ${meant}?`, `הדומיין ${domain} לא מקבל אימיילים. האם התכוונת ל-${meant}?`),
    };
  }
  return { ok: true, email, domain };
}
