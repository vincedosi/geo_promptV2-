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
 * Le quota `geo:rl:couverture`, 6 / min / compte, PARTAGÉ par deux lectures : la couverture d'une zone de ④
 * (`/api/zones/[id]/couverture`, T6) et les contours de communes de ⑤ (`/api/zones/communes/contours`). Un seul
 * limiteur : deux déclarations du même préfixe pourraient diverger. La radio et le trafic de la zone (T13), qui le
 * partageaient aussi, ont été retirés le 2026-10-26 (retours du 26/10, T5).
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

/**
 * Les découpages admis par `couverture_geometrie` — exporté pour la copie Angular (`couverture-paritaire.test.ts`).
 * `commune` et `departement` (sql/275, lot 5) : la maille TikTok, lue par ⑤ ; l'écran ④ ne les propose pas.
 */
export const DECOUPAGES = ['forme', 'cp', 'iris', 'commune', 'departement'] as const;

/**
 * Un territoire touché par la zone (tout découpage sauf `forme`), tel que `couverture_geometrie` le rend dans `lignes`.
 * `part` (en %, une décimale) est NULL si le territoire n'a pas de dénominateur. Même forme que la copie Angular
 * (`logique/analyses/couverture.ts`) ; lue par la conversion de ⑤ (`lib/zones/conversion.ts`).
 */
export interface LigneCouverture {
  code: string;
  nom: string | null;
  /** La commune de l'IRIS ; `null` dans les autres découpages. */
  commune: string | null;
  n_carreaux: number;
  pop_en_zone: number;
  pop_totale: number | null;
  part: number | null;
}

/** Les paramètres de requête. Absents : la population totale (`ind`), la zone telle quelle (`forme`). */
export const RequeteCouvertureSchema = z.object({
  cible: z.string().regex(/^[a-z0-9_]{2,20}$/, 'Cible invalide.').default('ind'),
  decoupage: z.enum(DECOUPAGES, { errorMap: () => ({ message: 'Découpage inconnu : forme, cp, iris, commune ou departement.' }) }).default('forme'),
});

type RefusCouverture =
  | 'zone_introuvable' | 'cible_inconnue' | 'zone_trop_vaste' | 'trop_de_carreaux' | 'couverture_non_construite'
  | 'decoupage_trop_fin_pays';

export const MESSAGES_REFUS_COUVERTURE: Readonly<Record<RefusCouverture, string>> = {
  zone_introuvable: MESSAGES_REFUS.zone_introuvable,
  cible_inconnue: 'Cette cible n’est pas connue.',
  zone_trop_vaste: 'La zone est trop vaste : la couverture se calcule jusqu’à la taille d’une région.',
  trop_de_carreaux: `La zone compte plus de ${formaterNombre(MAX_CARREAUX_COUVERTURE)} carreaux habités.`,
  couverture_non_construite: 'La couverture n’est pas encore construite sur cette base.',
  // Zone pays (sql/296, ④ finitions T2, A-4) : refusé SANS lecture ; la liste IRIS pèserait 2,4 Mo.
  decoupage_trop_fin_pays: 'Sur toute la France, le découpage par IRIS (48 872) ou par commune (34 918) est trop fin : '
    + 'choisissez le découpage par code postal.',
};

/**
 * ⑤ face à une zone pays (A-5) : hors de ce lot, l'extraction d'un jeu la refuse avec cette phrase
 * (`lib/zones/extraction-jeu-zone.ts`). La ligne Excel « Mode pays — ⑤ » porte la suite.
 */
export const MESSAGE_ZONE_PAYS_PLATEFORMES = 'Zone nationale : le ciblage France natif des plateformes arrive avec les finitions de ⑤.';

/** Vrai pour une recette `pays` (sql/296), lue brute de `custom_geo_zones.recette` : la règle unique des routes. */
export function estRecettePays(recette: unknown): boolean {
  return (recette as { type?: unknown } | null | undefined)?.type === 'pays';
}

/**
 * 422 `zone_pays` pour une recette `pays`, sinon `null` : les lectures par CODES d'une zone (export, détail de
 * `/api/custom-geo/[id]`) n'ont rien à rendre pour une zone pays, qui n'a pas de `custom_geo_zone_codes` (sql/296,
 * `compter_zone_pays`) — un fichier vide ou « 0 code » se lirait comme une zone vide (relecture 1, ④ finitions).
 */
export function refusZonePays(recette: unknown): NextResponse | null {
  if (!estRecettePays(recette)) return null;
  return NextResponse.json({ error: MESSAGE_ZONE_PAYS_PLATEFORMES, refus: 'zone_pays' }, { status: 422 });
}

/**
 * La réponse d'une RPC de couverture (`couverture_zone`, `couverture_zone_en_cache`, `couverture_rayon_poi`) en HTTP : 200 le chiffrage ; un refus de `messages` en `{ error, refus, …détails }` (`plafond`,
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
