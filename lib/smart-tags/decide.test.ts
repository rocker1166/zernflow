import { describe, expect, it } from "vitest";
import { buildAsk, decideTags, redact, type ContactFacts, type TagEvent } from "@/lib/smart-tags/decide";
import { commentEvents, messageEvents, timeline } from "@/lib/smart-tags/events";
import type { JevAnswer } from "@/lib/smart-tags/jev";

const NOW = Date.parse("2026-11-26T12:00:00Z");
const DAY = 86_400_000;

function ev(from: "us" | "them", text: string, daysAgo: number, extra: Partial<TagEvent> = {}): TagEvent {
  return { at: NOW - daysAgo * DAY, from, via: "dm", text, action: false, media: [], ...extra };
}
function facts(events: TagEvent[], extra: Partial<ContactFacts> = {}): ContactFacts {
  return { platforms: ["instagram"], subscribed: true, events, truncated: false, sessions: [], ...extra };
}
const say = (choice: string, confidence = 0.9): JevAnswer => ({ choice, confidence });
const p = (noul: number): JevAnswer => ({ noul });
const names = (f: ContactFacts, answers: Record<string, JevAnswer> = {}) =>
  decideTags(f, answers, NOW).tags.map((t) => t.name);

describe("stage", () => {
  it("needs a reply when they wrote last and are waiting", () => {
    const f = facts([ev("us", "hi", 2), ev("them", "share details", 1)]);
    expect(names(f, { needs_reply: p(0.9) })).toContain("Needs reply");
  });
  it("does not when they only said ok", () => {
    const f = facts([ev("us", "hi", 2), ev("them", "ok thanks", 1)]);
    const got = names(f, { needs_reply: p(0.1), intent: say("interested") });
    expect(got).not.toContain("Needs reply");
    expect(got).not.toContain("Waiting on them");
  });
  it("needs a reply when Jev gave no answer to go by", () => {
    expect(names(facts([ev("them", "hello?", 1)]))).toContain("Needs reply");
  });
  it("needs a reply when a tap was never answered", () => {
    expect(names(facts([ev("us", "tap", 2), ev("them", "I followed", 1, { action: true })]))).toContain("Needs reply");
  });
  it("moves waiting, follow up, gone quiet with the days, and says when to look again", () => {
    const at = (d: number) => decideTags(facts([ev("them", "yes", d + 1), ev("us", "great", d)]), { intent: say("interested") }, NOW);
    expect(at(1).tags.map((t) => t.name)).toContain("Waiting on them");
    expect(at(1).nextLookAt).toBe(NOW + 4 * DAY);
    expect(at(6).tags.map((t) => t.name)).toContain("Follow up");
    expect(at(6).nextLookAt).toBe(NOW + 4 * DAY);
    expect(at(20).tags.map((t) => t.name)).toContain("Gone quiet");
    expect(at(20).nextLookAt).toBeNull();
  });
  it("never replied: only our message, or a comment that never answered the DM", () => {
    expect(names(facts([ev("us", "hi", 1)]))).toContain("Never replied");
    const comment = ev("them", "Kaafila", 2, { via: "comment", action: true });
    expect(names(facts([comment, ev("us", "follow first", 2)]))).toContain("Never replied");
  });
  it("closed after a no, opted out beats everything", () => {
    const no = facts([ev("them", "not interested", 2), ev("us", "ok", 1)]);
    expect(names(no, { intent: say("not_interested") })).toContain("Closed");
    expect(names({ ...no, subscribed: false }, { intent: say("not_interested") })).toContain("Opted out");
    const ask = facts([ev("them", "stop messaging me", 1)]);
    expect(names(ask, { removal: p(0.79), needs_reply: p(0.9) })).not.toContain("Opted out");
    expect(names(ask, { removal: p(0.95), needs_reply: p(0.9) })).toContain("Opted out");
  });
  it("wears exactly one stage", () => {
    const stages = ["Needs reply", "Waiting on them", "Follow up", "Gone quiet", "Never replied", "Closed", "Opted out"];
    const got = names(facts([ev("them", "no", 2), ev("us", "ok", 1)], { subscribed: false }), { intent: say("not_interested") });
    expect(got.filter((n) => stages.includes(n))).toHaveLength(1);
  });
});

