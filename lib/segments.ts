/**
 * Segment filters, decided in one place: the Contacts page and broadcasts must agree on
 * who a filter means. Pure.
 */

export type FilterOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "gt"
  | "lt"
  | "before"
  | "after";

export type FilterField =
  | "has_tag"
  | "missing_tag"
  | "custom_field"
  | "platform"
  | "is_subscribed"
  | "last_interaction";

export interface FilterRule {
  id: string;
  field: FilterField;
  operator: FilterOperator;
  value: string;
}

export interface FilterGroup {
  id: string;
  combinator: "and" | "or";
  rules: FilterRule[];
}

export interface SegmentFilter {
  combinator: "and" | "or";
  groups: FilterGroup[];
}

export interface SegmentContact {
  /** ids and names: filters saved by the builder hold ids, older ones names */
  tags: { id: string; name: string }[];
  platforms: string[];
  isSubscribed: boolean;
  lastInteractionAt: string | null;
  customFields: { slug: string; value: string }[];
}

/** A rule the user has not finished filling in. */
export function isIncomplete(rule: FilterRule): boolean {
  if (rule.field === "custom_field") {
    const [slug, value] = splitField(rule.value);
    return !slug || !value;
  }
  return !rule.value;
}

/** The filter without its unfinished rules and empty groups, for a live view. */
export function completeRules(filter: SegmentFilter): SegmentFilter {
  return {
    ...filter,
    groups: filter.groups
      .map((g) => ({ ...g, rules: g.rules.filter((r) => !isIncomplete(r)) }))
      .filter((g) => g.rules.length > 0),
  };
}

/**
 * An unfinished rule or an empty group matches nobody: a broadcast with a half-made filter must not go to
 * everyone. A live view drops those rules first with completeRules().
 */
export function matchesSegment(contact: SegmentContact, filter: SegmentFilter): boolean {
  if (filter.groups.length === 0) return true;
  return combine(
    filter.combinator,
    filter.groups,
    (g) => g.rules.length > 0 && combine(g.combinator, g.rules, (r) => matchesRule(contact, r))
  );
}

function combine<T>(combinator: "and" | "or", items: T[], test: (item: T) => boolean): boolean {
  return combinator === "and" ? items.every(test) : items.some(test);
}

function matchesRule(contact: SegmentContact, rule: FilterRule): boolean {
  if (isIncomplete(rule)) return false;
  switch (rule.field) {
    case "has_tag":
      return wears(contact, rule.value);
    case "missing_tag":
      return !wears(contact, rule.value);
    case "platform":
      return contact.platforms.includes(rule.value) !== (rule.operator === "not_equals");
    case "is_subscribed":
      return contact.isSubscribed === (rule.value === "true");
    case "last_interaction": {
      if (!contact.lastInteractionAt) return false;
      const at = Date.parse(contact.lastInteractionAt);
      const date = Date.parse(rule.value);
      return rule.operator === "before" ? at < date : at > date;
    }
    case "custom_field": {
      const [slug, wanted] = splitField(rule.value);
      const value = contact.customFields.find((f) => f.slug === slug)?.value;
      if (value === undefined) return false;
      return compareField(value, rule.operator, wanted);
    }
    default:
      return false;
  }
}

function wears(contact: SegmentContact, idOrName: string): boolean {
  return contact.tags.some((t) => t.id === idOrName || t.name === idOrName);
}

function compareField(value: string, operator: FilterOperator, wanted: string): boolean {
  switch (operator) {
    case "equals":
      return value === wanted;
    case "not_equals":
      return value !== wanted;
    case "contains":
      return value.toLowerCase().includes(wanted.toLowerCase());
    case "gt":
      return isNaN(+value) || isNaN(+wanted) ? value > wanted : +value > +wanted;
    case "lt":
      return isNaN(+value) || isNaN(+wanted) ? value < wanted : +value < +wanted;
    default:
      return false;
  }
}

/** "slug::value" from the builder; "slug:value" is the older form. */
function splitField(value: string): [string, string] {
  const separator = value.includes("::") ? "::" : ":";
  const at = value.indexOf(separator);
  return at === -1 ? [value, ""] : [value.slice(0, at), value.slice(at + separator.length)];
}

// ── Reading contacts ────────────────────────────────────────────────────────

/** The fields toSegmentContact() reads. */
export const SEGMENT_FIELDS =
  "is_subscribed, last_interaction_at, contact_tags(tags(id, name)), contact_channels(platform_username, channels(platform)), contact_custom_fields(value, custom_field_definitions(slug))" as const;

interface SegmentRow {
  is_subscribed: boolean;
  last_interaction_at: string | null;
  contact_tags: { tags: { id: string; name: string } | null }[];
  contact_channels: { channels: { platform: string } | null }[];
  contact_custom_fields: { value: string; custom_field_definitions: { slug: string } | null }[];
}

export function toSegmentContact(row: SegmentRow): SegmentContact {
  return {
    tags: row.contact_tags.flatMap((ct) => (ct.tags ? [ct.tags] : [])),
    platforms: row.contact_channels.flatMap((cc) => (cc.channels ? [cc.channels.platform] : [])),
    isSubscribed: row.is_subscribed,
    lastInteractionAt: row.last_interaction_at,
    customFields: row.contact_custom_fields.flatMap((f) =>
      f.custom_field_definitions ? [{ slug: f.custom_field_definitions.slug, value: f.value }] : []
    ),
  };
}

const PAGE = 1000;

/**
 * Every row of a query, a page at a time (the API returns 1000 at most).
 * shortcut: the whole contact list is held in memory; move filtering into SQL past ~10k contacts
 */
export async function readAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}
