import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";

/**
 * Schedule a job to run at a specific time.
 */
export async function scheduleJob(
  supabase: SupabaseClient<Database>,
  type: string,
  payload: Record<string, unknown>,
  runAt: Date
) {
  const { data, error } = await supabase
    .from("scheduled_jobs")
    .insert({
      type,
      payload: payload as unknown as Json,
      run_at: runAt.toISOString(),
    })
    .select("id")
    .single();

  if (error) throw error;
  return data;
}

/**
 * Schedule broadcast delivery: one job per recipient, 15 a minute. Zernio allows 60 calls a
 * minute and the live flows and the tagger share them.
 */
const BROADCAST_SPACING_MS = 4000;

export async function scheduleBroadcastDelivery(
  supabase: SupabaseClient<Database>,
  broadcastId: string,
  recipientIds: string[]
) {
  if (recipientIds.length === 0) {
    throw new Error("No recipients to schedule");
  }

  const jobs = recipientIds.map((recipientId, index) => ({
    type: "send_broadcast",
    payload: { broadcastId, recipientId } as unknown as Json,
    run_at: new Date(Date.now() + index * BROADCAST_SPACING_MS).toISOString(),
    status: "pending" as const,
  }));

  // Insert in batches of 100
  const batchSize = 100;
  for (let i = 0; i < jobs.length; i += batchSize) {
    const batch = jobs.slice(i, i + batchSize);
    const { error } = await supabase.from("scheduled_jobs").insert(batch);
    if (error) throw new Error(`Failed to schedule jobs: ${error.message}`);
  }
}