describe("what Jev reads", () => {
  it("drops an unsure answer and asks a person to look", () => {
    const f = facts([ev("them", "hmm", 2), ev("us", "?", 1)]);
    const got = names(f, { person: say("creator", 0.69), intent: say("interested", 0.5) });
    expect(got).not.toContain("Creator");
    expect(got).not.toContain("Interested");
    expect(got).toContain("Needs review");
  });
  it("reads a split between near options as one answer, and only between those", () => {
    const split = (probabilities: Record<string, number>): JevAnswer => ({ choice: Object.keys(probabilities)[0], confidence: 0.4, probabilities });
    const f = facts([ev("them", "led 85 trips", 2), ev("us", "great", 1)]);
    const person = split({ creator: 0.52, captain: 0.48 });
    expect(names(f, { person, has_experience: p(0.9) })).toContain("Trip captain");
    expect(names(f, { person })).not.toContain("Trip captain");
    expect(names(f, { intent: split({ interested: 0.5, answered: 0.4, unclear: 0.1 }) })).toContain("Interested");
    expect(names(f, { intent: split({ interested: 0.5, not_now: 0.5 }) })).not.toContain("Interested");
  });
  it("ignores a choice it does not know", () => {
    const f = facts([ev("them", "x", 1), ev("us", "y", 0)]);
    const got = names(f, { person: say("toString"), intent: say("constructor") });
    expect(got).toEqual(["Instagram", "They messaged first", "Waiting on them"]);
  });
  it("gives no intent to someone who only tapped or sent the keyword", () => {
    const f = facts([ev("them", "Kaafila", 2, { via: "comment", action: true }), ev("us", "hey", 2), ev("them", "I followed", 1, { action: true }), ev("us", "link", 1)]);
    expect(Object.keys(buildAsk(f)!.questions)).toEqual(["person"]);
    expect(names(f, { person: say("captain"), intent: say("interested") })).not.toContain("Interested");
  });
  it("does not treat a bot answer as a reply, but still shows a shared number", () => {
    const f = facts([ev("us", "hi", 2), ev("them", "Thanks for contacting us, call 98765 43210", 1)]);
    const got = names(f, { auto_reply: p(0.8), intent: say("interested"), needs_reply: p(0.9) });
    expect(got).toEqual(expect.arrayContaining(["Auto-reply", "Never replied", "Shared number"]));
    expect(got).not.toContain("Interested");
  });
  it("asks nothing when there is nothing to read", () => {
    expect(buildAsk(facts([]))).toBeNull();
    expect(names(facts([]))).toEqual(["Instagram"]);
  });
  it("same chat, same hash; a new message, a new one", () => {
    const a = buildAsk(facts([ev("them", "hi", 1)]))!.hash;
    expect(buildAsk(facts([ev("them", "hi", 3)]))!.hash).toBe(a);
    expect(buildAsk(facts([ev("them", "hi", 1), ev("us", "hello", 0)]))!.hash).not.toBe(a);
  });
});

describe("privacy", () => {
  it.each([
    ["8505885256", "[phone number]"],
    ["https://wa.me/919876543210", "https://wa.me/[phone number]"],
    ["Ph.9876543210", "Ph.[phone number]"],
    ["+91 98992-90722 call me", "[phone number] call me"],
    ["mail a.b+c@gmail.com ok", "mail [email] ok"],
    ["₹15000 for 12 people on 12/12/2026", "₹15000 for 12 people on 12/12/2026"],
    ["https://www.instagram.com/reel/18146154052591962/", "https://www.instagram.com/reel/18146154052591962/"],
  ])("%s", (input, want) => expect(redact(input)).toBe(want));
  it("no number or email reaches the request", () => {
    const body = JSON.stringify(buildAsk(facts([ev("them", "8505885256 me@x.in", 1)])));
    expect(body).not.toMatch(/8505885256|me@x\.in/);
  });
});

describe("facts", () => {
  it("source is the first thing that happened, unknown when history is cut", () => {
    const comment = ev("them", "Kaafila", 3, { via: "comment", action: true });
    expect(names(facts([comment, ev("us", "hi", 2)]))).toContain("Reel comment");
    expect(names(facts([ev("us", "hi", 2)]))).toContain("We messaged first");
    expect(names(facts([ev("them", "hi", 2)]))).toContain("They messaged first");
    expect(names(facts([ev("us", "hi", 2)], { truncated: true }))).not.toContain("We messaged first");
  });
  it("funnel keeps the furthest step", () => {
    const s = (status: string, waiting: boolean, followStatus: string | null) => ({ status, waiting, followStatus });
    expect(names(facts([], { sessions: [s("active", true, null)] }))).toContain("Did not tap the DM");
    expect(names(facts([], { sessions: [s("active", true, "not_following")] }))).toContain("Did not follow yet");
    expect(names(facts([], { sessions: [s("active", true, "unknown")] }))).toContain("Did not tap the DM");
    expect(names(facts([ev("them", "I followed", 1)], { sessions: [s("active", true, "unknown")] }))).toContain("Did not follow yet");
    expect(names(facts([], { sessions: [s("active", true, null), s("completed", false, "following")] }))).toContain("Got the link");
  });
  it("an answered comment lands before its own DM", () => {
    const at = "2026-11-25T10:00:00Z";
    const events = timeline(
      messageEvents([{ message: "follow first", direction: "outgoing", sentAt: "2026-11-25T09:59:50Z" }]),
      commentEvents([{ post_id: "1", comment_text: "Kaafila", matched_trigger_id: null, flow_id: "f", dm_sent: true, created_at: at }], new Map([["1", "Trip Captains"]]))
    );
    expect(events.map((e) => e.via)).toEqual(["comment", "dm"]);
    expect(events[0]).toMatchObject({ action: true, reel: "Trip Captains" });
  });
  it("a quick reply tap is an action and a deleted message is gone", () => {
    const events = messageEvents([
      { message: "I followed", direction: "incoming", sentAt: "2026-11-25T10:00:00Z", metadata: { quickReplyPayload: "ask" } },
      { message: "oops", direction: "incoming", sentAt: "2026-11-25T10:01:00Z", isDeleted: true },
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe(true);
  });
});
