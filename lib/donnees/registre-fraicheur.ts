/**
 * Registre des sources de données NON socio-démographiques — MAGELIAN.
 *
 * POURQUOI CE FICHIER EXISTE
 * Une donnée absente ou périmée ne lève aucune erreur : elle se lit comme un
 * résultat, et oriente un achat média. Ce registre déclare CE QU'ON SAIT de
 * chaque source (d'où elle vient, comment elle entre, où elle atterrit) ;
 * la RPC `fraicheur_sources` mesure EN BASE ce qui est mesurable. Aucune date
 * n'est écrite ici : tout chiffre affiché à l'écran vient d'une mesure.
 *
 * PÉRIMÈTRE : tout SAUF POI, IRIS et Filosofi, qui sont le socle
 * socio-démographique et relèvent de `/admin/qualite-donnees`.
 *
 * TROIS NATURES, à ne jamais confondre — c'est la distinction qui décide si
 * une donnée a le droit de vivre en base :
 *   live          → appelée à chaque usage, jamais stockée. Il n'y a rien à
 *                   périmer, donc rien à mesurer.
 *   cache         → copie DATÉE qui expire d'elle-même. Stockée, mais elle
 *                   n'est pas un référentiel : elle porte son échéance et se
 *                   purge. La stocker est ce qui rend une choroplèthe
 *                   nationale possible en un seul appel au fournisseur.
 *   referentiel   → millésime figé, réimporté à la main. Le seul risque est
 *                   qu'il vieillisse sans que personne ne le voie.
 *   derive        → calculée depuis une autre donnée du projet.
 */
import type { TableName } from '@/lib/supabase/tables';

export type NatureSource = 'live' | 'cache' | 'referentiel' | 'derive';

/**
 * Coût d'une mesure de fraîcheur, mesuré au plan d'exécution, jamais supposé.
 * `lourd` = la mesure elle-même balaye la table. Sur un Nano plafonné à
 * 5 Mo/s, elle ne part JAMAIS toute seule : il faut un geste explicite.
 */
export type CoutMesure = 'leger' | 'lourd';

/** Journal d'import externe, quand la table de données ne porte pas sa date. */
export interface JournalSource {
  table: TableName;
  colonneDate: string;
  colonneFiltre: string;
  valeurFiltre: string;
}

export interface SourceDonnee {
  id: string;
  libelle: string;
  nature: NatureSource;
  /** Le fournisseur de la donnée, pas notre plomberie. */
  provenance: string;
  /** Comment elle entre chez nous. */
  collecte: string;
  /** `null` = jamais stockée. C'est une information, pas un trou. */
  table: TableName | null;
  /** Date métier : échéance, millésime. Ce que la donnée DÉCRIT. */
  colonneDonnee: string | null;
  /** Date d'écriture : quand NOUS l'avons posée. */
  colonneIngestion: string | null;
  /** Quand la table de données ne date rien elle-même. */
  journal: JournalSource | null;
  /** Rythme attendu, en jours. `null` = aucun rythme attendu, donc jamais en retard. */
  cadenceAttendueJours: number | null;
  coutMesure: CoutMesure;
  /** Ce que le lecteur doit savoir pour ne pas se tromper sur ce chiffre. */
  note: string | null;
}

