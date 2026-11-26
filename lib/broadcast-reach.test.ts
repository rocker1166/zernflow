import { describe, expect, it } from "vitest";
import { reachOf, replyWindow, timeLeft, type ReachChat } from "@/lib/broadcast-reach";

const NOW = Date.parse("2026-11-26T12:00:00Z");
const H = 3_600_000;
const chat = (hoursAgo: number | null, extra: Partial<ReachChat> = {}): ReachChat => ({
  id: "v", channelId: "c", platform: "instagram", hasChat: true,
  lastInboundAt: hoursAgo === null ? null : new Date(NOW - hoursAgo * H).toISOString(), ...extra,
});
const reach = (chats: ReachChat[], isSubscribed = true) => reachOf({ isSubscribed, chats }, NOW);

describe("reachOf", () => {
  it("is open for 24 hours after they wrote, and not a moment longer", () => {
    expect(reach([chat(23.9)])).toMatchObject({ ok: true });
    expect(reach([chat(24)])).toEqual({ ok: false, reason: "closed" });
  });
  it("counts an unknown last message as closed", () => {
    expect(reach([chat(null)])).toEqual({ ok: false, reason: "closed" });
  });
  it("needs a chat and a subscription", () => {
    expect(reach([])).toEqual({ ok: false, reason: "no_chat" });
    expect(reach([chat(1, { hasChat: false })])).toEqual({ ok: false, reason: "no_chat" });
    expect(reach([chat(1)], false)).toEqual({ ok: false, reason: "unsubscribed" });
  });
  it("picks the chat that stays open longest, and platforms without a window", () => {
    expect(reach([chat(20, { id: "a" }), chat(2, { id: "b" }), chat(30, { id: "c" })])).toMatchObject({ chat: { id: "b" } });
    expect(reach([chat(2, { id: "a" }), chat(null, { id: "t", platform: "telegram" })])).toMatchObject({ chat: { id: "t" }, closesAt: null });
  });
  it("says how long is left", () => {
    expect(timeLeft(NOW + 5.5 * H, NOW)).toBe("5 h left");
    expect(timeLeft(NOW + 0.5 * H, NOW)).toBe("30 min left");
  });
});

describe("replyWindow", () => {
  const at = (hoursAgo: number) => new Date(NOW - hoursAgo * H).toISOString();
  it("is a normal reply within 24 hours, when unknown, and where there is no window", () => {
    expect(replyWindow("instagram", at(23), NOW)).toEqual({ mode: "open" });
    expect(replyWindow("instagram", null, NOW)).toEqual({ mode: "open" });
    expect(replyWindow("telegram", at(500), NOW)).toEqual({ mode: "open" });
  });
  it("uses the human-agent tag from 24 hours to 7 days, on Instagram and Messenger only", () => {
    expect(replyWindow("instagram", at(24), NOW)).toEqual({ mode: "human_agent", until: NOW + 144 * H });
    expect(replyWindow("facebook", at(167), NOW)).toMatchObject({ mode: "human_agent" });
    expect(replyWindow("instagram", at(168), NOW)).toEqual({ mode: "closed", reason: "expired" });
    expect(replyWindow("whatsapp", at(25), NOW)).toEqual({ mode: "closed", reason: "needs_template" });
  });
});
