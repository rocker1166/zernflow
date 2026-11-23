/**
 * STOP on WhatsApp. Lives in code ahead of the flows, so it works whatever the flows
 * do and even while automation is paused for the chat.
 *
 * The webhook saves the request as a scheduled job before it acks (an unsaved one is
 * answered 500 and Zernio delivers it again); the cron job then stops ZernFlow's own
 * sends, tells Kaafila's API, and only after that confirms to the person.
 */

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { upsertContactForSender } from "@/lib/inbox-sync";
import { createZernioClient } from "@/lib/zernio-client";

export const OPT_OUT_JOB = "whatsapp_opt_out";
/** About 8 days at one try an hour: an opt-out must outlive an outage or a missing setting. */
export const OPT_OUT_MAX_ATTEMPTS = 200;

/** all = every message Kaafila sends on WhatsApp; offers = promotions only. */
export type OptOutScope = "all" | "offers";

// Whole messages only: "don't stop the trip" is a chat. Nothing that could be about a trip
// ("cancel", "remove me", "end") is listed.
const ALL = new Set([
  "stop",
  "stop all",
  "stopall",
  "please stop",
  "stop please",
  "stop messages",
  "stop messaging me",
  "stop sending messages",
  "stop sending me messages",
  "please stop messaging me",
  "stop updates",
  "unsubscribe",
  "unsubscribe me",
  "unsubscribe all",
  "opt out",
  "optout",
  "opt me out",
  "do not message me",
  "dont message me",
  "stop karo",
  "band karo",
  "message band karo",
  "msg band karo",
  "message mat bhejo",
  "msg mat bhejo",
  "बंद करो",
  "बंद करें",
  "स्टॉप",
  "मैसेज मत भेजो",
  "मैसेज बंद करो",
]);
const OFFERS = new Set([
  "stop offers",
  "stop offer",
  "stop promotions",
  "stop promotion",
  "stop promos",
  "stop marketing",
  "no offers",
  "unsubscribe from offers",
  "offers band karo",
  "offer band karo",
  "ऑफर बंद करो",
]);

/** "  STOP!! 🙏" -> "stop". Keeps letters and the vowel signs Hindi needs, drops the rest. */
function normalize(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim();
}

/**
 * What a message asks to stop, or null. A tap on a template button ("Stop offers")
 * arrives with its label as the text and the payload in `buttonPayload`.
 */
export function optOutScope(message: {
  text?: string | null;
  buttonPayload?: string | null;
}): OptOutScope | null {
  for (const value of [message.buttonPayload, message.text]) {
    if (!value) continue;
    const said = normalize(value);
    if (OFFERS.has(said)) return "offers";
    if (ALL.has(said)) return "all";
  }
  return null;
}

/**
 * The sender's number as E.164, or null. People with a WhatsApp username can write
 * without showing a number; their sender id is then a "IN.123…" business-scoped id.
 */
export function phoneOf(sender: { id: string; phoneNumber?: string | null }): string | null {
  for (const value of [sender.phoneNumber, sender.id]) {
    const digits = value?.replace(/[\s()+-]/g, "");
    if (digits && /^\d{8,15}$/.test(digits)) return `+${digits}`;
  }
  return null;
}

export interface OptOutPayload {
  scope: OptOutScope;
  phone: string | null;
  senderId: string;
  senderName: string;
  channelId: string;
  workspaceId: string;
  lateConversationId: string;
  lateAccountId: string;
}

/**
 * Saves the request. The row id comes from the message, so a redelivery is a no-op.
 * Throws when it could not be saved: the caller must not ack.
 */
export async function queueOptOut(
  supabase: SupabaseClient<Database>,
  messageId: string,
  payload: OptOutPayload
): Promise<void> {
  const h = createHash("sha256").update(`${OPT_OUT_JOB}:${payload.channelId}:${messageId}`).digest("hex");
  const { error } = await supabase.from("scheduled_jobs").insert({
    id: `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`,
    type: OPT_OUT_JOB,
    payload: payload as unknown as Json,
    // the cron takes the oldest 20 each minute: ahead of any broadcast still sending
    run_at: new Date(0).toISOString(),
  });
  if (error && error.code !== "23505") {
    throw new Error(`opt-out could not be saved: ${error.message}`);
  }
}

