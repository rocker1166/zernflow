/** The Contacts page filters. OR inside a tag group, AND across groups. Pure. */

import { completeRules, matchesSegment, type SegmentContact, type SegmentFilter } from "@/lib/segments";

export interface FilterTag {
  id: string;
  name: string;
  color: string | null;
  category: string | null;
}

export interface FilterContact extends SegmentContact {
  id: string;
  name: string;
  email: string | null;
  usernames: string[];
}

export const ACTIVE_WITHIN = { "1": "Last 24 hours", "7": "Last 7 days", "30": "Last 30 days" } as const;

export interface ContactFilter {
  q: string;
  tagIds: string[];
  /** Days, or "" for any time. */
  within: string;
  subscribed: "" | "yes" | "no";
  /** Connected account (channel) ids; any of them. */
  accounts: string[];
}

export const EMPTY_CONTACT_FILTER: ContactFilter = { q: "", tagIds: [], within: "", subscribed: "", accounts: [] };

export function isFiltering(f: ContactFilter): boolean {
  return Boolean(f.q || f.tagIds.length || f.within || f.subscribed || f.accounts.length);
}

const groupOf = (tag: FilterTag) => tag.category ?? "other";

/** `exceptGroup` leaves one tag group out, to count what each of its tags would give. */
export function filterContacts<T extends FilterContact>(
  contacts: T[],
  f: ContactFilter,
  tags: FilterTag[],
  now: number,
  segment?: SegmentFilter,
  exceptGroup?: string
): T[] {
  const wanted = new Map<string, Set<string>>();
  for (const tag of tags) {
    if (!f.tagIds.includes(tag.id) || groupOf(tag) === exceptGroup) continue;
    const group = wanted.get(groupOf(tag)) ?? new Set();
    wanted.set(groupOf(tag), group.add(tag.id));
  }
  const groups = [...wanted.values()];
  const q = f.q.trim().toLowerCase().replace(/^@/, "");
  const since = f.within ? now - Number(f.within) * 86_400_000 : null;
  const live = segment && completeRules(segment);

  return contacts.filter((c) => {
    if (q && ![c.name, c.email ?? "", ...c.usernames].some((v) => v.toLowerCase().includes(q))) return false;
    if (since !== null && !(c.lastInteractionAt && Date.parse(c.lastInteractionAt) >= since)) return false;
    if (f.subscribed && c.isSubscribed !== (f.subscribed === "yes")) return false;
    if (f.accounts.length && !c.channelIds.some((id) => f.accounts.includes(id))) return false;
    if (!groups.every((ids) => c.tags.some((t) => ids.has(t.id)))) return false;
    return !live || matchesSegment(c, live);
  });
}

/** How many contacts each account would show, given every other filter. */
export function countAccounts<T extends FilterContact>(
  contacts: T[],
  f: ContactFilter,
  tags: FilterTag[],
  now: number,
  segment?: SegmentFilter
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const c of filterContacts(contacts, { ...f, accounts: [] }, tags, now, segment)) {
    for (const id of new Set(c.channelIds)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** How many contacts each tag would show, given every other filter. */
export function countTags<T extends FilterContact>(
  contacts: T[],
  f: ContactFilter,
  tags: FilterTag[],
  now: number,
  segment?: SegmentFilter
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const group of new Set(tags.map(groupOf))) {
    const ids = new Set(tags.filter((t) => groupOf(t) === group).map((t) => t.id));
    for (const c of filterContacts(contacts, f, tags, now, segment, group)) {
      for (const t of c.tags) if (ids.has(t.id)) counts.set(t.id, (counts.get(t.id) ?? 0) + 1);
    }
  }
  return counts;
}

// ── In the address bar, so a filtered list survives Back and can be shared ──

export function readFilter(params: Record<string, string | string[] | undefined>): ContactFilter {
  const one = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : "");
  const sub = one("sub");
  return {
    q: one("q"),
    tagIds: one("tags").split(",").filter(Boolean),
    within: one("within") in ACTIVE_WITHIN ? one("within") : "",
    subscribed: sub === "yes" || sub === "no" ? sub : "",
    accounts: one("acc").split(",").filter(Boolean),
  };
}

export function writeFilter(f: ContactFilter): string {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.tagIds.length) p.set("tags", f.tagIds.join(","));
  if (f.within) p.set("within", f.within);
  if (f.subscribed) p.set("sub", f.subscribed);
  if (f.accounts.length) p.set("acc", f.accounts.join(","));
  const s = p.toString();
  return s ? `?${s}` : "";
}
