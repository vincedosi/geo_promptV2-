/**
 * @file lib/import/georisques/familles.ts
 *
 * Miroir TypeScript du seed de `icpe_rubrique_familles`.
 *
 * ── Pourquoi les deux, la table ET la constante ─────────────────────────────
 *
 * Le classement tourne dans le processus d'import, sur 138 423 sites : aller
 * chercher le libellé en base pour chaque rubrique de chaque site serait un
 * aller-retour par ligne, exactement ce que `lib/import/inserter.ts` a corrigé
 * le 2026-09-11. La constante sert donc le chemin chaud.
 *
 * La table, elle, sert l'affichage et l'évolution : `/api/map/poi-natures`
 * rend les natures disponibles à partir d'elle (15 lignes bornées) au lieu de
 * balayer les 138 423 jsonb de `poi_france` — voir la spec §8bis. Et un libellé
 * qui change devient une ligne de SQL, pas un déploiement.
 *
 * ── Ce que `rang_gravite` fait, et ne fait pas ─────────────────────────────
 *
 * Il ne sert QU'À départager la nature dominante d'un site qui porte plusieurs
 * rubriques. Ce n'est pas une échelle de danger publiable : la vraie gravité
 * réglementaire est le statut Seveso, qui vit dans `sous_categorie`. Les rangs
 * sont espacés de 5 pour qu'une famille puisse être insérée entre deux sans
 * renuméroter.
 *
 * ── Provenance des familles ────────────────────────────────────────────────
 *
 * Les préfixes et leurs libellés viennent de la nomenclature ICPE telle que
 * l'API Géorisques la renvoie dans `rubriques[].nature`, relevée le 2026-09-17
 * sur 400 sites du département 13. Un préfixe absent de cette liste ne fait pas
 * échouer l'import : il tombe sur NATURE_NON_PRECISEE.
 */

export interface FamilleIcpe {
  /** Deux premiers chiffres du numéro de rubrique ICPE. */
  prefixe: string;
  /** Libellé affiché, et valeur écrite dans `metadata.libelle_nature`. */
  libelle: string;
  /** Départage la nature dominante. Rien d'autre. */
  rang_gravite: number;
}

export const FAMILLES_ICPE_SEED: FamilleIcpe[] = [
  { prefixe: '41', libelle: 'Toxicité aiguë', rang_gravite: 100 },
  { prefixe: '42', libelle: 'Explosibles', rang_gravite: 95 },
  { prefixe: '47', libelle: 'GPL et produits pétroliers', rang_gravite: 90 },
  { prefixe: '43', libelle: 'Gaz et liquides inflammables', rang_gravite: 85 },
  { prefixe: '14', libelle: 'Inflammables (ancienne nomenclature)', rang_gravite: 80 },
  { prefixe: '27', libelle: 'Déchets', rang_gravite: 75 },
  { prefixe: '45', libelle: 'Dangereux pour le milieu aquatique', rang_gravite: 70 },
  { prefixe: '34', libelle: 'Chimie (IED)', rang_gravite: 65 },
  { prefixe: '35', libelle: 'Déchets (IED)', rang_gravite: 60 },
  { prefixe: '15', libelle: 'Entrepôts et stockages', rang_gravite: 55 },
  { prefixe: '29', libelle: 'Combustion et refroidissement', rang_gravite: 50 },
  { prefixe: '26', libelle: 'Plastiques et caoutchouc', rang_gravite: 45 },
  { prefixe: '25', libelle: 'Matériaux et minéraux', rang_gravite: 40 },
  { prefixe: '22', libelle: 'Agroalimentaire et divers', rang_gravite: 35 },
  { prefixe: '11', libelle: 'Fluides frigorigènes', rang_gravite: 30 },
];

/**
 * Nature servie quand un site n'a aucune rubrique exploitable — 40 % des sites
 * mesurés (179 sur 300 en portent). Une valeur explicite, jamais `null` : le
 * filtre carte fait un `.in()` sur ce champ, et un `null` rendrait ces sites
 * INVISIBLES dès qu'un filtre de nature est posé.
 */
export const NATURE_NON_PRECISEE = 'Nature non précisée';
