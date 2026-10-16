/**
 * Le script `scripts/ooh/importer-plan.ts` lancé pour de vrai (preflight P5) : quand la BAN est en panne, il échoue
 * en le disant AVANT l'étape d'écriture — aucun appel à la base, aucun rapport. `fetch` est remplacé dans le processus
 * enfant par `_ban-en-panne.mjs` : la BAN y répond 503, tout autre appel (la base comprise) est refusé et consigné.
 * Classeur SYNTHÉTIQUE, écrit dans un dossier temporaire.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const RACINE = process.cwd();
const dossier = mkdtempSync(join(tmpdir(), 'ooh-cli-'));
const plan = join(dossier, 'plan-essai.xlsx');

beforeAll(async () => {
  const wb = new ExcelJS.Workbook();
  const hyp = wb.addWorksheet('HYP1');
  hyp.addRow([null, 'ESSAI - 20/09 - 02/10']);
  hyp.addRow([null, 'AFFICHEURS', 'RESEAUX', "NBRE D'ECRANS", 'FORMAT', 'LOGS', 'DEPART', 'DUREE', 'RANG OPTION', 'TARIF BRUT', 'TARIF NET ESTIME', 'FRAIS ESTIMES', 'HONO NET+FRAIS', 'TOTAL TTCHI']);
  hyp.addRow([null, 'METROPOLE']);
  hyp.addRow([null, 'STRIDE', 'DOOH BORNES \n1 établissements', 1, 'DOOH', 10, new Date(Date.UTC(2026, 8, 20)), '7 jours', '2nd OPTION', 1, 1, 1, 1, 1]);
  const campus = wb.addWorksheet('LISTING CAMPUS');
  campus.addRow(['Etablissement', 'Groupement', 'Type', 'Adresse', 'CP', 'Ville', 'Zone', 'Ecrans', 'Taille écrans', 'Contacts par semaine', 'Contacts 18-25 par semaine']);
  campus.addRow(['Mairie essai', '0', 'Campus', '1 place de la Mairie', '45000', 'Orléans', 'Centre', 1, 10, 100, 90]);
  await wb.xlsx.writeFile(plan);
});

afterAll(() => rmSync(dossier, { recursive: true, force: true }));

describe('scripts/ooh/importer-plan.ts — BAN en panne', () => {
  it('échoue avant l écriture, sans appeler la base ni écrire de rapport', () => {
    const r = spawnSync(process.execPath, [
      '--import', 'tsx', '--import', pathToFileURL(join(RACINE, 'tests/unit/ooh/_ban-en-panne.mjs')).href,
      'scripts/ooh/importer-plan.ts',
      '--plan', plan, '--espace', 'essai-inexistant', '--campagne', 'Essai panne BAN', '--cle', 'essai-panne-ban', '--rapport', dossier,
    ], { cwd: RACINE, encoding: 'utf8', timeout: 90_000 });

    expect(r.error).toBeUndefined();
    expect(r.stdout).toContain('4/6 Géolocalisation');
    expect(r.stderr).toContain("BAN indisponible : rien n'est écrit.");
    expect(r.status).toBe(1);
    expect(r.stdout).not.toContain('5/6');
    expect(r.stderr).not.toContain('APPEL-INTERDIT');
    expect(readdirSync(dossier).filter((f) => f.startsWith('rapport-ooh-'))).toEqual([]);
  }, 120_000);
});