export const SOURCES_DONNEES: readonly SourceDonnee[] = [
  {
    id: 'meteo',
    libelle: 'Météo',
    nature: 'live',
    provenance: 'Open-Meteo',
    collecte: 'Appel à la demande, 500 points max par requête',
    table: null,
    colonneDonnee: null,
    colonneIngestion: null,
    journal: null,
    cadenceAttendueJours: null,
    coutMesure: 'leger',
    note: "Jamais stockée, donc jamais périmée. Le cache est un fichier dans le répertoire temporaire de l'instance : il n'est pas partagé entre instances et disparaît à froid, donc il ne cache presque rien en production.",
  },
  {
    id: 'pollen',
    libelle: 'Pollen par code postal',
    nature: 'cache',
    provenance: 'WFS public Atmo France (ODbL)',
    collecte: 'Ingestion nationale en masse, cron quotidien 05h30 Europe/Paris',
    table: 'pollen_map_daily',
    colonneDonnee: 'date_ech',
    colonneIngestion: 'updated_at',
    journal: null,
    cadenceAttendueJours: 1,
    coutMesure: 'leger',
    note: 'Purge à J-2 : sans ingestion, la carte se vide au lieu de montrer de la donnée vieille.',
  },
  {
    id: 'atmo',
    libelle: "Qualité de l'air par code postal",
    nature: 'cache',
    provenance: 'WFS public Atmo France (ODbL)',
    collecte: 'Ingestion nationale en masse, cron quotidien 05h30 Europe/Paris',
    table: 'atmo_map_daily',
    colonneDonnee: 'date_ech',
    colonneIngestion: 'updated_at',
    journal: null,
    cadenceAttendueJours: 1,
    coutMesure: 'leger',
    note: 'Purge à J-2, même règle que le pollen.',
  },
  {
    id: 'sante_commune',
    libelle: 'Santé environnementale par commune',
    nature: 'cache',
    provenance: 'Atmo Data v2, ou fournisseur simulé selon ATMO_PROVIDER',
    collecte: "À la demande, commune par commune. Valide 24 h, servie jusqu'à 48 h si le fournisseur tombe",
    table: 'civic_health_cache',
    colonneDonnee: null,
    colonneIngestion: 'fetched_at',
    journal: null,
    cadenceAttendueJours: null,
    coutMesure: 'leger',
    note: "Ne couvre que les communes déjà consultées : un faible nombre de lignes n'est pas un défaut.",
  },
  {
    id: 'flux_routier',
    libelle: 'Flux routier',
    nature: 'referentiel',
    provenance: 'CSV TMJA réseau routier national, et classification OSM',
    collecte: 'Script Python lancé à la main, une seule fois',
    table: 'comptages_routiers',
    colonneDonnee: 'annee_mesure',
    colonneIngestion: 'created_at',
    journal: null,
    cadenceAttendueJours: null,
    coutMesure: 'lourd',
    note: "Seules 1 100 lignes sont des comptages mesurés. Les 406 930 autres viennent d'un proxy OSM qui ne porte que 11 valeurs de trafic distinctes et aucune année : c'est une constante par classe de route, pas une mesure. Le millésime affiché est celui des comptages réels.",
  },
  {
    id: 'radio_emetteurs',
    libelle: 'Émetteurs radio',
    nature: 'referentiel',
    provenance: 'ANFR',
    collecte: "Import déclenché depuis l'administration",
    table: 'emetteurs_radio',
    colonneDonnee: 'snapshot_date',
    colonneIngestion: null,
    journal: {
      table: 'radio_imports_log',
      colonneDate: 'completed_at',
      colonneFiltre: 'type',
      valeurFiltre: 'anfr',
    },
    cadenceAttendueJours: null,
    coutMesure: 'leger',
    note: null,
  },
  {
    id: 'radio_stations',
    libelle: 'Radios',
    nature: 'referentiel',
    provenance: 'Arcom',
    collecte: "Crawl déclenché depuis l'administration",
    table: 'radios',
    colonneDonnee: null,
    colonneIngestion: null,
    journal: {
      table: 'radio_imports_log',
      colonneDate: 'completed_at',
      colonneFiltre: 'type',
      valeurFiltre: 'arcom',
    },
    cadenceAttendueJours: null,
    coutMesure: 'leger',
    note: "La table ne date rien elle-même : la date vient du journal d'import.",
  },
  {
    id: 'panneaux',
    libelle: 'Panneaux OOH/DOOH',
    nature: 'referentiel',
    provenance: 'ArcGIS REST des régies',
    collecte: "Import déclenché depuis l'administration",
    table: 'panneaux_affichage',
    colonneDonnee: 'date_maj',
    colonneIngestion: 'date_import',
    journal: null,
    cadenceAttendueJours: null,
    coutMesure: 'leger',
    note: null,
  },
  {
    id: 'isochrones',
    libelle: 'Isochrones',
    nature: 'cache',
    provenance: 'OpenRouteService',
    collecte: 'Calculées à la demande, puis conservées',
    table: 'isochrones_cache',
    colonneDonnee: null,
    colonneIngestion: 'created_at',
    journal: null,
    cadenceAttendueJours: null,
    coutMesure: 'leger',
    note: "Ce cache n'expire pas : une isochrone reflète le réseau routier tel qu'il était au calcul.",
  },
  {
    id: 'indicateurs_cp',
    libelle: 'Indicateurs par code postal',
    nature: 'derive',
    provenance: 'Dérivé des données déjà en base',
    collecte: 'Matérialisation à la demande, indicateur par indicateur',
    table: 'indicator_cp_values',
    colonneDonnee: null,
    colonneIngestion: 'computed_at',
    journal: null,
    cadenceAttendueJours: null,
    coutMesure: 'leger',
    note: "C'est ici qu'une donnée quotidienne se fige si elle sert un score : la valeur matérialisée garde la date de son calcul, pas celle du jour.",
  },
] as const;

