import { getWorkspace } from "@/lib/workspace";
import { readFilter } from "@/lib/contact-filter";
import { loadContactRows } from "@/lib/contact-rows";
import { loadAccounts } from "@/lib/accounts";
import { ContactsView } from "./contacts-view";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspace, supabase } = await getWorkspace();
  const filter = readFilter(await searchParams);

  const [contacts, tagsRes, accounts] = await Promise.all([
    loadContactRows(supabase, workspace.id),
    supabase.from("tags").select("id, name, color, category").eq("workspace_id", workspace.id).order("name"),
    loadAccounts(supabase, workspace.id),
  ]);

  return <ContactsView contacts={contacts} tags={tagsRes.data ?? []} accounts={accounts} workspaceId={workspace.id} initialFilter={filter} />;
}
