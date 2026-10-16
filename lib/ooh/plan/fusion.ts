import type { EmplacementBrut } from '@/types/campagnes-media';

/** Somme de deux compteurs facultatifs : `null` seulement si les deux le sont. */
function somme(a: number | null, b: number | null): number | null {
  return a === null && b === null ? null : (a ?? 0) + (b ?? 0);
}

/**
 * Réunit les emplacements de même clé : les lecteurs Basic-Fit d'un même club, deux lignes d'un même campus, deux noms
 * de la liste qui désignent la même gare (même UIC). Écrans et contacts s'additionnent, les formats se réunissent,
 * TOUTES les lignes d'origine sont gardées dans `metadata.lignes`. L'entrée n'est pas modifiée.
 */
export function fusionnerEmplacements<T extends EmplacementBrut>(liste: readonly T[], cle: (e: T) => string): T[] {
  const parCle = new Map<string, T>();
  for (const e of liste) {
    const k = cle(e);
    const deja = parCle.get(k);
    if (!deja) {
      parCle.set(k, { ...e, formats: [...e.formats], metadata: { ...e.metadata, lignes: [...e.metadata.lignes] } });
      continue;
    }
    deja.nb_ecrans = somme(deja.nb_ecrans, e.nb_ecrans);
    deja.contacts_semaine = somme(deja.contacts_semaine, e.contacts_semaine);
    deja.contacts_18_25_semaine = somme(deja.contacts_18_25_semaine, e.contacts_18_25_semaine);
    for (const f of e.formats) if (!deja.formats.includes(f)) deja.formats.push(f);
    deja.metadata.lignes.push(...e.metadata.lignes);
  }
  return [...parCle.values()];
}
