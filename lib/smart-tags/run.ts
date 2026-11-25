/**
 * Works through the queue of contacts whose tags are due (contact_tagging, filled by
 * database triggers). Called every minute by /api/cron/tags.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { createZernioClient, type Zernio } from "@/lib/zernio-client";
import { askJev, JevBusyError, type JevAnswer } from "@/lib/smart-tags/jev";
import { buildAsk, decideTags, type ContactFacts, type TagEvent } from "@/lib/smart-tags/decide";
import { commentEvents, messageEvents, timeline, type CommentLog, type ZernioChatMessage } from "@/lib/smart-tags/events";
import { tagColor, type TagDef } from "@/lib/smart-tags/taxonomy";

type Db = SupabaseClient<Database>;

/** Zernio allows 60 calls a minute and the live automations share them. */
const CONTACTS_PER_RUN = 20;
const RUN_BUDGET_MS = 45_000;
const CAPTIONS_TTL_MS = 60 * 60 * 1000;

/** Zernio said slow down: leave the rest of the queue for the next run. */
class ZernioBusyError extends Error {}

/**
 * Only these workspaces are read and sent to TypeSafe. An env list and not a switch in the
 * app: sign-ups are open, and another workspace must not be able to use our key.
 */
export function taggedWorkspaces(): string[] {
  if (!process.env.TYPESAFE_API_KEY) return [];
  return (process.env.SMART_TAGS_WORKSPACES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export async function runSmartTags(supabase: Db): Promise<{ tagged: number; failed: number; stopped?: string }> {
  const workspaceIds = taggedWorkspaces();
  if (workspaceIds.length === 0) return { tagged: 0, failed: 0, stopped: "off" };

  const started = Date.now();
  const { data: due, error } = await supabase
    .from("contact_tagging")
    .select("contact_id, workspace_id, due_at, attempts, hash, answers")
    .in("workspace_id", workspaceIds)
    .lte("due_at", new Date().toISOString())
    .order("due_at", { ascending: true })
    .limit(CONTACTS_PER_RUN);
  if (error) throw new Error(`smart tags: queue not readable: ${error.message}`);

  const zernios = new Map<string, Zernio>();
  let tagged = 0;
  let failed = 0;

  for (const row of due) {
    if (Date.now() - started > RUN_BUDGET_MS) return { tagged, failed, stopped: "time" };
    try {
      let zernio = zernios.get(row.workspace_id);
      if (!zernio) {
        zernio = await zernioFor(supabase, row.workspace_id);
        zernios.set(row.workspace_id, zernio);
      }
      const done = await tagContact(supabase, zernio, row);
      // Only if nothing new arrived meanwhile: a newer due_at must survive.
      await must(
        supabase
          .from("contact_tagging")
          .update({
            due_at: done.nextLookAt ? new Date(done.nextLookAt).toISOString() : null,
            attempts: 0,
            last_error: null,
          })
          .eq("contact_id", row.contact_id)
          .eq("due_at", row.due_at!)
      );
      tagged++;
    } catch (err) {
      if (err instanceof JevBusyError || err instanceof ZernioBusyError) {
        return { tagged, failed, stopped: err.message };
      }
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Smart tags: contact ${row.contact_id} failed (try ${row.attempts + 1}):`, message);
      const attempts = row.attempts + 1;
      const retryAt = Date.now() + Math.min(2 ** attempts * 60_000, 6 * 60 * 60_000);
      await supabase
        .from("contact_tagging")
        .update({
          due_at: new Date(retryAt).toISOString(),
          attempts,
          last_error: message.slice(0, 500),
        })
        .eq("contact_id", row.contact_id)
        .eq("due_at", row.due_at!);
    }
  }
  return { tagged, failed };
}

async function tagContact(
  supabase: Db,
  zernio: Zernio,
  row: { contact_id: string; workspace_id: string; hash: string | null; answers: Json | null }
): Promise<{ nextLookAt: number | null }> {
  const facts = await loadFacts(supabase, zernio, row);
  // A disconnected account: their words cannot be read, so the tags stay as they are.
  if (!facts) return { nextLookAt: null };
  const ask = buildAsk(facts);

  let answers: Record<string, JevAnswer> = {};
  let inputTokens = 0;
  if (ask) {
    if (row.hash === ask.hash && row.answers) {
      answers = row.answers as unknown as Record<string, JevAnswer>;
    } else {
      ({ answers, inputTokens } = await askJev(ask.state, ask.questions));
    }
  }

  const now = Date.now();
  const { tags, nextLookAt } = decideTags(facts, answers, now);
  await saveTags(supabase, row.workspace_id, row.contact_id, tags, facts.truncated);
  await must(
    supabase
      .from("contact_tagging")
      .update({
        tagged_at: new Date(now).toISOString(),
        hash: ask?.hash ?? null,
        answers: answers as unknown as Json,
        ...(inputTokens ? { input_tokens: inputTokens } : {}),
      })
      .eq("contact_id", row.contact_id)
  );
  return { nextLookAt };
}

// ── Reading ─────────────────────────────────────────────────────────────────

async function loadFacts(
  supabase: Db,
  zernio: Zernio,
  { contact_id: contactId, workspace_id: workspaceId, hash }: { contact_id: string; workspace_id: string; hash: string | null }
): Promise<ContactFacts | null> {
  const [contact, links, conversations, sessions] = await Promise.all([
    must(supabase.from("contacts").select("is_subscribed").eq("id", contactId).single()),
    must(
      supabase
        .from("contact_channels")
        .select("channel_id, platform_sender_id, channels!inner(platform, late_account_id, is_active)")
        .eq("contact_id", contactId)
    ),
    must(supabase.from("conversations").select("id, channel_id, late_conversation_id").eq("contact_id", contactId)),
    must(
      supabase
        .from("flow_sessions")
        .select("status, waiting_for_input, variables")
        .eq("contact_id", contactId)
    ),
  ]);

  let truncated = false;
  const parts: TagEvent[][] = [];
  for (const conv of conversations) {
    const channel = links.find((l) => l.channel_id === conv.channel_id)?.channels;
    if (conv.late_conversation_id) {
      if (!channel?.is_active) return null;
      const chat = await fetchChat(zernio, conv.late_conversation_id, channel.late_account_id);
      // It had messages before: an empty answer now is a bad read, not an empty chat.
      if (chat.messages.length === 0 && hash) throw new Error("Zernio answered with an empty chat");
      truncated ||= chat.hasMore;
      parts.push(messageEvents(chat.messages));
    } else {
      // Zernio has no chat until they answer a comment DM; what the flow sent is stored here.
      const sent = await must(
        supabase
          .from("messages")
          .select("text, created_at")
          .eq("conversation_id", conv.id)
          .eq("direction", "outbound")
          .neq("status", "failed")
          .order("created_at", { ascending: false })
          .limit(50)
      );
      parts.push(messageEvents(sent.map((m) => ({ message: m.text, direction: "outbound", sentAt: m.created_at }))));
    }
  }

  const comments: CommentLog[] = [];
  for (const link of links) {
    comments.push(
      ...(await must(
        supabase
          .from("comment_logs")
          .select("post_id, comment_text, matched_trigger_id, flow_id, dm_sent, created_at")
          .eq("channel_id", link.channel_id)
          .eq("author_id", link.platform_sender_id)
          .order("created_at", { ascending: false })
          .limit(20)
      ))
    );
  }
  if (comments.length) {
    const accounts = links.filter((l) => l.channels.platform === "instagram").map((l) => l.channels.late_account_id);
    parts.push(commentEvents(comments, await reelCaptions(zernio, workspaceId, accounts)));
  }

  return {
    platforms: [...new Set(links.map((l) => l.channels.platform as string))],
    subscribed: contact.is_subscribed,
    events: timeline(...parts),
    truncated,
    sessions: sessions.map((s) => ({
      status: s.status,
      waiting: s.waiting_for_input,
      followStatus: ((s.variables as Record<string, unknown> | null)?.follow_status as string | undefined) ?? null,
    })),
  };
}

async function fetchChat(
  zernio: Zernio,
  conversationId: string,
  accountId: string
): Promise<{ messages: ZernioChatMessage[]; hasMore: boolean }> {
  const res = await zernioCall(() =>
    zernio.messages.getInboxConversationMessages({
      path: { conversationId },
      query: { accountId, limit: 100, sortOrder: "desc" },
    })
  );
  const data = res.data as { messages?: ZernioChatMessage[]; pagination?: { hasMore?: boolean } } | undefined;
  if (!data?.messages) throw new Error("Zernio answered without messages");
  return { messages: data.messages, hasMore: data.pagination?.hasMore === true };
}

async function zernioCall(call: () => Promise<{ data?: unknown }>): Promise<{ data?: unknown }> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      call(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Zernio: no answer in 15 s")), 15_000);
      }),
    ]);
  } catch (err) {
    if ((err as { statusCode?: number }).statusCode === 429) throw new ZernioBusyError("Zernio rate limit");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const captionCache = new Map<string, { at: number; captions: Map<string, string> }>();

/**
 * Captions by post id. An ad is a separate post Zernio does not list, so
 * SMART_TAGS_AD_POSTS ("adId:reelId,...") points it at its reel.
 */
async function reelCaptions(zernio: Zernio, workspaceId: string, accountIds: string[]): Promise<Map<string, string>> {
  const cached = captionCache.get(workspaceId);
  if (cached && Date.now() - cached.at < CAPTIONS_TTL_MS) return cached.captions;

  const captions = new Map<string, string>();
  for (const accountId of accountIds) {
    const res = await zernioCall(() =>
      zernio.comments.listInboxComments({
        query: { accountId, platform: "instagram", limit: 50, sortBy: "date", sortOrder: "desc" },
      })
    );
    for (const post of (res.data as { data?: { id?: string; content?: string }[] } | undefined)?.data ?? []) {
      if (post.id && post.content) captions.set(post.id, post.content.trim());
    }
  }
  for (const pair of (process.env.SMART_TAGS_AD_POSTS ?? "").split(",")) {
    const [ad, reel] = pair.split(":").map((s) => s.trim());
    const caption = reel && captions.get(reel);
    if (ad && caption) captions.set(ad, caption);
  }
  captionCache.set(workspaceId, { at: Date.now(), captions });
  return captions;
}

// ── Saving ──────────────────────────────────────────────────────────────────

async function saveTags(
  supabase: Db,
  workspaceId: string,
  contactId: string,
  tags: TagDef[],
  /** The first message is out of reach, so where they came from stays as it was. */
  keepSource: boolean
): Promise<void> {
  const ids = await tagIds(supabase, workspaceId, tags);
  const current = await must(
    supabase.from("contact_tags").select("tag_id, source, tags(category)").eq("contact_id", contactId)
  );
  const worn = new Set(current.map((c) => c.tag_id));
  const stale = current
    .filter((c) => c.source === "auto" && !ids.includes(c.tag_id))
    .filter((c) => !(keepSource && c.tags?.category === "source"))
    .map((c) => c.tag_id);
  const fresh = ids.filter((id) => !worn.has(id));

  if (stale.length) {
    await must(
      supabase.from("contact_tags").delete().eq("contact_id", contactId).eq("source", "auto").in("tag_id", stale)
    );
  }
  if (fresh.length) {
    await must(
      supabase
        .from("contact_tags")
        .upsert(
          fresh.map((tag_id) => ({ contact_id: contactId, tag_id, source: "auto" as const })),
          { onConflict: "contact_id,tag_id", ignoreDuplicates: true }
        )
    );
  }
}

async function tagIds(supabase: Db, workspaceId: string, tags: TagDef[]): Promise<string[]> {
  if (tags.length === 0) return [];
  const names = tags.map((t) => t.name);
  const read = () =>
    must(supabase.from("tags").select("id, name, category").eq("workspace_id", workspaceId).in("name", names));
  let rows = await read();
  // Missing, or made earlier as a plain tag of the same name: it joins its group.
  const missing = tags.filter((t) => rows.find((r) => r.name === t.name)?.category !== t.category);
  if (missing.length) {
    await must(
      supabase.from("tags").upsert(
        missing.map((t) => ({ workspace_id: workspaceId, name: t.name, color: tagColor(t), category: t.category })),
        { onConflict: "workspace_id,name" }
      )
    );
    rows = await read();
  }
  return rows.map((r) => r.id);
}

// ── Replies sent outside ZernFlow ───────────────────────────────────────────

/**
 * A reply typed on the phone sends us no webhook. Zernio's conversation list shows it as
 * newer activity than our last look, so those contacts are queued. One call per account.
 */
export async function queueOutsideActivity(supabase: Db): Promise<number> {
  let queued = 0;
  for (const workspaceId of taggedWorkspaces()) {
    const zernio = await zernioFor(supabase, workspaceId);
    const channels = await must(
      supabase.from("channels").select("id, late_account_id").eq("workspace_id", workspaceId).eq("is_active", true)
    );
    for (const channel of channels) {
      const res = await zernioCall(() =>
        zernio.messages.listInboxConversations({
          query: { accountId: channel.late_account_id, limit: 50, sortOrder: "desc" },
        })
      );
      const latest = new Map<string, number>();
      const page = res.data as { data?: { id?: string; updatedTime?: string }[] } | undefined;
      for (const c of page?.data ?? []) {
        if (c.id && c.updatedTime) latest.set(c.id, Date.parse(c.updatedTime));
      }
      if (latest.size === 0) continue;

      const known = await must(
        supabase
          .from("conversations")
          .select("contact_id, late_conversation_id")
          .eq("channel_id", channel.id)
          .in("late_conversation_id", [...latest.keys()])
      );
      if (known.length === 0) continue;
      const looked = await must(
        supabase
          .from("contact_tagging")
          .select("contact_id, tagged_at, due_at")
          .in("contact_id", known.map((k) => k.contact_id))
      );
      const now = Date.now();
      const stale = looked.filter((l) => {
        const conv = known.find((k) => k.contact_id === l.contact_id);
        const activity = latest.get(conv?.late_conversation_id ?? "") ?? 0;
        const dueSoon = l.due_at && Date.parse(l.due_at) <= now + 60_000;
        return l.tagged_at && activity > Date.parse(l.tagged_at) && !dueSoon;
      });
      if (stale.length === 0) continue;
      await must(
        supabase
          .from("contact_tagging")
          .update({ due_at: new Date(now).toISOString(), attempts: 0 })
          .in("contact_id", stale.map((s) => s.contact_id))
      );
      queued += stale.length;
    }
  }
  return queued;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function zernioFor(supabase: Db, workspaceId: string): Promise<Zernio> {
  const ws = await must(
    supabase.from("workspaces").select("late_api_key_encrypted").eq("id", workspaceId).single()
  );
  if (!ws.late_api_key_encrypted) throw new Error("no Zernio API key");
  return createZernioClient(ws.late_api_key_encrypted);
}

/** A failed read must not look like an empty one: tags would be removed on it. */
async function must<T>(query: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<NonNullable<T>> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data as NonNullable<T>;
}
