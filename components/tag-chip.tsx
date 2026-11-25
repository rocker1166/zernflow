import { cn } from "@/lib/utils";

/** A tag. "solid" tints the whole chip (the stage); otherwise the colour is a dot. */
export function TagChip({
  tag,
  solid = false,
  className,
}: {
  tag: { name: string; color: string | null };
  solid?: boolean;
  className?: string;
}) {
  const color = tag.color ?? undefined;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border px-2 py-0.5 text-[11px] font-medium",
        className
      )}
      style={solid && color ? { backgroundColor: `${color}20`, borderColor: `${color}40`, color } : undefined}
    >
      {!solid && (
        <span aria-hidden className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-muted-foreground" style={{ backgroundColor: color }} />
      )}
      {tag.name}
    </span>
  );
}
