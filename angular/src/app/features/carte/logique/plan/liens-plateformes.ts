/**
 * ⑥ Plan — la liaison plateforme d'un canal (`geo_strategy.channels.links`), copiée de `lib/campaigns/platform-links.ts`
 * (lot 6, T2). La hiérarchie des niveaux (annonceur → campagne → …) vient du registre `dsp_channel_registry.link_levels`
 * — aucune hiérarchie en dur. Chaque niveau écrit deux clés plates dans l'entrée du canal : `${key}_id` et
 * `${key}_name`. Les schémas Zod restent au serveur (Angular ne valide pas un corps qu'il envoie).
 * Verrouillée par `tests/unit/angular/plan-logique-paritaire.test.ts` : mêmes entrées, mêmes sorties que React.
 */

/** Un niveau de liaison du registre (du plus haut au plus bas). */
export interface LinkLevel { key: string; label: string }

/** Entrée d'un canal : map plate `${key}_id` / `${key}_name` (+ extras, ex. algorithm_id). */
export type PlatformLinks = Record<string, string | undefined>;

/** Une entrée par canal sélectionné (clé = code du registre). */
export type DspLinks = Record<string, PlatformLinks | undefined>;

function hasContent(entry: PlatformLinks | undefined): boolean {
  return !!entry && Object.values(entry).some((v) => typeof v === 'string' && v.trim() !== '');
}

/**
 * Garde uniquement les liaisons des canaux encore sélectionnés (dsps + socials + ad_server) et purge les entrées
 * vides — même rôle que `pruneBudgets` au retrait d'un canal.
 */
export function pruneLinks(
  links: DspLinks | null | undefined,
  sel: { dsps: string[]; socials: string[]; ad_server: string | null },
): DspLinks {
  if (!links) return {};
  const allowed = new Set([...sel.dsps, ...sel.socials, ...(sel.ad_server ? [sel.ad_server] : [])]);
  return Object.fromEntries(
    Object.entries(links).filter(([code, entry]) => allowed.has(code) && hasContent(entry)),
  );
}

/** true si chaque niveau du canal a un ID renseigné (liaison exploitable). */
export function linksComplete(entry: PlatformLinks | undefined, levels: LinkLevel[]): boolean {
  if (levels.length === 0) return false;
  return levels.every((l) => !!entry?.[`${l.key}_id`]?.trim());
}

/** Résumé lisible « Nom → Nom → … » des niveaux renseignés (repli sur l'ID). */
export function linksSummary(entry: PlatformLinks | undefined, levels: LinkLevel[]): string {
  if (!entry) return '';
  return levels
    .map((l) => entry[`${l.key}_name`]?.trim() || entry[`${l.key}_id`]?.trim() || '')
    .filter((s) => s !== '')
    .join(' → ');
}
