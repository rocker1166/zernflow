"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Search, Users, CheckCircle, XCircle, Filter, ChevronDown, MessageSquare, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { SegmentBuilder, createEmptyFilter } from "@/components/segment-builder";
import { FacetMenu } from "@/components/contacts/facet-menu";
import { ContactAvatar } from "@/components/inbox/contact-avatar";
import { PlatformIcon } from "@/components/platform-icon";
import { TagChip } from "@/components/tag-chip";
import { compareTags, groupTags } from "@/lib/smart-tags/taxonomy";
import type { SegmentFilter } from "@/lib/segments";
import {
  ACTIVE_WITHIN,
  countTags,
  EMPTY_CONTACT_FILTER,
  filterContacts,
  isFiltering,
  writeFilter,
  type ContactFilter,
  type FilterContact,
  type FilterTag,
} from "@/lib/contact-filter";

interface ContactRow extends FilterContact {
  avatarUrl: string | null;
  conversationId: string | null;
}

const ROWS = 100;
const noSubscribe = () => () => {};

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
  workspaceId,
  initialFilter,
}: {
  contacts: ContactRow[];
  tags: FilterTag[];
  workspaceId: string;
  initialFilter: ContactFilter;
}) {
  const [filter, setFilter] = useState(initialFilter);
  const [showSegmentBuilder, setShowSegmentBuilder] = useState(false);
  const [segment, setSegment] = useState<SegmentFilter>(createEmptyFilter());
  const [shown, setShown] = useState(ROWS);
  // Dates depend on the viewer's clock, which is not the server's.
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);

  useEffect(() => {
    window.history.replaceState(null, "", window.location.pathname + writeFilter(filter));
  }, [filter]);

  function updateFilter(change: Partial<ContactFilter>) {
    setFilter((f) => ({ ...f, ...change }));
    setShown(ROWS);
  }

  const activeSegment = showSegmentBuilder ? segment : undefined;
  const [now] = useState(() => Date.now());
  const { matching, counts } = useMemo(
    () => ({
      matching: filterContacts(contacts, filter, tags, now, activeSegment),
      counts: countTags(contacts, filter, tags, now, activeSegment),
    }),
    [contacts, filter, tags, now, activeSegment]
  );

  const tagById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);
  const groups = useMemo(() => groupTags(tags), [tags]);
  const stages = groups.find((g) => g.key === "stage")?.tags ?? [];
  const facets = groups.filter((g) => g.key !== "stage");

  function setGroup(groupTags: FilterTag[], selected: string[]) {
    const ids = groupTags.map((t) => t.id);
    updateFilter({ tagIds: [...filter.tagIds.filter((id) => !ids.includes(id)), ...selected] });
  }
  const toggleTag = (id: string) =>
    updateFilter({
      tagIds: filter.tagIds.includes(id) ? filter.tagIds.filter((t) => t !== id) : [...filter.tagIds, id],
    });

  const total = `${contacts.length} contact${contacts.length !== 1 ? "s" : ""}`;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border px-8 py-6">
        <h1 className="text-2xl font-bold">Contacts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {matching.length === contacts.length ? `${total} in your workspace` : `${matching.length} of ${total}`}
        </p>

        {/* Stage */}
        {stages.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {stages.map((tag) => {
              const on = filter.tagIds.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleTag(tag.id)}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    on
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color ?? undefined }} />
                  {tag.name}
                  <span className="tabular-nums opacity-70">{counts.get(tag.id) ?? 0}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Search and filters */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              aria-label="Search contacts"
              placeholder="Name, @handle or email"
              value={filter.q}
              onChange={(e) => updateFilter({ q: e.target.value })}
              className="w-full rounded-lg border border-input bg-background py-1.5 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          {facets.map((group) => (
            <FacetMenu
              key={group.key}
              label={group.label}
              options={group.tags.map((t) => ({ value: t.id, label: t.name, color: t.color, count: counts.get(t.id) ?? 0 }))}
              selected={filter.tagIds.filter((id) => group.tags.some((t) => t.id === id))}
              onChange={(selected) => setGroup(group.tags, selected)}
            />
          ))}
          <FacetMenu
            label="Last active"
            multiple={false}
            options={Object.entries(ACTIVE_WITHIN).map(([value, label]) => ({ value, label }))}
            selected={filter.within ? [filter.within] : []}
            onChange={([within = ""]) => updateFilter({ within })}
          />
          <FacetMenu
            label="Subscribed"
            multiple={false}
            options={[
              { value: "yes", label: "Subscribed" },
              { value: "no", label: "Not subscribed" },
            ]}
            selected={filter.subscribed ? [filter.subscribed] : []}
            onChange={([s]) => updateFilter({ subscribed: s === "yes" || s === "no" ? s : "" })}
          />
          <button
            type="button"
            aria-expanded={showSegmentBuilder}
            onClick={() => setShowSegmentBuilder(!showSegmentBuilder)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
              showSegmentBuilder
                ? "border-primary bg-primary/10 text-primary"
                : "border-input text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            <Filter className="h-3 w-3" />
            Segment
            <ChevronDown className={cn("h-3 w-3 transition-transform", showSegmentBuilder && "rotate-180")} />
          </button>
          {(isFiltering(filter) || showSegmentBuilder) && (
            <button
              type="button"
              onClick={() => {
                updateFilter(EMPTY_CONTACT_FILTER);
                setSegment(createEmptyFilter());
                setShowSegmentBuilder(false);
              }}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-3 w-3" />
              Clear
            </button>
          )}
        </div>

        {showSegmentBuilder && (
          <div className="mt-4 max-h-[40vh] overflow-y-auto">
            <SegmentBuilder value={segment} onChange={setSegment} workspaceId={workspaceId} />
          </div>
        )}
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
                  <th className="px-8 py-3 font-medium">Name</th>
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
                  const worn = contact.tags
                    .flatMap((t) => tagById.get(t.id) ?? [])
                    .sort(compareTags);
                  const stage = worn.find((t) => t.category === "stage");
                  // The channel is the icon beside the name.
                  const rest = worn.filter((t) => t.category !== "stage" && t.category !== "channel");
                  const sub = contact.email ?? contact.usernames.find((u) => u !== contact.name);

                  return (
                    <tr key={contact.id} className="border-b border-border transition-colors hover:bg-accent/50">
                      <td className="px-8 py-3">
                        <Link href={`/dashboard/contacts/${contact.id}`} className="flex items-center gap-3">
                          <div className="relative flex-shrink-0">
                            <ContactAvatar name={contact.name} src={contact.avatarUrl} className="h-8 w-8 text-xs" />
                            {contact.platforms[0] && (
                              <span className="absolute -bottom-1 -right-1 rounded-full bg-background p-0.5">
                                <PlatformIcon platform={contact.platforms[0]} size={10} className="h-2.5 w-2.5" />
                              </span>
                            )}
                          </div>
                          <span className="min-w-0">
                            <span className="block max-w-56 truncate text-sm font-medium hover:underline">{contact.name}</span>
                            {sub && (
                              <span className="block max-w-56 truncate text-xs text-muted-foreground">
                                {contact.email ? sub : `@${sub}`}
                              </span>
                            )}
                          </span>
                        </Link>
                      </td>
                      <td className="px-4 py-3">{stage && <TagChip tag={stage} solid />}</td>
                      <td className="px-4 py-3">
                        {rest.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {rest.map((tag) => (
                              <TagChip key={tag.id} tag={tag} />
                            ))}
                          </div>
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
    </div>
  );
}
