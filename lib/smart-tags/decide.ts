/**
 * Smart tag rules. Pure: a contact's events in, questions and tags out.
 *
 * Facts (channel, where they came from, funnel step, phone number, dates) are decided
 * by code. Only what needs reading (who they are, what they want) is asked of Jev, and
 * an answer below its threshold is not used.
 */

import { createHash } from "node:crypto";
import { JEV_MODEL, type JevAnswer, type JevQuestion } from "@/lib/smart-tags/jev";
import {
  FUNNEL,
  INTENT,
  PERSON,
  REVIEW,
  SIGNAL,
  SOURCE,
  STAGE,
  channelTag,
  type TagDef,
} from "@/lib/smart-tags/taxonomy";

/** A choice below this is not used. */
export const CONF_FLOOR = 0.7;
/** A yes/no counts from here. */
export const YES = 0.6;
/** Needed before treating someone as opted out. */
export const STRONG = 0.8;
/** Missing a person who is waiting costs more than one extra look. */
const NEEDS_REPLY = 0.5;

export const FOLLOW_UP_DAYS = 5;
export const QUIET_DAYS = 10;
const DAY = 86_400_000;

const MAX_EVENTS = 24;
const MAX_TEXT = 400;
/** Instagram calls a shared contact or rich card a "template", which reads like a bot. */
const MEDIA_LABELS: Record<string, string> = { template: "sent a contact card" };

export interface TagEvent {
  at: number;
  from: "us" | "them";
  via: "dm" | "comment";
  text: string;
  /** A tapped button, or a comment that is just the reel keyword: an action, not words. */
  action: boolean;
  /** Attachment types, when there are any. */
  media: string[];
  /** Caption of the reel a comment was left on. */
  reel?: string;
}

export interface FunnelSession {
  status: string;
  waiting: boolean;
  followStatus: string | null;
}

export interface ContactFacts {
  platforms: string[];
  subscribed: boolean;
  events: TagEvent[];
  /** Older messages exist than the ones loaded, so the first event is not the first ever. */
  truncated: boolean;
  sessions: FunnelSession[];
}

// ── What is asked ───────────────────────────────────────────────────────────

const ABOUT_US =
  "Kaafila is an Indian group-travel app. Travellers book group trips on it. Travel creators and influencers host trips as a Travel Host. Trip captains lead the groups on the road and travel for free. Agencies list their own trips.";

const PERSON_QUESTION: JevQuestion = {
  type: "choice",
  instructions:
    "Who is the other person ('them') to Kaafila, judging by what they say and by what they answered or were offered? A comment that is only our keyword (Kaafila, Kafila) on a reel means they are answering what that reel offers.",
  criteria: {
    captain:
      "Wants to be, or is being considered as, a trip captain, trip leader, trek leader or crew, or commented on or answered our Trip Captain reel or the 'travel for free and get paid' offer",
    creator:
      "A content creator, influencer, blogger or page we invited to host trips, collaborate or sell us content, or who offers that",
    traveller: "Wants to join or book a trip, or asks about a trip's dates, price, place or plan",
    agency: "A travel agency, tour operator, hotel or transport company talking about working together",
    seller: "Pitches their own service or product to Kaafila: marketing, editing, software, promotion, followers",
    unclear: "Nothing in the chat shows which of these they are",
  },
};

const INTENT_QUESTION: JevQuestion = {
  type: "choice",
  instructions: "What is the other person's latest position, from their most recent words? Messages can be in English, Hindi or Hinglish.",
  criteria: {
    interested: "Says yes, ok or done, agrees, is interested, wants to join, shares their number to go ahead, or sends only our keyword (Kaafila, Kafila)",
    wants_details: "Wants to know more before deciding, asks us to share details or the plan",
    question: "Asks one specific question",
    not_now: "Interested in principle but the timing is wrong",
    not_interested: "Declines",
    greeting: "Only a greeting such as hi or hello, with nothing else said so far",
    unclear: "None of these can be told from their words",
  },
};

