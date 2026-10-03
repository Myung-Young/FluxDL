/**
 * Settings search/filter (M3.4). Pure matcher: a field matches when the
 * query is a case-insensitive substring of its label, element id, or any
 * keyword (keywords carry the English terms so Malay labels still match
 * "proxy", "theme", etc.).
 */

export interface FilterableField {
  readonly id: string;
  readonly label: string;
  readonly keywords?: readonly string[];
}

export function matchSettingField(field: FilterableField, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return true;
  const hay = [field.label, field.id, ...(field.keywords ?? [])]
    .join(" ")
    .toLowerCase();
  return q
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .every((w) => hay.includes(w));
}

/** Ids of the fields matching the query, in input order. */
export function filterSettingIds(
  fields: readonly FilterableField[],
  query: string,
): string[] {
  return fields.filter((f) => matchSettingField(f, query)).map((f) => f.id);
}
