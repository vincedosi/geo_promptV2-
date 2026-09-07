/**
 * Contrat des parsers de bundle Shapefile
 * (`app/admin/carreaux-import/_lib/shapefile.ts`), consommés par la page
 * d'import des carreaux INSEE.
 *
 * Ces fonctions lisent du binaire octet par octet : un décalage d'offset ne
 * lève aucune erreur, il produit des coordonnées ou des attributs faux qui
 * partent tels quels en base. Les tests fixent donc la lecture bit à bit —
 * en-tête, découpage des anneaux, types de champs, enregistrements supprimés.
 *
 * Les fixtures sont construites ici plutôt que stockées en binaire opaque :
 * un test de parser doit montrer les octets qu'il donne à lire.
 */
import { describe, expect, it } from 'vitest';
import {
  detectCRS,
  detectIdColumn,
  parseDBF,
  parseSHP,
  polygonToEWKT,
  reprojectCoords,
  type DbfField,
} from '@/app/admin/carreaux-import/_lib/shapefile';

// ─── Constructeurs de fixtures ───────────────────────────────────────────────

/** Un anneau de polygone : liste de points [x, y]. */
type Ring = number[][];

/**
 * Écrit un .shp minimal mais conforme : en-tête de 100 octets puis un
 * enregistrement par géométrie. `shapeType` permet de produire du PolygonZ /
 * PolygonM, ou un type non supporté pour tester le rejet.
 */
function buildSHP(shapes: Ring[][], shapeType = 5): ArrayBuffer {
  const bodies = shapes.map((rings) => {
    const points = rings.flat();
    const size = 4 + 32 + 4 + 4 + rings.length * 4 + points.length * 16;
    const buf = new ArrayBuffer(size);
    const v = new DataView(buf);
    v.setInt32(0, shapeType, true);
    // bbox — non relu par le parser, laissé à zéro
    v.setInt32(36, rings.length, true);
    v.setInt32(40, points.length, true);
    let partStart = 0;
    rings.forEach((ring, i) => {
      v.setInt32(44 + i * 4, partStart, true);
      partStart += ring.length;
    });
    const pointsOffset = 44 + rings.length * 4;
    points.forEach(([x, y], i) => {
      v.setFloat64(pointsOffset + i * 16, x, true);
      v.setFloat64(pointsOffset + i * 16 + 8, y, true);
    });
    return buf;
  });

  const total = 100 + bodies.reduce((n, b) => n + 8 + b.byteLength, 0);
  const out = new ArrayBuffer(total);
  const view = new DataView(out);
  const bytes = new Uint8Array(out);

  view.setInt32(0, 9994, false); // magic
  view.setInt32(24, total / 2, false); // longueur en mots de 16 bits
  view.setInt32(28, 1000, true); // version
  view.setInt32(32, shapeType, true);

  let offset = 100;
  bodies.forEach((body, i) => {
    view.setInt32(offset, i + 1, false); // numéro d'enregistrement
    view.setInt32(offset + 4, body.byteLength / 2, false); // longueur du contenu
    bytes.set(new Uint8Array(body), offset + 8);
    offset += 8 + body.byteLength;
  });

  return out;
}

/** Un enregistrement .shp de type « null shape » (aucune géométrie). */
function buildNullShapeSHP(): ArrayBuffer {
  const out = new ArrayBuffer(100 + 8 + 4);
  const view = new DataView(out);
  view.setInt32(0, 9994, false);
  view.setInt32(24, out.byteLength / 2, false);
  view.setInt32(28, 1000, true);
  view.setInt32(32, 5, true); // le fichier reste déclaré Polygon
  view.setInt32(100, 1, false);
  view.setInt32(104, 2, false); // 4 octets = 2 mots
  view.setInt32(108, 0, true); // type 0 = null shape
  return out;
}

interface FieldSpec {
  name: string;
  type: string;
  length: number;
  decimal?: number;
}

/**
 * Écrit un .dbf : en-tête, descripteurs de champs, puis un enregistrement par
 * ligne. Une ligne passée à `null` est marquée supprimée (drapeau 0x2a).
 */
