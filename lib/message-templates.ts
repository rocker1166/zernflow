import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { toContent, type BroadcastContent } from "@/lib/broadcast-message";

export type Template = Database["public"]["Tables"]["message_templates"]["Row"];

export function fromTemplate(t: Template): BroadcastContent {
  return toContent({ text: t.body, buttonLabel: t.button_label, buttonUrl: t.button_url });
}

/** Adds a template, or changes the one with `id`. Returns what went wrong, or null. */
export async function saveTemplate(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  name: string,
  content: BroadcastContent,
  id?: string
): Promise<string | null> {
  const fields = {
    name: name.trim(),
    body: content.text.trim(),
    button_label: content.buttonLabel?.trim() || null,
    button_url: content.buttonUrl?.trim() || null,
  };
  const { error } = id
    ? await supabase.from("message_templates").update(fields).eq("id", id)
    : await supabase.from("message_templates").insert({ ...fields, workspace_id: workspaceId });
  if (!error) return null;
  return error.code === "23505" ? "A template with this name already exists." : "Could not save the template. Try again.";
}
