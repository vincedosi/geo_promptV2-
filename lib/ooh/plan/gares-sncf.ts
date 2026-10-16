/**
 * Référentiel public SNCF « gares de voyageurs » (data.sncf.com, sans clé, téléchargé au lancement du script) et
 * correspondance des noms de gare d'une liste de régie (spec 2026-10-16-ooh-campagnes § 7, § 9).
 *
 * Ordre d'essai d'un nom : le nom plein, puis la DERNIÈRE partie (« BOIS COLOMBES - LES VALLEES » est « Les Vallées »),
 * puis première + dernière (« VALENCE - TGV »), puis la première seule — qui ne donne qu'un point À VÉRIFIER. L'ordre
 * de la spec (première partie avant la dernière) fusionnait 11 paires de gares sur un même code UIC (mesuré le 16/10).
 * Une gare trouvée hors du bloc annoncé (une gare de province dans la liste IDF) est à vérifier. Jamais
 * d'approchement flou : un nom introuvable n'est pas placé, il est rapporté.
 *
 * La table d'alias est VERSIONNÉE ici : un nom de la liste → le nom exact du référentiel, vérifié au lancement par
 * le code INSEE de la commune. Un alias dont la gare a changé de commune (ou disparu) n'est pas placé.
 */
import Papa from 'papaparse';
import { fetchLectureAvecReprise } from '@/lib/http/lecture-avec-reprise';
import type { BlocGares, GeolocQualite } from '@/types/campagnes-media';
import { departementDeInsee, normaliser } from './texte';

const URL_REFERENTIEL_GARES =
  'https://ressources.data.sncf.com/api/explore/v2.1/catalog/datasets/gares-de-voyageurs/exports/csv?delimiter=%3B';

/** Une gare du référentiel. `uic` est l'identité stable d'un panneau de gare (`source_ref`). */
export interface GareSncf {
  nom: string;
  code_insee: string;
  uic: string;
  lat: number;
  lng: number;
}

const MOTS_VIDES = new Set(['GARE', 'DE', 'DU', 'DES', 'D', 'LA', 'LE', 'LES', 'L']);
const DEPARTEMENTS_IDF = new Set(['75', '77', '78', '91', '92', '93', '94', '95']);

/** `normaliser`, puis sans les mots vides d'un nom de gare (« GARE », « DE », « LES »…). */
export function normaliserNomGare(nom: string): string {
  return normaliser(nom).split(' ').filter((m) => m !== '' && !MOTS_VIDES.has(m)).join(' ');
}

/** Lit le CSV du référentiel (séparateur `;`, BOM toléré) ; une gare sans position, sans UIC ou sans INSEE est écartée. */
export function lireReferentielGares(csv: string): GareSncf[] {
  const lu = Papa.parse<Record<string, string>>(csv.replace(/^\uFEFF/, ''), { header: true, delimiter: ';', skipEmptyLines: true });
  const gares: GareSncf[] = [];
  for (const l of lu.data) {
    const [lat, lng] = (l.position_geographique ?? '').split(',').map((v) => Number(v.trim()));
    const uic = (l.codes_uic ?? '').split(/[,;\s]+/).find((v) => v !== '');
    const nom = (l.nom ?? '').trim();
    const insee = (l.codeinsee ?? '').trim();
    if (nom === '' || !uic || insee === '' || !Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) continue;
    gares.push({ nom, code_insee: insee, uic, lat, lng });
  }
  return gares;
}

/** Les gares par nom normalisé (plusieurs gares peuvent partager un nom normalisé : on garde toutes). */
type IndexGares = ReadonlyMap<string, readonly GareSncf[]>;

export function indexerGares(gares: readonly GareSncf[]): IndexGares {
  const index = new Map<string, GareSncf[]>();
  for (const g of gares) {
    const cle = normaliserNomGare(g.nom);
    index.set(cle, [...(index.get(cle) ?? []), g]);
  }
  return index;
}

/** Un alias : le nom EXACT du référentiel et le code INSEE de sa commune, vérifié à chaque lancement. */
interface AliasGare {
  sncf: string;
  insee: string;
}

/**
 * Noms de la liste Mediatransports que la correspondance par nom ne place pas, ou place mal (mesuré le 16/10 sur le
 * plan TF4 contre le référentiel téléchargé ce jour-là). Clé = `normaliser(nom de la liste)`.
 */
