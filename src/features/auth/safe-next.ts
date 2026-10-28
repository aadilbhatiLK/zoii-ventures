/** Only same-origin relative paths are accepted as post-login destinations (prevents open redirects). */
export function safeNextPath(raw: string | null | undefined, fallback = "/dashboard"): string {
  if (!raw) return fallback;
  // Browsers strip tabs/newlines and treat "\\" as "/" when parsing URLs, so validate the
  // parsed result rather than the raw string.
  if (/[\u0000-\u001f\u007f]/.test(raw) || raw.includes("\\")) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
  const base = "https://zoii.invalid";
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return fallback;
  }
  if (url.origin !== base) return fallback;
  const path = `${url.pathname}${url.search}${url.hash}`;
  // Dot-segments can normalise into a protocol-relative URL ("/ /../..//evil.com" → "//evil.com").
  if (path.startsWith("//") || /\s/.test(url.pathname)) return fallback;
  if (path.startsWith("/login") || path.startsWith("/forgot-password")) return fallback;
  return path;
}
