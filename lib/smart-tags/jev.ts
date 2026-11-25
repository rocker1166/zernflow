/**
 * TypeSafe Jev: typed questions in, calibrated answers out. It writes no text.
 * Same model and thresholds style as Warmbly's inbox tagging.
 */

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
/** Pinned: the thresholds in decide.ts belong to this version. */
export const JEV_MODEL = "jev-1.13.0";

export type JevQuestion =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "noul"; instructions: string };

export interface JevAnswer {
  /** choice */
  choice?: string;
  confidence?: number;
  /** choice: every option's probability */
  probabilities?: Record<string, number>;
  /** noul: probability of yes */
  noul?: number;
}

export interface JevResult {
  answers: Record<string, JevAnswer>;
  inputTokens: number;
}

/** 429/529: stop this run and leave the rest of the queue for the next one. */
export class JevBusyError extends Error {}

export async function askJev(
  state: unknown,
  questions: Record<string, JevQuestion>
): Promise<JevResult> {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) throw new Error("TYPESAFE_API_KEY is not set");

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model: JEV_MODEL, state, questions }),
    redirect: "error", // never carry the key to another host
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 429 || res.status === 529) throw new JevBusyError(`TypeSafe answered ${res.status}`);
  if (!res.ok) throw new Error(`TypeSafe answered ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const body = (await res.json()) as {
    answers?: Record<string, JevAnswer>;
    usage?: { input_tokens?: number };
  };
  if (!body.answers) throw new Error("TypeSafe answered without answers");
  return { answers: body.answers, inputTokens: body.usage?.input_tokens ?? 0 };
}
