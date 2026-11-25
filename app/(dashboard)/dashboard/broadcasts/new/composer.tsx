"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronLeft, ChevronRight, Send } from "lucide-react";
import { ContactFilters, useContactFilter } from "@/components/contacts/contact-filters";
import { ContactName, splitTags, TagList } from "@/components/contacts/contact-cells";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { MessageBubble, MessageFields } from "@/components/broadcasts/message-fields";
import { TagChip } from "@/components/tag-chip";
import { useMounted } from "@/components/use-mounted";
import { contentProblem, personalize, type BroadcastContent } from "@/lib/broadcast-message";
import { REACH_REASON, reachOf, timeLeft } from "@/lib/broadcast-reach";
import { takeSelection } from "@/lib/broadcast-selection";
import { createClient } from "@/lib/supabase/client";
import { fromTemplate, saveTemplate, type Template } from "@/lib/message-templates";
import type { ContactFilter, FilterTag } from "@/lib/contact-filter";
import type { ContactRow } from "@/lib/contact-rows";
import type { Json } from "@/lib/types/database";
import { cn } from "@/lib/utils";

const ROWS = 100;

interface ComposerProps {
  contacts: ContactRow[];
  tags: FilterTag[];
  templates: Template[];
  workspaceId: string;
  initialFilter: ContactFilter;
  initialName: string;
  initialContent: BroadcastContent;
  draftId: string | null;
}

/** Who can be reached depends on the viewer's clock, and the ticked contacts on their tab. */
export function Composer(props: ComposerProps) {
  return useMounted() ? <ComposerInner {...props} /> : null;
}

