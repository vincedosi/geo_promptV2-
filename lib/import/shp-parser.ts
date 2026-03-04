/**
 * GENESIS — Minimal Shapefile Parser (SHP + DBF)
 * Supports Point geometry types only (ShapeType 1 / PointZ 11 / PointM 21)
 * DBF: dBASE III+ format for attribute data
 */

// ============================================================
// DBF Parser
// ============================================================

interface DbfField {
  name: string;
  type: string; // C=char, N=numeric, F=float, L=logical, D=date
  length: number;
}

function parseDbf(buf: Buffer): {
  fieldNames: string[];
  records: Record<string, string | null>[];
} {
  if (buf.length < 32) throw new Error('Fichier DBF invalide (trop court)');

  const recordCount = buf.readUInt32LE(4);
  const headerSize = buf.readUInt16LE(8);
  const recordSize = buf.readUInt16LE(10);

  // Field descriptors (32 bytes each, starting at offset 32)
  const fields: DbfField[] = [];
  let offset = 32;

  while (offset + 32 <= headerSize) {
    const terminator = buf.readUInt8(offset);
    if (terminator === 0x0d) break; // header terminator byte

    const name = buf.slice(offset, offset + 11).toString('ascii').replace(/\0/g, '').trim();
    if (!name) break;

    const type = String.fromCharCode(buf.readUInt8(offset + 11));
    const length = buf.readUInt8(offset + 16);

    fields.push({ name, type, length });
    offset += 32;
  }

  const fieldNames = fields.map((f) => f.name);

  // Records start at headerSize
  const records: Record<string, string | null>[] = [];
  let recOffset = headerSize;

  for (let i = 0; i < recordCount && recOffset + recordSize <= buf.length; i++) {
    const deletionFlag = buf.readUInt8(recOffset);
    recOffset += 1;

    if (deletionFlag === 0x2a) {
      // Deleted record — skip
      recOffset += recordSize - 1;
      continue;
    }

    const record: Record<string, string | null> = {};
    for (const field of fields) {
      const raw = buf.slice(recOffset, recOffset + field.length).toString('latin1').trim();
      record[field.name] = raw === '' ? null : raw;
      recOffset += field.length;
    }
    records.push(record);
  }

  return { fieldNames, records };
}

// ============================================================
// SHP Parser — Points only
// ============================================================

function parseShpPoints(buf: Buffer): { x: number; y: number }[] {
  if (buf.length < 100) throw new Error('Fichier SHP invalide (trop court)');

  const points: { x: number; y: number }[] = [];
  let offset = 100; // records start after 100-byte file header

  while (offset + 8 <= buf.length) {
    // Record header: 8 bytes (record number + content length, big-endian)
    const contentLength = buf.readInt32BE(offset + 4) * 2; // 16-bit words → bytes
    offset += 8;

    if (contentLength < 4 || offset + contentLength > buf.length) break;

    const shapeType = buf.readInt32LE(offset);

    // ShapeType 1 = Point, 11 = PointZ, 21 = PointM
    if (shapeType === 1 || shapeType === 11 || shapeType === 21) {
      if (contentLength >= 20) {
        const x = buf.readDoubleLE(offset + 4);
        const y = buf.readDoubleLE(offset + 12);
        points.push({ x, y });
      }
    }
    // shapeType === 0 = Null shape, any other type → unsupported but we skip gracefully

    offset += contentLength;
  }

  return points;
}

// ============================================================
// Main entry point
// ============================================================

export interface ParsedShapefile {
  rows: Record<string, string | null>[];
  fieldNames: string[];
  totalRows: number;
}

/**
 * Parse a Shapefile from SHP + DBF buffers.
 * Coordinates are stored as `_shp_x` / `_shp_y` in the row.
 * Non-point shapes are silently skipped (row count may differ from DBF record count).
 */
export function parseShapefile(shpBuf: Buffer, dbfBuf: Buffer): ParsedShapefile {
  const points = parseShpPoints(shpBuf);
  const { fieldNames, records } = parseDbf(dbfBuf);

  const rows: Record<string, string | null>[] = points.map((pt, i) => ({
    _shp_x: String(pt.x),
    _shp_y: String(pt.y),
    ...(records[i] ?? {}),
  }));

  return { rows, fieldNames: ['_shp_x', '_shp_y', ...fieldNames], totalRows: rows.length };
}
