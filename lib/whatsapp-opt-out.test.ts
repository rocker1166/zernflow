import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { confirmation, optOutScope, phoneOf, queueOptOut, runOptOut, type OptOutPayload } from "./whatsapp-opt-out";

const sendInboxMessage = vi.hoisted(() => vi.fn());
vi.mock("@/lib/zernio-client", () => ({ createZernioClient: () => ({ messages: { sendInboxMessage } }) }));

const payload: OptOutPayload = {
  scope: "all",
  phone: "+919000000001",
  senderId: "919000000001",
  senderName: "Asha",
  channelId: "ch1",
  workspaceId: "ws1",
  lateConversationId: "conv1",
  lateAccountId: "acc1",
};

/** Records every write; `failOn` makes writes to that table return an error. */
function fakeSupabase({ failOn, insertErrorCode }: { failOn?: string; insertErrorCode?: string } = {}) {
  const writes: Array<{ table: string; op: string; row: Record<string, unknown>; filters: Record<string, unknown> }> = [];
  const client = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const read = () =>
        table === "contact_channels"
          ? { data: { contact_id: "c1" }, error: null }
          : { data: { late_api_key_encrypted: "key" }, error: null };
      const write = (op: string, row: Record<string, unknown>) => {
        writes.push({ table, op, row, filters });
        const error =
          insertErrorCode && op === "insert"
            ? { code: insertErrorCode, message: "insert failed" }
            : failOn === table
              ? { code: "XX000", message: "db down" }
              : null;
        const chain = {
          eq(col: string, val: unknown) {
            filters[col] = val;
            return chain;
          },
          then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error }).then(ok),
        };
        return chain;
      };
      const select = {
        eq: () => select,
        single: () => Promise.resolve(read()),
      };
      return {
        select: () => select,
        insert: (row: Record<string, unknown>) => write("insert", row),
        update: (row: Record<string, unknown>) => write("update", row),
      };
    },
  };
  return { supabase: client as unknown as SupabaseClient<Database>, writes };
}

const answer = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  vi.stubEnv("KAAFILA_OPT_OUT_URL", "https://api.test/v1/whatsapp/opt-out");
  vi.stubEnv("KAAFILA_OPT_OUT_SECRET", "s".repeat(32));
  vi.spyOn(console, "error").mockImplementation(() => {});
  sendInboxMessage.mockReset().mockResolvedValue({});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("optOutScope", () => {
  it.each(["STOP", " stop ", "Stop!!", "stop 🙏", '"STOP"', "Unsubscribe.", "opt-out", "Don't message me", "don’t message me", "बंद करो", "मैसेज मत भेजो।"])(
    "%s stops everything",
    (text) => expect(optOutScope({ text })).toBe("all")
  );
  it.each(["Stop offers", "stop promotions", "STOP OFFERS."])("%s stops offers", (text) =>
    expect(optOutScope({ text })).toBe("offers")
  );
  it("reads the tapped button even when the text is missing or different", () => {
    expect(optOutScope({ text: null, buttonPayload: "Stop offers" })).toBe("offers");
    expect(optOutScope({ text: "STOP", buttonPayload: "Stop offers" })).toBe("offers");
  });
  it.each(["don't stop the trip", "where does the bus stop", "stop at Manali?", "is there a stop", "cancel", "remove me", "start", "", "🙏", null])(
    "%s is a chat",
    (text) => expect(optOutScope({ text })).toBeNull()
  );
});

describe("phoneOf", () => {
  it("takes the number, else bare digits, never a business-scoped id", () => {
    expect(phoneOf({ id: "IN.13491208655302741918", phoneNumber: "+919000000001" })).toBe("+919000000001");
    expect(phoneOf({ id: "919000000001", phoneNumber: null })).toBe("+919000000001");
    expect(phoneOf({ id: "IN.1349", phoneNumber: "+91 90000-00001" })).toBe("+919000000001");
    expect(phoneOf({ id: "919000000001", phoneNumber: "hidden" })).toBe("+919000000001");
    expect(phoneOf({ id: "IN.13491208655302741918" })).toBeNull();
    expect(phoneOf({ id: "13491208655302741918" })).toBeNull();
  });
});

