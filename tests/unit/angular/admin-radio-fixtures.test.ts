/**
 * Les flux NDJSON rejoués par les specs Angular de l'écran Radio (lot 6, T16) sont les MÊMES que ceux que
 * la preuve navigateur sert aux deux écrans, React et Angular, par interception (régime C12 c : les
 * trois imports écrivent ou effacent des données radio irremplaçables, ils ne se lancent jamais).
 *
 * Les specs Angular ne peuvent rien importer hors d'`angular/` (`isolement.test.ts`) : elles en gardent
 * une copie en TypeScript. Sans ce test, la copie et les fichiers dériveraient, et les specs prouveraient
 * un rendu sur un flux que le navigateur ne voit jamais.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  FLUX_RADIO_ANFR, FLUX_RADIO_ARCOM, FLUX_RADIO_ODS,
} from '../../../angular/src/app/features/admin/radio/testing/radio-flux.fixture';

const RACINE = path.resolve(__dirname, '../../..');
const lire = (nom: string) => readFileSync(path.join(RACINE, 'tests/fixtures/admin', nom), 'utf8').replace(/\r\n/g, '\n');

const FLUX = [
  ['radio-anfr.ndjson', FLUX_RADIO_ANFR, 'FINALIZE'],
  ['radio-arcom.ndjson', FLUX_RADIO_ARCOM, 'COMPLETE'],
  ['radio-ods.ndjson', FLUX_RADIO_ODS, 'FINALIZE'],
] as const;

interface Evenement {
  type: string;
  message: string;
  level?: string;
  phase?: string;
  raw_message?: string;
  timestamp?: string;
  percent?: number;
}

const ICONES: Record<string, string> = { debug: '·', info: '▸', warn: '⚠', error: '✗', success: '✓' };

describe('fixtures des flux d’import radio (lot 6, T16)', () => {
  it.each(FLUX)('%s : la copie TypeScript des specs Angular est identique à l’octet au fichier NDJSON', (nom, copie) => {
    expect(copie).toBe(lire(nom));
  });

  it.each(FLUX)('%s : chaque ligne a la forme d’`ImportLogger.log` ou d’un `progress`, et le flux finit par le `done` de %s', (_n, flux, derniere) => {
    const evenements = flux.trim().split('\n').map((l) => JSON.parse(l) as Evenement);
    for (const e of evenements) {
      expect(typeof e.message).toBe('string');
      if (e.type === 'progress') {
        // `importAnfrData` : ni `level` ni `phase`, un `percent` entier.
        expect(e.level).toBeUndefined();
        expect(Number.isInteger(e.percent)).toBe(true);
        continue;
      }
      expect(['debug', 'info', 'warn', 'error', 'success']).toContain(e.level);
      expect(e.type).toBe(e.level === 'error' ? 'error' : e.level === 'success' ? 'done' : 'status');
      // `message` = `[HH:MM:SS] [LEVEL  ] [PHASE       ] <icône> raw_message`, l'heure tirée de `timestamp`.
      expect(e.message).toBe(
        `[${e.timestamp!.slice(11, 19)}] [${e.level!.toUpperCase().padEnd(7)}] [${e.phase!.padEnd(12)}] ${ICONES[e.level!]} ${e.raw_message}`,
      );
    }
    expect(evenements.at(-1)).toMatchObject({ type: 'done', phase: derniere });
  });
});
