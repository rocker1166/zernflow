"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Square } from "lucide-react";
import { BroadcastStatusBadge } from "@/components/broadcasts/status";
import { MessageBubble } from "@/components/broadcasts/message-fields";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { toContent } from "@/lib/broadcast-message";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/types/database";
import { cn } from "@/lib/utils";

const REFRESH_MS = 5000;

const RECIPIENT_STATUS: Record<string, { label: string; className: string }> = {
  pending: { label: "Waiting", className: "text-muted-foreground" },
  sending: { label: "Sending", className: "text-amber-600" },
  sent: { label: "Sent", className: "text-green-600" },
  failed: { label: "Not sent", className: "text-red-600" },
  cancelled: { label: "Stopped", className: "text-muted-foreground" },
};

export function BroadcastProgress({
  broadcast,
  recipients,
}: {
  broadcast: Database["public"]["Tables"]["broadcasts"]["Row"];
  recipients: { id: string; status: string; error: string | null; contactId: string | null; name: string }[];
}) {
  const router = useRouter();
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sending = broadcast.status === "sending";

  useEffect(() => {
    if (!sending) return;
    const timer = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [sending, router]);

  async function stop() {
    setStopping(false);
    const { error } = await createClient()
      .from("broadcasts")
      .update({ status: "cancelled" })
      .eq("id", broadcast.id)
      .eq("status", "sending");
    setError(error ? "Could not stop it. Try again." : null);
    router.refresh();
  }

  const count = (...statuses: string[]) => recipients.filter((r) => statuses.includes(r.status)).length;
  const done = count("sent", "failed", "cancelled");
  const stats = [
    { label: "People", value: recipients.length, className: "" },
    { label: "Sent", value: count("sent"), className: "text-green-600" },
    { label: "Waiting", value: count("pending", "sending"), className: "" },
    { label: "Not sent", value: count("failed"), className: count("failed") ? "text-red-600" : "" },
    ...(count("cancelled") ? [{ label: "Stopped", value: count("cancelled"), className: "" }] : []),
  ];
  const content = toContent(broadcast.message_content);
  // What needs reading first: failures, then what is in flight, then the rest.
  const order = ["failed", "sending", "pending", "sent", "cancelled"];
  const sorted = [...recipients].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-8 py-6">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/broadcasts"
            aria-label="Back to broadcasts"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="min-w-0 truncate text-2xl font-bold">{broadcast.name}</h1>
          <BroadcastStatusBadge status={broadcast.status} />
          {sending && (
            <button
              type="button"
              onClick={() => setStopping(true)}
              className="ml-auto inline-flex items-center gap-2 rounded-lg border border-input px-3 py-1.5 text-sm font-medium hover:bg-accent"
            >
              <Square className="h-3.5 w-3.5" />
              Stop
            </button>
          )}
        </div>
        {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
        {recipients.length > 0 && (
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={recipients.length}
            aria-valuenow={done}
            className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted"
          >
            <div className="h-full bg-primary transition-[width]" style={{ width: `${(done / recipients.length) * 100}%` }} />
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto px-8 py-6">
        <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
          <div>
            <div className="mb-6 flex gap-10">
              {stats.map((s) => (
                <div key={s.label}>
                  <p className={cn("text-2xl font-bold tabular-nums", s.className)}>{s.value}</p>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </div>
              ))}
            </div>
            <ul className="divide-y divide-border border-y border-border">
              {sorted.map((r) => {
                const status = RECIPIENT_STATUS[r.status] ?? { label: r.status, className: "" };
                return (
                  <li key={r.id} className="flex items-center gap-4 py-2.5 text-sm">
                    {r.contactId ? (
                      <Link href={`/dashboard/contacts/${r.contactId}`} className="min-w-0 truncate font-medium hover:underline">
                        {r.name}
                      </Link>
                    ) : (
                      <span className="min-w-0 truncate">{r.name}</span>
                    )}
                    <span className="ml-auto truncate text-xs text-muted-foreground">{r.error}</span>
                    <span className={cn("flex-shrink-0 text-xs font-medium", status.className)}>{status.label}</span>
                  </li>
                );
              })}
            </ul>
          </div>
          <div>
            <h2 className="mb-2 text-sm font-semibold">Message</h2>
            <div className="rounded-lg border border-border bg-muted/30 p-4">
              <MessageBubble content={content} text={content.text} />
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={stopping}
        title="Stop this broadcast?"
        message="Messages already sent stay sent. Everyone still waiting will not get it."
        confirmLabel="Stop"
        destructive
        onConfirm={stop}
        onCancel={() => setStopping(false)}
      />
    </div>
  );
}
