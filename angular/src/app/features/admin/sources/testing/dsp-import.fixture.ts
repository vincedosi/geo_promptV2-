/**
 * Flux SSE de `POST /api/admin/campaigns/import` pour `tests/fixtures/admin/campagne-essai.csv` (20 lignes,
 * 3 codes postaux, campagne « [ESSAI lot 6] campagne »), rejoué par les specs de l'onglet DSP (lot 6, T20).
 *
 * COPIE À L'OCTET de `tests/fixtures/admin/dsp-import.sse`, verrouillée par
 * `tests/unit/angular/admin-dsp-fixture.test.ts` (ce dossier ne peut rien importer hors d'`angular/`).
 *
 * Écrit d'après la route (`app/api/admin/campaigns/import/route.ts`) : `send` sérialise `data: <json>` suivi
 * d'une ligne vide ; `parsing` l.170, `progress` 0 / N l.199-204, `progress` d'insertion l.382-389 (20 lignes,
 * lots de 50 : un seul, émis parce que `inserted === dedupedTotal`), `matching` l.402-419, `rollups` l.423,
 * `complete` l.438-449. Aucune ligne en double (clés date|CP|ville|média distinctes) : pas d'événement
 * d'agrégation. L'identifiant de campagne est fictif ; le reste est ce que l'import réel a rendu (rapport T20).
 */
export const FLUX_IMPORT_DSP = `data: {"type":"parsing","message":"Parsing campagne-essai.csv…"}

data: {"type":"progress","processed":0,"total":20,"message":"20 lignes détectées, 1 pays"}

data: {"type":"progress","processed":20,"total":20,"message":"20/20 lignes insérées"}

data: {"type":"matching","matched":0,"total_france":20,"message":"Matching IRIS pour 20 lignes France…"}

data: {"type":"matching","matched":20,"total_france":20,"message":"20/20 lignes matchées IRIS"}

data: {"type":"rollups","message":"Agrégats de suivi…"}

data: {"type":"complete","report":{"campaign_id":"00000000-0000-4000-8000-0000000000e1","campaign_name":"[ESSAI lot 6] campagne","total_rows":20,"countries":["France"],"total_france":20,"matched_iris":20,"pct_matched":100}}

`;
