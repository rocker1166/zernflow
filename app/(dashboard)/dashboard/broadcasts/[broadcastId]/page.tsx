import { notFound } from "next/navigation";
import { getWorkspace } from "@/lib/workspace";
import { readAll } from "@/lib/segments";
import { BroadcastProgress } from "./broadcast-progress";

export default async function BroadcastPage({ params }: { params: Promise<{ broadcastId: string }> }) {
  const { broadcastId } = await params;
  const { workspace, supabase } = await getWorkspace();

  const { data: broadcast } = await supabase
    .from("broadcasts")
    .select("*")
    .eq("id", broadcastId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  if (!broadcast) notFound();

  const recipients = await readAll((from, to) =>
    supabase
      .from("broadcast_recipients")
      .select("id, status, error_message, contacts(id, display_name)")
      .eq("broadcast_id", broadcastId)
      .order("id")
      .range(from, to)
  );

  return (
    <BroadcastProgress
      broadcast={broadcast}
      recipients={recipients.map((r) => ({
        id: r.id,
        status: r.status,
        error: r.error_message,
        contactId: r.contacts?.id ?? null,
        name: r.contacts?.display_name ?? "Unknown",
      }))}
    />
  );
}
