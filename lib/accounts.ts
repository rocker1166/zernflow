import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { platformLabel } from "@/lib/platforms";

/** A connected account (a channel), as filters show it. */
export interface Account {
  id: string;
  platform: string;
  label: string;
}

export function toAccount(c: { id: string; platform: string; username: string | null; display_name: string | null }): Account {
  const handle = c.username ?? c.display_name;
  const who = handle ? (c.platform === "whatsapp" || handle.startsWith("+") ? handle : `@${handle}`) : null;
  return { id: c.id, platform: c.platform, label: who ? `${platformLabel(c.platform)} · ${who}` : platformLabel(c.platform) };
}

export async function loadAccounts(supabase: SupabaseClient<Database>, workspaceId: string): Promise<Account[]> {
  const { data } = await supabase
    .from("channels")
    .select("id, platform, username, display_name")
    .eq("workspace_id", workspaceId)
    .order("platform");
  return (data ?? []).map(toAccount);
}
