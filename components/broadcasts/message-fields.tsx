"use client";

import { useRef } from "react";
import {
  MAX_BUTTON,
  MAX_TEXT,
  MAX_TEXT_WITH_BUTTON,
  VARIABLES,
  type BroadcastContent,
} from "@/lib/broadcast-message";
import { cn } from "@/lib/utils";

const field =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring";

/** The words and the optional link button, for a broadcast or a template. */
export function MessageFields({
  content,
  onChange,
}: {
  content: BroadcastContent;
  onChange: (content: BroadcastContent) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const limit = content.buttonLabel || content.buttonUrl ? MAX_TEXT_WITH_BUTTON : MAX_TEXT;
  const length = Array.from(content.text).length;

  function insert(token: string) {
    const el = ref.current;
    const at = el?.selectionStart ?? content.text.length;
    const end = el?.selectionEnd ?? at;
    onChange({ ...content, text: content.text.slice(0, at) + token + content.text.slice(end) });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + token.length, at + token.length);
    });
  }

  return (
    <div className="space-y-3">
      <div>
        <textarea
          ref={ref}
          aria-label="Message"
          rows={6}
          placeholder="Write your message"
          value={content.text}
          onChange={(e) => onChange({ ...content, text: e.target.value })}
          className={cn(field, "resize-y")}
        />
        <div className="mt-1.5 flex items-center gap-1.5">
          {VARIABLES.map((v) => (
            <button
              key={v.token}
              type="button"
              onClick={() => insert(v.token)}
              className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              + {v.label}
            </button>
          ))}
          <span className={cn("ml-auto text-xs tabular-nums text-muted-foreground", length > limit && "text-red-600")}>
            {length}/{limit}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-[2fr_3fr] gap-2">
        <input
          aria-label="Button label"
          placeholder="Button label"
          maxLength={MAX_BUTTON}
          value={content.buttonLabel ?? ""}
          onChange={(e) => onChange({ ...content, buttonLabel: e.target.value })}
          className={field}
        />
        <input
          aria-label="Button link"
          type="url"
          placeholder="Button link, https://"
          value={content.buttonUrl ?? ""}
          onChange={(e) => onChange({ ...content, buttonUrl: e.target.value })}
          className={field}
        />
      </div>
    </div>
  );
}

/** How it looks in their chat. */
export function MessageBubble({ content, text }: { content: BroadcastContent; text: string }) {
  return (
    <div className="ml-auto w-fit max-w-[90%] overflow-hidden rounded-2xl rounded-br-md bg-primary text-sm text-primary-foreground">
      <p className="whitespace-pre-wrap break-words px-3.5 py-2.5">{text || "Your message"}</p>
      {content.buttonLabel && (
        <p className="border-t border-primary-foreground/20 px-3.5 py-2 text-center text-xs font-semibold">
          {content.buttonLabel}
        </p>
      )}
    </div>
  );
}
