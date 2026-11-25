/** Contacts ticked on the Contacts page, handed to the composer. Per tab; too many ids for a link. */

const KEY = "broadcast-selection";

export function storeSelection(ids: Iterable<string>): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify([...ids]));
  } catch {
    // Storage blocked: the composer opens with nobody ticked.
  }
}

/** Reads it once. */
export function takeSelection(): Set<string> {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    const ids: unknown = JSON.parse(raw ?? "[]");
    return new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}