function buildDBF(fields: FieldSpec[], rows: (string[] | null)[]): ArrayBuffer {
  const headerSize = 32 + 32 * fields.length + 1;
  const recordSize = 1 + fields.reduce((n, f) => n + f.length, 0);
  const out = new ArrayBuffer(headerSize + rows.length * recordSize + 1);
  const view = new DataView(out);
  const bytes = new Uint8Array(out);

  bytes[0] = 3; // dBase III
  bytes[1] = 26; bytes[2] = 9; bytes[3] = 7; // date de dernière maj
  view.setUint32(4, rows.length, true);
  view.setUint16(8, headerSize, true);
  view.setUint16(10, recordSize, true);

  fields.forEach((f, i) => {
    const off = 32 + i * 32;
    const name = Buffer.from(f.name, 'latin1').subarray(0, 11);
    bytes.set(name, off);
    bytes[off + 11] = f.type.charCodeAt(0);
    bytes[off + 16] = f.length;
    bytes[off + 17] = f.decimal ?? 0;
  });
  bytes[32 + 32 * fields.length] = 0x0d; // terminateur de descripteurs

  let off = headerSize;
  for (const row of rows) {
    bytes[off] = row === null ? 0x2a : 0x20;
    off += 1;
    fields.forEach((f, i) => {
      const raw = row === null ? '' : row[i] ?? '';
      const padded = Buffer.alloc(f.length, 0x20);
      Buffer.from(raw, 'latin1').copy(padded, 0, 0, Math.min(f.length, raw.length));
      bytes.set(padded, off);
      off += f.length;
    });
  }
  bytes[off] = 0x1a; // EOF

  return out;
}

/** Carré fermé de 0.01° de côté, sens horaire, comme en sortie de QGIS. */
const SQUARE: Ring = [
  [2.30, 48.86],
  [2.31, 48.86],
  [2.31, 48.87],
  [2.30, 48.87],
  [2.30, 48.86],
];

// ─── parseSHP ────────────────────────────────────────────────────────────────

describe('parseSHP', () => {
  it('lit un polygone à un seul anneau', () => {
    const geometries = parseSHP(buildSHP([[SQUARE]]));

    expect(geometries).toHaveLength(1);
    expect(geometries[0]).toHaveLength(1);
    expect(geometries[0][0]).toEqual(SQUARE);
  });

  it('lit tous les enregistrements du fichier', () => {
    const other: Ring = [[4.84, 45.76], [4.85, 45.76], [4.85, 45.77], [4.84, 45.76]];
    const geometries = parseSHP(buildSHP([[SQUARE], [other]]));

    expect(geometries).toHaveLength(2);
    expect(geometries[0][0]).toEqual(SQUARE);
    expect(geometries[1][0]).toEqual(other);
  });

  it('découpe les anneaux aux indices de parts — cas du polygone à trou', () => {
    const hole: Ring = [
      [2.303, 48.863],
      [2.307, 48.863],
      [2.307, 48.867],
      [2.303, 48.863],
    ];
    const geometries = parseSHP(buildSHP([[SQUARE, hole]]));

    expect(geometries[0]).toHaveLength(2);
    expect(geometries[0][0]).toEqual(SQUARE);
    expect(geometries[0][1]).toEqual(hole);
  });

  it.each([
    ['PolygonZ', 15],
    ['PolygonM', 25],
  ])('accepte le type %s', (_label, shapeType) => {
    const geometries = parseSHP(buildSHP([[SQUARE]], shapeType));

    expect(geometries[0][0]).toEqual(SQUARE);
  });

  it('pousse une géométrie vide pour un null shape', () => {
    expect(parseSHP(buildNullShapeSHP())).toEqual([[]]);
  });

  it('refuse un fichier dont le magic number n\'est pas 9994', () => {
    const buf = buildSHP([[SQUARE]]);
    new DataView(buf).setInt32(0, 1234, false);

    expect(() => parseSHP(buf)).toThrow(/SHP invalide \(magic=1234\)/);
  });

  it('refuse un type de géométrie autre que Polygon', () => {
    // 1 = Point : le parser ne sait produire que des polygones
    expect(() => parseSHP(buildSHP([[SQUARE]], 1)))
      .toThrow(/Type de géométrie non supporté: 1/);
  });
});

// ─── parseDBF ────────────────────────────────────────────────────────────────

