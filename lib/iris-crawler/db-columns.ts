// Colonnes écrivables de la table public.iris (hors géométrie/clés)
export interface IrisDbColumn {
  name: string;
  label: string;
  type: 'integer' | 'float';
}

export const IRIS_DB_COLUMNS: IrisDbColumn[] = [
  { name: 'population',      label: 'Population totale',          type: 'integer' },
  { name: 'pop_0_14',        label: 'Pop 0–14 ans',               type: 'integer' },
  { name: 'pop_15_29',       label: 'Pop 15–29 ans',              type: 'integer' },
  { name: 'pop_30_44',       label: 'Pop 30–44 ans',              type: 'integer' },
  { name: 'pop_45_59',       label: 'Pop 45–59 ans',              type: 'integer' },
  { name: 'pop_60_74',       label: 'Pop 60–74 ans',              type: 'integer' },
  { name: 'pop_75_plus',     label: 'Pop 75 ans+',                type: 'integer' },
  { name: 'nb_menages',      label: 'Nombre de ménages',          type: 'integer' },
  { name: 'rev_median',      label: 'Revenu médian (€)',          type: 'float'   },
  { name: 'taux_chomage',    label: 'Taux de chômage (%)',        type: 'float'   },
  { name: 'taux_proprio',    label: 'Taux de propriétaires (%)',  type: 'float'   },
  { name: 'nb_diplome_aucun',label: 'Sans diplôme',               type: 'integer' },
  { name: 'nb_diplome_bac',  label: 'Bac ou équivalent',          type: 'integer' },
  { name: 'nb_diplome_sup',  label: 'Diplôme supérieur',          type: 'integer' },
  { name: 'taux_diplome_sup',label: 'Taux diplôme sup (%)',       type: 'float'   },
  { name: 'nb_csp_cadre',    label: 'CSP — Cadres',               type: 'integer' },
  { name: 'nb_csp_employe',  label: 'CSP — Employés',             type: 'integer' },
  { name: 'nb_csp_ouvrier',  label: 'CSP — Ouvriers',             type: 'integer' },
];

export const IRIS_DB_COLUMN_NAMES = new Set(IRIS_DB_COLUMNS.map(c => c.name));
