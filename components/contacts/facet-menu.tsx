"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FacetOption {
  value: string;
  label: string;
  count?: number;
  color?: string | null;
}

/** A filter button with its list. Several choices when `multiple`, else one at a time. */
export function FacetMenu({
  label,
  options,
  selected,
  onChange,
  multiple = true,
}: {
  label: string;
  options: FacetOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  multiple?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function close(e: MouseEvent | KeyboardEvent) {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  function toggle(value: string) {
    const on = selected.includes(value);
    if (multiple) onChange(on ? selected.filter((v) => v !== value) : [...selected, value]);
    else {
      onChange(on ? [] : [value]);
      setOpen(false);
    }
  }

  const chosen = options.filter((o) => selected.includes(o.value));
  const summary = chosen.length === 0 ? label : chosen.length === 1 ? chosen[0].label : `${label}: ${chosen.length}`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
          chosen.length
            ? "border-primary bg-primary/10 text-primary"
            : "border-input text-muted-foreground hover:bg-accent hover:text-foreground"
        )}
      >
        {summary}
        <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={label}
          aria-multiselectable={multiple}
          className="absolute left-0 top-full z-50 mt-1 max-h-72 min-w-48 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
        >
          {options.map((o) => {
            const on = selected.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => toggle(o.value)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-popover-foreground hover:bg-accent"
              >
                <Check className={cn("h-3.5 w-3.5 flex-shrink-0", on ? "text-primary" : "invisible")} />
                {o.color && <span aria-hidden className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: o.color }} />}
                <span className="flex-1 whitespace-nowrap">{o.label}</span>
                {o.count !== undefined && <span className="pl-3 tabular-nums text-muted-foreground">{o.count}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
