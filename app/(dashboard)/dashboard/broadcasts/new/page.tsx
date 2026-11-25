import { getWorkspace } from "@/lib/workspace";
import { readFilter } from "@/lib/contact-filter";
import { toContent } from "@/lib/broadcast-message";
import { loadContactRows } from "@/lib/contact-rows";
import { fromTemplate } from "@/lib/message-templates";
import { Composer } from "./composer";

export default async function NewBroadcastPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspace, supabase } = await getWorkspace();
  const params = await searchParams;

  const [contacts, { data: tags }, { data: templates }, { data: draft }] = await Promise.all([
    loadContactRows(supabase, workspace.id),
    supabase.from("tags").select("id, name, color, category").eq("workspace_id", workspace.id).order("name"),
    supabase.from("message_templates").select("*").eq("workspace_id", workspace.id).order("name"),
    typeof params.draft === "string"
      ? supabase
          .from("broadcasts")
          .select("id, name, message_content")
          .eq("id", params.draft)
          .eq("workspace_id", workspace.id)
          .eq("status", "draft")
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const template = (templates ?? []).find((t) => t.id === params.template);
  return (
    <Composer
      contacts={contacts}
      tags={tags ?? []}
      templates={templates ?? []}
      workspaceId={workspace.id}
      initialFilter={readFilter(params)}
      draftId={draft?.id ?? null}
      initialName={draft?.name ?? template?.name ?? ""}
      initialContent={draft ? toContent(draft.message_content) : template ? fromTemplate(template) : { text: "" }}
    />
  );
}