const SIGNAL_QUESTIONS = {
  form_filled: "Does the other person say they have already filled or submitted our form or application?",
  wants_call: "Does the other person ask for a call, or offer a time to talk?",
  asked_pay: "Does the other person ask what Kaafila will pay them, such as salary, commission, profit share or a collaboration fee?",
  asked_price: "Does the other person ask what a trip costs for a traveller?",
  has_experience: "Does the other person say they have themselves hosted, led or captained group trips or treks before?",
  problem: "Does the other person report a problem, such as not receiving a message or link, something not working, or being unhappy with Kaafila?",
  auto_reply: "Is the other person's latest typed message an automatic reply from a business account or bot, such as a thanks for contacting us or a chatbot answer, and not written by a person?",
  removal: "Does the other person ask Kaafila to stop messaging them?",
} as const;

const NEEDS_REPLY_QUESTION: JevQuestion = {
  type: "noul",
  instructions:
    "The last message is from the other person. Are they waiting for an answer or an action from Kaafila? A plain ok, thanks, an emoji or a goodbye is not waiting.",
};

/** Did they write anything of their own, beyond taps and the reel keyword? */
export function hasWords(facts: ContactFacts): boolean {
  return facts.events.some((e) => e.from === "them" && !e.action && e.text.trim() !== "");
}

function lastEvent(facts: ContactFacts): TagEvent | undefined {
  return facts.events[facts.events.length - 1];
}

/** Numbers and emails stay here; Jev only needs to know that one was shared. */
export function redact(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/(wa\.me\/|phone=|tel:)\+?\d{8,15}/gi, "$1[phone number]")
    .replace(PHONE, "[phone number]");
}

// 10+ digits, with the separators people type between them; not part of a URL or a longer id
const PHONE = /(?<![\w/=]|\d\.)\+?\d(?:[\s().-]{0,2}\d){9,12}(?!\w)/g;

/** The one call for this contact, or null when there is nothing to read. */
export function buildAsk(
  facts: ContactFacts
): { state: unknown; questions: Record<string, JevQuestion>; hash: string } | null {
  const readable = facts.events.filter((e) => e.text.trim() || e.media.length);
  if (readable.length === 0) return null;

  const questions: Record<string, JevQuestion> = { person: PERSON_QUESTION };
  if (hasWords(facts)) {
    questions.intent = INTENT_QUESTION;
    for (const [id, instructions] of Object.entries(SIGNAL_QUESTIONS)) {
      questions[id] = { type: "noul", instructions };
    }
  }
  const last = lastEvent(facts);
  if (last?.from === "them" && !last.action) questions.needs_reply = NEEDS_REPLY_QUESTION;

  const state = {
    about_us: ABOUT_US,
    chat: readable.slice(-MAX_EVENTS).map((e) => ({
      from: e.from,
      via: e.via,
      text: redact(e.text).slice(0, MAX_TEXT) || `[${e.media.map((m) => MEDIA_LABELS[m] ?? m).join(", ")}]`,
      ...(e.reel ? { on_our_reel: e.reel.slice(0, MAX_TEXT) } : {}),
    })),
  };
  const hash = createHash("sha256")
    // the questions too: rewording one asks everybody again
    .update(JSON.stringify([JEV_MODEL, state, questions]))
    .digest("hex");
  return { state, questions, hash };
}

// ── What is worn ────────────────────────────────────────────────────────────

export interface TagDecision {
  tags: TagDef[];
  /** When the tags change with the calendar alone, or null. */
  nextLookAt: number | null;
}

