/**
 * Flux NDJSON de `POST /api/iris-crawler/manual-import`, rejoué par les specs (régime C12 c : l'import
 * RÉÉCRIT des colonnes d'`iris` par `update_iris_core_batch`, il ne se lance jamais pour de vrai).
 *
 * COPIE À L'OCTET de `tests/fixtures/admin/iris-manual-import.ndjson` — le fichier que la preuve
 * navigateur sert aux DEUX écrans (React et Angular) par interception — verrouillée par
 * `tests/unit/angular/admin-iris-fixture.test.ts` (ce dossier ne peut rien importer hors d'`angular/`).
 *
 * Écrit d'après la route (`app/api/iris-crawler/manual-import/route.ts`) : `send(type, message, extra)`
 * sérialise `{ type, message, ...extra }` ; `status` l.100 et l.139-143, `progress` l.185-189
 * (`percent`, `totalInserted`, `totalErrors`), `done` l.233-236. Un fichier de 1 200 lignes, lots de
 * 500 (`BATCH_SIZE`) : 3 lots, 42 %, 83 %, 100 % (`Math.round`).
 */
export const FLUX_IMPORT_IRIS = `{"type":"status","message":"1200 lignes chargées depuis BASE_TD_FILO_IRIS_2021_DEC.csv. Préparation…"}
{"type":"status","message":"1200 lignes préparées (5 colonnes core)…"}
{"type":"progress","message":"Batch 1/3 — 42%","percent":42,"totalInserted":500,"totalErrors":0}
{"type":"progress","message":"Batch 2/3 — 83%","percent":83,"totalInserted":1000,"totalErrors":0}
{"type":"progress","message":"Batch 3/3 — 100%","percent":100,"totalInserted":1200,"totalErrors":0}
{"type":"done","message":"✓ 1200 IRIS mis à jour","totalInserted":1200,"totalErrors":0,"status":"success","historyId":"00000000-0000-4000-8000-000000000015","columns":["rev_median","rev_d1","rev_d9","indice_gini","taux_pauvrete"]}
`;

/**
 * Réponse de `POST /api/iris-crawler/manual-upload` pour `tests/fixtures/admin/iris-essai.csv` (5 IRIS),
 * telle que la route la rend (l.152-161) et que `autoMap` la calcule : `LIBIRIS` ignorée (méta géo),
 * cinq colonnes Filosofi vers des colonnes core, aucune en JSONB.
 */
export const DEPOT_IRIS_ESSAI = {
  sessionId: '3f2b7c1e-15a0-4c6b-9d1e-000000000015',
  filename: 'iris-essai.csv',
  headers: ['IRIS', 'LIBIRIS', 'DEC_MED21', 'DEC_D121', 'DEC_D921', 'DEC_GI21', 'DISP_TP6021'],
  totalRows: 5,
  previewRows: [] as Record<string, string>[],
  autoMapResult: {
    irisKeyCol: 'IRIS',
    mapping: {
      LIBIRIS: 'ignore',
      DEC_MED21: 'rev_median',
      DEC_D121: 'rev_d1',
      DEC_D921: 'rev_d9',
      DEC_GI21: 'indice_gini',
      DISP_TP6021: 'taux_pauvrete',
    } as Record<string, string>,
    coreCols: ['DEC_MED21', 'DEC_D121', 'DEC_D921', 'DEC_GI21', 'DISP_TP6021'],
    jsonbCols: [] as string[],
  },
  detectedSeparator: ';',
  parseWarnings: [] as string[],
};
