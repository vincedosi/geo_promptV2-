/**
 * @file lib/carte/fiche-jeu.ts — la fiche d'un jeu de l'étape ② (lot « Catalogue et groupes », A-8 ; spec
 * carte-en-parcours § 7.1).
 *
 * Composition PURE, testée à part (tests/unit/carte/fiche-jeu.test.ts) : la route `GET /api/map/catalogue/fiche` lit
 * ce qui est visible de l'espace actif — sources, indicateurs, noms d'espaces — et cette fonction le met en forme. Il
 * n'y a pas de table « catalogue » : un type de POI et un indicateur privable sont des lignes `data_sources`, un
 * référentiel est une entrée du registre statique `JEUX_REFERENTIELS`.
 *
 * Effectif : `data_sources.valid_count`, jamais un `COUNT` sur `poi_france` (§ 7.1). Un référentiel sans source ne dit
 * ni provenance ni millésime : Données › Fraîcheur les montre.
 */
import { CATEGORIES_HORS_POI, JEUX_REFERENTIELS, PREFIXE_POI, RE_CLE_JEU } from './jeux-carte';

/** Le niveau d'une source VU DE L'ESPACE ACTIF : au socle, privée à lui, ou partagée avec lui par un autre espace. */
export type NiveauSource = 'socle' | 'prive' | 'partage';

/** Une ligne `data_sources` déjà restreinte aux sources visibles de l'espace actif. */
export interface SourceLue {
  id: string;
  name: string;
  type: string;
  category: string | null;
  visibilite: string;
  organization_id: string | null;
  shared_with: string[] | null;
  valid_count: number | null;
  import_date: string | null;
}

export interface SourceDeFiche {
  nom: string;
  proprietaire: string;
  niveau: NiveauSource;
  effectif: number;
  importe_le: string | null;
}

export interface FicheJeu {
  cle: string;
  /** Vrai pour un référentiel du registre : « Socle dentsu.explore, référentiel système ». */
  referentiel: boolean;
  /** Les sources visibles qui portent le jeu ; vide pour un référentiel qui n'en a pas. */
  sources: SourceDeFiche[];
}

export interface ContexteFiche {
  /** L'espace actif ; `null` sans espace (rien n'est alors « privé » ni « partagé »). */
  espaceActif: string | null;
  /**
   * Les sources visibles lues pour cette clé : celles de la catégorie pour un type de POI, celles des indicateurs
   * visibles du référentiel (`IndicateursVisibles.sourceDe`) pour un référentiel.
   */
  sources: readonly SourceLue[];
  /** Les codes d'indicateurs visibles (`indicateursVisibles`). */
  indicateursVisibles: ReadonlySet<string>;
  /** Le nom AFFICHÉ de chaque espace propriétaire (`nomAffiche`). */
  nomsEspaces: ReadonlyMap<string, string>;
}

/** La catégorie d'une clé `poi:<cat>` que ② peut montrer, sinon `null`. */
export function categorieDeCle(cle: string): string | null {
  if (!RE_CLE_JEU.test(cle) || !cle.startsWith(PREFIXE_POI)) return null;
  const categorie = cle.slice(PREFIXE_POI.length);
  return CATEGORIES_HORS_POI.includes(categorie) ? null : categorie;
}

function niveau(s: SourceLue, espaceActif: string | null): NiveauSource {
  if (s.visibilite === 'socle') return 'socle';
  return espaceActif !== null && s.organization_id === espaceActif ? 'prive' : 'partage';
}

function versFiche(s: SourceLue, ctx: ContexteFiche): SourceDeFiche {
  return {
    nom: s.name,
    proprietaire: (s.organization_id && ctx.nomsEspaces.get(s.organization_id)) || 'Espace supprimé',
    niveau: niveau(s, ctx.espaceActif),
    effectif: s.valid_count ?? 0,
    importe_le: s.import_date,
  };
}

/**
 * La fiche d'une clé de ②, ou `null` — clé inconnue, type de POI sans source visible, référentiel dont aucun
 * indicateur n'est visible. La route répond `null` par un 404 : un jeu invisible ne se distingue pas d'un jeu
 * inexistant.
 */
export function composerFiche(cle: string, ctx: ContexteFiche): FicheJeu | null {
  const categorie = categorieDeCle(cle);
  if (categorie !== null) {
    const sources = ctx.sources.filter((s) => s.type === 'poi' && s.category === categorie);
    if (sources.length === 0) return null;
    return { cle, referentiel: false, sources: sources.map((s) => versFiche(s, ctx)) };
  }

  const referentiel = JEUX_REFERENTIELS.find((j) => j.cle === cle);
  if (!referentiel) return null;
  if (referentiel.indicateurs === undefined) return { cle, referentiel: true, sources: [] };
  const visibles = referentiel.indicateurs.filter((code) => ctx.indicateursVisibles.has(code));
  if (visibles.length === 0) return null;
  const sources = ctx.sources.filter((s) => s.type === 'indicateur');
  return { cle, referentiel: true, sources: sources.map((s) => versFiche(s, ctx)) };
}
