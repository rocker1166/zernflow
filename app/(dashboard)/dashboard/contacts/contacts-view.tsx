"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle, MessageSquare, Radio, Users, XCircle } from "lucide-react";
import { ContactFilters, useContactFilter } from "@/components/contacts/contact-filters";
import { ContactName, splitTags, TagList } from "@/components/contacts/contact-cells";
import { TagChip } from "@/components/tag-chip";
import { useMounted } from "@/components/use-mounted";
import { storeSelection } from "@/lib/broadcast-selection";
import { writeFilter, type ContactFilter, type FilterTag } from "@/lib/contact-filter";
import type { ContactRow } from "@/lib/contact-rows";
import type { Account } from "@/lib/accounts";

const ROWS = 100;

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const date = new Date(dateStr);
  const diffDays = Math.floor((Date.now() - date.getTime()) / 86_400_000);

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function ContactsView({
  contacts,
  tags,
  accounts,
  workspaceId,
  initialFilter,
}: {
  contacts: ContactRow[];
  tags: FilterTag[];
  accounts: Account[];
  workspaceId: string;
  initialFilter: ContactFilter;
}) {
  const router = useRouter();
  const list = useContactFilter(contacts, tags, initialFilter);
  const { filter, matching } = list;
  const [shown, setShown] = useState(ROWS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Dates depend on the viewer's clock, which is not the server's.
  const mounted = useMounted();

  useEffect(() => {
    window.history.replaceState(null, "", window.location.pathname + writeFilter(filter));
  }, [filter]);

  const tagById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);
  const total = `${contacts.length} contact${contacts.length !== 1 ? "s" : ""}`;
  const allSelected = matching.length > 0 && matching.every((c) => selected.has(c.id));

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
      for (const c of matching) if (allSelected) next.delete(c.id); else next.add(c.id);
      return next;
    });
  }
  function messageSelected() {
    storeSelection(selected);
    router.push("/dashboard/broadcasts/new");
  }

  return (
    <div className="relative flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border px-8 py-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Contacts</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {matching.length === contacts.length ? `${total} in your workspace` : `${matching.length} of ${total}`}
            </p>
          </div>
          <Link
            href={`/dashboard/broadcasts/new${writeFilter(filter)}`}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <Radio className="h-4 w-4" />
            New broadcast
          </Link>
        </div>
        <ContactFilters list={list} tags={tags} accounts={accounts} workspaceId={workspaceId} onChange={() => setShown(ROWS)} />
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {matching.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Users className="h-10 w-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm font-medium text-muted-foreground">
              {contacts.length ? "No contacts match these filters" : "No contacts yet"}
            </p>
            {contacts.length === 0 && (
              <p className="mt-1 text-xs text-muted-foreground/70">
                Contacts are created automatically when someone messages your channels
              </p>
            )}
          </div>
        ) : (
          <>
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase text-muted-foreground">
                  <th className="w-px py-3 pl-8 pr-1">
                    <input
                      type="checkbox"
                      aria-label={`Select all ${matching.length}`}
                      checked={allSelected}
                      onChange={toggleAll}
                      className="h-4 w-4 cursor-pointer align-middle accent-primary"
                    />
                  </th>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Stage</th>
                  <th className="px-4 py-3 font-medium">Tags</th>
                  <th className="px-4 py-3 font-medium">Last active</th>
                  <th className="px-4 py-3 font-medium">Subscribed</th>
                  <th className="px-4 py-3 font-medium">
                    <span className="sr-only">Chat</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {matching.slice(0, shown).map((contact) => {
                  const { stage, rest } = splitTags(contact, tagById);
                  return (
                    <tr key={contact.id} className="border-b border-border transition-colors hover:bg-accent/50">
                      <td className="w-px py-3 pl-8 pr-1">
                        <input
                          type="checkbox"
                          aria-label={`Select ${contact.name}`}
                          checked={selected.has(contact.id)}
                          onChange={() => toggle(contact.id)}
                          className="h-4 w-4 cursor-pointer align-middle accent-primary"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <ContactName contact={contact} link />
                      </td>
                      <td className="px-4 py-3">{stage && <TagChip tag={stage} solid />}</td>
                      <td className="px-4 py-3">
                        {rest.length > 0 ? (
                          <TagList tags={rest} />
                        ) : (
                          <span className="text-xs text-muted-foreground/60">No tags</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-muted-foreground" suppressHydrationWarning>
                        {mounted ? formatDate(contact.lastInteractionAt) : ""}
                      </td>
                      <td className="px-4 py-3">
                        {contact.isSubscribed ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600">
                            <CheckCircle className="h-3.5 w-3.5" />
                            Yes
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                            <XCircle className="h-3.5 w-3.5" />
                            No
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {contact.conversationId && (
                          <Link
                            href={`/dashboard/inbox?c=${contact.conversationId}`}
                            aria-label={`Open chat with ${contact.name}`}
                            title="Open chat"
                            className="inline-flex rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                          >
                            <MessageSquare className="h-4 w-4" />
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {matching.length > shown && (
              <div className="py-4 text-center">
                <button
                  type="button"
                  onClick={() => setShown(shown + ROWS)}
                  className="rounded-lg border border-border px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  Show {Math.min(ROWS, matching.length - shown)} more
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-4 border-t border-border bg-card px-8 py-3">
          <p className="text-sm font-medium">{selected.size} selected</p>
          <button
            type="button"
            onClick={messageSelected}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <Radio className="h-4 w-4" />
            Message selected
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Clear selection
          </button>
        </div>
      )}
    </div>
  );
}
