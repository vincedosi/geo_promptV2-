/**
 * ⑤ Jeu de zones — les noms des plateformes et des mailles, et la forme d'une ligne de `plateformes_geo` (lot 5, T9) :
 * copie de `lib/zones/plateformes.ts` sans Zod (Angular n'importe jamais le serveur, `isolement.test.ts`).
 *
 * Aucune limite ici, comme côté serveur : 200 cercles, 1 à 80 km, 3 000 lieux… se LISENT dans la ligne servie par
 * `GET /api/zones/plateformes` (§ 16.2-3). `tests/unit/angular/conversion-paritaire.test.ts` verrouille l'égalité des
 * deux listes et du type d'une ligne. Aucun import d'Angular : le test de parité (Vitest racine) importe ce fichier.
 */

export const PLATEFORMES = ['dv360', 'ttd', 'meta', 'tiktok'] as const;
/** `pays` (sql/300, ⑤ finitions) : le ciblage pays natif, pour une zone nationale (recette `pays`) seulement. */
export const MAILLES = ['polygone', 'cp', 'iris', 'commune', 'departement', 'cercle', 'pays'] as const;

/** Les valeurs de `poids_groupe_cp` (sql/304). */
export const POIDS_GROUPE_CP = ['meme', 'divise'] as const;

/** Les paramètres qu'une ligne peut déclarer « à vérifier » (`parametres_a_verifier`, sql/304 ; bornes du polygone, sql/312). */
export const PARAMETRES_VERIFIABLES = [
  'poids_groupe_cp', 'max_unites', 'rayon_min_m', 'rayon_max_m', 'pop_min_unite', 'pop_min_groupe', 'max_sommets',
  'polygone_sommets_max', 'polygone_morceaux_max',
] as const;

export type Plateforme = (typeof PLATEFORMES)[number];
export type Maille = (typeof MAILLES)[number];

/** Une ligne de `plateformes_geo`. Une limite absente = aucune limite connue (jamais 0 pour « illimité »). */
export interface PlateformeGeo {
  plateforme: Plateforme;
  maille: Maille;
  libelle: string;
  natif: boolean;
  disponible: boolean;
  limites: {
    max_unites?: number | undefined;
    rayon_min_m?: number | undefined;
    rayon_max_m?: number | undefined;
    pop_min_unite?: number | undefined;
    pop_min_groupe?: number | undefined;
    max_sommets?: number | undefined;
  };
  doc_url: string | null;
  releve_le: string;
  a_verifier: boolean;
  note: string | null;
  ordre: number;
  /** Ligne `pays` seulement (sql/300) : les codes ISO ciblés pour `METRO` et pour `FR` ; `null` ou absent sinon. */
  codes_pays?: { METRO: string[]; FR: string[] } | null | undefined;
  /** Ligne `pays` : les codes de recette dont le ciblage reste « à vérifier » (sql/300, relecture 1) ; absent = aucun. */
  pays_a_verifier?: ('METRO' | 'FR')[] | null | undefined;
  /** Ligne CP (sql/304, A2) : chaque membre d'un groupe de CP reçoit le multiplicateur `meme` ou `divise` ; `null` hors CP. */
  poids_groupe_cp?: (typeof POIDS_GROUPE_CP)[number] | null | undefined;
  /** Les paramètres de la ligne non confirmés (sql/304, amendement E9) ; absent ou vide = aucun parmi eux. */
  parametres_a_verifier?: (typeof PARAMETRES_VERIFIABLES)[number][] | undefined;
  /** Ligne polygone (sql/312, A7) : sommets et morceaux maximaux de la forme envoyée, après simplification ; `null` ou absent = aucune limite connue. */
  polygone_sommets_max?: number | null | undefined;
  polygone_morceaux_max?: number | null | undefined;
}
