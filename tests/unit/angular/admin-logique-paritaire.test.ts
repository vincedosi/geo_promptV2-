/**
 * La logique de l'administration copiée dans angular/ (P6) rend la MÊME chose que sa source
 * React. Les modules copiés servent aussi l'API et ne sont pas gelés : ce test est ce qui
 * oblige la copie à suivre (feuille de route, lot 6).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as Rr from '@/lib/auth/roles';
import * as Ar from '../../../angular/src/app/features/admin/logique/roles';
import * as Rv from '@/lib/version';
import * as Av from '../../../angular/src/app/features/admin/logique/version';
import * as Rf from '@/app/admin/carreaux-import/_components/shared';
import * as Af from '../../../angular/src/app/features/admin/logique/formats';
import * as Rp from '@/app/admin/api/_lib/constants';
import * as Rs from '@/app/admin/sources/_lib/theme';
import * as As from '../../../angular/src/app/features/admin/sources/logique/constantes';
import * as Ap from '../../../angular/src/app/features/admin/api/logique/fournisseurs';
import * as Ri from '@/app/admin/import/_components/shared';
import * as Ai from '../../../angular/src/app/features/admin/import/logique/constantes';
import proj4 from 'proj4';
import * as Rsh from '@/app/admin/carreaux-import/_lib/shapefile';
import * as Ash from '../../../angular/src/app/features/admin/logique/shapefile';
import {
  carreauxEssai, fabriquerShapefile, PRJ_LAMBERT_93,
} from '../../../angular/src/app/features/admin/carreaux-import/testing/shapefile.fixture';
import type * as RtA from '@/types/admin';
import type * as AtA from '../../../angular/src/app/features/admin/logique/types/admin';
import type * as RtD from '@/types/dsp';
import type * as AtD from '../../../angular/src/app/features/admin/logique/types/dsp';
import type * as RtC from '@/types/campaign';
import type * as AtC from '../../../angular/src/app/features/admin/logique/types/campagne-import';
import type * as RtI from '@/lib/import/types';
import type * as AtI from '../../../angular/src/app/features/admin/logique/types/import-poi';
import type * as RtF from '@/lib/donnees/registre-fraicheur';
import type * as AtF from '../../../angular/src/app/features/admin/logique/types/fraicheur';

// Assignabilité mutuelle, vérifiée par `npx tsc --noEmit` à la racine (Vitest ne type-vérifie pas).
// Liste = chaque type que l'admin React importe de ces modules (grep du 2026-10-06), plus `UserRole`.
// Les CLÉS aussi (vague finale H3) : un champ OPTIONNEL ajouté d'un seul côté garde l'assignabilité
// mutuelle, mais change `keyof`.
type MemesCles<A, B> = [keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : false) : false;
type Egal<A, B> = [A] extends [B] ? ([B] extends [A] ? MemesCles<A, B> : false) : false;
const _verif: [
  Egal<RtA.HealthResponse, AtA.HealthResponse>,
  Egal<RtA.Check, AtA.Check>,
  Egal<RtA.Organization, AtA.Organization>,
  Egal<RtA.DataSource, AtA.DataSource>,
  Egal<RtA.UserRole, AtA.UserRole>,
  Egal<RtA.UserRole, Ar.UserRole>,
  Egal<RtD.DspProvider, AtD.DspProvider>,
  Egal<RtD.DspConnectionPublic, AtD.DspConnectionPublic>,
  Egal<RtD.DspApiLogRow, AtD.DspApiLogRow>,
  Egal<RtC.CampaignListItem, AtC.CampaignListItem>,
  Egal<RtC.CampaignImportEvent, AtC.CampaignImportEvent>,
  Egal<RtC.CampaignImportReport, AtC.CampaignImportReport>,
  Egal<RtI.ParseResult, AtI.ParseResult>,
  Egal<RtI.ImportProgress, AtI.ImportProgress>,
  Egal<RtI.ImportReport, AtI.ImportReport>,
  Egal<RtI.DryRunResult, AtI.DryRunResult>,
  Egal<RtI.GeocodeDetailedResult, AtI.GeocodeDetailedResult>,
  Egal<RtI.FieldMapping, AtI.FieldMapping>,
  Egal<RtI.GeoMode, AtI.GeoMode>,
  Egal<RtI.GeoConfig, AtI.GeoConfig>,
  Egal<RtF.NatureSource, AtF.NatureSource>,
  Egal<RtF.EtatFraicheur, AtF.EtatFraicheur>,
  Egal<Rsh.ShapefileBundle, Ash.ShapefileBundle>,
  Egal<Rsh.DbfField, Ash.DbfField>,
  Egal<Rsh.Feature, Ash.Feature>,
] = [
  true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true,
  true, true, true,
];
void _verif;

describe("logique de l'administration : Angular = React", () => {
  it('rôles', () => {
    expect(Ar.ROLE_LEVELS).toEqual(Rr.ROLE_LEVELS);
    expect(Ar.ROLE_LABELS).toEqual(Rr.ROLE_LABELS);
    expect(Ar.ROLES).toEqual(Rr.ROLES);
    expect(Ar.ROLES_MEMBRE).toEqual(Rr.ROLES_MEMBRE);
  });
  it('version affichée par le Health check', () => {
    expect(Av.APP_VERSION).toBe(Rv.APP_VERSION);
    expect(Av.BUILD_DATE).toBe(Rv.BUILD_DATE);
  });
  it('colonnes de schéma proposées comme champs filtres d’une source (T18)', () => {
    expect(As.SCHEMA_FILTER_COLS).toEqual(Rs.SCHEMA_FILTER_COLS);
  });
  it('import POI (T12) : modes de géolocalisation et champs du mapping standard', () => {
    expect(Ai.GEO_MODES).toEqual(Ri.GEO_MODES);
    expect(Ai.GENESIS_FIELDS_POI).toEqual(Ri.GENESIS_FIELDS_POI);
  });
  it('formats de taille et de durée', () => {
    for (const b of [0, 1, 1023, 1024, 1_048_575, 1_048_576, 5_368_709_120]) expect(Af.fmtBytes(b)).toBe(Rf.fmtBytes(b));
    for (const s of [0, 59, 60, 61, 3599, 3600, 86_400]) expect(Af.fmtTime(s)).toBe(Rf.fmtTime(s));
  });

  it('fournisseurs des Connexions API (T9) : mêmes clés, libellés, disponibilité ; logos copiés À L’OCTET (C15)', () => {
    const sansLogo = (l: readonly { logo: string }[]) => l.map(({ logo: _l, ...r }) => r);
    expect(sansLogo(Ap.PROVIDERS)).toEqual(sansLogo(Rp.PROVIDERS));
    // React : `/logos/<p>.svg` (absolu, origine de Next) ; Angular : `logos/<p>.svg` (relatif à la remote).
    Rp.PROVIDERS.forEach((r, i) => expect(`/${Ap.PROVIDERS[i].logo}`).toBe(r.logo));
    for (const p of Rp.PROVIDERS) {
      const nom = p.logo.replace(/^\//, '');
      const react = readFileSync(join(process.cwd(), 'public', nom));
      const angular = readFileSync(join(process.cwd(), 'angular', 'public', nom));
      expect(angular.equals(react), nom).toBe(true);
    }
  });
});

/** Copie d'un tableau d'octets dans un `ArrayBuffer` neuf : chaque lecture part du même état. */
const tampon = (o: Uint8Array): ArrayBuffer => o.slice().buffer;

