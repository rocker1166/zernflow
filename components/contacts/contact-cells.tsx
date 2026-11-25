import Link from "next/link";
import { ContactAvatar } from "@/components/inbox/contact-avatar";
import { PlatformIcon } from "@/components/platform-icon";
import { TagChip } from "@/components/tag-chip";
import { compareTags } from "@/lib/smart-tags/taxonomy";
import type { FilterTag } from "@/lib/contact-filter";
import type { ContactRow } from "@/lib/contact-rows";

/** Picture, channel, name and handle. */
export function ContactName({ contact, link = false }: { contact: ContactRow; link?: boolean }) {
  const sub = contact.email ?? contact.usernames.find((u) => u !== contact.name);
  const inner = (
    <>
      <div className="relative flex-shrink-0">
        <ContactAvatar name={contact.name} src={contact.avatarUrl} className="h-8 w-8 text-xs" />
        {contact.platforms[0] && (
          <span className="absolute -bottom-1 -right-1 rounded-full bg-background p-0.5">
            <PlatformIcon platform={contact.platforms[0]} size={10} className="h-2.5 w-2.5" />
          </span>
        )}
      </div>
      <span className="min-w-0">
        <span className={`block max-w-56 truncate text-sm font-medium${link ? " hover:underline" : ""}`}>{contact.name}</span>
        {sub && (
          <span className="block max-w-56 truncate text-xs text-muted-foreground">{contact.email ? sub : `@${sub}`}</span>
        )}
      </span>
    </>
  );
  return link ? (
    <Link href={`/dashboard/contacts/${contact.id}`} className="flex items-center gap-3">
      {inner}
    </Link>
  ) : (
    <span className="flex items-center gap-3">{inner}</span>
  );
}

/** A contact's tags in order, the stage apart. The channel is the icon beside the name. */
export function splitTags(contact: ContactRow, tagById: Map<string, FilterTag>) {
  const worn = contact.tags.flatMap((t) => tagById.get(t.id) ?? []).sort(compareTags);
  return {
    stage: worn.find((t) => t.category === "stage"),
    rest: worn.filter((t) => t.category !== "stage" && t.category !== "channel"),
  };
}

export function TagList({ tags }: { tags: FilterTag[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <TagChip key={tag.id} tag={tag} />
      ))}
    </div>
  );
}
