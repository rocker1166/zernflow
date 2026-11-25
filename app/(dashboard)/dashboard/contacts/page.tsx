import { getWorkspace } from "@/lib/workspace";
import { readFilter } from "@/lib/contact-filter";
import { loadContactRows } from "@/lib/contact-rows";
import { ContactsView } from "./contacts-view";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspace, supabase } = await getWorkspace();
  const filter = readFilter(await searchParams);

  const [contacts, tagsRes] = await Promise.all([
    loadContactRows(supabase, workspace.id),
    supabase.from("tags").select("id, name, color, category").eq("workspace_id", workspace.id).order("name"),
  ]);

  return <ContactsView contacts={contacts} tags={tagsRes.data ?? []} workspaceId={workspace.id} initialFilter={filter} />;
}
