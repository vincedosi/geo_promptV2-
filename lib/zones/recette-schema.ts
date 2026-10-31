/**
 * @file lib/zones/recette-schema.ts — la recette validée côté serveur (Zod). Les bornes sont celles de
 * `lib/zones/recette.ts` ; `.strict()` partout : une clé inconnue est refusée (une géométrie ne voyage JAMAIS dans la
 * recette, elle a son propre champ dans les routes).
 *
 * Une combinaison : l'intersection se fait entre EXACTEMENT deux zones ; l'union et la différence entre deux zones au
 * moins (`get_composite_zone_geometry` lève sous deux) ; une zone n'y figure qu'une fois. Tout UUID (zones d'une
 * combinaison, périmètre « zone ») sort en minuscules — le même UUID en deux casses est donc un doublon.
 *
 * ⚠ `RecetteSchema` est un `ZodEffects` (le `superRefine` de l'intersection), PAS une `ZodDiscriminatedUnion` : il
 * ne s'imbrique pas dans une autre `discriminatedUnion` et n'a pas de `.options`. Pour cela, prendre
 * `RecetteUnionSchema` (l'union nue, sans la règle de l'intersection — à revérifier par `RecetteSchema` ensuite).
 *
 * Les messages de refus sont en français : `messageAnomalies` (`lib/api/valider-corps.ts`) traduit ceux de Zod.
 */
import { z } from 'zod';
import { messageAnomalies } from '@/lib/api/valider-corps';
import {
  CODES_FRANCE, CODES_PAYS, INDICATEURS_SEUIL_CARREAUX, MAX_CODES_POSTAUX, MAX_INDICATEURS_SCORE, MIN_MENAGES_CARREAUX_MAX, RAYON_POINT_MAX_M, RAYON_POI_MAX_M, RAYON_POI_MIN_M,
  SEUIL_CARREAUX_MAX, SEUIL_TERRITOIRE_MAX_ABS, TYPES_PERIMETRE, VERSION_RECETTE, type OperateurSeuil, type ParametresScore as ParametresScoreRecette,
  type PerimetreRecette, type Recette,
} from './recette';

// Tout UUID cité sort en MINUSCULES : `zone_referencee` (sql/253) le compare en texte jsonb, et un UUID en majuscules
// lui échapperait — une zone citée par une combinaison serait alors recalculable sous le plan qui l'achète.
const Uuid = z.string().uuid().transform((s) => s.toLowerCase());
// Codes taillés partout ; région et département en MAJUSCULES (V-8, Q-5) : `resoudre_perimetre` compare les codes tels
// quels, et « 2a » rendait `perimetre_inconnu`. Normalisés ICI, à l'entrée : la base reçoit toujours des codes propres.
const Perimetre = z.object({ type: z.enum(TYPES_PERIMETRE), code: z.string().trim().min(1).max(64) }).strict()
  .refine((p) => p.type !== 'zone' || Uuid.safeParse(p.code).success, { message: 'le code d’une zone doit être un UUID', path: ['code'] })
  .refine((p) => p.type !== 'france' || (CODES_FRANCE as readonly string[]).includes(p.code), { message: 'le code de la France est FR ou METRO', path: ['code'] })
  .transform((p): PerimetreRecette => {
    if (p.type === 'zone') return { ...p, code: p.code.toLowerCase() };
    if (p.type === 'region' || p.type === 'departement') return { ...p, code: p.code.toUpperCase() };
    return p;
  })
  .nullable();
