/**
 * Le Shapefile jetable de l'import de carreaux (lot 6, T14) : les fichiers versionnés
 * `tests/fixtures/admin/carreaux-essai.{shp,shx,dbf,prj}` — ceux qu'on dépose au navigateur dans les deux
 * écrans — sont la sortie EXACTE de `fabriquerShapefile`, la fabrique dont se servent les specs Angular.
 *
 * Les specs ne peuvent rien lire hors d'`angular/` (`isolement.test.ts`) : elles fabriquent le bundle en
 * mémoire. Sans ce test, la fabrique et les fichiers dériveraient, et les specs prouveraient une lecture sur
 * des octets que le navigateur ne voit jamais. La lecture REACT des fichiers est vérifiée au passage.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as R from '@/app/admin/carreaux-import/_lib/shapefile';
import { bundleEssai } from '../../../angular/src/app/features/admin/carreaux-import/testing/shapefile.fixture';

const RACINE = path.resolve(__dirname, '../../..');
const lire = (ext: string) => readFileSync(path.join(RACINE, `tests/fixtures/admin/carreaux-essai.${ext}`));
const tampon = (b: Buffer): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

describe('Shapefile jetable de l’import de carreaux (lot 6, T14)', () => {
  it('les quatre fichiers versionnés sont, à l’octet, la sortie de `fabriquerShapefile` (50 carreaux)', () => {
    const b = bundleEssai(50);
    expect(Buffer.from(b.shp).equals(lire('shp'))).toBe(true);
    expect(Buffer.from(b.shx).equals(lire('shx'))).toBe(true);
    expect(Buffer.from(b.dbf).equals(lire('dbf'))).toBe(true);
    expect(lire('prj').toString('latin1')).toBe(b.prj);
  });

  it('React lit le bundle : 50 polygones et 50 enregistrements, Lambert 93, colonne d’identité `idcar_200m`', () => {
    const geometries = R.parseSHP(tampon(lire('shp')));
    const { fields, records } = R.parseDBF(tampon(lire('dbf')));
    expect(geometries).toHaveLength(50);
    expect(records).toHaveLength(50);
    expect(fields.map((f) => [f.name, f.type])).toEqual([['idcar_200m', 'C'], ['ind', 'N'], ['men', 'N'], ['lcog_geo', 'C']]);
    expect(records[0]).toEqual({ idcar_200m: 'ESSAI_LOT6_0001', ind: 10, men: 4, lcog_geo: '75056' });
    expect(R.detectCRS(lire('prj').toString('latin1'), geometries[0][0][0])).toBe('EPSG:2154');
    expect(R.detectIdColumn(fields)).toBe('idcar_200m');
  });
});
