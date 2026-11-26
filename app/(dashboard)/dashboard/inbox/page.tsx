import { getWorkspace } from "@/lib/workspace";
import { InboxView } from "./inbox-view";
import { loadAccounts } from "@/lib/accounts";

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { workspace, supabase } = await getWorkspace();
  const { c: openId } = await searchParams;

  const [{ data: conversations }, { data: tags }, accounts] = await Promise.all([
    supabase
      .from("conversations")
      .select("*, contacts(*, contact_channels(platform_username), contact_tags(tag_id))")
      .eq("workspace_id", workspace.id)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      // Enough for the tag filter to mean something.
      .limit(500),
    supabase.from("tags").select("id, name, color, category").eq("workspace_id", workspace.id).order("name"),
    loadAccounts(supabase, workspace.id),
  ]);

  // ?c=<id> opens one conversation (links from Comment to DM activity). Fetch it when it is
  // older than the ones loaded.
  let list = conversations ?? [];
  if (openId && !list.some((c) => c.id === openId)) {
    const { data: extra } = await supabase
      .from("conversations")
      .select("*, contacts(*, contact_channels(platform_username), contact_tags(tag_id))")
      .eq("workspace_id", workspace.id)
      .eq("id", openId)
      .maybeSingle();
    if (extra) list = [extra, ...list];
  }

  return (
    <InboxView
      conversations={list}
      tags={tags ?? []}
      accounts={accounts}
      workspaceId={workspace.id}
      initialSelectedId={openId ?? null}
    />
  );
}
