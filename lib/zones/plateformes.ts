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

/** Les valeurs de `poids_groupe_cp` (CHECK `plateformes_geo_poids_groupe_cp_valide`, sql/304). */
export const POIDS_GROUPE_CP = ['meme', 'divise'] as const;

/**
 * Les paramètres qu'une ligne peut déclarer « à vérifier » (`parametres_a_verifier`, fonction
 * `plateformes_geo_parametres_valides`, sql/304) : la règle de poids d'un groupe de CP et les clés de `limites`.
 */
export const PARAMETRES_VERIFIABLES = [
  'poids_groupe_cp', 'max_unites', 'rayon_min_m', 'rayon_max_m', 'pop_min_unite', 'pop_min_groupe', 'max_sommets',
] as const;

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
const CodesPaysSchema = z.object({ METRO: codesIso, FR: codesIso }).strict();

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
  /** Ligne `pays` : les codes de recette dont le ciblage reste « à vérifier » (sql/300, relecture 1) ; absent = aucun. */
  pays_a_verifier: z.array(z.enum(['METRO', 'FR'])).nullable().optional(),
  /**
   * Ligne CP (sql/304, A2) : ce que reçoit chaque membre d'un groupe de CP indiscernables — `meme` (le multiplicateur
   * de l'unité, répété) ou `divise` (divisé par le nombre de membres). `null` hors CP ; absent = `null`.
   */
  poids_groupe_cp: z.enum(POIDS_GROUPE_CP).nullable().optional(),
  /** Les paramètres de la ligne non confirmés (sql/304, amendement E9) ; absent ou vide = aucun parmi eux. */
  parametres_a_verifier: z.array(z.enum(PARAMETRES_VERIFIABLES)).optional(),
});

export type PlateformeGeo = z.infer<typeof PlateformeGeoSchema>;
