import { describe, expect, it } from "vitest";
import { countAccounts, countTags, EMPTY_CONTACT_FILTER, filterContacts, readFilter, writeFilter, type FilterContact, type FilterTag } from "@/lib/contact-filter";

const NOW = Date.parse("2026-11-26T12:00:00Z");
const tags: FilterTag[] = [
  { id: "s1", name: "Needs reply", color: null, category: "stage" },
  { id: "s2", name: "Follow up", color: null, category: "stage" },
  { id: "p1", name: "Creator", color: null, category: "person" },
];
const c = (id: string, tagIds: string[], extra: Partial<FilterContact> = {}): FilterContact => ({
  id, name: id, email: null, usernames: [], platforms: [], channelIds: ["ig"], isSubscribed: true, lastInteractionAt: "2026-11-26T00:00:00Z",
  customFields: [], tags: tagIds.map((t) => ({ id: t, name: t })), ...extra,
});
const all = [c("a", ["s1", "p1"]), c("b", ["s2"], { channelIds: ["wa"] }), c("d", ["s1"], { usernames: ["Roadie"], lastInteractionAt: "2026-10-01T00:00:00Z", isSubscribed: false })];
const run = (f: Partial<typeof EMPTY_CONTACT_FILTER>) =>
  filterContacts(all, { ...EMPTY_CONTACT_FILTER, ...f }, tags, NOW).map((x) => x.id);

describe("filterContacts", () => {
  it("OR inside a group, AND across groups", () => {
    expect(run({ tagIds: ["s1", "s2"] })).toEqual(["a", "b", "d"]);
    expect(run({ tagIds: ["s1", "p1"] })).toEqual(["a"]);
    expect(run({ tagIds: ["gone"] })).toEqual(["a", "b", "d"]);
  });
  it("search, dates, subscribed", () => {
    expect(run({ q: "@road" })).toEqual(["d"]);
    expect(run({ within: "7" })).toEqual(["a", "b"]);
    expect(run({ subscribed: "no" })).toEqual(["d"]);
    expect(run({ accounts: ["wa"] })).toEqual(["b"]);
    expect(run({ accounts: ["wa", "ig"] })).toEqual(["a", "b", "d"]);
  });
  it("counts what picking each tag would show", () => {
    const n = countTags(all, { ...EMPTY_CONTACT_FILTER, tagIds: ["s1"] }, tags, NOW);
    expect([n.get("s1"), n.get("s2"), n.get("p1")]).toEqual([2, 1, 1]);
  });
  it("counts each account under the other filters", () => {
    const n = countAccounts(all, { ...EMPTY_CONTACT_FILTER, tagIds: ["s1"], accounts: ["wa"] }, tags, NOW);
    expect([n.get("ig"), n.get("wa")]).toEqual([2, undefined]);
  });
  it("survives the address bar", () => {
    const f = { q: "a b", tagIds: ["s1", "p1"], within: "30", subscribed: "no" as const, accounts: ["wa"] };
    expect(readFilter(Object.fromEntries(new URLSearchParams(writeFilter(f))))).toEqual(f);
    expect(readFilter({ within: "999", sub: "maybe", tags: ["x", "y"] })).toEqual(EMPTY_CONTACT_FILTER);
  });
});
