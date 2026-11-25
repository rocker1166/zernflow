/**
 * Every smart tag, in groups. A contact wears at most one tag from a "one" group
 * and any number from a "many" group. Filters use OR inside a group, AND across groups.
 */

import { PLATFORM_LABELS } from "@/lib/platforms";

export type TagCategory =
  | "stage"
  | "person"
  | "intent"
  | "signal"
  | "funnel"
  | "source"
  | "channel"
  | "review";

/** In the order they are shown. */
export const TAG_CATEGORIES: Record<TagCategory, { label: string; color: string }> = {
  stage: { label: "Stage", color: "#f59e0b" },
  person: { label: "Who", color: "#8b5cf6" },
  intent: { label: "Intent", color: "#10b981" },
  signal: { label: "Signals", color: "#0ea5e9" },
  funnel: { label: "Reel funnel", color: "#ec4899" },
  source: { label: "Came from", color: "#64748b" },
  channel: { label: "Channel", color: "#6366f1" },
  review: { label: "Review", color: "#ef4444" },
};

export const CATEGORY_ORDER = Object.keys(TAG_CATEGORIES) as TagCategory[];

interface TagDef {
  name: string;
  category: TagCategory;
  color?: string;
}

function define<K extends string>(category: TagCategory, names: Record<K, string | [string, string]>) {
  const out = {} as Record<K, TagDef>;
  for (const key of Object.keys(names) as K[]) {
    const v = names[key];
    out[key] = typeof v === "string" ? { name: v, category } : { name: v[0], color: v[1], category };
  }
  return out;
}

export const STAGE = define("stage", {
  needs_reply: ["Needs reply", "#ef4444"],
  waiting: ["Waiting on them", "#f59e0b"],
  follow_up: ["Follow up", "#f97316"],
  quiet: ["Gone quiet", "#78716c"],
  never_replied: ["Never replied", "#6b7f99"],
  closed: ["Closed", "#78716c"],
  opted_out: ["Opted out", "#dc2626"],
});

export const PERSON = define("person", {
  captain: "Trip captain",
  creator: "Creator",
  traveller: "Traveller",
  agency: "Agency",
  seller: "Selling to us",
});

export const INTENT = define("intent", {
  interested: "Interested",
  wants_details: "Wants details",
  question: "Asked a question",
  answered: "Answered us",
  not_now: ["Not now", "#a3a3a3"],
  not_interested: ["Not interested", "#a3a3a3"],
  greeting: ["Said hi", "#a3a3a3"],
});

export const SIGNAL = define("signal", {
  shared_number: "Shared number",
  form_filled: "Form filled",
  wants_call: "Wants a call",
  asked_pay: "Asked about pay",
  asked_price: "Asked trip price",
  has_experience: "Has hosted trips",
  problem: ["Has a problem", "#ef4444"],
  auto_reply: ["Auto-reply", "#a3a3a3"],
});

export const FUNNEL = define("funnel", {
  got_link: "Got the link",
  not_following: "Did not follow yet",
  not_opened: "Did not tap the DM",
});

export const SOURCE = define("source", {
  comment: "Reel comment",
  we_first: "We messaged first",
  they_first: "They messaged first",
});

export const REVIEW = define("review", { review: "Needs review" });

const CHANNEL_COLORS: Record<string, string> = { instagram: "#e1306c", whatsapp: "#25d366" };

export function channelTag(platform: string): TagDef {
  const name = (PLATFORM_LABELS as Record<string, string>)[platform] ?? platform;
  return { name, category: "channel", color: CHANNEL_COLORS[platform] };
}

export type { TagDef };

export function tagColor(tag: TagDef): string {
  return tag.color ?? TAG_CATEGORIES[tag.category].color;
}

/** The order tags are written in above: groups first, then each group's own order. */
const TAG_ORDER = [STAGE, PERSON, INTENT, SIGNAL, FUNNEL, SOURCE, REVIEW]
  .flatMap((group) => Object.values<TagDef>(group))
  .map((t) => t.name);

/** Sorts tags the way they are shown: by group, plain tags last. */
export function compareTags(
  a: { name: string; category?: string | null },
  b: { name: string; category?: string | null }
): number {
  const group = (t: { category?: string | null }) => {
    const i = CATEGORY_ORDER.indexOf(t.category as TagCategory);
    return i === -1 ? CATEGORY_ORDER.length : i;
  };
  return (
    group(a) - group(b) ||
    TAG_ORDER.indexOf(a.name) - TAG_ORDER.indexOf(b.name) ||
    a.name.localeCompare(b.name)
  );
}

export interface TagGroup<T> {
  key: string;
  label: string;
  tags: T[];
}

/** Tags split into their groups, in order; plain tags last. Empty groups are left out. */
export function groupTags<T extends { name: string; category?: string | null }>(tags: T[]): TagGroup<T>[] {
  const known = CATEGORY_ORDER.map((key) => ({
    key: key as string,
    label: TAG_CATEGORIES[key].label,
    tags: tags.filter((t) => t.category === key).sort(compareTags),
  }));
  const other = tags.filter((t) => !CATEGORY_ORDER.includes(t.category as TagCategory));
  return [...known, { key: "other", label: "Other tags", tags: other }].filter((g) => g.tags.length > 0);
}
