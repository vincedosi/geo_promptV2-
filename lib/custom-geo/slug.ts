/** Slug de nom de fichier : minuscules, sans accents, alphanum + tirets. */
export function toSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'zone';
}
