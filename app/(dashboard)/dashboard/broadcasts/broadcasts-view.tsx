"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Radio, Trash2 } from "lucide-react";
import { BroadcastStatusBadge } from "@/components/broadcasts/status";
import { TemplatesPanel } from "@/components/broadcasts/templates-panel";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useMounted } from "@/components/use-mounted";
import { toContent } from "@/lib/broadcast-message";
import { createClient } from "@/lib/supabase/client";
import type { Template } from "@/lib/message-templates";
import type { Database } from "@/lib/types/database";
import { cn } from "@/lib/utils";

type Broadcast = Database["public"]["Tables"]["broadcasts"]["Row"];
type Tab = "broadcasts" | "templates";

export function BroadcastsView({
  broadcasts,
  templates,
  workspaceId,
  initialTab,
}: {
  broadcasts: Broadcast[];
  templates: Template[];
  workspaceId: string;
  initialTab: Tab;
}) {
  const router = useRouter();
  const mounted = useMounted();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [deleting, setDeleting] = useState<Broadcast | null>(null);
  const [error, setError] = useState<string | null>(null);

  function show(next: Tab) {
    setTab(next);
    window.history.replaceState(null, "", next === "templates" ? "?tab=templates" : window.location.pathname);
  }
  async function removeDraft(broadcast: Broadcast) {
    setDeleting(null);
    const { error } = await createClient().from("broadcasts").delete().eq("id", broadcast.id).eq("status", "draft");
    setError(error ? "Could not delete the draft. Try again." : null);
    router.refresh();
  }

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "broadcasts", label: "Broadcasts", count: broadcasts.length },
    { key: "templates", label: "Templates", count: templates.length },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-8 pt-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold">Broadcasts</h1>
            <p className="mt-1 text-sm text-muted-foreground">Send one message to many contacts</p>
          </div>
          <Link
            href="/dashboard/broadcasts/new"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            New broadcast
          </Link>
        </div>
        <div role="tablist" className="mt-4 flex gap-6">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => show(t.key)}
              className={cn(
                "-mb-px border-b-2 pb-3 text-sm font-medium transition-colors",
                tab === t.key
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {t.label} <span className="tabular-nums text-muted-foreground">{t.count}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {tab === "templates" ? (
          <TemplatesPanel templates={templates} workspaceId={workspaceId} />
        ) : broadcasts.length === 0 ? (
          <div className="flex flex-col items-center py-20">
            <Radio className="h-10 w-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm font-medium text-muted-foreground">No broadcasts yet</p>
          </div>
        ) : (
          <>
            {error && <p className="px-8 pt-4 text-sm text-red-600">{error}</p>}
            <ul className="divide-y divide-border">
              {broadcasts.map((b) => {
                const isDraft = b.status === "draft" || b.status === "scheduled";
                return (
                  <li key={b.id} className="flex items-center transition-colors hover:bg-accent/50">
                    <Link
                      href={isDraft ? `/dashboard/broadcasts/new?draft=${b.id}` : `/dashboard/broadcasts/${b.id}`}
                      className="flex min-w-0 flex-1 items-center gap-6 px-8 py-4"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-3">
                          <h3 className="truncate text-sm font-medium">{b.name}</h3>
                          <BroadcastStatusBadge status={b.status} />
                        </div>
                        <p className="mt-1 truncate text-xs text-muted-foreground">{toContent(b.message_content).text}</p>
                      </div>
                      <span className="whitespace-nowrap text-xs text-muted-foreground" suppressHydrationWarning>
                        {mounted
                          ? new Date(b.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
                          : ""}
                      </span>
                      {!isDraft && (
                        <span className="flex gap-5 text-center">
                          <Count value={b.total_recipients} label="People" />
                          <Count value={b.sent} label="Sent" className="text-green-600" />
                          <Count value={b.failed} label="Failed" className={b.failed ? "text-red-600" : ""} />
                        </span>
                      )}
                    </Link>
                    {isDraft && (
                      <button
                        type="button"
                        aria-label={`Delete draft ${b.name}`}
                        onClick={() => setDeleting(b)}
                        className="mr-6 rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this draft?"
        message={`"${deleting?.name}" was never sent.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => deleting && removeDraft(deleting)}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

function Count({ value, label, className }: { value: number; label: string; className?: string }) {
  return (
    <span>
      <span className={cn("block text-base font-semibold tabular-nums", className)}>{value}</span>
      <span className="block text-[10px] uppercase text-muted-foreground">{label}</span>
    </span>
  );
}
