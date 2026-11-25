import { getWorkspace } from "@/lib/workspace";
import { BroadcastsView } from "./broadcasts-view";

export default async function BroadcastsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { workspace, supabase } = await getWorkspace();
  const { tab } = await searchParams;

  const [{ data: broadcasts }, { data: templates }] = await Promise.all([
    supabase
      .from("broadcasts")
      .select("*")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false }),
    supabase.from("message_templates").select("*").eq("workspace_id", workspace.id).order("name"),
  ]);

  return (
    <BroadcastsView
      broadcasts={broadcasts ?? []}
      templates={templates ?? []}
      workspaceId={workspace.id}
      initialTab={tab === "templates" ? "templates" : "broadcasts"}
    />
  );
}
