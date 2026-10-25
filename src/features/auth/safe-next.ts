/** Only same-origin relative paths are accepted as post-login destinations (prevents open redirects). */
export function safeNextPath(raw: string | null | undefined, fallback = "/dashboard"): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  if (raw.startsWith("/login") || raw.startsWith("/forgot-password")) return fallback;
  return raw;
}
