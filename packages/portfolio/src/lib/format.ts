/** Pure helpers for the Portfolio pages: validation, text shapes and the site snippet. */

export const HANDLE_PATTERN = /^[a-z0-9-]{3,40}$/;

/** Why a handle can't be used, or null when it can. */
export function handleProblem(handle: string): string | null {
  if (handle.length < 3) return 'Use at least 3 characters.';
  if (handle.length > 40) return 'Use at most 40 characters.';
  if (!HANDLE_PATTERN.test(handle)) return 'Use lowercase letters, digits and dashes only.';
  return null;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Whether a colour is the 6-digit hex the portfolio site needs. */
export function isHexColour(value: string): boolean {
  return HEX.test(value.trim());
}

/** A valid colour, lowercased; null when it isn't `#rrggbb`. */
export function normaliseHex(value: string): string | null {
  const v = value.trim();
  return HEX.test(v) ? v.toLowerCase() : null;
}

/** One item per line, blank lines dropped. */
export function linesToList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Paragraphs separated by blank lines; single line breaks stay inside a paragraph. */
export function textToParagraphs(text: string): string[] {
  return text
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function paragraphsToText(paragraphs: string[]): string {
  return paragraphs.join('\n\n');
}

/** The public site's absolute URL: the API's origin plus the view's `publicUrl`. */
export function publicSiteUrl(apiOrigin: string | null | undefined, publicUrl: string): string {
  if (!apiOrigin) return publicUrl;
  return `${apiOrigin.replace(/\/+$/, '')}${publicUrl}`;
}

/** The contact route next to the site route. */
export function publicContactUrl(siteUrl: string): string {
  return siteUrl.replace(/\/site$/, '/contact');
}

/** A Netlify `netlify.toml` that proxies the site's `/api/site` and `/api/contact` to Offerpath. */
export function netlifySnippet(siteUrl: string): string {
  return [
    '[[redirects]]',
    '  from = "/api/site"',
    `  to = "${siteUrl}"`,
    '  status = 200',
    '  force = true',
    '[[redirects]]',
    '  from = "/api/contact"',
    `  to = "${publicContactUrl(siteUrl)}"`,
    '  status = 200',
    '  force = true',
  ].join('\n');
}

/** A safe origin from a URL the host knows (the desktop's server address), or null. */
export function originOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Why an image can't be uploaded, or null when it can. */
export function imageProblem(file: { type: string; size: number }): string | null {
  if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return 'Choose a PNG, JPG, WebP or GIF image.';
  }
  if (file.size > MAX_IMAGE_BYTES) return 'Choose an image of 8 MB or less.';
  return null;
}

/** A file's bytes as base64 (no `data:` prefix), for `POST /portfolio/uploads`. */
export function readFileAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

/** "23 Oct 2026, 14:05" in the user's locale. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Moves one id of a list up or down by one place; the list unchanged at the ends. */
export function moveId(ids: string[], id: string, delta: -1 | 1): string[] {
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= ids.length) return ids;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/** Moves an id to where another one is (a drop). */
export function moveIdTo(ids: string[], id: string, targetId: string): string[] {
  const from = ids.indexOf(id);
  const to = ids.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return ids;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}
