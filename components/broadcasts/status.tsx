import { CheckCircle2, Clock, FileEdit, Loader2, XCircle } from "lucide-react";
import type { BroadcastStatus } from "@/lib/types/database";
import { cn } from "@/lib/utils";

const STATUS: Record<BroadcastStatus, { label: string; icon: React.ElementType; className: string }> = {
  draft: { label: "Draft", icon: FileEdit, className: "bg-muted text-muted-foreground" },
  scheduled: { label: "Scheduled", icon: Clock, className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  sending: { label: "Sending", icon: Loader2, className: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" },
  completed: { label: "Done", icon: CheckCircle2, className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  cancelled: { label: "Stopped", icon: XCircle, className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
};

export function BroadcastStatusBadge({ status }: { status: BroadcastStatus }) {
  const { label, icon: Icon, className } = STATUS[status];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium", className)}>
      <Icon className={cn("h-3 w-3", status === "sending" && "animate-spin")} />
      {label}
    </span>
  );
}
