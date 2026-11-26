/** Who a broadcast may reach. Pure; asked on the page, when it is sent, and again for each message. */

export const WINDOW_MS = 24 * 60 * 60 * 1000;

/** Meta refuses anything we start later than 24 hours after their last message. */
const WINDOWED = new Set(["instagram", "facebook", "whatsapp"]);

export interface ReachChat {
  id: string;
  channelId: string;
  platform: string;
  /** Zernio has the chat; without it there is nothing to send into. */
  hasChat: boolean;
  lastInboundAt: string | null;
}

export type Reach =
  | { ok: true; chat: ReachChat; closesAt: number | null }
  | { ok: false; reason: "unsubscribed" | "no_chat" | "closed" };

export const REACH_REASON: Record<"unsubscribed" | "no_chat" | "closed", string> = {
  unsubscribed: "Unsubscribed",
  no_chat: "Never wrote in DM",
  closed: "24 h window closed",
};

export function reachOf(contact: { isSubscribed: boolean; chats: ReachChat[] }, now: number): Reach {
  if (!contact.isSubscribed) return { ok: false, reason: "unsubscribed" };
  const chats = contact.chats.filter((c) => c.hasChat);
  if (chats.length === 0) return { ok: false, reason: "no_chat" };

  let best: { ok: true; chat: ReachChat; closesAt: number | null } | null = null;
  for (const chat of chats) {
    const closesAt = windowClosesAt(chat);
    if (closesAt !== null && closesAt <= now) continue;
    if (!best || (best.closesAt !== null && (closesAt === null || closesAt > best.closesAt))) {
      best = { ok: true, chat, closesAt };
    }
  }
  return best ?? { ok: false, reason: "closed" };
}

/** null = this platform has no window. A chat we have never seen them write in counts as closed. */
function windowClosesAt(chat: ReachChat): number | null {
  if (!WINDOWED.has(chat.platform)) return null;
  return chat.lastInboundAt ? Date.parse(chat.lastInboundAt) + WINDOW_MS : 0;
}

/** "5 h left", "40 min left" */
export function timeLeft(closesAt: number | null, now: number): string {
  if (closesAt === null) return "Can receive";
  const minutes = Math.max(0, Math.floor((closesAt - now) / 60_000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h left` : `${minutes} min left`;
}

// ── One-to-one replies from the Inbox ───────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
/** Meta's human-agent tag: a person may answer for 7 days after their last message. Instagram and Messenger only. */
export const HUMAN_AGENT_MS = 7 * DAY_MS;
const HUMAN_AGENT_PLATFORMS = new Set(["instagram", "facebook"]);

export type ReplyWindow =
  /** Inside 24 hours, a platform without a window, or not known yet: send as usual. */
  | { mode: "open" }
  /** 24 hours to 7 days: send with the human-agent tag. */
  | { mode: "human_agent"; until: number }
  | { mode: "closed"; reason: "expired" | "needs_template" };

export function replyWindow(platform: string, lastInboundAt: string | null, now: number): ReplyWindow {
  if (!WINDOWED.has(platform) || !lastInboundAt) return { mode: "open" };
  const at = Date.parse(lastInboundAt);
  if (now < at + WINDOW_MS) return { mode: "open" };
  if (!HUMAN_AGENT_PLATFORMS.has(platform)) return { mode: "closed", reason: "needs_template" };
  if (now < at + HUMAN_AGENT_MS) return { mode: "human_agent", until: at + HUMAN_AGENT_MS };
  return { mode: "closed", reason: "expired" };
}