const OPERATEURS = ['>=', '<='] as const satisfies readonly OperateurSeuil[];
const Operateur = z.enum(OPERATEURS);
/** La version unique des recettes : celle du CHECK `custom_geo_zones_recette_forme` (sql/253). */
const V = z.literal(VERSION_RECETTE);
const IDS_CARREAUX = INDICATEURS_SEUIL_CARREAUX.map((i) => i.id) as [string, ...string[]];
// La provenance d'une zone du score composite (V-6, A-6) : les bornes de `/api/custom-geo/source/score`.
const ParametresScore = z.object({
  indicateurs: z.array(z.object({ code: z.string().min(1).max(100), poids: z.number().positive().finite(), sens: z.enum(['croissant', 'decroissant']) }).strict())
    .min(1).max(MAX_INDICATEURS_SCORE),
  maille: z.literal('cp'),
  seuil_score: z.number().finite().min(0).max(100),
}).strict() satisfies z.ZodType<ParametresScoreRecette>;
const Zones = z.array(Uuid).min(2).max(20)
  .refine((zs) => new Set(zs).size === zs.length, { message: 'Une zone ne peut figurer qu’une fois.' });

export const RecetteUnionSchema = z.discriminatedUnion('type', [
  z.object({ v: V, type: z.literal('rayon_point'), lon: z.number().min(-180).max(180), lat: z.number().min(-90).max(90), rayon_m: z.number().int().min(RAYON_POI_MIN_M).max(RAYON_POINT_MAX_M), part_retenue: z.number().min(0).max(1).optional() }).strict(),
  z.object({ v: V, type: z.literal('rayon_poi'), categorie: z.string().regex(/^[a-z0-9_-]{1,64}$/), rayon_m: z.number().int().min(RAYON_POI_MIN_M).max(RAYON_POI_MAX_M), perimetre: Perimetre }).strict(),
  z.object({ v: V, type: z.literal('seuil_carreaux'), indicateur: z.enum(IDS_CARREAUX), operateur: Operateur, seuil: z.number().finite().min(0).max(SEUIL_CARREAUX_MAX), perimetre: Perimetre, min_menages: z.number().int().min(0).max(MIN_MENAGES_CARREAUX_MAX).optional() }).strict(),
  z.object({ v: V, type: z.literal('seuil_territoire'), indicateur: z.string().regex(/^[a-z0-9_]{1,64}$/), operateur: Operateur, seuil: z.number().finite().min(-SEUIL_TERRITOIRE_MAX_ABS).max(SEUIL_TERRITOIRE_MAX_ABS), perimetre: Perimetre }).strict(),
  z.object({ v: V, type: z.literal('codes_postaux'), codes: z.array(z.string().regex(/^\d{5}$/)).min(1).max(MAX_CODES_POSTAUX) }).strict(),
  z.object({ v: V, type: z.literal('dessin') }).strict(),
  z.object({ v: V, type: z.literal('import'), format: z.enum(['geojson', 'kml']), fichier: z.string().min(1).max(200) }).strict(),
  z.object({ v: V, type: z.literal('isochrone'), parametres: z.record(z.union([z.string().max(200), z.number(), z.boolean()])).refine((o) => Object.keys(o).length <= 20, { message: 'au plus 20 paramètres' }) }).strict(),
  z.object({ v: V, type: z.literal('combinaison'), operation: z.enum(['union', 'intersection', 'difference']), zones: Zones }).strict(),
  z.object({ v: V, type: z.literal('capture'), source_type: z.string().min(1).max(100), parametres: ParametresScore.optional() }).strict(),
  z.object({ v: V, type: z.literal('pays'), code: z.enum(CODES_PAYS) }).strict(),
]);

export const RecetteSchema = RecetteUnionSchema.superRefine((r, ctx) => {
  // `discriminatedUnion` n'accepte que des objets nus : la règle propre à l'intersection se pose donc sur l'union.
  if (r.type === 'combinaison' && r.operation === 'intersection' && r.zones.length !== 2) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['zones'], message: 'L’intersection se fait entre deux zones.' });
  }
});

export function lireRecette(v: unknown): { ok: true; recette: Recette } | { ok: false; message: string } {
  const r = RecetteSchema.safeParse(v);
  if (r.success) return { ok: true, recette: r.data };
  return { ok: false, message: `Recette invalide : ${messageAnomalies(r.error).replace(/[.!?]$/, '')}.` };
}
