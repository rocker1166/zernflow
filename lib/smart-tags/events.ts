/** Turns what is stored about a contact into one timeline. Pure. */

import { isOutbound } from "@/lib/inbox-messages";
import type { TagEvent } from "@/lib/smart-tags/decide";

export interface ZernioChatMessage {
  message?: string | null;
  direction?: string;
  createdAt?: string;
  sentAt?: string;
  isDeleted?: boolean | null;
  attachments?: Array<{ type?: string }> | null;
  metadata?: { quickReplyPayload?: string; postbackPayload?: string; buttonPayload?: string } | null;
}

export function messageEvents(messages: ZernioChatMessage[]): TagEvent[] {
  return messages
    .filter((m) => !m.isDeleted)
    .map((m) => ({
      at: Date.parse(m.sentAt ?? m.createdAt ?? "") || 0,
      from: isOutbound(m.direction) ? ("us" as const) : ("them" as const),
      via: "dm" as const,
      text: m.message ?? "",
      action: Boolean(m.metadata?.quickReplyPayload || m.metadata?.postbackPayload || m.metadata?.buttonPayload),
      media: (m.attachments ?? []).map((a) => a.type ?? "file"),
    }));
}

export interface CommentLog {
  post_id: string | null;
  comment_text: string;
  matched_trigger_id: string | null;
  flow_id: string | null;
  dm_sent: boolean;
  created_at: string;
}

export function commentEvents(comments: CommentLog[], captions: Map<string, string>): TagEvent[] {
  return comments.map((c) => ({
    // Logged after the flow ran, so a comment we answered must not land after its own DM.
    at: Date.parse(c.created_at) - (c.dm_sent ? 60_000 : 0),
    from: "them" as const,
    via: "comment" as const,
    text: c.comment_text,
    // The reel keyword alone ("Kaafila") is a tap in words.
    action: Boolean(c.flow_id || c.matched_trigger_id) && c.comment_text.trim().split(/\s+/).length <= 2,
    media: [],
    reel: c.post_id ? captions.get(c.post_id) : undefined,
  }));
}

export function timeline(...parts: TagEvent[][]): TagEvent[] {
  return parts.flat().sort((a, b) => a.at - b.at);
}
