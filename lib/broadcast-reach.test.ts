import { describe, expect, it } from "vitest";
import { reachOf, timeLeft, type ReachChat } from "@/lib/broadcast-reach";

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
