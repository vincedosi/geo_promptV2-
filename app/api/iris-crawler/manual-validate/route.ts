import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs/promises';
import { IRIS_DB_COLUMNS, classifyTarget } from '@/lib/iris-crawler/db-columns';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import type { UploadSessionData } from '@/app/api/iris-crawler/manual-upload/route';

export const dynamic = 'force-dynamic';

const UPLOAD_DIR = path.join(process.cwd(), 'data', 'iris-uploads');
const CODE_IRIS_RE = /^\d{9}$/;

interface ValidationError {
  row:    number;
  column: string;
  value:  string;
  reason: string;
}

export interface ValidationResult {
  validRows:    number;
  warningRows:  number;
  errorRows:    number;
  errors:       ValidationError[];
  warnings:     Array<{ row: number; column: string; reason: string }>;
  errorReasons: Record<string, number>;  // Résumé diagnostique : raison → nombre d'occurrences
}

// POST /api/iris-crawler/manual-validate
// Body: { sessionId, irisKeyCol, mapping: Record<csvCol, dbTarget> }
export async function POST(req: NextRequest) {
  const body = await req.json() as {
    sessionId?:  string;
    irisKeyCol?: string;
    mapping?:    Record<string, string>;
  };

  const { sessionId, irisKeyCol, mapping } = body;

  if (!sessionId || !irisKeyCol) {
    return NextResponse.json({ error: 'sessionId et irisKeyCol requis' }, { status: 400 });
  }

  let session: UploadSessionData;
  try {
    const raw = await fs.readFile(path.join(UPLOAD_DIR, `${sessionId}.json`), 'utf-8');
    session = JSON.parse(raw) as UploadSessionData;
  } catch {
    return NextResponse.json({ error: 'Session introuvable ou expirée. Ré-uploadez le fichier.' }, { status: 404 });
  }

  if (!mapping || Object.keys(mapping).length === 0) {
    return NextResponse.json({ error: 'Mapping requis' }, { status: 400 });
  }

  // Types des colonnes core pour validation numérique
  const coreNumericCols = new Set(
    IRIS_DB_COLUMNS.filter(c => c.type === 'float' || c.type === 'integer').map(c => c.name)
  );

  const errors:   ValidationError[] = [];
  const warnings: Array<{ row: number; column: string; reason: string }> = [];
  const seenIrisCodes = new Set<string>();

  let validRows   = 0;
  let errorRows   = 0;
  let warningRows = 0;

  // Compter les raisons d'erreur pour le résumé diagnostique
  const errorReasons: Record<string, number> = {};

  for (let i = 0; i < session.rows.length; i++) {
    const row    = session.rows[i];
    const rowNum = i + 2;
    let rowHasError   = false;
    let rowHasWarning = false;

    // 1. Valider CODE_IRIS
    const irisCode = row[irisKeyCol]?.trim() ?? '';
    if (!irisCode) {
      const reason = 'CODE_IRIS manquant';
      if (errors.length < 200) errors.push({ row: rowNum, column: irisKeyCol, value: '', reason });
      errorReasons[reason] = (errorReasons[reason] ?? 0) + 1;
      rowHasError = true;
    } else if (!CODE_IRIS_RE.test(irisCode)) {
      // Code non conforme → warning seulement (la ligne sera ignorée à l'import)
      const reasonKey = irisCode.length !== 9
        ? `Code IRIS ignoré à l'import (${irisCode.length} car. au lieu de 9)`
        : `Code IRIS ignoré à l'import (caractères non numériques)`;
      if (warnings.length < 100) warnings.push({ row: rowNum, column: irisKeyCol, reason: `${reasonKey} : "${irisCode}"` });
      errorReasons[reasonKey] = (errorReasons[reasonKey] ?? 0) + 1;
      rowHasWarning = true;
    } else if (seenIrisCodes.has(irisCode)) {
      const reason = `CODE_IRIS dupliqué : ${irisCode}`;
      const reasonKey = 'CODE_IRIS dupliqué';
      if (errors.length < 200) errors.push({ row: rowNum, column: irisKeyCol, value: irisCode, reason });
      errorReasons[reasonKey] = (errorReasons[reasonKey] ?? 0) + 1;
      rowHasError = true;
    } else {
      seenIrisCodes.add(irisCode);
    }

    // 2. Valider les colonnes mappées
    for (const [csvCol, dbTarget] of Object.entries(mapping)) {
      const target = classifyTarget(dbTarget);
      if (target === 'ignore') continue;

      const val = row[csvCol]?.trim() ?? '';

      // Valeur vide → warning (pas erreur, INSEE utilise 's' pour secret)
      if (val === '') {
        if (warnings.length < 100) warnings.push({ row: rowNum, column: csvCol, reason: `Valeur manquante pour ${dbTarget}` });
        rowHasWarning = true;
        continue;
      }

      // Valeurs secrètes INSEE valides → accepter (s=secret, ns=non significatif, nd=non disponible)
      if (val === 's' || val === 'S' || val === 'ns' || val === 'NS'
        || val === 'nd' || val === 'ND' || val === 'n.d.' || val === 'n.s.') continue;

      // Validation numérique :
      //   - colonnes core numériques → erreur si non-numérique
      //   - colonnes JSONB           → warning si non-numérique (on ne connaît pas leur type)
      const isNumericCore = target === 'core' && coreNumericCols.has(dbTarget);
      const isJsonb       = target === 'jsonb';

      if (isNumericCore || isJsonb) {
        const num = parseFloat(val.replace(',', '.'));
        if (isNaN(num)) {
          if (isNumericCore) {
            const reason = `Valeur non numérique pour la colonne core "${dbTarget}"`;
            if (errors.length < 200) errors.push({ row: rowNum, column: csvCol, value: val, reason });
            errorReasons[reason] = (errorReasons[reason] ?? 0) + 1;
            rowHasError = true;
          } else {
            if (warnings.length < 100) warnings.push({ row: rowNum, column: csvCol, reason: `Valeur non numérique dans l'indicateur "${dbTarget}" (sera stocké comme texte)` });
            rowHasWarning = true;
          }
        }
      }
    }

    if (rowHasError)        { errorRows++; }
    else if (rowHasWarning) { warningRows++; validRows++; }
    else                    { validRows++; }
  }

  return NextResponse.json({
    validRows,
    warningRows,
    errorRows,
    errors,
    warnings,
    errorReasons,
  } satisfies ValidationResult);
}
