/**
 * @file lib/isochrones/paquets-cles.ts — découpe une liste de clés de `isochrones_cache` en paquets qui tiennent dans
 * une URL (`.in('cache_key', paquet)` passe par la query string de PostgREST, derrière Kong).
 *
 * Mesuré le 26/10 (base locale) : avec des clés de 97 caractères (`battle__risque_industriel__<uuid>__60min__drive`),
 * 100 clés passent et 120 sont refusées « URI too long ». Les deux routes de bataille lisaient par paquets FIXES de
 * 200 clés, et sans lire l'erreur : chaque paquet plein échouait en silence, la bataille ne voyait que le dernier
 * paquet, partiel (retours du 26/10, T2). Un budget en octets tient quelle que soit la longueur de la catégorie.
 */

/** Octets de clés par paquet : ≈ 60 % de la limite mesurée (100 × 97 + séparateurs ≈ 9 800 octets). */
const BUDGET_URL_OCTETS = 6_000;
/** Ce qu'ajoute chaque clé dans `in.(…)` : la virgule et les guillemets encodés (`%22`). */
const SURCOUT_PAR_CLE = 7;

export function paquetsDeCles(cles: readonly string[], budget: number = BUDGET_URL_OCTETS): string[][] {
  const paquets: string[][] = [];
  let courant: string[] = [];
  let taille = 0;
  for (const cle of cles) {
    const t = cle.length + SURCOUT_PAR_CLE;
    if (courant.length > 0 && taille + t > budget) {
      paquets.push(courant);
      courant = [];
      taille = 0;
    }
    courant.push(cle);
    taille += t;
  }
  if (courant.length > 0) paquets.push(courant);
  return paquets;
}
