"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Filter, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { SegmentBuilder, createEmptyFilter } from "@/components/segment-builder";
import { FacetMenu } from "@/components/contacts/facet-menu";
import { groupTags } from "@/lib/smart-tags/taxonomy";
import type { SegmentFilter } from "@/lib/segments";
import {
  ACTIVE_WITHIN,
  countTags,
  EMPTY_CONTACT_FILTER,
  filterContacts,
  isFiltering,
  type ContactFilter,
  type FilterContact,
  type FilterTag,
} from "@/lib/contact-filter";

/** The filter state of a contact list, and what it leaves. */
export function useContactFilter<T extends FilterContact>(contacts: T[], tags: FilterTag[], initial: ContactFilter) {
  const [filter, setFilter] = useState(initial);
  const [segment, setSegment] = useState<SegmentFilter>(createEmptyFilter());
  const [showSegment, setShowSegment] = useState(false);
  const [now] = useState(() => Date.now());

  const activeSegment = showSegment ? segment : undefined;
  const { matching, counts } = useMemo(
    () => ({
      matching: filterContacts(contacts, filter, tags, now, activeSegment),
      counts: countTags(contacts, filter, tags, now, activeSegment),
    }),
    [contacts, filter, tags, now, activeSegment]
  );
  const update = (change: Partial<ContactFilter>) => setFilter((f) => ({ ...f, ...change }));

  return { filter, update, segment, setSegment, showSegment, setShowSegment, matching, counts };
}

/** Stage buttons, search, one menu per tag group, and the segment builder. */
export function ContactFilters({
  list,
  tags,
  workspaceId,
  onChange,
}: {
  list: ReturnType<typeof useContactFilter>;
  tags: FilterTag[];
  workspaceId: string;
  onChange?: () => void;
}) {
  const { filter, counts, segment, setSegment, showSegment, setShowSegment } = list;
  const groups = useMemo(() => groupTags(tags), [tags]);
  const stages = groups.find((g) => g.key === "stage")?.tags ?? [];
  const facets = groups.filter((g) => g.key !== "stage");

  function update(change: Partial<ContactFilter>) {
    list.update(change);
    onChange?.();
  }
  const toggleTag = (id: string) =>
    update({ tagIds: filter.tagIds.includes(id) ? filter.tagIds.filter((t) => t !== id) : [...filter.tagIds, id] });
  function setGroup(groupTags: FilterTag[], selected: string[]) {
    const ids = groupTags.map((t) => t.id);
    update({ tagIds: [...filter.tagIds.filter((id) => !ids.includes(id)), ...selected] });
  }

  return (
    <>
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

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            aria-label="Search contacts"
            placeholder="Name, @handle or email"
            value={filter.q}
            onChange={(e) => update({ q: e.target.value })}
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
          onChange={([within = ""]) => update({ within })}
        />
        <FacetMenu
          label="Subscribed"
          multiple={false}
          options={[
            { value: "yes", label: "Subscribed" },
            { value: "no", label: "Not subscribed" },
          ]}
          selected={filter.subscribed ? [filter.subscribed] : []}
          onChange={([s]) => update({ subscribed: s === "yes" || s === "no" ? s : "" })}
        />
        <button
          type="button"
          aria-expanded={showSegment}
          onClick={() => setShowSegment(!showSegment)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
            showSegment
              ? "border-primary bg-primary/10 text-primary"
              : "border-input text-muted-foreground hover:bg-accent hover:text-foreground"
          )}
        >
          <Filter className="h-3 w-3" />
          Segment
          <ChevronDown className={cn("h-3 w-3 transition-transform", showSegment && "rotate-180")} />
        </button>
        {(isFiltering(filter) || showSegment) && (
          <button
            type="button"
            onClick={() => {
              update(EMPTY_CONTACT_FILTER);
              setSegment(createEmptyFilter());
              setShowSegment(false);
            }}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-3 w-3" />
            Clear
          </button>
        )}
      </div>

      {showSegment && (
        <div className="mt-4 max-h-[40vh] overflow-y-auto">
          <SegmentBuilder value={segment} onChange={setSegment} workspaceId={workspaceId} />
        </div>
      )}
    </>
  );
}