describe('import Shapefile (T14) : `logique/shapefile.ts` = `carreaux-import/_lib/shapefile.ts`', () => {
  const { polygones, attributs } = carreauxEssai(12);
  // Un polygone à trou (deux anneaux) en plus des carreaux.
  polygones.push([
    [[652000, 6870000], [652000, 6870600], [652600, 6870600], [652600, 6870000], [652000, 6870000]],
    [[652200, 6870200], [652400, 6870200], [652400, 6870400], [652200, 6870400], [652200, 6870200]],
  ]);
  const lignes = [...attributs.lignes, { idcar_200m: 'ESSAI_LOT6_TROU', ind: null, men: 0, lcog_geo: '' }];
  const octets = fabriquerShapefile(polygones, { champs: attributs.champs, lignes });

  it('parseSHP : mêmes anneaux, et mêmes refus (code magique, type de forme)', () => {
    expect(Ash.parseSHP(tampon(octets.shp))).toEqual(Rsh.parseSHP(tampon(octets.shp)));
    expect(Ash.parseSHP(tampon(octets.shp))).toHaveLength(13);
    const fauxCode = octets.shp.slice();
    new DataView(fauxCode.buffer).setInt32(0, 1234, false);
    expect(() => Ash.parseSHP(fauxCode.buffer)).toThrow(new Error('SHP invalide (magic=1234)'));
    expect(() => Rsh.parseSHP(fauxCode.buffer)).toThrow(new Error('SHP invalide (magic=1234)'));
    const points = octets.shp.slice();
    new DataView(points.buffer).setInt32(32, 1, true);
    const message = 'Type de géométrie non supporté: 1 (seuls les Polygons sont acceptés)';
    expect(() => Ash.parseSHP(points.buffer)).toThrow(new Error(message));
    expect(() => Rsh.parseSHP(points.buffer)).toThrow(new Error(message));
  });

  it('parseDBF : mêmes champs et enregistrements (valeurs vides → null, enregistrement effacé sauté), même refus', () => {
    expect(Ash.parseDBF(tampon(octets.dbf))).toEqual(Rsh.parseDBF(tampon(octets.dbf)));
    const efface = octets.dbf.slice();
    const v = new DataView(efface.buffer);
    efface[v.getUint16(8, true) + v.getUint16(10, true)] = 0x2a; // 2e enregistrement marqué effacé
    const a = Ash.parseDBF(efface.buffer);
    expect(a).toEqual(Rsh.parseDBF(efface.buffer));
    expect(a.records).toHaveLength(12);
    expect(a.records.at(-1)).toEqual({ idcar_200m: 'ESSAI_LOT6_TROU', ind: null, men: 0, lcog_geo: null });
    expect(() => Ash.parseDBF(new ArrayBuffer(10))).toThrow(new Error('DBF invalide (trop court)'));
    expect(() => Rsh.parseDBF(new ArrayBuffer(10))).toThrow(new Error('DBF invalide (trop court)'));
  });

  it('detectCRS : .prj Lambert 93, LAEA, WGS 84, Web Mercator, 5490 ; sans .prj, par les coordonnées ; défaut', () => {
    const prjs = [
      PRJ_LAMBERT_93,
      'PROJCS["ETRS89_LAEA_Europe",GEOGCS["GCS_ETRS_1989"],PROJECTION["Lambert_Azimuthal_Equal_Area"]]',
      'PROJCS["ETRS89-extended / LAEA Europe",AUTHORITY["EPSG","3035"]]',
      'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984"],AUTHORITY["EPSG","4326"]]',
      'PROJCS["WGS 84 / Pseudo-Mercator",AUTHORITY["EPSG","3857"]]',
      'PROJCS["RGAF09 / UTM zone 20N",AUTHORITY["EPSG","5490"]]',
      'PROJCS["RGF93 v1 / Lambert-93"]',
      'PROJCS["Inconnu"]',
    ];
    const coordonnees: (number[] | null)[] = [
      null, [3760000, 2890000], [652000, 6862000], [2.35, 48.85], [12000000, 12000000],
    ];
    for (const prj of [...prjs, null]) {
      for (const c of coordonnees) expect(Ash.detectCRS(prj, c), `${prj} / ${c}`).toBe(Rsh.detectCRS(prj, c));
    }
    expect(Ash.detectCRS(PRJ_LAMBERT_93, null)).toBe('EPSG:2154');
    expect(Ash.detectCRS(null, [3760000, 2890000])).toBe('EPSG:3035');
    expect(Ash.detectCRS(null, null)).toBe('EPSG:3035');
  });

  it('reprojectCoords : même `proj4` des deux côtés, mêmes définitions (EPSG:2154, EPSG:3035), 4326 rendu tel quel', () => {
    Ash.enregistrerProjections(proj4);
    for (const nom of Object.keys(Ash.DEFINITIONS_PROJECTIONS)) expect(proj4.defs(nom)).toBeDefined();
    const anneau = polygones[0][0];
    for (const crs of ['EPSG:2154', 'EPSG:3035', 'EPSG:4326']) {
      expect(Ash.reprojectCoords(anneau, crs, proj4)).toEqual(Rsh.reprojectCoords(anneau, crs));
    }
    const [lng, lat] = Ash.reprojectCoords(anneau, 'EPSG:2154', proj4)[0];
    expect(lng).toBeCloseTo(2.33, 1);
    expect(lat).toBeCloseTo(48.86, 1);
    expect(Ash.reprojectCoords(anneau, 'EPSG:4326', proj4)).toBe(anneau);
  });

  it('polygonToEWKT et detectIdColumn', () => {
    for (const p of polygones) expect(Ash.polygonToEWKT(p)).toBe(Rsh.polygonToEWKT(p));
    expect(Ash.polygonToEWKT([[[1.5, 2], [3, 4]]])).toBe('SRID=4326;POLYGON((1.5 2,3 4))');
    const champs = (noms: string[]) => noms.map((name) => ({ name, type: 'C', length: 10, decimal: 0 }));
    for (const noms of [
      ['IDINSPIRE', 'Idcar_200m'], ['x', 'IdCar_1km'], ['idcar', 'id'], ['ID_CAR'], ['Id', 'nom'], ['nom', 'ind'], [],
    ]) {
      expect(Ash.detectIdColumn(champs(noms))).toBe(Rsh.detectIdColumn(champs(noms)));
    }
  });
});
