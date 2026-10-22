/**
 * @file lib/zones/couverture.ts — le contrat de `GET /api/zones/[id]/couverture` (lot 4, T6) : les paramètres admis,
 * les refus de `couverture_geometrie` (sql/269, relayés par `couverture_zone`, sql/270) et leur statut HTTP.
 *
 * Statuts (un refus est une RÉPONSE, jamais une exception muette — plan, Global Constraints) :
 * - `zone_introuvable` → **404** : la zone n'existe pas DANS CET ESPACE (absente ou d'un autre espace : même réponse,
 *   on ne révèle pas qu'elle existe ailleurs) ;
 * - `cible_inconnue`, `zone_trop_vaste`, `trop_de_carreaux` → **422** : la requête est bien formée (Zod l'a admise),
 *   mais ce chiffrage-là n'est pas servi — cible absente du catalogue, ou borne de ① dépassée (§ 16.2-5) ;
 * - `couverture_non_construite` → **503** : la demande est valable, c'est la BASE qui n'est pas prête (table étroite non
 *   certifiée, dénominateur absent ou périmé) ; un état du serveur, que reconstruire la base lève.
 * Pas de 409 : aucun refus de ce calcul ne dépend d'un conflit d'état de la zone (elle est lue telle quelle).
 */
import { z } from 'zod';

/** Les trois découpages admis — exporté pour la copie Angular (`couverture-paritaire.test.ts`). */
export const DECOUPAGES = ['forme', 'cp', 'iris'] as const;

/** Les paramètres de requête. Absents : la population totale (`ind`), la zone telle quelle (`forme`). */
export const RequeteCouvertureSchema = z.object({
  cible: z.string().regex(/^[a-z0-9_]{2,20}$/, 'Cible invalide.').default('ind'),
  decoupage: z.enum(DECOUPAGES, { errorMap: () => ({ message: 'Découpage inconnu : forme, cp ou iris.' }) }).default('forme'),
});

const REFUS_COUVERTURE = [
  'zone_introuvable', 'cible_inconnue', 'zone_trop_vaste', 'trop_de_carreaux', 'couverture_non_construite',
] as const;
type RefusCouverture = (typeof REFUS_COUVERTURE)[number];

export const MESSAGES_REFUS_COUVERTURE: Readonly<Record<RefusCouverture, string>> = {
  zone_introuvable: 'Cette zone n’existe pas dans cet espace.',
  cible_inconnue: 'Cette cible n’est pas connue.',
  zone_trop_vaste: 'La zone est trop vaste : la couverture se calcule jusqu’à la taille d’une région.',
  trop_de_carreaux: 'La zone compte plus de 400 000 carreaux habités.',
  couverture_non_construite: 'La couverture n’est pas encore construite sur cette base.',
};

const STATUTS: Readonly<Record<RefusCouverture, 404 | 422 | 503>> = {
  zone_introuvable: 404,
  cible_inconnue: 422,
  zone_trop_vaste: 422,
  trop_de_carreaux: 422,
  couverture_non_construite: 503,
};

export function statutDuRefus(refus: RefusCouverture): 404 | 422 | 503 {
  return STATUTS[refus];
}

function estRefusConnu(v: unknown): v is RefusCouverture {
  return typeof v === 'string' && (REFUS_COUVERTURE as readonly string[]).includes(v);
}

/**
 * Rétrécit le `Json` de `couverture_zone` / `couverture_zone_en_cache` : un chiffrage, un refus connu (avec ses
 * détails — `plafond`, `surface_km2`, `plafond_km2`, `motif`), ou `null` (hors contrat : refus inconnu, pas un objet).
 */
export function lireReponseCouverture(
  data: unknown,
): { ok: true; resultat: Record<string, unknown> } | { ok: false; refus: RefusCouverture; details: Record<string, unknown> } | null {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;
  const o = data as Record<string, unknown>;
  if (!('refus' in o)) return { ok: true, resultat: o };
  if (!estRefusConnu(o.refus)) return null;
  const { refus, ...details } = o;
  return { ok: false, refus, details };
}
