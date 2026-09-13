export function validLocationLinks(links) {
 if (!Array.isArray(links) || links.length > 50) return false;
 return links.every(link => {
  if (!link || typeof link.label !== 'string' || !link.label.trim() || link.label.length > 120 || typeof link.url !== 'string' || link.url.length > 2048) return false;
  try { const url = new URL(link.url); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
 });
}