/** Runs one saved request. Every step is safe to repeat; a throw makes the cron try again. */
export async function runOptOut(
  supabase: SupabaseClient<Database>,
  p: OptOutPayload
): Promise<void> {
  await stopLocally(supabase, p);

  if (!p.phone) {
    console.error("whatsapp opt-out: no phone number in the message, Kaafila was not told");
    await reply(supabase, p, "We got your message, but WhatsApp is hiding your number from us, so we could not find your account. Please turn messages off in the Kaafila app, in Settings.");
    return;
  }

  const { matched } = await tellKaafila(p.phone, p.scope);
  await reply(supabase, p, confirmation(p.scope, matched > 0));
}

export function confirmation(scope: OptOutScope, hasAccount: boolean): string {
  if (!hasAccount) {
    return scope === "all"
      ? "Done. Kaafila will not send offers or updates to this number."
      : "Done. Kaafila will not send offers to this number.";
  }
  return scope === "all"
    ? "Done. No more offers from Kaafila, and no more trip updates on WhatsApp. You can turn them back on in the Kaafila app, in Settings."
    : "Done. No more offers from Kaafila, here, by email or in the app. Trip updates are not affected. You can turn offers back on in the Kaafila app, in Settings.";
}

/** ZernFlow's own sends: broadcasts and sequences check is_subscribed, waiting flows are ended. */
async function stopLocally(supabase: SupabaseClient<Database>, p: OptOutPayload): Promise<void> {
  // Usually there already (the webhook saves it after the ack); made here if that failed.
  await upsertContactForSender({
    supabase,
    channel: { id: p.channelId, workspace_id: p.workspaceId },
    senderId: p.senderId,
    senderName: p.senderName,
    senderPicture: null,
    interactionAt: new Date().toISOString(),
    stampExisting: false,
  });
  // Read it back: if the webhook saved it at the same moment, the linked contact is the real one.
  const { data: link, error } = await supabase
    .from("contact_channels")
    .select("contact_id")
    .eq("channel_id", p.channelId)
    .eq("platform_sender_id", p.senderId)
    .single();
  if (error || !link) throw new Error(`opt-out: contact not found: ${error?.message ?? "no row"}`);

  const contactId = link.contact_id;
  const results = await Promise.all([
    supabase.from("contacts").update({ is_subscribed: false }).eq("id", contactId),
    supabase
      .from("sequence_enrollments")
      .update({ status: "cancelled" })
      .eq("contact_id", contactId)
      .eq("channel_id", p.channelId)
      .eq("status", "active"),
    supabase
      .from("flow_sessions")
      .update({ status: "cancelled" })
      .eq("contact_id", contactId)
      .eq("channel_id", p.channelId)
      .eq("status", "active"),
  ]);
  const failed = results.find((r) => r.error);
  if (failed?.error) throw new Error(`opt-out: could not stop local sends: ${failed.error.message}`);
}

// shortcut: one Kaafila per ZernFlow, so every WhatsApp channel reports to the same API; per-workspace settings if that changes
async function tellKaafila(phone: string, scope: OptOutScope): Promise<{ matched: number }> {
  const url = process.env.KAAFILA_OPT_OUT_URL;
  const secret = process.env.KAAFILA_OPT_OUT_SECRET;
  if (!url || !secret) throw new Error("KAAFILA_OPT_OUT_URL or KAAFILA_OPT_OUT_SECRET is not set");

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-kaafila-secret": secret },
    body: JSON.stringify({ phone, scope }),
    redirect: "error", // never carry the secret to another host
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Kaafila opt-out answered ${res.status}`);
  const body: { matched?: unknown } = await res.json();
  // a 200 from something that is not the endpoint (a proxy page) must not count as done
  if (typeof body.matched !== "number") throw new Error("Kaafila opt-out answered without a result");
  return { matched: body.matched };
}

/** Logged, never thrown: the opt-out itself is done, and a retry would repeat it only for the reply. */
async function reply(supabase: SupabaseClient<Database>, p: OptOutPayload, message: string): Promise<void> {
  try {
    const { data: workspace } = await supabase
      .from("workspaces")
      .select("late_api_key_encrypted")
      .eq("id", p.workspaceId)
      .single();
    if (!workspace?.late_api_key_encrypted) throw new Error("no Zernio API key");
    const sending = createZernioClient(workspace.late_api_key_encrypted).messages.sendInboxMessage({
      path: { conversationId: p.lateConversationId },
      body: { accountId: p.lateAccountId, message },
    });
    // this job is first in the queue: a send that hangs would hold up every job behind it
    await Promise.race([
      sending,
      new Promise((_, reject) => setTimeout(() => reject(new Error("no answer in 15 s")), 15_000)),
    ]);
  } catch (err) {
    console.error("whatsapp opt-out: done, but the confirmation was not sent:", err);
  }
}
