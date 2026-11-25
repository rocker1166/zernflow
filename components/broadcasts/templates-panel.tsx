"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Pencil, Plus, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { MessageFields } from "@/components/broadcasts/message-fields";
import { createClient } from "@/lib/supabase/client";
import { contentProblem, type BroadcastContent } from "@/lib/broadcast-message";
import { fromTemplate, saveTemplate, type Template } from "@/lib/message-templates";

export function TemplatesPanel({ templates, workspaceId }: { templates: Template[]; workspaceId: string }) {
  const router = useRouter();
  /** "new", a template id, or nothing open */
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Template | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(template: Template) {
    setDeleting(null);
    const { error } = await createClient().from("message_templates").delete().eq("id", template.id);
    setError(error ? "Could not delete the template. Try again." : null);
    router.refresh();
  }
  function saved() {
    setEditing(null);
    router.refresh();
  }

  return (
    <div className="px-8 py-6">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Saved messages to reuse in broadcasts.</p>
        {editing !== "new" && (
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="inline-flex items-center gap-2 rounded-lg border border-input px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            <Plus className="h-4 w-4" />
            New template
          </button>
        )}
      </div>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {editing === "new" && (
        <div className="mb-4">
          <TemplateForm workspaceId={workspaceId} onSaved={saved} onCancel={() => setEditing(null)} />
        </div>
      )}
      {templates.length === 0 && editing !== "new" ? (
        <div className="flex flex-col items-center py-20 text-center">
          <FileText className="h-10 w-10 text-muted-foreground/40" />
          <p className="mt-3 text-sm font-medium text-muted-foreground">No templates yet</p>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {templates.map((t) =>
            editing === t.id ? (
              <TemplateForm key={t.id} template={t} workspaceId={workspaceId} onSaved={saved} onCancel={() => setEditing(null)} />
            ) : (
              <article key={t.id} className="flex flex-col rounded-lg border border-border bg-card p-4">
                <h3 className="text-sm font-semibold">{t.name}</h3>
                <p className="mt-2 line-clamp-5 flex-1 whitespace-pre-wrap text-sm text-muted-foreground">{t.body}</p>
                {t.button_label && (
                  <p className="mt-2 truncate text-xs text-muted-foreground">
                    Button: {t.button_label} · {t.button_url}
                  </p>
                )}
                <div className="mt-4 flex items-center gap-1">
                  <Link
                    href={`/dashboard/broadcasts/new?template=${t.id}`}
                    className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                  >
                    Use
                  </Link>
                  <button
                    type="button"
                    aria-label={`Edit ${t.name}`}
                    onClick={() => setEditing(t.id)}
                    className="ml-auto rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${t.name}`}
                    onClick={() => setDeleting(t)}
                    className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </article>
            )
          )}
        </div>
      )}
      <ConfirmDialog
        open={deleting !== null}
        title="Delete this template?"
        message={`"${deleting?.name}" will be gone for everyone in this workspace.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => deleting && remove(deleting)}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

function TemplateForm({
  template,
  workspaceId,
  onSaved,
  onCancel,
}: {
  template?: Template;
  workspaceId: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(template?.name ?? "");
  const [content, setContent] = useState<BroadcastContent>(template ? fromTemplate(template) : { text: "" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    const problem = !name.trim() ? "Give the template a name." : contentProblem(content);
    if (problem) return setError(problem);
    setSaving(true);
    const failed = await saveTemplate(createClient(), workspaceId, name, content, template?.id);
    setSaving(false);
    if (failed) setError(failed);
    else onSaved();
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <input
        aria-label="Template name"
        placeholder="Template name"
        value={name}
        maxLength={80}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-medium placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <MessageFields content={content} onChange={setContent} />
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent">
          Cancel
        </button>
      </div>
    </div>
  );
}
