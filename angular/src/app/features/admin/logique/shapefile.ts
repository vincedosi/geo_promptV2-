/**
 * Lecture d'un bundle Shapefile dans le navigateur — copie de `app/admin/carreaux-import/_lib/shapefile.ts`
 * (lot 6, T14, gel P5) ; parité : `tests/unit/angular/admin-logique-paritaire.test.ts`.
 *
 * Le .shp donne les géométries (polygones seulement), le .dbf les attributs, le .prj la projection. Tout est
 * lu en mémoire dans l'onglet : aucun fichier ne transite par le serveur avant la validation du mapping.
 *
 * Un seul écart à la source, voulu (arbitrage C10) : `proj4` n'est PAS importé ici. React l'importe en tête
 * de module et enregistre ses définitions au chargement ; ce module-ci reste PUR et reçoit `proj4` en
 * paramètre (`reprojectCoords(ring, crs, proj4)`), ce qui permet à l'écran de le charger par `import()`
 * DYNAMIQUE au premier fichier lu, hors du paquet initial. Les définitions EPSG:3035 / EPSG:2154 sont les
 * mêmes chaînes, enregistrées par `enregistrerProjections(proj4)` après ce chargement.
 */

export interface ShapefileBundle {
  shp: ArrayBuffer;
  dbf: ArrayBuffer;
  prj: string | null;
  shx: ArrayBuffer | null;
  fileName: string;
}

export interface DbfField {
  name: string;
  type: string; // C=char, N=numeric, F=float, L=logical, D=date
  length: number;
  decimal: number;
}

export interface Feature {
  geometry: number[][][]; // polygon rings: [ring][point][x,y]
  properties: Record<string, string | number | null>;
}

/**
 * Ce dont la reprojection a besoin de `proj4` : l'appel `proj4(de, vers, point)` et `proj4.defs`. Une
 * interface minimale plutôt que `typeof import('proj4')` : la racine (test de parité) et `angular/` ont
 * chacune leur copie du paquet, et deux déclarations de classe ne sont pas interchangeables pour TypeScript.
 */
export interface Proj4 {
  (de: string, vers: string, point: number[]): number[];
  defs(nom: string, definition: string): unknown;
}

/** Les deux définitions que React enregistre au chargement de son module (`shapefile.ts:186-187`). */
export const DEFINITIONS_PROJECTIONS: Readonly<Record<string, string>> = {
  'EPSG:3035': '+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +units=m +no_defs',
  'EPSG:2154': '+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +units=m +no_defs',
};

/** Enregistre `DEFINITIONS_PROJECTIONS` dans `proj4` (idempotent). */
export function enregistrerProjections(proj4: Proj4): void {
  for (const [nom, definition] of Object.entries(DEFINITIONS_PROJECTIONS)) proj4.defs(nom, definition);
}

// ─── SHP binary parser ──────────────────────────────────────────────────────

export function parseSHP(buffer: ArrayBuffer): number[][][][] {
  const view = new DataView(buffer);
  // Validate magic number (9994 big-endian)
  const magic = view.getInt32(0, false);
  if (magic !== 9994) throw new Error(`SHP invalide (magic=${magic})`);

  const shapeType = view.getInt32(32, true);
  // We support: 5 = Polygon, 15 = PolygonZ, 25 = PolygonM
  if (shapeType !== 5 && shapeType !== 15 && shapeType !== 25) {
    throw new Error(`Type de géométrie non supporté: ${shapeType} (seuls les Polygons sont acceptés)`);
  }

  const geometries: number[][][][] = [];
  let offset = 100; // skip 100-byte header

  while (offset + 8 < buffer.byteLength) {
    // Record header: record number (4b BE) + content length in 16-bit words (4b BE)
    const contentLength = view.getInt32(offset + 4, false) * 2;
    const recordStart = offset + 8;

    if (recordStart + contentLength > buffer.byteLength) break;

    const recordType = view.getInt32(recordStart, true);

    if (recordType === 5 || recordType === 15 || recordType === 25) {
      // skip bounding box (32 bytes) after type (4 bytes)
      const numParts = view.getInt32(recordStart + 36, true);
      const numPoints = view.getInt32(recordStart + 40, true);

      // Parts array
      const parts: number[] = [];
      for (let i = 0; i < numParts; i++) {
        parts.push(view.getInt32(recordStart + 44 + i * 4, true));
      }

      // Points start after parts array
      const pointsOffset = recordStart + 44 + numParts * 4;
      const allPoints: number[][] = [];
      for (let i = 0; i < numPoints; i++) {
        const x = view.getFloat64(pointsOffset + i * 16, true);
        const y = view.getFloat64(pointsOffset + i * 16 + 8, true);
        allPoints.push([x, y]);
      }

      // Split into rings by parts indices
      const rings: number[][][] = [];
      for (let p = 0; p < numParts; p++) {
        const start = parts[p];
        const end = p + 1 < numParts ? parts[p + 1] : numPoints;
        rings.push(allPoints.slice(start, end));
      }

      geometries.push(rings);
    } else if (recordType === 0) {
      // Null shape — push empty
      geometries.push([]);
    }

    offset = recordStart + contentLength;
  }

  return geometries;
}

