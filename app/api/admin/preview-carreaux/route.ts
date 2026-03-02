/**
 * GENESIS — API Route — /api/admin/preview-carreaux
 * POST : charge 5 lignes du fichier source et retourne les colonnes disponibles
 *        avec leurs types (id / number / string) et 3 valeurs d'exemple.
 *
 * Utilisé par /admin/carreaux-import pour la sélection de colonnes avant import.
 */
import { NextRequest, NextResponse } from 'next/server';
import { execFileSync, execSync, spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

// Réutilise la même logique de détection Python que import-carreaux
function findPythonPath(): string {
  const envPython = process.env.PYTHON_PATH;
  if (envPython && envPython !== 'auto') {
    try {
      const v = execFileSync(envPython, ['--version'], { encoding: 'utf-8', timeout: 8000, windowsHide: true }).trim();
      if (v.startsWith('Python')) return envPython;
    } catch {}
  }

  // where.exe
  for (const cmd of ['where.exe python', 'where.exe python3']) {
    try {
      const found = execSync(cmd, { encoding: 'utf-8', timeout: 5000, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
        .trim().split('\n').map((p: string) => p.trim()).filter(Boolean);
      for (const p of found) {
        if (!fs.existsSync(p)) continue;
        try {
          const v = execFileSync(p, ['--version'], { encoding: 'utf-8', timeout: 5000, windowsHide: true }).trim();
          if (v.startsWith('Python')) return p;
        } catch {}
      }
    } catch {}
  }

  // shell fallback
  for (const cmd of ['python -c "import sys; print(sys.executable)"', 'python3 -c "import sys; print(sys.executable)"']) {
    try {
      const result = execSync(cmd, { encoding: 'utf-8', timeout: 10000, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      if (result && result.toLowerCase().endsWith('.exe')) return result;
    } catch {}
  }

  throw new Error('Python 3.x introuvable. Définissez PYTHON_PATH dans .env.local');
}

export async function POST(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  try {
    const formData = await request.formData();
    const mode = formData.get('mode') as string;
    const url = formData.get('url') as string;
    const file = formData.get('file') as File | null;

    const etlPath = path.join(process.cwd(), '..', 'genesis_etl');
    const scriptPath = path.join(etlPath, 'scripts', 'carreaux_import.py');

    if (!fs.existsSync(scriptPath)) {
      return NextResponse.json({ error: 'Script Python introuvable', path: scriptPath }, { status: 500 });
    }

    let pythonExe: string;
    try { pythonExe = findPythonPath(); }
    catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }

    const pythonArgs: string[] = ['-X', 'utf8', '-u', scriptPath, '--list-columns'];
    let tempFilePath = '';

    if (mode === 'manual' && file) {
      const dataDir = path.join(etlPath, 'data', 'raw');
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      const fileName = `preview_${Date.now()}_${file.name}`;
      tempFilePath = path.join(dataDir, fileName);
      const buffer = Buffer.from(await file.arrayBuffer());
      fs.writeFileSync(tempFilePath, buffer);
      pythonArgs.push('--csv-path', tempFilePath);
    } else if (mode === 'auto' && url) {
      // Pour le mode auto, on a besoin d'abord de télécharger le fichier.
      // On relance Python avec l'URL complète — Python télécharge et liste les colonnes.
      // Note: le téléchargement peut prendre du temps pour les gros fichiers.
      // Pour éviter ça, on utilise une limite de 5 lignes implicite dans --list-columns.
      // On n'a pas de --url en CLI Python, donc on saute pour l'instant.
      return NextResponse.json({
        error: 'La prévisualisation en mode URL n\'est pas disponible — uploadez le fichier manuellement pour voir les colonnes.',
        columns: {},
      }, { status: 400 });
    } else {
      return NextResponse.json({ error: 'Fichier manquant' }, { status: 400 });
    }

    console.log('[preview-carreaux] Running:', pythonExe, pythonArgs.join(' '));

    return new Promise<NextResponse>((resolve) => {
      let stdout = '';
      let stderr = '';

      const child = spawn(pythonExe, pythonArgs, {
        shell: true,
        cwd: etlPath,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
        windowsHide: true,
      });

      child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf-8'); });
      child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf-8'); });

      child.on('close', (code: number | null) => {
        // Cleanup temp file
        if (tempFilePath && fs.existsSync(tempFilePath)) {
          try { fs.unlinkSync(tempFilePath); } catch {}
        }

        // Chercher COLUMNS_JSON: dans stdout
        const match = stdout.match(/COLUMNS_JSON:(.+)/);
        if (match) {
          try {
            const columns = JSON.parse(match[1]);
            console.log(`[preview-carreaux] ${Object.keys(columns).length} colonnes trouvées`);
            resolve(NextResponse.json({ success: true, columns }));
            return;
          } catch (e) {
            resolve(NextResponse.json({ error: `JSON invalide: ${e}`, raw: match[1] }, { status: 500 }));
            return;
          }
        }

        // Chercher COLUMNS_ERROR:
        const errMatch = stdout.match(/COLUMNS_ERROR:(.+)/);
        const errorMsg = errMatch?.[1] || stderr || `Code de sortie: ${code}`;
        console.error('[preview-carreaux] Error:', errorMsg);
        resolve(NextResponse.json({ error: errorMsg, stdout, stderr }, { status: 500 }));
      });

      child.on('error', (err: Error) => {
        if (tempFilePath && fs.existsSync(tempFilePath)) {
          try { fs.unlinkSync(tempFilePath); } catch {}
        }
        resolve(NextResponse.json({ error: err.message }, { status: 500 }));
      });

      // Timeout 60s (le téléchargement des colonnes devrait être rapide)
      setTimeout(() => {
        try { child.kill(); } catch {}
        resolve(NextResponse.json({ error: 'Timeout — prévisualisation trop longue (> 60s)' }, { status: 408 }));
      }, 60000);
    });

  } catch (err: any) {
    console.error('[preview-carreaux] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
