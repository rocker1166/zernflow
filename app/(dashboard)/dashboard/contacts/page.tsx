import { getWorkspace } from "@/lib/workspace";
import { readFilter } from "@/lib/contact-filter";
import { readAll, toSegmentContact } from "@/lib/segments";
import { ContactsView } from "./contacts-view";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspace, supabase } = await getWorkspace();
  const filter = readFilter(await searchParams);

  const [contacts, tagsRes] = await Promise.all([
    readAll((from, to) =>
      supabase
        .from("contacts")
        .select(
          "id, display_name, email, avatar_url, is_subscribed, last_interaction_at, contact_tags(tags(id, name)), contact_channels(platform_username, channels(platform)), contact_custom_fields(value, custom_field_definitions(slug)), conversations(id, last_message_at)"
        )
        .eq("workspace_id", workspace.id)
        .order("last_interaction_at", { ascending: false, nullsFirst: false })
        .order("id")
        .range(from, to)
    ),
    supabase
      .from("tags")
      .select("id, name, color, category")
      .eq("workspace_id", workspace.id)
      .order("name"),
  ]);

  return (
    <ContactsView
      contacts={contacts.map((c) => ({
        ...toSegmentContact(c),
        id: c.id,
        name: c.display_name ?? "Unknown",
        email: c.email,
        avatarUrl: c.avatar_url,
        usernames: c.contact_channels.flatMap((cc) => (cc.platform_username ? [cc.platform_username] : [])),
        conversationId:
          [...c.conversations].sort((a, b) => (b.last_message_at ?? "").localeCompare(a.last_message_at ?? ""))[0]?.id ??
          null,
      }))}
      tags={tagsRes.data ?? []}
      workspaceId={workspace.id}
      initialFilter={filter}
    />
  );
}
