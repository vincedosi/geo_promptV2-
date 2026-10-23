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
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createQuota } from '@/lib/api/rate-limit';
import { formaterNombre } from '@/lib/format/nombre';
import { MESSAGES_REFUS } from './recette';

/**
 * Le quota `geo:rl:couverture`, 6 / min / compte, PARTAGÉ par les deux lectures d'une zone de ④ : sa couverture (T6)
 * et sa radio et son trafic (T13). Un seul limiteur : deux déclarations du même préfixe pourraient diverger.
 */
export const quotaCouverture = createQuota({ max: 6, window: '60 s', prefix: 'geo:rl:couverture' });

/**
 * Les bornes écrites en base, reprises par les routes et copiées côté Angular (`couverture-paritaire.test.ts`) : rayon
 * maximal et valeurs détaillées de `couverture_rayon_poi` (sql/272), carreaux lus par `couverture_geometrie` (sql/269).
 */
export const RAYON_MIN_M = 100;
export const RAYON_MAX_M = 10_000;
/** Huit teintes de valeur au plus (`--nature-1…8`). */
export const MAX_VALEURS = 8;
export const MAX_CARREAUX_COUVERTURE = 400_000;

/** Les trois découpages admis — exporté pour la copie Angular (`couverture-paritaire.test.ts`). */
export const DECOUPAGES = ['forme', 'cp', 'iris'] as const;

/** Les paramètres de requête. Absents : la population totale (`ind`), la zone telle quelle (`forme`). */
export const RequeteCouvertureSchema = z.object({
  cible: z.string().regex(/^[a-z0-9_]{2,20}$/, 'Cible invalide.').default('ind'),
  decoupage: z.enum(DECOUPAGES, { errorMap: () => ({ message: 'Découpage inconnu : forme, cp ou iris.' }) }).default('forme'),
});

type RefusCouverture = 'zone_introuvable' | 'cible_inconnue' | 'zone_trop_vaste' | 'trop_de_carreaux' | 'couverture_non_construite';

export const MESSAGES_REFUS_COUVERTURE: Readonly<Record<RefusCouverture, string>> = {
  zone_introuvable: MESSAGES_REFUS.zone_introuvable,
  cible_inconnue: 'Cette cible n’est pas connue.',
  zone_trop_vaste: 'La zone est trop vaste : la couverture se calcule jusqu’à la taille d’une région.',
  trop_de_carreaux: `La zone compte plus de ${formaterNombre(MAX_CARREAUX_COUVERTURE)} carreaux habités.`,
  couverture_non_construite: 'La couverture n’est pas encore construite sur cette base.',
};

/**
 * La réponse d'une RPC de couverture (`couverture_zone`, `couverture_zone_en_cache`, `couverture_rayon_poi`,
 * `croisements_zone`) en HTTP : 200 le chiffrage ; un refus de `messages` en `{ error, refus, …détails }` (`plafond`,
 * `surface_km2`, `motif`…) au statut de l'en-tête — 404, 503, sinon 422 ; erreur Postgres ou hors contrat (refus
 * inconnu, pas un objet) : journalisée, 500 `echec`. Avec `invalide`, une erreur 22023 (argument que Zod n'a pas vu :
 * la requête est fausse, pas le serveur) répond 400.
 */
export function repondreCouverture<R extends string>(
  { data, error }: { data: unknown; error: { code?: string; message: string } | null },
  messages: Readonly<Record<R, string>>, etiquette: string, echec: string, invalide?: string,
): NextResponse {
  if (error) {
    console.error(`[${etiquette}]`, error.code, error.message);
    return error.code === '22023' && invalide
      ? NextResponse.json({ error: invalide }, { status: 400 })
      : NextResponse.json({ error: echec }, { status: 500 });
  }
  const o = data !== null && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  if (o && !('refus' in o)) return NextResponse.json(o);
  if (!o || typeof o.refus !== 'string' || !Object.prototype.hasOwnProperty.call(messages, o.refus)) {
    console.error(`[${etiquette}] réponse hors contrat`, data);
    return NextResponse.json({ error: echec }, { status: 500 });
  }
  const refus = o.refus as R;
  const statut = refus === 'zone_introuvable' ? 404 : refus === 'couverture_non_construite' ? 503 : 422;
  return NextResponse.json({ error: messages[refus], ...o }, { status: statut });
}
