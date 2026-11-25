import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { queueOutsideActivity, runSmartTags } from "@/lib/smart-tags/run";

/**
 * Smart tags. Called every minute, beside /api/cron/jobs and with its own lock, so reading
 * chats never holds up a flow. GET with Authorization: Bearer CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const provided = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!cronSecret || provided !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createServiceClient();
  let outside = 0;
  if (new Date().getMinutes() % 10 === 0) {
    try {
      outside = await queueOutsideActivity(supabase);
    } catch (err) {
      console.error("Smart tags: could not check for replies sent outside ZernFlow:", err);
    }
  }
  return NextResponse.json({ ...(await runSmartTags(supabase)), outside });
}