describe('parseDBF', () => {
  const FIELDS: FieldSpec[] = [
    { name: 'idcar_200m', type: 'C', length: 30 },
    { name: 'ind', type: 'N', length: 10 },
  ];

  it('lit les descripteurs de champs', () => {
    const { fields } = parseDBF(buildDBF(FIELDS, [['CRS3035RES200mN2870600E3770200', '150']]));

    expect(fields).toEqual([
      { name: 'idcar_200m', type: 'C', length: 30, decimal: 0 },
      { name: 'ind', type: 'N', length: 10, decimal: 0 },
    ]);
  });

  it('lit les enregistrements en typant les colonnes numériques', () => {
    const { records } = parseDBF(buildDBF(FIELDS, [
      ['CRS3035RES200mN2870600E3770200', '150'],
      ['CRS3035RES200mN2860000E3760000', '87'],
    ]));

    expect(records).toEqual([
      { idcar_200m: 'CRS3035RES200mN2870600E3770200', ind: 150 },
      { idcar_200m: 'CRS3035RES200mN2860000E3760000', ind: 87 },
    ]);
  });

  it('trim les valeurs — le padding DBF est de l\'espace, pas de la donnée', () => {
    const { records } = parseDBF(buildDBF(
      [{ name: 'code', type: 'C', length: 12 }],
      [['  75002   ']],
    ));

    expect(records[0].code).toBe('75002');
  });

  it('rend null sur une valeur vide ou marquée absente', () => {
    const { records } = parseDBF(buildDBF(
      [{ name: 'a', type: 'C', length: 6 }, { name: 'b', type: 'N', length: 6 }],
      [['', '*']],
    ));

    expect(records[0]).toEqual({ a: null, b: null });
  });

  it('accepte la virgule décimale des exports français', () => {
    const { records } = parseDBF(buildDBF(
      [{ name: 'men_surf', type: 'N', length: 10, decimal: 2 }],
      [['1234,56']],
    ));

    expect(records[0].men_surf).toBe(1234.56);
  });

  it('rend null plutôt que NaN sur un numérique illisible', () => {
    const { records } = parseDBF(buildDBF(
      [{ name: 'ind', type: 'N', length: 8 }],
      [['n/a']],
    ));

    expect(records[0].ind).toBeNull();
  });

  it('ignore les enregistrements marqués supprimés', () => {
    const { records } = parseDBF(buildDBF(FIELDS, [
      ['CRS3035RES200mN2870600E3770200', '150'],
      null,
      ['CRS3035RES200mN2860000E3760000', '87'],
    ]));

    expect(records).toHaveLength(2);
    expect(records.map((r) => r.ind)).toEqual([150, 87]);
  });

  it('décode les accents en latin-1, encodage des exports INSEE', () => {
    const { records } = parseDBF(buildDBF(
      [{ name: 'commune', type: 'C', length: 20 }],
      [['Vitré']],
    ));

    expect(records[0].commune).toBe('Vitré');
  });

  it('refuse un fichier trop court pour porter un en-tête', () => {
    expect(() => parseDBF(new ArrayBuffer(16))).toThrow(/DBF invalide \(trop court\)/);
  });
});

// ─── detectCRS ───────────────────────────────────────────────────────────────

describe('detectCRS', () => {
  it.each([
    ['LAEA européen', 'PROJCS["ETRS89_LAEA_Europe",PROJECTION["Lambert_Azimuthal_Equal_Area"]]', 'EPSG:3035'],
    ['RGF93', 'PROJCS["RGF93_Lambert_93",GEOGCS["GCS_RGF_1993"]]', 'EPSG:2154'],
    ['WGS 84 au format OGC', 'GEOGCS["WGS 84",DATUM["WGS_1984"],AUTHORITY["EPSG","4326"]]', 'EPSG:4326'],
    ['Web Mercator', 'PROJCS["WGS_1984_Web_Mercator_Auxiliary_Sphere",AUTHORITY["EPSG","3857"]]', 'EPSG:3857'],
    ['Guadeloupe', 'PROJCS["RGAF09_UTM_20N",AUTHORITY["EPSG","5490"]]', 'EPSG:5490'],
  ])('reconnaît %s dans le .prj', (_label, prj, expected) => {
    expect(detectCRS(prj, null)).toBe(expected);
  });

  /**
   * Angle mort connu : la graphie ESRI du WGS84, celle que QGIS et ArcGIS
   * écrivent par défaut, est `GCS_WGS_1984` — ni « WGS 84 », ni « WGS84 »,
   * ni « 4326 ». Aucun motif du .prj ne matche, la fonction tombe dans la
   * branche suivante. Sans coordonnées elle rend donc le défaut Filosofi.
   */
  it('ne reconnaît pas la graphie ESRI du WGS84 dans le .prj seul', () => {
    const esri = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]]]';

    expect(detectCRS(esri, null)).toBe('EPSG:3035');
  });

  /**
   * En pratique le trou ci-dessus ne casse rien : un fichier réellement en
   * WGS84 porte des degrés, et l'heuristique sur les coordonnées rattrape.
   * Ce test garde la garantie explicite — si l'ordre des deux branches
   * changeait, l'import partirait en reprojection LAEA sur des degrés.
   */
  it('rattrape la graphie ESRI par les coordonnées en degrés', () => {
    const esri = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]]]';

    expect(detectCRS(esri, [2.35, 48.85])).toBe('EPSG:4326');
  });

  it('retombe sur les coordonnées quand il n\'y a pas de .prj', () => {
    expect(detectCRS(null, [3770200, 2870600])).toBe('EPSG:3035'); // LAEA
    expect(detectCRS(null, [652000, 6862000])).toBe('EPSG:2154'); // Lambert 93
    expect(detectCRS(null, [2.35, 48.85])).toBe('EPSG:4326'); // degrés
  });

  it('retombe sur EPSG:3035, projection des carreaux Filosofi, faute de mieux', () => {
    expect(detectCRS(null, null)).toBe('EPSG:3035');
    expect(detectCRS('PROJCS["Projection_inconnue"]', [9e9, 9e9])).toBe('EPSG:3035');
  });
});

