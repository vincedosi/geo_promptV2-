/**
 * Les campagnes OOH d'un espace sur la carte (spec 2026-10-16-ooh-campagnes § 6) : les formes rendues par
 * `GET /api/map/ooh/campagnes` et `GET /api/map/ooh/campagnes/:id` (RPC jsonb de sql/263), et la logique PURE de
 * l'overlay « Autres » → « Panneaux OOH et DOOH » et de sa couche. Préfixées OOH : « campagne » désigne déjà
 * `dsp_campaigns` et `CampagnePlan` (rattachement d'un plan média de zones).
 */
import { formaterDecimal, formaterNombre } from '../../../core/format/nombre';

/** Une ligne OOH dans la liste des campagnes. */
export interface LigneOohResume {
  id: string;
  ordre: number;
  media: string;
  regie: string | null;
  reseau: string | null;
  territoire: string | null;
  nb_ecrans: number | null;
  nb_places: number;
  nb_non_places: number;
}

/** Une campagne de l'espace ayant au moins une ligne OOH. */
export interface CampagneOohResume {
  id: string;
  nom: string;
  annonceur: string | null;
  vague: string | null;
  date_debut: string | null;
  date_fin: string | null;
  lignes: LigneOohResume[];
}

export interface ReponseCampagnesOoh {
  campagnes: CampagneOohResume[];
  tronque: boolean;
}

/** Un emplacement de la liste de la régie que l'import n'a pas pu placer. */
export interface NonPlace {
  nom: string;
  raison: string;
}

/** `campagne_lignes.details` : la ligne d'origine du plan, et ce que l'import y a ajouté. */
export interface DetailsLigneOoh {
  nb_lieux_plan?: number;
  unite_lieux_plan?: string;
  non_places?: NonPlace[];
  [cle: string]: unknown;
}

/** Une ligne OOH d'une campagne, dans l'ordre du plan. */
export interface LigneOoh {
  id: string;
  ordre: number;
  media: string;
  regie: string | null;
  reseau: string | null;
  territoire: string | null;
  nb_ecrans: number | null;
  format: string | null;
  nb_diffusions: number | null;
  date_debut: string | null;
  date_fin: string | null;
  duree_libelle: string | null;
  rang_option: string | null;
  plage_horaire: string | null;
  montant_brut: number | null;
  montant_net: number | null;
  frais: number | null;
  honoraires: number | null;
  total_ttc: number | null;
  contacts_15_plus: number | null;
  contacts_18_24: number | null;
  details: DetailsLigneOoh;
  /** Faux : la régie n'a fourni aucune liste (les DROM de TF4). */
  a_des_emplacements: boolean;
  nb_places: number;
  nb_a_verifier: number;
  nb_non_places: number;
}

export type QualiteGeoloc = 'sure' | 'a_verifier';
export type MethodeGeoloc = 'referentiel_gares' | 'adresse_ban' | 'alias_manuel' | 'coordonnees_fournies';

/** Tout ce que la table des panneaux dit d'un emplacement (sql/262), et la ligne qui le réserve. */
export interface ProprietesEmplacementOoh {
  id: string;
  ligne_id: string;
  nom_lieu: string | null;
  adresse: string | null;
  ville: string | null;
  code_postal: string | null;
  code_insee: string | null;
  regie: string | null;
  reseau: string | null;
  type_lieu: string | null;
  type_panneau: string | null;
  numerique: boolean | null;
  nb_ecrans: number | null;
  formats: string[] | null;
  contacts_semaine: number | null;
  contacts_18_25_semaine: number | null;
  geoloc_methode: MethodeGeoloc | null;
  geoloc_qualite: QualiteGeoloc | null;
  geoloc_score: number | null;
  geoloc_libelle: string | null;
  reference_panneau: string | null;
  metadata: Record<string, unknown> | null;
}

export interface EmplacementOoh {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: ProprietesEmplacementOoh;
}

export interface DetailCampagneOoh {
  campagne: {
    id: string;
    nom: string;
    annonceur: string | null;
    vague: string | null;
    date_debut: string | null;
    date_fin: string | null;
    budget_total_ttc: number | null;
    metadata: Record<string, unknown>;
  };
  lignes: LigneOoh[];
  emplacements: EmplacementOoh[];
  tronque: boolean;
}

/** Les jetons lus par `CouleursService` : les huit teintes de ligne (DESIGN_SYSTEM), le cerne des points et le segment sombre de l'anneau. */
export const JETONS_CAMPAGNE_OOH = {
  l1: 'ligne-media-1', l2: 'ligne-media-2', l3: 'ligne-media-3', l4: 'ligne-media-4',
  l5: 'ligne-media-5', l6: 'ligne-media-6', l7: 'ligne-media-7', l8: 'ligne-media-8',
  contour: 'poi-contour', anneau: 'anneau-a-verifier',
} as const;

export const NB_TEINTES_LIGNES = 8;

export const LIBELLES_QUALITE: Readonly<Record<QualiteGeoloc, string>> = { sure: 'Sûre', a_verifier: 'À vérifier' };

export const LIBELLES_METHODE: Readonly<Record<MethodeGeoloc, string>> = {
  referentiel_gares: 'Référentiel des gares SNCF',
  adresse_ban: 'Adresse (BAN)',
  alias_manuel: 'Alias vérifié par le code INSEE',
  coordonnees_fournies: 'Coordonnées fournies',
};