describe("queueOptOut", () => {
  it("gives a redelivered message the same row id, and another message another one", async () => {
    const { supabase, writes } = fakeSupabase();
    await queueOptOut(supabase, "wamid.1", payload);
    await queueOptOut(supabase, "wamid.1", payload);
    await queueOptOut(supabase, "wamid.2", payload);
    const ids = writes.map((w) => w.row.id);
    expect(ids[0]).toMatch(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
    expect(ids[1]).toBe(ids[0]);
    expect(ids[2]).not.toBe(ids[0]);
  });
  it("accepts a row that is already there and throws on any other failure", async () => {
    await expect(queueOptOut(fakeSupabase({ insertErrorCode: "23505" }).supabase, "m", payload)).resolves.toBeUndefined();
    await expect(queueOptOut(fakeSupabase({ insertErrorCode: "57P01" }).supabase, "m", payload)).rejects.toThrow("could not be saved");
  });
});

describe("runOptOut", () => {
  it("stops local sends, tells Kaafila, then confirms", async () => {
    const fetchMock = answer(200, { matched: 1 });
    vi.stubGlobal("fetch", fetchMock);
    const { supabase, writes } = fakeSupabase();
    await runOptOut(supabase, payload);

    expect(writes.map((w) => [w.table, w.row, w.filters])).toEqual([
      ["contacts", { is_subscribed: false }, { id: "c1" }],
      ["sequence_enrollments", { status: "cancelled" }, { contact_id: "c1", channel_id: "ch1", status: "active" }],
      ["flow_sessions", { status: "cancelled" }, { contact_id: "c1", channel_id: "ch1", status: "active" }],
    ]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.test/v1/whatsapp/opt-out");
    expect(init.headers).toMatchObject({ "x-kaafila-secret": "s".repeat(32) });
    expect(JSON.parse(init.body as string)).toEqual({ phone: "+919000000001", scope: "all" });
    expect(sendInboxMessage).toHaveBeenCalledExactlyOnceWith({
      path: { conversationId: "conv1" },
      body: { accountId: "acc1", message: confirmation("all", true) },
    });
  });

  it.each([
    ["Kaafila is down", answer(503, {})],
    ["the secret is wrong", answer(403, {})],
    ["something else answers 200", answer(200, { ok: true })],
    ["the network fails", vi.fn(async () => { throw new Error("offline"); })],
  ])("throws to be retried, and says nothing to the person, when %s", async (_why, fetchMock) => {
    vi.stubGlobal("fetch", fetchMock);
    const { supabase, writes } = fakeSupabase();
    await expect(runOptOut(supabase, payload)).rejects.toThrow();
    expect(sendInboxMessage).not.toHaveBeenCalled();
    expect(writes[0]).toMatchObject({ table: "contacts", row: { is_subscribed: false } }); // local sends stop at once
  });

  it("throws while the settings are missing, so the opt-out waits for them", async () => {
    vi.stubEnv("KAAFILA_OPT_OUT_SECRET", "");
    await expect(runOptOut(fakeSupabase().supabase, payload)).rejects.toThrow("is not set");
    expect(sendInboxMessage).not.toHaveBeenCalled();
  });

  it("throws when local sends could not be stopped", async () => {
    vi.stubGlobal("fetch", answer(200, { matched: 1 }));
    await expect(runOptOut(fakeSupabase({ failOn: "contacts" }).supabase, payload)).rejects.toThrow("could not stop local sends");
  });

  it("does not repeat a finished opt-out because the confirmation failed", async () => {
    vi.stubGlobal("fetch", answer(200, { matched: 1 }));
    sendInboxMessage.mockRejectedValue(new Error("window closed"));
    await expect(runOptOut(fakeSupabase().supabase, payload)).resolves.toBeUndefined();
  });

  it("does not wait for a confirmation that hangs", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", answer(200, { matched: 1 }));
    sendInboxMessage.mockReturnValue(new Promise(() => {}));
    const done = runOptOut(fakeSupabase().supabase, payload);
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(done).resolves.toBeUndefined();
    vi.useRealTimers();
  });

  it("never claims it is done when WhatsApp hides the number", async () => {
    const fetchMock = answer(200, { matched: 1 });
    vi.stubGlobal("fetch", fetchMock);
    await runOptOut(fakeSupabase().supabase, { ...payload, phone: null });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendInboxMessage.mock.calls[0][0].body.message).toContain("turn messages off in the Kaafila app");
  });
});
