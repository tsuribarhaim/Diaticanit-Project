import type { AppLocale } from "@/lib/locale";
import { normalizeLocale } from "@/lib/locale";

type SupabaseLike = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => PromiseLike<{ data: { preferred_language?: string | null } | null }>;
      };
    };
  };
};

export async function resolveUserLocale({
  supabase,
  userId,
}: {
  supabase: SupabaseLike;
  userId: string;
}): Promise<AppLocale> {
  const { data } = await supabase
    .from("user_profile")
    .select("preferred_language")
    .eq("user_id", userId)
    .maybeSingle();

  return normalizeLocale(data?.preferred_language);
}
