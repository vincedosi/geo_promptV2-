import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';
import Papa from 'papaparse';
import { autoMap } from '@/lib/iris-crawler/auto-map';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 Mo
const UPLOAD_DIR = path.join(process.cwd(), 'data', 'iris-uploads');

async function ensureUploadDir(): Promise<void> {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
}

function detectSeparator(firstLine: string): string {
  const counts: Record<string, number> = {
    ';': (firstLine.match(/;/g) ?? []).length,
    ',': (firstLine.match(/,/g) ?? []).length,
    '\t': (firstLine.match(/\t/g) ?? []).length,
    '|': (firstLine.match(/\|/g) ?? []).length,
  };
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : ';';
}

export interface UploadSessionData {
  sessionId: string;
  filename: string;
  totalRows: number;
  headers: string[];
  rows: Array<Record<string, string>>;
  createdAt: string;
}

// POST /api/iris-crawler/manual-upload
// Body: FormData { file: File, encoding?: string, separator?: string }
export async function POST(req: NextRequest) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Corps de requête invalide (FormData attendu)' }, { status: 400 });
  }

  const file = formData.get('file') as File | null;
  const encoding = (formData.get('encoding') as string | null) ?? 'utf-8';
  const separatorParam = (formData.get('separator') as string | null) ?? 'auto';

  if (!file) {
    return NextResponse.json({ error: 'Fichier manquant' }, { status: 400 });
  }

  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!['csv', 'tsv'].includes(ext)) {
    return NextResponse.json({ error: 'Seuls les fichiers .csv et .tsv sont acceptés' }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: 'Fichier trop volumineux (limite : 50 Mo)' }, { status: 400 });
  }

  // Décodage avec l'encodage sélectionné
  const arrayBuffer = await file.arrayBuffer();
  let text: string;
  try {
    const decoder = new TextDecoder(encoding);
    text = decoder.decode(arrayBuffer);
  } catch {
    return NextResponse.json({ error: `Encodage non supporté : ${encoding}` }, { status: 400 });
  }

  if (!text.trim()) {
    return NextResponse.json({ error: 'Le fichier est vide' }, { status: 400 });
  }

  // Auto-détection du séparateur
  const firstLine = text.split('\n')[0];
  const separator = separatorParam === 'auto'
    ? detectSeparator(firstLine)
    : separatorParam === '\\t' ? '\t' : separatorParam;

  // Parsing CSV
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    delimiter: separator,
    skipEmptyLines: true,
    transformHeader: (h: string) => h.trim(),
  });

  if (result.data.length === 0) {
    return NextResponse.json({ error: 'Aucune ligne de données trouvée (fichier vide ou mauvais séparateur ?)' }, { status: 400 });
  }

  const headers = (result.meta.fields ?? []).map((h: string) => h.trim());
  const rows = result.data as Array<Record<string, string>>;
  const totalRows = rows.length;

  // Détection format métadonnées INSEE (VARLIST / META)
  // Ces fichiers ont une colonne COD_VAR dont les valeurs sont des noms de variables, pas des codes IRIS
  const warnings: string[] = result.errors.slice(0, 5).map(e => e.message);
  if (headers.includes('COD_VAR')) {
    const sample = rows.slice(0, 5).map(r => r['COD_VAR'] ?? '');
    const looksLikeMeta = sample.some(v => /^[A-Z_]{3,}$/.test(v) && !/^\d{9}$/.test(v));
    if (looksLikeMeta) {
      warnings.unshift(
        'ATTENTION : ce fichier ressemble à un fichier de métadonnées INSEE (format VARLIST/META). ' +
        'Chaque ligne décrit une variable, pas une zone IRIS. ' +
        'Veuillez utiliser le fichier BASE_ (ex: BASE_TD_FILO_DISP_IRIS_2021.csv) ' +
        'dont chaque ligne représente une zone IRIS avec ses indicateurs en colonnes.'
      );
    }
  }

  // Auto-mapping
  const autoMapResult = autoMap(headers);

  // Stocker les données parsées côté serveur (pour validate + import)
  await ensureUploadDir();
  const sessionId = randomUUID();
  const sessionData: UploadSessionData = {
    sessionId,
    filename: file.name,
    totalRows,
    headers,
    rows,
    createdAt: new Date().toISOString(),
  };
  await fs.writeFile(
    path.join(UPLOAD_DIR, `${sessionId}.json`),
    JSON.stringify(sessionData),
    'utf-8'
  );

  return NextResponse.json({
    sessionId,
    filename: file.name,
    headers,
    totalRows,
    previewRows: rows.slice(0, 20),
    autoMapResult,
    detectedSeparator: separator,
    parseWarnings: warnings,
  });
}