export const ALIAS_GARES: Readonly<Record<string, AliasGare>> = {
  'AIX LES BAINS': { sncf: 'Aix-les-Bains le Revard', insee: '73008' },
  CHAMBERY: { sncf: 'Chambéry - Challes-les-Eaux', insee: '73065' },
  LORIENT: { sncf: 'Lorient Bretagne Sud', insee: '56121' },
  FRANCONVILLE: { sncf: 'Franconville - Le Plessis-Bouchard', insee: '95252' },
  'GARGES LES GONESSE GARGES LES GONESSE': { sncf: 'Garges - Sarcelles', insee: '95268' },
  'HOUILLES CARRIERES': { sncf: 'Houilles - Carrières-sur-Seine', insee: '78311' },
  'LE PERRAY': { sncf: 'Le Perray-en-Yvelines', insee: '78486' },
  'VALLAURIS GOLFE JUAN': { sncf: 'Golfe Juan Vallauris', insee: '06155' },
  MONTGERON: { sncf: 'Montgeron - Crosne', insee: '91421' },
  'NOISY LE GRAND LES YVRIS': { sncf: 'Les Yvris Noisy-le-Grand', insee: '93051' },
  'PARIS GARE DE BERCY': { sncf: "Paris Bercy Bourgogne - Pays d'Auvergne", insee: '75112' },
  'PARIS PEREIRE': { sncf: 'Péreire - Levallois', insee: '75117' },
  'PARIS PORTE MAILLOT': { sncf: 'Neuilly - Porte Maillot', insee: '75117' },
  'PARIS NEUILLY PORTE MAILLOT EOLE': { sncf: 'Neuilly Porte Maillot RER E', insee: '75117' },
  'PARIS SAINT MICHEL': { sncf: 'Saint-Michel Notre-Dame', insee: '75105' },
  'SAINT QUENTIN EN YVELINES': { sncf: 'Saint-Quentin en Yvelines - Montigny-le-Bretonneux', insee: '78423' },
  SURESNES: { sncf: 'Suresnes Mont Valérien', insee: '92073' },
  'TREMBLAY EN FRANCE AEROPORT 1 C DE GAULLE': { sncf: 'Aéroport Charles de Gaulle 1', insee: '93073' },
  'VILLEMOMBLE LE RAINCY VILLEMOMBLE': { sncf: 'Le Raincy - Villemomble - Montfermeil', insee: '93062' },
  'VILLIERS NEAUPHLE PONCHARTRAIN': { sncf: 'Villiers - Neauphle - Pontchartrain', insee: '78683' },
  'VILLIERS SUR MARNE': { sncf: 'Villiers-sur-Marne - Le Plessis-Trévise', insee: '94079' },
  'ASNIERES SUR SEINE GARE D ASNIERES': { sncf: 'Asnières-sur-Seine', insee: '92004' },
  'LE CREUSOT TGV': { sncf: 'Le Creusot - Montceau-les-Mines - Montchanin TGV', insee: '71187' },
  'EPINAY SUR SEINE VILLETANEUSE': { sncf: 'Épinay - Villetaneuse', insee: '93031' },
  'STRASBOURG TGV': { sncf: 'Strasbourg', insee: '67482' },
  'VALENCE TGV': { sncf: 'Valence TGV Rhône-Alpes Sud', insee: '26004' },
  'VALENCE VALENCE VILLE': { sncf: 'Valence', insee: '26362' },
  'PUTEAUX DEFENSE EOLE CNIT': { sncf: 'La Défense Grande Arche RER E', insee: '92062' },
  'RIS ORANGIS BOIS DE L EPINE': { sncf: "Orangis Bois de l'Épine", insee: '91521' },
  'SAINT DENIS LA PLAINE STADE DE FRANCE': { sncf: 'La Plaine Stade de France - Saint-Denis - Aubervilliers', insee: '93066' },
  'SAINT OUEN GARE DE SAINT OUEN RER': { sncf: 'Saint-Ouen', insee: '93070' },
  'VILLENEUVE SAINT GEORGES TRIAGE': { sncf: 'Villeneuve Triage', insee: '94078' },
};

type ResultatGare =
  | { trouvee: true; gare: GareSncf; methode: 'referentiel_gares' | 'alias_manuel'; qualite: GeolocQualite }
  | { trouvee: false; raison: string };

/** Les noms à essayer, du plus sûr au moins sûr ; le booléen dit si la correspondance suffit pour « sûr ». */
function candidats(nom: string): Array<[string, boolean]> {
  const parties = nom.split(/\s*-\s+|\s+-\s*/).map((p) => p.trim()).filter((p) => p !== '');
  if (parties.length < 2) return [[nom, true]];
  return [
    [nom, true],
    [parties[parties.length - 1], true],
    [`${parties[0]} ${parties[parties.length - 1]}`, true],
    [parties[0], false],
  ];
}

/** Cherche une gare de la liste dans le référentiel. */
export function trouverGare(nom: string, bloc: BlocGares, index: IndexGares): ResultatGare {
  const alias = ALIAS_GARES[normaliser(nom)];
  if (alias) {
    const homonymes = index.get(normaliserNomGare(alias.sncf)) ?? [];
    const gare = homonymes.find((g) => g.code_insee === alias.insee);
    if (gare) return { trouvee: true, gare, methode: 'alias_manuel', qualite: 'sure' };
    return {
      trouvee: false,
      raison: homonymes.length > 0
        ? `alias périmé : « ${alias.sncf} » n'est plus en ${alias.insee} (INSEE ${homonymes.map((g) => g.code_insee).join(', ')})`
        : `alias périmé : « ${alias.sncf} » absente du référentiel SNCF`,
    };
  }
  for (const [candidat, suffisant] of candidats(nom)) {
    const gares = index.get(normaliserNomGare(candidat));
    if (!gares || gares.length === 0) continue;
    const gare = gares[0];
    const dansLeBloc = bloc === 'inconnu' || (bloc === 'idf') === DEPARTEMENTS_IDF.has(departementDeInsee(gare.code_insee));
    const sure = suffisant && gares.length === 1 && dansLeBloc;
    return { trouvee: true, gare, methode: 'referentiel_gares', qualite: sure ? 'sure' : 'a_verifier' };
  }
  return { trouvee: false, raison: 'gare introuvable dans le référentiel SNCF' };
}

/** Télécharge le référentiel (60 s par tentative, trois tentatives) ; lève si la réponse n'est pas un succès. */
export async function telechargerReferentielGares(): Promise<GareSncf[]> {
  const reponse = await fetchLectureAvecReprise(URL_REFERENTIEL_GARES, {}, { delaiMs: 60_000, tentatives: 3 });
  if (!reponse.ok) throw new Error(`Référentiel des gares SNCF indisponible (HTTP ${reponse.status}).`);
  const gares = lireReferentielGares(await reponse.text());
  if (gares.length === 0) throw new Error('Référentiel des gares SNCF vide ou illisible.');
  return gares;
}
