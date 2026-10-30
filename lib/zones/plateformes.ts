/**
 * Les capacités géographiques des plateformes d'achat, lues dans `plateformes_geo` (sql/274, lot 5, T2).
 *
 * Ce module ne porte QUE les noms (plateformes, mailles) et la forme d'une ligne. Aucune limite n'est écrite ici :
 * 200 cercles, 1 à 80 km, 3 000 lieux… vivent dans la table et se corrigent par une `update`, sans livraison
 * (spec § 16.2-3, A-7). Les deux listes ci-dessous recopient les CHECK de la migration : les y changer d'un côté
 * sans l'autre fait échouer la lecture de la route (ligne refusée par le schéma), et
 * `tests/integration/plateformes-geo.test.ts` compare les deux listes aux CHECK de la base.
 */
import { z } from 'zod';

export const PLATEFORMES = ['dv360', 'ttd', 'meta', 'tiktok'] as const;
/** `pays` (sql/300, ⑤ finitions) : le ciblage pays natif, pour une zone nationale (recette `pays`) seulement. */
export const MAILLES = ['polygone', 'cp', 'iris', 'commune', 'departement', 'cercle', 'pays'] as const;

/**
 * Borne écrite de la lecture de la table : 4 plateformes × 7 mailles = 28 couples possibles au plus (clé primaire et
 * CHECK). 50 laisse de la marge sans jamais approcher le plafond PostgREST de 1 000 lignes ; la route lit une ligne
 * de plus et refuse au-delà, plutôt que de servir une liste coupée.
 */
export const MAX_PLATEFORMES_GEO = 50;

/** Une limite est un entier positif ; absente = aucune limite connue (jamais 0 pour « illimité »). */
const limite = z.number().int().positive().optional();

/** Une liste non vide de codes ISO 3166 à deux lettres majuscules, sans doublon — la règle du CHECK de sql/300. */
const codesIso = z.array(z.string().regex(/^[A-Z]{2}$/)).min(1)
  .refine((codes) => new Set(codes).size === codes.length, 'code pays en double');

/**
 * Les codes pays d'une ligne `pays` (sql/300) : ce que la plateforme cible pour chaque code de la recette `pays` —
 * `METRO` (France métropolitaine), `FR` (France entière, DROM compris). Strict : une clé inconnue est refusée, comme en
 * base (`plateformes_geo_codes_pays_valides`). `null` sur toute autre maille ; absent (anciennes lectures, fixtures) =
 * `null`.
 */
export const CodesPaysSchema = z.object({ METRO: codesIso, FR: codesIso }).strict();
export type CodesPays = z.infer<typeof CodesPaysSchema>;

/**
 * Une ligne de `plateformes_geo`. Les clés inconnues de `limites` sont retirées (défaut de Zod) : une clé ajoutée en
 * base sans être déclarée ici n'est lue par personne, autant ne pas la servir.
 */
export const PlateformeGeoSchema = z.object({
  plateforme: z.enum(PLATEFORMES),
  maille: z.enum(MAILLES),
  libelle: z.string().min(1),
  natif: z.boolean(),
  disponible: z.boolean(),
  limites: z.object({
    max_unites: limite,
    rayon_min_m: limite,
    rayon_max_m: limite,
    pop_min_unite: limite,
    pop_min_groupe: limite,
    max_sommets: limite,
  }),
  doc_url: z.string().url().nullable(),
  releve_le: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  a_verifier: z.boolean(),
  note: z.string().nullable(),
  ordre: z.number().int(),
  codes_pays: CodesPaysSchema.nullable().optional(),
});

export type PlateformeGeo = z.infer<typeof PlateformeGeoSchema>;
