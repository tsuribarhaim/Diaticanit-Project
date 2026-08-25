import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// Document upload/management moved into the Profile page (Step 5 - Medical Documents).
export default function DocumentsPage() {
  redirect("/app/profile");
}

