export type AnnouncementPart = { text: string; href?: string };

/** Preserve announcement text while recognizing standalone HTTP(S) URLs. */
export function splitAnnouncementLinks(message: string): AnnouncementPart[] {
  const parts: AnnouncementPart[] = [];
  const links = /https?:\/\/[^\s<>"'`，。；：！？、）】》」』]+/giu;
  let cursor = 0;
  for (const match of message.matchAll(links)) {
    const start = match.index;
    const previous = start > 0 ? message[start - 1]! : "";
    if (previous && /[\p{L}\p{N}_:/\\@]/u.test(previous)) continue;

    let text = match[0];
    let trimmed = true;
    while (text && trimmed) {
      trimmed = false;
      if (/[.,;:!?，。；：！？、]$/.test(text)) {
        text = text.slice(0, -1);
        trimmed = true;
      }
      for (const [opening, closing] of [
        ["(", ")"],
        ["[", "]"],
        ["{", "}"],
        ["（", "）"],
        ["【", "】"],
        ["《", "》"],
        ["「", "」"],
        ["『", "』"],
      ] as const) {
        if (
          text.endsWith(closing) &&
          text.split(closing).length > text.split(opening).length
        ) {
          text = text.slice(0, -1);
          trimmed = true;
        }
      }
    }
    let href: string;
    try {
      const url = new URL(text);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        !url.hostname ||
        url.username ||
        url.password
      )
        continue;
      href = url.href;
    } catch {
      continue;
    }
    if (start > cursor) parts.push({ text: message.slice(cursor, start) });
    parts.push({ text, href });
    cursor = start + text.length;
  }
  if (cursor < message.length || !parts.length)
    parts.push({ text: message.slice(cursor) });
  return parts;
}
