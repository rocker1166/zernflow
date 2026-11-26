import { describe, expect, it } from "vitest";
import { completeRules, matchesSegment, readAll, type FilterField, type FilterOperator, type SegmentContact, type SegmentFilter } from "@/lib/segments";

const contact: SegmentContact = {
  tags: [{ id: "t1", name: "Creator" }],
  platforms: ["instagram"],
  channelIds: ["c1"],
  isSubscribed: true,
  lastInteractionAt: "2026-11-20T00:00:00Z",
  customFields: [{ slug: "city", value: "Delhi" }, { slug: "age", value: "9" }],
};
function one(field: FilterField, value: string, operator: FilterOperator = "equals"): SegmentFilter {
  return { combinator: "and", groups: [{ id: "g", combinator: "and", rules: [{ id: "r", field, operator, value }] }] };
}
const hit = (f: SegmentFilter) => matchesSegment(contact, f);

describe("matchesSegment", () => {
  it.each([
    [one("has_tag", "t1"), true],
    [one("has_tag", "Creator"), true],
    [one("has_tag", "t2"), false],
    [one("missing_tag", "t1"), false],
    [one("missing_tag", "t2"), true],
    [one("platform", "instagram"), true],
    [one("platform", "instagram", "not_equals"), false],
    [one("is_subscribed", "false"), false],
    [one("last_interaction", "2026-11-21", "before"), true],
    [one("last_interaction", "2026-11-21", "after"), false],
    [one("custom_field", "city::Delhi"), true],
    [one("custom_field", "city:Delhi"), true],
    [one("custom_field", "city::del", "contains"), true],
    [one("custom_field", "age::10", "lt"), true],
    [one("custom_field", "town::Delhi", "not_equals"), false],
  ])("%o", (filter, want) => expect(hit(filter)).toBe(want));

  it("an unfinished rule reaches nobody, so a half-made broadcast filter never means everyone", () => {
    for (const field of ["has_tag", "missing_tag", "platform", "is_subscribed", "last_interaction"] as const) {
      expect(hit(one(field, ""))).toBe(false);
    }
    expect(hit(one("custom_field", "city::", "contains"))).toBe(false);
    expect(hit({ combinator: "and", groups: [{ id: "g", combinator: "and", rules: [] }] })).toBe(false);
  });
  it("a live view leaves unfinished rules out", () => {
    expect(matchesSegment(contact, completeRules(one("has_tag", "")))).toBe(true);
  });
  it("combines rules and groups", () => {
    const a = one("has_tag", "t1").groups[0];
    const b = one("has_tag", "t2").groups[0];
    expect(matchesSegment(contact, { combinator: "or", groups: [a, b] })).toBe(true);
    expect(matchesSegment(contact, { combinator: "and", groups: [a, b] })).toBe(false);
    expect(hit({ combinator: "and", groups: [{ id: "g", combinator: "or", rules: [...a.rules, ...b.rules] }] })).toBe(true);
  });
});

describe("readAll", () => {
  it("reads past the first page and stops", async () => {
    const all = Array.from({ length: 2300 }, (_, i) => i);
    const calls: number[] = [];
    const got = await readAll(async (from, to) => {
      calls.push(from);
      return { data: all.slice(from, to + 1), error: null };
    });
    expect(got).toHaveLength(2300);
    expect(calls).toEqual([0, 1000, 2000]);
  });
  it("throws instead of returning half", async () => {
    await expect(readAll(async () => ({ data: null, error: { message: "down" } }))).rejects.toThrow("down");
  });
});