/** Le rang de teinte (1 à 8) de chaque ligne qui a des emplacements, dans l'ordre du plan ; au-delà de huit, on recommence. */
export function rangsDesLignes(lignes: readonly LigneOoh[]): Map<string, number> {
  const rangs = new Map<string, number>();
  [...lignes].filter((l) => l.a_des_emplacements).sort((a, b) => a.ordre - b.ordre)
    .forEach((l, i) => rangs.set(l.id, (i % NB_TEINTES_LIGNES) + 1));
  return rangs;
}

/** La collection posée sur la carte : propriétés minimales (id, ligne, rang, qualité), lignes masquées retirées. */
export function collectionCarte(
  detail: DetailCampagneOoh, rangs: ReadonlyMap<string, number>, masquees: ReadonlySet<string>,
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: detail.emplacements
      .filter((e) => !masquees.has(e.properties.ligne_id))
      .map((e) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: e.geometry.coordinates },
        properties: { id: e.properties.id, ligne: e.properties.ligne_id, rang: rangs.get(e.properties.ligne_id) ?? 1, qualite: e.properties.geoloc_qualite ?? 'sure' },
      })),
  };
}

/**
 * L'emprise `[ouest, sud, est, nord]` des emplacements SÛRS ; de tous s'il n'y a aucun point sûr ; `null` s'il n'y en
 * a aucun. Un point à vérifier peut être placé n'importe où (une commune homonyme outre-mer : TF4, trois clubs de
 * métropole placés à La Réunion et en Guadeloupe par la BAN) — l'inclure faisait cadrer le monde au lieu de la France.
 */
export function emprise(emplacements: readonly EmplacementOoh[]): [number, number, number, number] | null {
  const surs = emplacements.filter((e) => e.properties.geoloc_qualite !== 'a_verifier');
  const points = surs.length > 0 ? surs : emplacements;
  if (points.length === 0) return null;
  const lng = points.map((e) => e.geometry.coordinates[0]);
  const lat = points.map((e) => e.geometry.coordinates[1]);
  return [Math.min(...lng), Math.min(...lat), Math.max(...lng), Math.max(...lat)];
}

function dateFr(iso: string | null): string {
  if (!iso) return '—';
  const [a, m, j] = iso.slice(0, 10).split('-');
  return `${j}/${m}/${a}`;
}

/** « 20/09/2026 → 02/10/2026 » ; « — » sans aucune date. */
export function libellePeriode(debut: string | null, fin: string | null): string {
  if (!debut && !fin) return '—';
  return `${dateFr(debut)} → ${dateFr(fin)}`;
}

/** « 48 480 € TTC », arrondi à l'euro ; « — » sans montant. */
export function montantTtc(v: number | null): string {
  return v === null ? '—' : `${formaterNombre(Math.round(v))} € TTC`;
}

/**
 * L'écart entre la liste de la régie et le plan, quand il existe : « 882 clubs placés · plan : 905 clubs, 4 802 écrans »
 * (décision 7 de la spec : on affiche les deux chiffres, sans en inventer un troisième). `null` sans écart.
 */
export function libelleEcart(l: LigneOoh): string | null {
  const plan = l.details.nb_lieux_plan;
  if (typeof plan !== 'number' || plan === l.nb_places) return null;
  const unite = l.details.unite_lieux_plan ?? 'emplacements';
  const places = unite === 'gares' ? 'placées' : 'placés';
  return `${formaterNombre(l.nb_places)} ${unite} ${places} · plan : ${formaterNombre(plan)} ${unite}, ${formaterNombre(l.nb_ecrans)} écrans`;
}

export function libelleNonPlaces(n: number): string {
  return n === 1 ? '1 emplacement non placé' : `${formaterNombre(n)} emplacements non placés`;
}

/** Score de géolocalisation à deux décimales, virgule française ; « — » sans score. */
export function formaterScore(s: number | null): string {
  return formaterDecimal(s, 2);
}

/** Un bloc de la fiche « Données de la régie ». */
export interface GroupeDonneesRegie {
  titre: string;
  cellules: [string, string][];
}

/**
 * `metadata` d'un panneau en blocs lisibles : une ligne d'origine par bloc (« LISTING CAMPUS, ligne 3 », toutes ses
 * cellules non vides), puis ce que l'import en a tiré (groupement, bloc, écrans par format…).
 */
export function donneesRegie(metadata: Record<string, unknown> | null): GroupeDonneesRegie[] {
  if (!metadata) return [];
  const onglet = typeof metadata['onglet'] === 'string' ? metadata['onglet'] : 'Liste de la régie';
  const groupes: GroupeDonneesRegie[] = [];
  const lignes = Array.isArray(metadata['lignes']) ? metadata['lignes'] : [];
  for (const l of lignes) {
    if (!l || typeof l !== 'object') continue;
    const ligne = l as { numero?: unknown; cellules?: unknown };
    const cellules = ligne.cellules && typeof ligne.cellules === 'object'
      ? Object.entries(ligne.cellules as Record<string, unknown>)
        .filter(([, v]) => v !== null && v !== undefined && v !== '')
        .map(([k, v]): [string, string] => [k, String(v)])
      : [];
    groupes.push({ titre: `${onglet}, ligne ${String(ligne.numero ?? '?')}`, cellules });
  }
  const autres = Object.entries(metadata)
    .filter(([k, v]) => k !== 'onglet' && k !== 'lignes' && v !== null && v !== undefined && v !== '')
    .map(([k, v]): [string, string] => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)]);
  if (autres.length > 0) groupes.push({ titre: 'Lu par l’import', cellules: autres });
  return groupes;
}
