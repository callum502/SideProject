export const normalizeMediaName = name => name.trim().toLowerCase();
export function duplicateMediaName(existing, names) {
  const used = new Set(existing.map(item => normalizeMediaName(item.name)));
  for (const name of names) {
    const key = normalizeMediaName(name);
    if (used.has(key)) return name;
    used.add(key);
  }
  return null;
}
