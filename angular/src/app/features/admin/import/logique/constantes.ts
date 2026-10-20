import type { FieldMapping, GeoMode } from '../../logique/types/import-poi';

/**
 * Constantes de l'import POI, copiées de `app/admin/import/_components/shared.tsx` et `page.tsx`
 * (lot 6, T12). `GEO_MODES` et `GENESIS_FIELDS_POI` sont verrouillés contre React par
 * `tests/unit/angular/admin-logique-paritaire.test.ts`.
 */

/** Correspondance colonne du fichier → champ dentsu.explore, indexable par clé dynamique (`MappingState`). */
export interface Correspondance extends FieldMapping {
  [cle: string]: string | undefined;
}

/** Une catégorie POI proposée à l'étape 02 (`PoiCategoryOption`). */
export interface OptionCategoriePoi {
  val: string;
  label: string;
  icone: string;
}

/** Modes de géolocalisation proposés à l'étape 03 (`GEO_MODES`, textes de React, accents compris). */
export const GEO_MODES: { val: GeoMode; title: string; desc: string }[] = [
  { val: 'gps', title: 'GPS direct', desc: 'Colonnes latitude / longitude deja presentes' },
  { val: 'address', title: 'Geocodage adresse', desc: 'Adresse → coordonnees via API BAN (gratuit)' },
  { val: 'lambert93', title: 'Lambert 93 (X, Y)', desc: 'Coordonnees projetees EPSG:2154 → WGS84' },
];

/** Champs POI cibles du mapping standard (`GENESIS_FIELDS_POI`). */
export const GENESIS_FIELDS_POI = [
  { key: 'nom', label: 'Nom', required: false },
  { key: 'adresse', label: 'Adresse', required: false },
  { key: 'ville', label: 'Ville', required: false },
  { key: 'code_postal', label: 'Code postal', required: false },
  { key: 'departement', label: 'Departement', required: false },
  { key: 'region', label: 'Region', required: false },
];

/**
 * Libellé de schéma d'un champ dans la sélection des colonnes (`fieldLabels`,
 * `ColumnSelectionStep.tsx:51-55`) ; un champ absent garde sa clé.
 */
export const LIBELLES_SCHEMA: Record<string, string> = {
  nom: 'nom', adresse: 'adresse', ville: 'ville', code_postal: 'code_postal',
  departement: 'departement', region: 'region',
  reference_panneau: 'reference', type_panneau: 'type_panneau',
};

/**
 * Repli quand la lecture des catégories ÉCHOUE au réseau ou au décodage (`page.tsx:116-125`).
 * ⚠ Défaut React recopié par parité, non corrigé : la règle du projet est « jamais de valeurs en
 * dur » — ces cinq catégories ne sont pas celles de la base (`college`, `gare`, `sport`, `autre`
 * existent, `lycee` aussi, mais pas sous ces libellés).
 */
export const CATEGORIES_REPLI: readonly OptionCategoriePoi[] = [
  { val: 'lycee', label: 'Lycee', icone: '' },
  { val: 'college', label: 'College', icone: '' },
  { val: 'gare', label: 'Gare', icone: '' },
  { val: 'sport', label: 'Sport', icone: '' },
  { val: 'autre', label: 'Autre', icone: '' },
];

/** Organisation proposée par défaut à l'import (`page.tsx:89`), recopiée par parité. */
export const ORGANISATION_DEFAUT = '00000000-0000-0000-0000-000000000001';

/** `accept` du champ fichier (`UploadStep.tsx:77`). */
export const FORMATS_ACCEPTES = '.csv,.xlsx,.geojson,.json,.txt,.tsv,.shp,.dbf,.prj,.shx';