// ─── DBF full parser ─────────────────────────────────────────────────────────

export function parseDBF(buffer: ArrayBuffer): { fields: DbfField[]; records: Record<string, string | number | null>[] } {
  const data = new Uint8Array(buffer);
  if (data.length < 32) throw new Error('DBF invalide (trop court)');

  const view = new DataView(buffer);
  const recordCount = view.getUint32(4, true);
  const headerSize = view.getUint16(8, true);
  const recordSize = view.getUint16(10, true);

  // Parse field descriptors (32 bytes each, starting at offset 32)
  const fields: DbfField[] = [];
  let off = 32;
  while (off + 32 <= headerSize) {
    if (data[off] === 0x0d) break;
    const name = new TextDecoder('latin1').decode(data.slice(off, off + 11)).replace(/\0/g, '').trim();
    if (!name) break;
    const type = String.fromCharCode(data[off + 11]);
    const length = data[off + 16];
    const decimal = data[off + 17];
    fields.push({ name, type, length, decimal });
    off += 32;
  }

  // Parse records
  const records: Record<string, string | number | null>[] = [];
  let recOff = headerSize;
  const decoder = new TextDecoder('latin1');

  for (let i = 0; i < recordCount && recOff + recordSize <= data.length; i++) {
    const deleted = data[recOff] === 0x2a;
    recOff += 1; // deletion flag byte

    if (deleted) {
      recOff += recordSize - 1;
      continue;
    }

    const rec: Record<string, string | number | null> = {};
    for (const f of fields) {
      const raw = decoder.decode(data.slice(recOff, recOff + f.length)).trim();
      recOff += f.length;

      if (raw === '' || raw === '*') {
        rec[f.name] = null;
      } else if (f.type === 'N' || f.type === 'F') {
        const num = parseFloat(raw.replace(',', '.'));
        rec[f.name] = isNaN(num) ? null : num;
      } else {
        rec[f.name] = raw;
      }
    }
    records.push(rec);
  }

  return { fields, records };
}

// ─── PRJ → proj4 string ─────────────────────────────────────────────────────

export function detectCRS(prjContent: string | null, firstCoords: number[] | null): string {
  // Try to match common CRS from PRJ WKT
  if (prjContent) {
    const upper = prjContent.toUpperCase();
    if (upper.includes('LAEA') || upper.includes('3035')) return 'EPSG:3035';
    if (upper.includes('LAMBERT_CONFORMAL_CONIC') && upper.includes('93')) return 'EPSG:2154';
    if (upper.includes('RGF93') || upper.includes('2154')) return 'EPSG:2154';
    if (upper.includes('4326') || upper.includes('WGS 84') || upper.includes('WGS84')) return 'EPSG:4326';
    if (upper.includes('3857') || upper.includes('WEB_MERCATOR')) return 'EPSG:3857';
    // EPSG:5490
    if (upper.includes('5490')) return 'EPSG:5490';
  }
  // Heuristic from coordinates
  if (firstCoords) {
    const [x, y] = firstCoords;
    // EPSG:3035 LAEA Europe (France range)
    if (x > 2500000 && x < 5000000 && y > 1000000 && y < 4000000) return 'EPSG:3035';
    // EPSG:2154 Lambert 93
    if (x > 100000 && x < 1300000 && y > 6000000 && y < 7200000) return 'EPSG:2154';
    // Already WGS84
    if (Math.abs(x) <= 180 && Math.abs(y) <= 90) return 'EPSG:4326';
  }
  return 'EPSG:3035'; // default for carreaux Filosofi
}

/** `proj4` reçu en paramètre (arbitrage C10) ; ses définitions enregistrées par `enregistrerProjections`. */
export function reprojectCoords(ring: number[][], fromCRS: string, proj4: Proj4): number[][] {
  if (fromCRS === 'EPSG:4326') return ring;
  return ring.map(([x, y]) => {
    const [lng, lat] = proj4(fromCRS, 'EPSG:4326', [x, y]);
    return [lng, lat];
  });
}

// ─── Polygon → WKT ──────────────────────────────────────────────────────────

export function polygonToEWKT(rings: number[][][]): string {
  const ringsWKT = rings.map(ring =>
    '(' + ring.map(([x, y]) => `${x} ${y}`).join(',') + ')',
  ).join(',');
  return `SRID=4326;POLYGON(${ringsWKT})`;
}

// ─── ID detection ────────────────────────────────────────────────────────────

export function detectIdColumn(fields: DbfField[]): string | null {
  const names = fields.map(f => f.name.toLowerCase());
  for (const candidate of ['idinspire', 'idcar_200m', 'idcar_1km', 'idcar', 'id_car', 'id']) {
    const idx = names.indexOf(candidate);
    if (idx >= 0) return fields[idx].name;
  }
  return null;
}
