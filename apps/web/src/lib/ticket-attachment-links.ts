import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * The agents (analyst, night run, daily triage) see the tickets' screenshots: the queue routes hand each ticket's newest
 * images over as short-lived signed links, and the bridge downloads them next to the agent. TCK-1's cause and the TCK-90
 * evidence were in screenshots no agent had seen.
 */
export type AttachmentLink = { fileName: string; mimeType: string; addedAt: string; url: string };

const MAX_PER_TICKET = 5;
const LINK_SECONDS = 60 * 60;

export async function attachmentLinksFor(admin: ReturnType<typeof createAdminClient>, ticketIds: string[]): Promise<Map<string, AttachmentLink[]>> {
  const links = new Map<string, AttachmentLink[]>();
  if (ticketIds.length === 0) return links;
  const { data } = await admin
    .from("ticket_attachments")
    .select("ticket_id, storage_path, file_name, mime_type, created_at")
    .in("ticket_id", ticketIds)
    .like("mime_type", "image/%")
    .order("created_at", { ascending: false });
  const rows = ((data ?? []) as { ticket_id: string; storage_path: string; file_name: string; mime_type: string; created_at: string }[]).filter((row, _index, all) => all.filter((other) => other.ticket_id === row.ticket_id).indexOf(row) < MAX_PER_TICKET);
  if (rows.length === 0) return links;
  const { data: signed } = await admin.storage.from("ticket-attachments").createSignedUrls(rows.map((row) => row.storage_path), LINK_SECONDS);
  rows.forEach((row, index) => {
    const url = signed?.[index]?.signedUrl;
    if (!url) return;
    const list = links.get(row.ticket_id) ?? [];
    list.push({ fileName: row.file_name, mimeType: row.mime_type, addedAt: row.created_at, url });
    links.set(row.ticket_id, list);
  });
  return links;
}