export function decideTags(
  facts: ContactFacts,
  answers: Record<string, JevAnswer>,
  now: number
): TagDecision {
  const tags: TagDef[] = facts.platforms.map(channelTag);
  const words = hasWords(facts);
  const yes = (id: string, floor = YES) => (answers[id]?.noul ?? 0) >= floor;
  const choice = (id: string) => {
    const a = answers[id];
    return a?.choice && (a.confidence ?? 0) >= CONF_FLOOR ? a.choice : null;
  };

  const source = sourceOf(facts);
  if (source) tags.push(source);
  const funnel = funnelOf(facts);
  if (funnel) tags.push(funnel);

  const autoReply = words && yes("auto_reply");
  const person = choice("person");
  if (person && Object.hasOwn(PERSON, person)) tags.push(PERSON[person as keyof typeof PERSON]);

  let intent: string | null = null;
  if (words && !autoReply) {
    intent = choice("intent");
    if (intent && Object.hasOwn(INTENT, intent)) tags.push(INTENT[intent as keyof typeof INTENT]);
    for (const id of ["form_filled", "wants_call", "asked_pay", "asked_price", "has_experience", "problem"] as const) {
      if (yes(id)) tags.push(SIGNAL[id]);
    }
  }
  if (facts.events.some((e) => e.from === "them" && e.text.search(PHONE) !== -1)) tags.push(SIGNAL.shared_number);
  if (autoReply) tags.push(SIGNAL.auto_reply);

  const optedOut = !facts.subscribed || (words && yes("removal", STRONG));
  const { stage, nextLookAt } = stageOf(facts, { optedOut, intent, autoReply, needsReply: answers.needs_reply?.noul }, now);
  if (stage) tags.push(stage);
  // They wrote something and we cannot tell what they want ("Needs reply" is already a look).
  if (words && !autoReply && !intent && stage !== STAGE.needs_reply && stage !== STAGE.opted_out) {
    tags.push(REVIEW.review);
  }

  return { tags, nextLookAt };
}

function sourceOf(facts: ContactFacts): TagDef | null {
  const first = facts.events[0];
  if (!first || facts.truncated) return null;
  if (first.via === "comment") return SOURCE.comment;
  return first.from === "us" ? SOURCE.we_first : SOURCE.they_first;
}

/** The furthest step reached in any reel automation. */
function funnelOf({ sessions, events }: ContactFacts): TagDef | null {
  if (sessions.length === 0) return null;
  if (sessions.some((s) => s.status === "completed" && s.followStatus === "following")) return FUNNEL.got_link;
  // A second comment re-runs the follow check, which then answers "unknown" for someone who never opened the DM.
  const answeredDm = events.some((e) => e.from === "them" && e.via === "dm");
  if (sessions.some((s) => s.followStatus === "not_following" || (s.followStatus === "unknown" && answeredDm))) {
    return FUNNEL.not_following;
  }
  if (sessions.some((s) => s.status === "active" && s.waiting)) return FUNNEL.not_opened;
  return null;
}

function stageOf(
  facts: ContactFacts,
  read: { optedOut: boolean; intent: string | null; autoReply: boolean; needsReply: number | undefined },
  now: number
): { stage: TagDef | null; nextLookAt: number | null } {
  if (read.optedOut) return { stage: STAGE.opted_out, nextLookAt: null };

  const last = lastEvent(facts);
  if (!last) return { stage: null, nextLookAt: null };

  // A tap nothing answered is a person stuck in the flow.
  if (last.from === "them" && !read.autoReply) {
    const waitingOnUs = last.action ? last.via === "dm" : (read.needsReply ?? 1) >= NEEDS_REPLY;
    if (waitingOnUs) return { stage: STAGE.needs_reply, nextLookAt: null };
  }
  if (read.intent === "not_interested") return { stage: STAGE.closed, nextLookAt: null };

  const theirDms = facts.events.filter((e) => e.from === "them" && e.via === "dm").length;
  const replied = theirDms > (read.autoReply ? 1 : 0);
  const ours = facts.events.filter((e) => e.from === "us").at(-1);
  if (!ours) return { stage: null, nextLookAt: null };
  if (!replied) return { stage: STAGE.never_replied, nextLookAt: null };
  // They closed it politely ("ok, thanks"): nothing to chase.
  if (last.from === "them" && last.via === "dm" && !read.autoReply) return { stage: null, nextLookAt: null };

  const quietFor = now - ours.at;
  if (quietFor < FOLLOW_UP_DAYS * DAY) return { stage: STAGE.waiting, nextLookAt: ours.at + FOLLOW_UP_DAYS * DAY };
  if (quietFor < QUIET_DAYS * DAY) return { stage: STAGE.follow_up, nextLookAt: ours.at + QUIET_DAYS * DAY };
  return { stage: STAGE.quiet, nextLookAt: null };
}