/** Descripteur envoyé à la RPC. Aucun nom de table ou de colonne côté SQL. */
export interface DescripteurMesure {
  id: string;
  table: string | null;
  col_donnee: string | null;
  col_ingestion: string | null;
  journal_table: string | null;
  journal_col_date: string | null;
  journal_col_filtre: string | null;
  journal_val_filtre: string | null;
  cout: CoutMesure;
}

export function descripteursDeMesure(
  sources: readonly SourceDonnee[] = SOURCES_DONNEES,
): DescripteurMesure[] {
  return sources.map((s) => ({
    id: s.id,
    table: s.table,
    col_donnee: s.colonneDonnee,
    col_ingestion: s.colonneIngestion,
    journal_table: s.journal?.table ?? null,
    journal_col_date: s.journal?.colonneDate ?? null,
    journal_col_filtre: s.journal?.colonneFiltre ?? null,
    journal_val_filtre: s.journal?.valeurFiltre ?? null,
    cout: s.coutMesure,
  }));
}

export function sourceParId(id: string): SourceDonnee | undefined {
  return SOURCES_DONNEES.find((s) => s.id === id);
}

/** Clé du relevé persisté dans `qualite_releves`. */
export const CLE_RELEVE_FRAICHEUR = 'fraicheur_donnees';

/** Une mesure rendue par la RPC pour une source. */
export interface MesureSource {
  id: string;
  n_lignes: number | null;
  /** Vrai quand le nombre vient des statistiques du planificateur, pas d'un COUNT. */
  n_estime: boolean;
  donnee_min: string | null;
  donnee_max: string | null;
  ingestion_max: string | null;
  /** Renseigné quand la source n'a pas été mesurée, avec la raison. */
  non_mesure: string | null;
}

export interface ReleveFraicheur {
  mesures: MesureSource[];
  mesure_le: string;
}

/**
 * Fusionne un relevé frais avec le précédent, source par source.
 *
 * C'est la règle qui protège une mesure COÛTEUSE d'être effacée par une mesure
 * ordinaire : une passe légère laisse le flux routier « non mesuré », et sans
 * cette fusion son millésime, payé 347 Mo de lecture, disparaîtrait au premier
 * clic sur « Relancer la mesure ».
 *
 * On ne conserve qu'une mesure RÉELLE : un ancien « non mesuré » ne remplace
 * jamais un nouveau, sinon la raison affichée serait celle d'hier.
 */
export function fusionnerMesures(
  fraiches: readonly MesureSource[],
  precedentes: readonly MesureSource[],
): MesureSource[] {
  const ancien = new Map(precedentes.map((m) => [m.id, m]));
  return fraiches.map((m) => {
    if (!m.non_mesure) return m;
    const conserve = ancien.get(m.id);
    return conserve && !conserve.non_mesure ? conserve : m;
  });
}

/**
 * État d'une source vis-à-vis de sa cadence attendue.
 * `sans_objet` n'est PAS un défaut : une donnée live ou un référentiel
 * n'ont aucun rythme à tenir.
 */
export type EtatFraicheur = 'a_jour' | 'en_retard' | 'jamais_mesure' | 'sans_objet';

export function etatDeSource(
  source: SourceDonnee,
  mesure: MesureSource | undefined,
  maintenant: Date,
): { etat: EtatFraicheur; ageJours: number | null } {
  if (source.nature === 'live') return { etat: 'sans_objet', ageJours: null };
  if (!mesure || mesure.non_mesure) return { etat: 'jamais_mesure', ageJours: null };

  const reference = mesure.ingestion_max ?? mesure.donnee_max;
  if (!reference) return { etat: 'jamais_mesure', ageJours: null };

  const date = new Date(reference.length === 4 ? `${reference}-01-01` : reference);
  if (Number.isNaN(date.getTime())) return { etat: 'jamais_mesure', ageJours: null };

  const ageJours = Math.floor((maintenant.getTime() - date.getTime()) / 86_400_000);
  if (source.cadenceAttendueJours === null) return { etat: 'sans_objet', ageJours };
  // Une cadence quotidienne tolère la journée en cours : un relevé du matin
  // n'est pas en retard à 23 h. Le retard commence au-delà de la cadence.
  return {
    etat: ageJours > source.cadenceAttendueJours ? 'en_retard' : 'a_jour',
    ageJours,
  };
}