// ─── reprojectCoords ─────────────────────────────────────────────────────────

describe('reprojectCoords', () => {
  it('ne touche pas un anneau déjà en WGS84', () => {
    expect(reprojectCoords(SQUARE, 'EPSG:4326')).toBe(SQUARE);
  });

  it('reprojette du Lambert 93 vers WGS84', () => {
    // 652000 / 6862000 tombe sur Paris
    const [[lng, lat]] = reprojectCoords([[652000, 6862000]], 'EPSG:2154');

    expect(lng).toBeCloseTo(2.35, 1);
    expect(lat).toBeCloseTo(48.85, 1);
  });

  it('reprojette du LAEA européen vers WGS84', () => {
    // 3760000 / 2890000 tombe sur la région parisienne
    const [[lng, lat]] = reprojectCoords([[3760000, 2890000]], 'EPSG:3035');

    expect(lng).toBeGreaterThan(1.5);
    expect(lng).toBeLessThan(3.5);
    expect(lat).toBeGreaterThan(48);
    expect(lat).toBeLessThan(50);
  });

  it('reprojette tous les points de l\'anneau', () => {
    const ring = [[652000, 6862000], [653000, 6862000], [653000, 6863000]];

    expect(reprojectCoords(ring, 'EPSG:2154')).toHaveLength(3);
  });
});

// ─── polygonToEWKT ───────────────────────────────────────────────────────────

describe('polygonToEWKT', () => {
  it('écrit un polygone simple en EWKT SRID 4326', () => {
    expect(polygonToEWKT([[[2.3, 48.8], [2.4, 48.8], [2.4, 48.9], [2.3, 48.8]]]))
      .toBe('SRID=4326;POLYGON((2.3 48.8,2.4 48.8,2.4 48.9,2.3 48.8))');
  });

  it('écrit les anneaux intérieurs à la suite', () => {
    const wkt = polygonToEWKT([
      [[0, 0], [4, 0], [4, 4], [0, 0]],
      [[1, 1], [2, 1], [2, 2], [1, 1]],
    ]);

    expect(wkt).toBe('SRID=4326;POLYGON((0 0,4 0,4 4,0 0),(1 1,2 1,2 2,1 1))');
  });
});

// ─── detectIdColumn ──────────────────────────────────────────────────────────

describe('detectIdColumn', () => {
  const field = (name: string): DbfField => ({ name, type: 'C', length: 30, decimal: 0 });

  it('reconnaît les identifiants de carreaux INSEE', () => {
    expect(detectIdColumn([field('ind'), field('idcar_200m')])).toBe('idcar_200m');
    expect(detectIdColumn([field('idcar_1km'), field('men')])).toBe('idcar_1km');
  });

  it('préfère idInspire aux autres candidats, quel que soit l\'ordre des champs', () => {
    expect(detectIdColumn([field('idcar_200m'), field('idInspire')])).toBe('idInspire');
  });

  it('compare sans tenir compte de la casse mais rend le nom d\'origine', () => {
    expect(detectIdColumn([field('IdCar_200m')])).toBe('IdCar_200m');
  });

  it('rend null quand aucune colonne ne fait un identifiant', () => {
    expect(detectIdColumn([field('ind'), field('men')])).toBeNull();
  });
});
