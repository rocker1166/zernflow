/** What a broadcast says: the words, the variables and their limits. Pure. */

export interface BroadcastContent {
  text: string;
  buttonLabel?: string;
  buttonUrl?: string;
}

export const VARIABLES = [
  { token: "{{first_name}}", label: "First name" },
  { token: "{{name}}", label: "Full name" },
];

/** Instagram's own limits, the tightest of the platforms. */
export const MAX_TEXT = 1000;
export const MAX_TEXT_WITH_BUTTON = 640;
export const MAX_BUTTON = 20;

/** Read from a stored message, whatever shape an older one has. */
export function toContent(value: unknown): BroadcastContent {
  const v = (value ?? {}) as Record<string, unknown>;
  const text = (key: string) => (typeof v[key] === "string" ? (v[key] as string).trim() : "");
  const content: BroadcastContent = { text: text("text") };
  if (text("buttonLabel") || text("buttonUrl")) {
    content.buttonLabel = text("buttonLabel");
    content.buttonUrl = text("buttonUrl");
  }
  return content;
}

/** The first thing wrong with it, or null. */
export function contentProblem(content: BroadcastContent): string | null {
  if (!content.text.trim()) return "Write a message first.";
  const hasButton = Boolean(content.buttonLabel || content.buttonUrl);
  const limit = hasButton ? MAX_TEXT_WITH_BUTTON : MAX_TEXT;
  if (Array.from(content.text).length > limit) {
    return `Keep the message under ${limit} characters${hasButton ? " when it has a button" : ""}.`;
  }
  const unknown = content.text.match(/\{\{[^}]*\}\}/g)?.find((t) => !VARIABLES.some((v) => v.token === t));
  if (unknown) return `${unknown} is not something we can fill in.`;
  if (!hasButton) return null;
  if (!content.buttonLabel) return "Give the button a label.";
  if (Array.from(content.buttonLabel).length > MAX_BUTTON) return `Keep the button label under ${MAX_BUTTON} characters.`;
  if (!isHttpsUrl(content.buttonUrl ?? "")) return "The button link must start with https://";
  return null;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function personalize(text: string, name: string | null): string {
  return text
    .replaceAll("{{first_name}}", firstName(name))
    .replaceAll("{{name}}", cleanName(name) ?? "there");
}

// First words of page names, not of people.
const NOT_A_NAME = new Set(
  "travel travels traveller traveler trip trips the team official instagram user trek treks explore explorer wander wanderlust backpack nomad unknown mr mrs ms dr".split(" ")
);

/** "Dhruv Aagiwal" -> "Dhruv"; a handle, a page name or decorated text -> "there". */
export function firstName(name: string | null): string {
  const word = cleanName(name)?.split(" ")[0] ?? "";
  if (!/^\p{L}[\p{L}\p{M}'’]+$/u.test(word) || NOT_A_NAME.has(word.toLowerCase())) return "there";
  return word[0].toUpperCase() + word.slice(1).toLowerCase();
}

/** The name people would call them, or null when all we have is a handle. */
function cleanName(name: string | null): string | null {
  // Styled letters become plain ones; what follows a divider is a tagline.
  const plain = (name ?? "").normalize("NFKC").split(/[|•·~–—/]/)[0].replace(/\s+/g, " ").trim();
  const isHandle = !plain.includes(" ") && (/[._\d]/.test(plain) || plain === plain.toLowerCase());
  return plain && !isHandle ? plain : null;
}
