/**
 * Copie Angular (lot 4, P6) VERBATIM de `lib/custom-geo/slug.ts` (imports relatifs seuls changes),
 * verrouillee par tests/unit/angular/carte-couches-paritaire.test.ts (gel P5 etendu a /map).
 * Ne pas corriger un defaut ici sans le corriger dans React.
 */
/** Slug de nom de fichier : minuscules, sans accents, alphanum + tirets. */
export function toSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'zone';
}
