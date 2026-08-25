/** Normalize checked-in source text before cross-platform exact assertions. */
export function normalizeSourceText(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}
