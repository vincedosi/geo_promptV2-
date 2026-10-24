/**
 * ⑤ Jeu de zones — les noms des plateformes et des mailles, et la forme d'une ligne de `plateformes_geo` (lot 5, T9) :
 * copie de `lib/zones/plateformes.ts` sans Zod (Angular n'importe jamais le serveur, `isolement.test.ts`).
 *
 * Aucune limite ici, comme côté serveur : 200 cercles, 1 à 80 km, 3 000 lieux… se LISENT dans la ligne servie par
 * `GET /api/zones/plateformes` (§ 16.2-3). `tests/unit/angular/conversion-paritaire.test.ts` verrouille l'égalité des
 * deux listes et du type d'une ligne. Aucun import d'Angular : le test de parité (Vitest racine) importe ce fichier.
 */

export const PLATEFORMES = ['dv360', 'ttd', 'meta', 'tiktok'] as const;
export const MAILLES = ['polygone', 'cp', 'iris', 'commune', 'departement', 'cercle'] as const;

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
}