function ComposerInner({
  contacts,
  tags,
  templates,
  workspaceId,
  initialFilter,
  initialName,
  initialContent,
  draftId,
}: ComposerProps) {
  const router = useRouter();
  const [now] = useState(() => Date.now());
  const [onlyReachable, setOnlyReachable] = useState(true);
  const reach = useMemo(() => new Map(contacts.map((c) => [c.id, reachOf(c, now)])), [contacts, now]);
  const isReachable = (c: ContactRow) => reach.get(c.id)?.ok === true;
  // The counts on the filters are of the people on show.
  const base = useMemo(
    () => (onlyReachable ? contacts.filter((c) => reach.get(c.id)?.ok) : contacts),
    [contacts, onlyReachable, reach]
  );
  const list = useContactFilter(base, tags, initialFilter);
  const [shown, setShown] = useState(ROWS);
  const [name, setName] = useState(initialName);
  const [content, setContent] = useState(initialContent);
  const [previewAt, setPreviewAt] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // A failed send keeps its row, so trying again does not make a second one.
  const broadcastId = useRef(draftId);

  const [carried] = useState(takeSelection);
  const [selected, setSelected] = useState(() => new Set([...carried].filter((id) => reach.get(id)?.ok)));
  const leftOut = carried.size - [...carried].filter((id) => reach.get(id)?.ok).length;

  const tagById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);
  const rows = list.matching;
  const pickable = rows.filter(isReachable);
  const allPicked = pickable.length > 0 && pickable.every((c) => selected.has(c.id));
  const reachableTotal = contacts.filter(isReachable).length;
  const recipients = contacts.filter((c) => selected.has(c.id));
  const person = recipients[Math.min(previewAt, recipients.length - 1)];
  const problem = contentProblem(content);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of pickable) if (allPicked) next.delete(c.id); else next.add(c.id);
      return next;
    });
  }
  function applyTemplate(id: string) {
    const template = templates.find((t) => t.id === id);
    if (!template) return;
    setContent(fromTemplate(template));
    if (!name.trim()) setName(template.name);
    setNotice(null);
  }
  async function keepAsTemplate() {
    const label = name.trim();
    if (problem) return setError(problem);
    if (!label) return setError("Give the broadcast a name first. The template will use it.");
    const failed = await saveTemplate(createClient(), workspaceId, label, content);
    setError(failed);
    if (!failed) {
      setNotice(`Saved as template "${label}".`);
      router.refresh();
    }
  }

  async function send() {
    setConfirming(false);
    if (sending) return;
    setSending(true);
    setError(null);
    setNotice(null);
    try {
      const fields = {
        name: name.trim() || Array.from(content.text.trim()).slice(0, 40).join(""),
        message_content: content as unknown as Json,
      };
      const broadcasts = createClient().from("broadcasts");
      if (broadcastId.current) {
        const { error } = await broadcasts.update(fields).eq("id", broadcastId.current).eq("status", "draft");
        if (error) throw new Error("Could not save the broadcast. Try again.");
      } else {
        const { data, error } = await broadcasts
          .insert({ ...fields, workspace_id: workspaceId, status: "draft" })
          .select("id")
          .single();
        if (error) throw new Error("Could not create the broadcast. Try again.");
        broadcastId.current = data.id;
      }
      const res = await fetch(`/api/v1/broadcasts/${broadcastId.current}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageContent: content, contactIds: recipients.map((c) => c.id) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not send. Try again.");
      router.push(`/dashboard/broadcasts/${broadcastId.current}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send. Try again.");
      setSending(false);
    }
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Who */}
      <div className="flex min-w-0 flex-1 flex-col border-r border-border">
        <div className="border-b border-border px-8 py-6">
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard/broadcasts"
              aria-label="Back to broadcasts"
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <h1 className="text-2xl font-bold">New broadcast</h1>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              {reachableTotal} of {contacts.length} contacts can get a message now.
            </span>{" "}
            Instagram and WhatsApp only allow it within 24 hours of their last message to you.
          </p>
          {leftOut > 0 && (
            <p className="mt-1 text-sm text-amber-600">
              {leftOut} of the {carried.size} you ticked cannot get a message now and {leftOut === 1 ? "was" : "were"} left out.
            </p>
          )}
          <ContactFilters list={list} tags={tags} workspaceId={workspaceId} onChange={() => setShown(ROWS)} />
          <label className="mt-3 flex w-fit cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={onlyReachable}
              onChange={(e) => setOnlyReachable(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            Only show people who can get a message now
          </label>
        </div>

        <div className="flex-1 overflow-auto">
          {rows.length === 0 ? (
            <p className="py-20 text-center text-sm text-muted-foreground">
              {onlyReachable ? "Nobody here can get a message right now." : "No contacts match these filters."}
            </p>
          ) : (
            <table className="w-full">
              <thead className="sticky top-0 z-10 bg-background">
                <tr className="border-b border-border text-left text-xs font-medium uppercase text-muted-foreground">
                  <th className="w-px py-3 pl-8 pr-1">
                    <input
                      type="checkbox"
                      aria-label={`Select all ${pickable.length}`}
                      checked={allPicked}
                      disabled={pickable.length === 0}
                      onChange={toggleAll}
                      className="h-4 w-4 cursor-pointer align-middle accent-primary"
                    />
                  </th>
                  <th className="px-4 py-3 font-medium">
                    {allPicked ? "All selected" : `Select all ${pickable.length}`}
                  </th>
                  <th className="px-4 py-3 font-medium">Tags</th>
                  <th className="px-4 py-3 font-medium">Can receive</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, shown).map((c) => {
                  const r = reach.get(c.id)!;
                  const { stage, rest } = splitTags(c, tagById);
                  return (
                    <tr
                      key={c.id}
                      onClick={() => r.ok && toggle(c.id)}
                      className={cn(
                        "border-b border-border",
                        r.ok ? "cursor-pointer hover:bg-accent/50" : "opacity-50",
                        selected.has(c.id) && "bg-accent/40"
                      )}
                    >
                      <td className="w-px py-3 pl-8 pr-1">
                        <input
                          type="checkbox"
                          aria-label={`Select ${c.name}`}
                          checked={selected.has(c.id)}
                          disabled={!r.ok}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => toggle(c.id)}
                          className="h-4 w-4 align-middle accent-primary"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <ContactName contact={c} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {stage && <TagChip tag={stage} solid />}
                          <TagList tags={rest} />
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                        {r.ok ? timeLeft(r.closesAt, now) : REACH_REASON[r.reason]}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {rows.length > shown && (
            <div className="py-4 text-center">
              <button
                type="button"
                onClick={() => setShown(shown + ROWS)}
                className="rounded-lg border border-border px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                Show {Math.min(ROWS, rows.length - shown)} more
              </button>
            </div>
          )}
        </div>
      </div>

      {/* What */}
      <div className="flex w-[400px] flex-shrink-0 flex-col">
        <div className="flex-1 space-y-5 overflow-y-auto p-6">
          <input
            aria-label="Broadcast name"
            placeholder="Broadcast name (only you see it)"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Message</h2>
              {templates.length > 0 && (
                <select
                  aria-label="Use a template"
                  value=""
                  onChange={(e) => applyTemplate(e.target.value)}
                  className="max-w-[200px] rounded-lg border border-input bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Use a template...</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <MessageFields content={content} onChange={setContent} />
            <button
              type="button"
              onClick={keepAsTemplate}
              className="mt-2 text-xs font-medium text-primary hover:underline"
            >
              Save as template
            </button>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Preview</h2>
              {recipients.length > 1 && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <button
                    type="button"
                    aria-label="Previous person"
                    onClick={() => setPreviewAt((i) => (Math.min(i, recipients.length - 1) + recipients.length - 1) % recipients.length)}
                    className="rounded p-1 hover:bg-accent"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <span className="max-w-32 truncate">{person?.name}</span>
                  <button
                    type="button"
                    aria-label="Next person"
                    onClick={() => setPreviewAt((i) => (Math.min(i, recipients.length - 1) + 1) % recipients.length)}
                    className="rounded p-1 hover:bg-accent"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
            <div className="rounded-lg border border-border bg-muted/30 p-4">
              <MessageBubble content={content} text={personalize(content.text, person?.name ?? null)} />
            </div>
          </div>
        </div>

        <div className="space-y-3 border-t border-border p-6">
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          {notice && <p role="status" className="text-sm text-green-600">{notice}</p>}
          <button
            type="button"
            disabled={sending || recipients.length === 0 || problem !== null}
            onClick={() => setConfirming(true)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            {sending ? "Sending..." : `Send to ${recipients.length}`}
          </button>
          <p className="text-center text-xs text-muted-foreground">
            {recipients.length === 0 ? "Tick who should get it." : problem ?? `Goes out at 15 a minute. You can stop it on the next screen.`}
          </p>
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        title={`Send to ${recipients.length} ${recipients.length === 1 ? "person" : "people"}?`}
        message="It starts right away and a sent message cannot be taken back."
        confirmLabel="Send now"
        onConfirm={send}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
