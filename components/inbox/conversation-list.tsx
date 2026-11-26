"use client";

import { useState, useEffect } from "react";
import { Search, MessageSquare } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { PlatformIcon } from "@/components/platform-icon";
import { ContactAvatar } from "@/components/inbox/contact-avatar";
import { FacetMenu } from "@/components/contacts/facet-menu";
import type { Account } from "@/lib/accounts";
import { TagChip } from "@/components/tag-chip";
import { compareTags, groupTags } from "@/lib/smart-tags/taxonomy";
import type { Database, Platform, ConversationStatus } from "@/lib/types/database";

export type Conversation = Database["public"]["Tables"]["conversations"]["Row"] & {
  contacts:
    | (Database["public"]["Tables"]["contacts"]["Row"] & { contact_tags?: { tag_id: string }[] })
    | null;
};
export type InboxTag = Pick<Database["public"]["Tables"]["tags"]["Row"], "id" | "name" | "color" | "category">;

function formatTime(dateStr: string | null): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) {
    return date.toLocaleDateString([], { weekday: "short" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function ConversationList({
  conversations: initialConversations,
  tags,
  accounts,
  workspaceId,
  selectedId,
  onSelect,
}: {
  conversations: Conversation[];
  tags: InboxTag[];
  accounts: Account[];
  workspaceId: string;
  selectedId: string | null;
  onSelect: (conversation: Conversation) => void;
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const [search, setSearch] = useState("");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<ConversationStatus | "all">("open");
  // Relative timestamps depend on the client's clock/locale, which differ from the
  // server's during SSR and trigger a hydration mismatch (React #418, which crashes
  // the inbox in production). Defer time rendering until after mount so the server
  // and the first client render agree.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    setConversations(initialConversations);
  }, [initialConversations]);

  // Subscribe to conversation updates via Realtime
  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel("conversations-updates")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversations",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        async (payload) => {
          if (payload.eventType === "UPDATE") {
            const updated = payload.new as Database["public"]["Tables"]["conversations"]["Row"];
            setConversations((prev) =>
              prev
                .map((c) => (c.id === updated.id ? { ...c, ...updated } : c))
                .sort((a, b) => {
                  const aTime = a.last_message_at ?? a.created_at;
                  const bTime = b.last_message_at ?? b.created_at;
                  return new Date(bTime).getTime() - new Date(aTime).getTime();
                })
            );
          } else if (payload.eventType === "INSERT") {
            const inserted = payload.new as Database["public"]["Tables"]["conversations"]["Row"];
            // Fetch full conversation with contact
            const { data } = await supabase
              .from("conversations")
              .select("*, contacts(*, contact_tags(tag_id))")
              .eq("id", inserted.id)
              .single();
            if (data) {
              setConversations((prev) => [data as Conversation, ...prev]);
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [workspaceId]);

  const groups = groupTags(tags).filter((g) => g.key === "stage" || g.key === "person" || g.key === "intent");
  const wears = (c: Conversation, id: string) => Boolean(c.contacts?.contact_tags?.some((t) => t.tag_id === id));
  const wanted = groups
    .map((g) => g.tags.filter((t) => tagIds.includes(t.id)))
    .filter((g) => g.length > 0);

  const filtered = conversations.filter((c) => {
    if (accountIds.length && !accountIds.includes(c.channel_id)) return false;
    if (!wanted.every((group) => group.some((t) => wears(c, t.id)))) return false;
    if (statusFilter !== "all" && c.status !== statusFilter) return false;
    if (search) {
      const name = c.contacts?.display_name?.toLowerCase() ?? "";
      const preview = c.last_message_preview?.toLowerCase() ?? "";
      const q = search.toLowerCase();
      if (!name.includes(q) && !preview.includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="flex h-full flex-col border-r border-border bg-background">
      {/* Header */}
      <div className="flex h-14 items-center justify-between border-b border-border px-4">
        <h2 className="text-sm font-semibold">Inbox</h2>
        <span className="text-xs text-muted-foreground">
          {filtered.length} conversation{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Search */}
      <div className="p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search conversations..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      {/* Status filter */}
      <div className="flex gap-1 px-3 pb-2">
        {(["all", "open", "closed", "snoozed"] as const).map((status) => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors",
              statusFilter === status
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            {status}
          </button>
        ))}
      </div>

      {/* Tag filters */}
      {(groups.length > 0 || accounts.length > 1) && (
        <div className="flex flex-wrap gap-1.5 px-3 pb-2">
          {accounts.length > 1 && (
            <FacetMenu
              label="Account"
              options={accounts.map((a) => ({
                value: a.id,
                label: a.label,
                count: conversations.filter((c) => c.channel_id === a.id).length,
              }))}
              selected={accountIds}
              onChange={setAccountIds}
            />
          )}
          {groups.map((group) => (
            <FacetMenu
              key={group.key}
              label={group.label}
              options={group.tags.map((t) => ({
                value: t.id,
                label: t.name,
                color: t.color,
                count: conversations.filter((c) => wears(c, t.id)).length,
              }))}
              selected={tagIds.filter((id) => group.tags.some((t) => t.id === id))}
              onChange={(selected) =>
                setTagIds((prev) => [...prev.filter((id) => !group.tags.some((t) => t.id === id)), ...selected])
              }
            />
          ))}
        </div>
      )}

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <MessageSquare className="h-8 w-8 text-muted-foreground/50" />
            <p className="mt-2 text-sm text-muted-foreground">No conversations found</p>
          </div>
        ) : (
          filtered.map((conversation) => (
            <button
              key={conversation.id}
              onClick={() => onSelect(conversation)}
              className={cn(
                "flex w-full items-start gap-3 border-b border-border p-3 text-left transition-colors hover:bg-accent/50",
                selectedId === conversation.id && "bg-accent"
              )}
            >
              {/* Avatar with platform badge */}
              <div className="relative flex-shrink-0">
                <ContactAvatar
                  name={conversation.contacts?.display_name}
                  src={conversation.contacts?.avatar_url}
                  className="h-10 w-10 text-sm"
                />
                <div className="absolute -bottom-0.5 -right-0.5 flex h-4.5 w-4.5 items-center justify-center rounded-full border-2 border-background bg-background">
                  <PlatformIcon
                    platform={conversation.platform}
                    className="h-3 w-3"
                    size={12}
                  />
                </div>
              </div>

              {/* Content */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <p className="truncate text-sm font-medium">
                    {conversation.contacts?.display_name ?? "Unknown"}
                  </p>
                  <span
                    suppressHydrationWarning
                    className="flex-shrink-0 text-[11px] text-muted-foreground"
                  >
                    {mounted ? formatTime(conversation.last_message_at) : ""}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {conversation.last_message_preview ?? "No messages yet"}
                  </p>
                  {conversation.unread_count > 0 && (
                    <span className="ml-2 flex h-5 min-w-5 flex-shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                      {conversation.unread_count}
                    </span>
                  )}
                </div>
                <RowTags tags={tags.filter((t) => wears(conversation, t.id))} />
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

/** What matters while scanning chats: the stage, who they are and what they want. */
function RowTags({ tags }: { tags: InboxTag[] }) {
  const shown = tags
    .filter((t) => t.category === "stage" || t.category === "person" || t.category === "intent")
    .sort(compareTags);
  if (shown.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {shown.map((t) => (
        <TagChip key={t.id} tag={t} solid={t.category === "stage"} className="px-1.5 py-0 text-[10px]" />
      ))}
    </div>
  );
}
