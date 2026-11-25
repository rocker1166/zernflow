/** The contact list as the Contacts page and the broadcast composer show it. */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { FilterContact } from "@/lib/contact-filter";
import type { ReachChat } from "@/lib/broadcast-reach";
import { readAll, SEGMENT_FIELDS, toSegmentContact } from "@/lib/segments";

export interface ContactRow extends FilterContact {
  avatarUrl: string | null;
  chats: ReachChat[];
  /** Their latest chat, to open. */
  conversationId: string | null;
}

export const REACH_FIELDS =
  "conversations(id, channel_id, platform, late_conversation_id, last_message_at, last_inbound_at, channels(is_active))" as const;

interface ReachRow {
  id: string;
  channel_id: string;
  platform: string;
  late_conversation_id: string | null;
  last_inbound_at: string | null;
  channels: { is_active: boolean } | null;
}

export function toReachChat(c: ReachRow): ReachChat {
  return {
    id: c.id,
    channelId: c.channel_id,
    platform: c.platform,
    // A disconnected account cannot send.
    hasChat: Boolean(c.late_conversation_id) && c.channels?.is_active === true,
    lastInboundAt: c.last_inbound_at,
  };
}

export async function loadContactRows(supabase: SupabaseClient<Database>, workspaceId: string): Promise<ContactRow[]> {
  const contacts = await readAll((from, to) =>
    supabase
      .from("contacts")
      .select(`id, display_name, email, avatar_url, ${SEGMENT_FIELDS}, ${REACH_FIELDS}`)
      .eq("workspace_id", workspaceId)
      .order("last_interaction_at", { ascending: false, nullsFirst: false })
      .order("id")
      .range(from, to)
  );
  return contacts.map((c) => ({
    ...toSegmentContact(c),
    id: c.id,
    name: c.display_name ?? "Unknown",
    email: c.email,
    avatarUrl: c.avatar_url,
    usernames: c.contact_channels.flatMap((cc) => (cc.platform_username ? [cc.platform_username] : [])),
    chats: c.conversations.map(toReachChat),
    conversationId:
      [...c.conversations].sort((a, b) => (b.last_message_at ?? "").localeCompare(a.last_message_at ?? ""))[0]?.id ?? null,
  }));
}
