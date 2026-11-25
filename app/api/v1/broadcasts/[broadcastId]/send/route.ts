import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { scheduleBroadcastDelivery } from "@/lib/scheduler";
import { contentProblem, toContent } from "@/lib/broadcast-message";
import { reachOf } from "@/lib/broadcast-reach";
import { REACH_FIELDS, toReachChat } from "@/lib/contact-rows";
import { matchesSegment, readAll, SEGMENT_FIELDS, toSegmentContact, type SegmentFilter } from "@/lib/segments";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";

type Db = SupabaseClient<Database>;

/**
 * POST /api/v1/broadcasts/:broadcastId/send
 *
 * Body: { messageContent?, contactIds? }. Goes to `contactIds` when given, else to the
 * contacts the broadcast's segment filter means, else to every subscribed contact. Whoever
 * cannot be reached (unsubscribed, no chat, 24-hour window closed) is left out.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ broadcastId: string }> }
) {
  const { broadcastId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Row security: only a broadcast in one of this user's workspaces comes back.
  const { data: broadcast } = await supabase.from("broadcasts").select("*").eq("id", broadcastId).maybeSingle();
  if (!broadcast) return NextResponse.json({ error: "Broadcast not found" }, { status: 404 });

  let body: { messageContent?: unknown; contactIds?: unknown } = {};
  try {
    body = (await request.json()) ?? {};
  } catch {
    // No body: send what is saved.
  }
  const content = toContent(body.messageContent ?? broadcast.message_content);
  const problem = contentProblem(content);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  let contactIds: Set<string> | null = null;
  if (body.contactIds !== undefined) {
    if (!Array.isArray(body.contactIds) || !body.contactIds.every((id) => typeof id === "string")) {
      return NextResponse.json({ error: "contactIds must be a list of ids" }, { status: 400 });
    }
    contactIds = new Set(body.contactIds);
  }

  let recipients: { contactId: string; channelId: string }[];
  try {
    recipients = await resolveRecipients(
      supabase,
      broadcast.workspace_id,
      contactIds,
      broadcast.segment_filter as unknown as SegmentFilter | null
    );
  } catch (err) {
    console.error("Failed to resolve broadcast contacts:", err);
    return NextResponse.json({ error: "Could not read the contacts for this broadcast" }, { status: 500 });
  }
  if (recipients.length === 0) {
    return NextResponse.json({ error: "Nobody you picked can receive a message right now." }, { status: 400 });
  }

  // Claim it, so a double click or a second tab cannot send it twice.
  const { data: claimed } = await supabase
    .from("broadcasts")
    .update({ status: "sending", message_content: content as unknown as Json, total_recipients: recipients.length })
    .eq("id", broadcastId)
    .in("status", ["draft", "scheduled"])
    .select("id");
  if (!claimed?.length) {
    return NextResponse.json({ error: "This broadcast was already sent." }, { status: 409 });
  }

  // scheduled_jobs is service-role only; access to the broadcast was checked above.
  const service = await createServiceClient();
  try {
    const recipientIds: string[] = [];
    for (let i = 0; i < recipients.length; i += 500) {
      const { data, error } = await service
        .from("broadcast_recipients")
        .insert(
          recipients.slice(i, i + 500).map((r) => ({
            broadcast_id: broadcastId,
            contact_id: r.contactId,
            channel_id: r.channelId,
            status: "pending",
          }))
        )
        .select("id");
      if (error) throw new Error(error.message);
      recipientIds.push(...data.map((r) => r.id));
    }
    await scheduleBroadcastDelivery(service, broadcastId, recipientIds);
  } catch (err) {
    console.error("Failed to queue broadcast:", err);
    // Without its recipient row a queued job does nothing, so this undoes a half-made queue.
    await service.from("broadcast_recipients").delete().eq("broadcast_id", broadcastId).eq("status", "pending");
    await service.from("broadcasts").update({ status: "draft", total_recipients: 0 }).eq("id", broadcastId);
    return NextResponse.json({ error: "Could not queue the broadcast. Nothing more will be sent." }, { status: 500 });
  }

  return NextResponse.json({ broadcastId, totalRecipients: recipients.length, status: "sending" });
}

async function resolveRecipients(
  supabase: Db,
  workspaceId: string,
  contactIds: Set<string> | null,
  filter: SegmentFilter | null
): Promise<{ contactId: string; channelId: string }[]> {
  const now = Date.now();
  const subscribed = await readAll((from, to) =>
    supabase
      .from("contacts")
      .select(`id, ${SEGMENT_FIELDS}, ${REACH_FIELDS}`)
      .eq("workspace_id", workspaceId)
      .eq("is_subscribed", true)
      .order("id")
      .range(from, to)
  );
  return subscribed.flatMap((c) => {
    if (contactIds) {
      if (!contactIds.has(c.id)) return [];
    } else if (filter?.groups?.length && !matchesSegment(toSegmentContact(c), filter)) {
      return [];
    }
    const reach = reachOf({ isSubscribed: c.is_subscribed, chats: c.conversations.map(toReachChat) }, now);
    return reach.ok ? [{ contactId: c.id, channelId: reach.chat.channelId }] : [];
  });
}
