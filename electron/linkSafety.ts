/** Which link targets from a PDF MaliPDF may hand to the system browser / mail app. */
export function safeExternalUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 4096) return null;
  try {
    const url = new URL(raw.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'mailto:' ? url.toString() : null;
  } catch {
    return null;
  }
}
