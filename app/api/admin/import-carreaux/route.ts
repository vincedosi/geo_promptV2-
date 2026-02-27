import { NextRequest, NextResponse } from 'next/server';
import { execFile, execFileSync, execSync, spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { createAdminClient } from '@/lib/auth';

const execFileAsync = promisify(execFile);

// =============================================================================
// Types pour le diagnostic
// =============================================================================

interface PythonDiagnostic {
  method: string;
  path: string;
  checked: { path: string; exists: boolean }[];
}

// =============================================================================
// Détection automatique du chemin Python — avec diagnostic complet
// =============================================================================

function findPythonPath(): { pythonPath: string; diagnostic: PythonDiagnostic } {
  const diagnostic: PythonDiagnostic = { method: '', path: '', checked: [] };

  // -------------------------------------------------------------------------
  // 0. PRIORITÉ ABSOLUE : variable d'environnement PYTHON_PATH
  //    → L'utilisateur peut la définir dans .env.local
  //    → On ESSAIE D'EXÉCUTER au lieu de juste fs.existsSync
  //      car Windows peut bloquer existsSync sur des fichiers cross-user
  //      ou sur des App Execution Aliases (Microsoft Store)
  // -------------------------------------------------------------------------
  const envPython = process.env.PYTHON_PATH;
  if (envPython && envPython !== 'auto') {
    const fileExists = fs.existsSync(envPython);
    diagnostic.checked.push({ path: `PYTHON_PATH=${envPython}`, exists: fileExists });

    // Essayer d'exécuter même si fs.existsSync échoue
    try {
      const version = execFileSync(envPython, ['--version'], {
        encoding: 'utf-8',
        timeout: 10000,
        windowsHide: true,
      }).trim();

      if (version.startsWith('Python')) {
        diagnostic.method = 'env:PYTHON_PATH (exec)';
        diagnostic.path = envPython;
        console.log(`[import-carreaux] Python trouvé (env PYTHON_PATH exec): ${envPython} → ${version}`);
        return { pythonPath: envPython, diagnostic };
      }
    } catch (execErr: any) {
      console.warn(`[import-carreaux] PYTHON_PATH exec failed: ${execErr.message}`);
      diagnostic.checked.push({ path: `PYTHON_PATH exec error: ${execErr.code || execErr.message}`, exists: false });
    }

    // Essayer via le même chemin mais sous le profil du user courant
    const currentUser = process.env.USERPROFILE || '';
    if (currentUser && envPython.includes('\\Users\\')) {
      const userInPath = envPython.match(/\\Users\\([^\\]+)\\/)?.[1];
      if (userInPath && currentUser && !currentUser.endsWith(userInPath)) {
        const currentUserName = path.basename(currentUser);
        const altPath = envPython.replace(`\\Users\\${userInPath}\\`, `\\Users\\${currentUserName}\\`);
        diagnostic.checked.push({ path: `ALT_USER=${altPath}`, exists: fs.existsSync(altPath) });

        try {
          const version = execFileSync(altPath, ['--version'], {
            encoding: 'utf-8',
            timeout: 10000,
            windowsHide: true,
          }).trim();

          if (version.startsWith('Python')) {
            diagnostic.method = 'env:PYTHON_PATH (alt user)';
            diagnostic.path = altPath;
            console.log(`[import-carreaux] Python trouvé (alt user): ${altPath} → ${version}`);
            return { pythonPath: altPath, diagnostic };
          }
        } catch {
          console.warn(`[import-carreaux] Alt user path also failed: ${altPath}`);
        }
      }
    }

    console.warn(`[import-carreaux] PYTHON_PATH défini mais inaccessible: ${envPython}`);
  }

  // -------------------------------------------------------------------------
  // Variables d'environnement Windows
  // -------------------------------------------------------------------------
  const localAppData = process.env.LOCALAPPDATA || '';
  const userProfile = process.env.USERPROFILE || '';
  const appData = process.env.APPDATA || '';

  console.log(`[import-carreaux] ENV: LOCALAPPDATA=${localAppData || '(vide)'}`);
  console.log(`[import-carreaux] ENV: USERPROFILE=${userProfile || '(vide)'}`);
  console.log(`[import-carreaux] ENV: APPDATA=${appData || '(vide)'}`);

  // Construire LOCALAPPDATA à partir de USERPROFILE si manquant
  const effectiveLocalAppData = localAppData || (userProfile ? path.join(userProfile, 'AppData', 'Local') : '');

  // -------------------------------------------------------------------------
  // 1. Microsoft Store Python (le VRAI exe dans le sous-dossier)
  //    Les alias python.exe dans WindowsApps/ sont des "reparse points"
  //    qui ne fonctionnent PAS depuis child_process de Node.js.
  // -------------------------------------------------------------------------
  const windowsAppsPaths = [
    effectiveLocalAppData ? path.join(effectiveLocalAppData, 'Microsoft', 'WindowsApps') : '',
    userProfile ? path.join(userProfile, 'AppData', 'Local', 'Microsoft', 'WindowsApps') : '',
  ].filter(Boolean);

  for (const windowsApps of windowsAppsPaths) {
    diagnostic.checked.push({ path: `dir:${windowsApps}`, exists: fs.existsSync(windowsApps) });
    if (!fs.existsSync(windowsApps)) continue;

    try {
      const entries = fs.readdirSync(windowsApps);
      for (const entry of entries) {
        if (entry.startsWith('PythonSoftwareFoundation.Python')) {
          const pythonExe = path.join(windowsApps, entry, 'python.exe');
          diagnostic.checked.push({ path: pythonExe, exists: fs.existsSync(pythonExe) });
          if (fs.existsSync(pythonExe)) {
            diagnostic.method = 'microsoft-store';
            diagnostic.path = pythonExe;
            console.log(`[import-carreaux] Python trouvé (Store réel): ${pythonExe}`);
            return { pythonPath: pythonExe, diagnostic };
          }
        }
      }
    } catch (e) {
      console.warn('[import-carreaux] Erreur scan WindowsApps:', e);
    }
  }

  // -------------------------------------------------------------------------
  // 2. where.exe python — commande native Windows pour trouver un exe
  // -------------------------------------------------------------------------
  for (const cmd of ['where.exe python', 'where.exe python3', 'where.exe py']) {
    try {
      const result = execSync(cmd, {
        encoding: 'utf-8',
        timeout: 5000,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();

      // where.exe peut retourner plusieurs lignes
      const paths = result.split('\n').map((p: string) => p.trim()).filter(Boolean);
      for (const foundPath of paths) {
        diagnostic.checked.push({ path: `where:${foundPath}`, exists: fs.existsSync(foundPath) });

        // Vérifier que c'est un vrai exe (pas un alias WindowsApps)
        if (fs.existsSync(foundPath)) {
          // Tester si l'exe fonctionne réellement
          try {
            const version = execFileSync(foundPath, ['--version'], {
              encoding: 'utf-8',
              timeout: 5000,
              windowsHide: true,
            }).trim();

            if (version.startsWith('Python')) {
              diagnostic.method = 'where.exe';
              diagnostic.path = foundPath;
              console.log(`[import-carreaux] Python trouvé (where.exe): ${foundPath} → ${version}`);
              return { pythonPath: foundPath, diagnostic };
            }
          } catch {
            // Cet exe ne fonctionne pas (alias?), essayer le suivant
            console.log(`[import-carreaux] ${foundPath} existe mais ne s'exécute pas (alias?)`);
          }
        }
      }
    } catch {
      // where.exe n'a pas trouvé la commande
    }
  }

  // -------------------------------------------------------------------------
  // 3. python.org installer (emplacements classiques)
  // -------------------------------------------------------------------------
  const pythonOrgDirs = [
    effectiveLocalAppData ? path.join(effectiveLocalAppData, 'Programs', 'Python') : '',
    'C:\\Python313',
    'C:\\Python312',
    'C:\\Python311',
    'C:\\Python310',
    'C:\\Program Files\\Python313',
    'C:\\Program Files\\Python312',
    'C:\\Program Files\\Python311',
    'C:\\Program Files (x86)\\Python311',
  ].filter(Boolean);

  for (const dir of pythonOrgDirs) {
    if (!fs.existsSync(dir)) continue;

    // Directement dans le dossier
    const direct = path.join(dir, 'python.exe');
    diagnostic.checked.push({ path: direct, exists: fs.existsSync(direct) });
    if (fs.existsSync(direct)) {
      diagnostic.method = 'python.org';
      diagnostic.path = direct;
      console.log(`[import-carreaux] Python trouvé (python.org): ${direct}`);
      return { pythonPath: direct, diagnostic };
    }

    // Sous-dossiers (Python313/, Python312/, etc.)
    try {
      for (const sub of fs.readdirSync(dir)) {
        const subExe = path.join(dir, sub, 'python.exe');
        diagnostic.checked.push({ path: subExe, exists: fs.existsSync(subExe) });
        if (fs.existsSync(subExe)) {
          diagnostic.method = 'python.org-sub';
          diagnostic.path = subExe;
          console.log(`[import-carreaux] Python trouvé (python.org sub): ${subExe}`);
          return { pythonPath: subExe, diagnostic };
        }
      }
    } catch {}
  }

  // -------------------------------------------------------------------------
  // 4. Anaconda / Miniconda
  // -------------------------------------------------------------------------
  const condaDirs = [
    userProfile ? path.join(userProfile, 'anaconda3') : '',
    userProfile ? path.join(userProfile, 'miniconda3') : '',
    userProfile ? path.join(userProfile, 'Anaconda3') : '',
    userProfile ? path.join(userProfile, 'Miniconda3') : '',
    'C:\\ProgramData\\anaconda3',
    'C:\\ProgramData\\miniconda3',
  ].filter(Boolean);

  for (const dir of condaDirs) {
    const condaPython = path.join(dir, 'python.exe');
    diagnostic.checked.push({ path: condaPython, exists: fs.existsSync(condaPython) });
    if (fs.existsSync(condaPython)) {
      diagnostic.method = 'conda';
      diagnostic.path = condaPython;
      console.log(`[import-carreaux] Python trouvé (conda): ${condaPython}`);
      return { pythonPath: condaPython, diagnostic };
    }
  }

  // -------------------------------------------------------------------------
  // 5. Dernier recours : execSync via shell (cmd.exe résout les alias)
  //    On ne vérifie PAS fs.existsSync — si cmd.exe peut l'exécuter, on l'utilise
  // -------------------------------------------------------------------------
  const shellCmds = [
    'python -c "import sys; print(sys.executable)"',
    'python3 -c "import sys; print(sys.executable)"',
    'py -3 -c "import sys; print(sys.executable)"',
    'py -c "import sys; print(sys.executable)"',
  ];

  for (const cmd of shellCmds) {
    try {
      const result = execSync(cmd, {
        encoding: 'utf-8',
        timeout: 10000,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();

      diagnostic.checked.push({ path: `shell:${cmd} → ${result}`, exists: result ? fs.existsSync(result) : false });

      if (result && result.toLowerCase().endsWith('.exe')) {
        // Vérifier que le chemin fonctionne réellement via execFile
        try {
          execFileSync(result, ['--version'], {
            encoding: 'utf-8',
            timeout: 5000,
            windowsHide: true,
          });
          diagnostic.method = 'shell-exec';
          diagnostic.path = result;
          console.log(`[import-carreaux] Python trouvé (shell): ${result}`);
          return { pythonPath: result, diagnostic };
        } catch {
          // execFileSync a échoué — le chemin n'est pas exécutable directement
          // Mais cmd.exe peut l'exécuter, donc on retourne un wrapper
          diagnostic.method = 'shell-only';
          diagnostic.path = result;
          console.log(`[import-carreaux] Python trouvé (shell-only, cmd.exe nécessaire): ${result}`);
          return { pythonPath: result, diagnostic };
        }
      }
    } catch (e: any) {
      diagnostic.checked.push({ path: `shell:${cmd} → ERROR: ${e.code || e.message?.substring(0, 50)}`, exists: false });
    }
  }

  // -------------------------------------------------------------------------
  // ÉCHEC — retourner le diagnostic pour debug
  // -------------------------------------------------------------------------
  throw Object.assign(
    new Error(
      'Python 3.x introuvable. Ajoutez PYTHON_PATH=C:\\chemin\\vers\\python.exe dans le fichier .env.local puis redémarrez le serveur.'
    ),
    { diagnostic }
  );
}

// =============================================================================
// API Route — POST : Lancer l'import
// =============================================================================

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    const mode = formData.get('mode') as string;
    const url = formData.get('url') as string;
    const dryRun = formData.get('dryRun') === 'true';
    const limit = formData.get('limit') as string;
    const bbox = formData.get('bbox') as string; // "west south east north" ou vide
    const tableName = formData.get('tableName') as string; // nom de table override
    const columns = formData.get('columns') as string; // "col1,col2,..." ou vide = toutes
    const file = formData.get('file') as File | null;

    // Chemin vers le projet ETL
    const etlPath = path.join(process.cwd(), '..', 'genesis_etl');
    const scriptPath = path.join(etlPath, 'scripts', 'carreaux_import.py');

    // Vérifier que le script existe
    if (!fs.existsSync(scriptPath)) {
      return NextResponse.json(
        { error: 'Script Python introuvable', path: scriptPath },
        { status: 500 }
      );
    }

    // Détecter Python
    let pythonExe: string;
    let pythonDiag: PythonDiagnostic | null = null;
    try {
      const result = findPythonPath();
      pythonExe = result.pythonPath;
      pythonDiag = result.diagnostic;
    } catch (err: any) {
      return NextResponse.json(
        {
          success: false,
          error: err.message,
          diagnostic: err.diagnostic || null,
          hint: 'Ajoutez PYTHON_PATH=C:\\chemin\\vers\\python.exe dans .env.local',
        },
        { status: 500 }
      );
    }

    // Construire les arguments
    // -u : force stdout/stderr non-bufferisé (critique pour le streaming SSE en temps réel)
    let pythonArgs: string[] = ['-X', 'utf8', '-u', scriptPath];
    let csvPath = '';

    if (mode === 'auto') {
      if (!url) {
        return NextResponse.json(
          { error: 'URL manquante pour le mode automatique' },
          { status: 400 }
        );
      }
    }

    if (mode === 'manual') {
      if (!file) {
        return NextResponse.json(
          { error: 'Fichier manquant pour le mode manuel' },
          { status: 400 }
        );
      }

      const dataDir = path.join(etlPath, 'data', 'raw');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      const fileName = `upload_${Date.now()}_${file.name}`;
      csvPath = path.join(dataDir, fileName);

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      fs.writeFileSync(csvPath, buffer);

      pythonArgs.push('--csv-path', csvPath);
    }

    if (dryRun) {
      pythonArgs.push('--dry-run');
    }

    if (limit) {
      pythonArgs.push('--limit', limit);
    }

    // Filtre géographique bbox : "west south east north" → 4 args séparés
    if (bbox && bbox.trim()) {
      const parts = bbox.trim().split(/\s+/);
      if (parts.length === 4 && parts.every(p => !isNaN(Number(p)))) {
        pythonArgs.push('--bbox', ...parts);
        console.log('[import-carreaux] bbox filter:', parts.join(', '));
      }
    }

    // Nom de table override
    if (tableName && /^[a-z0-9_]+$/.test(tableName)) {
      pythonArgs.push('--table', tableName);
    }

    // Filtre colonnes : "col1,col2,..." → --columns col1,col2,...
    if (columns && columns.trim()) {
      pythonArgs.push('--columns', columns.trim());
      console.log('[import-carreaux] colonnes sélectionnées:', columns.trim());
    }

    console.log('[import-carreaux] Python:', pythonExe);
    console.log('[import-carreaux] Method:', pythonDiag?.method);
    console.log('[import-carreaux] Args:', pythonArgs);

    const execEnv = {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUNBUFFERED: '1', // Force stdout non-bufferisé — nécessaire pour le streaming SSE
    };

    // ── SSE streaming : spawn Python et streame la progression en temps réel ─
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const send = (data: object) => {
          try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch {}
        };

        console.log(`[import-carreaux] spawn shell: "${pythonExe}" ${pythonArgs.join(' ')}`);

        const child = spawn(pythonExe!, pythonArgs, {
          shell: true,
          cwd: etlPath,
          env: execEnv,
          windowsHide: true,
        });

        let stdoutBuf = '';
        let stderrBuf = '';

        child.stdout?.on('data', (chunk: Buffer) => {
          const text = chunk.toString('utf-8');
          stdoutBuf += text;
          for (const line of text.split('\n')) {
            const t = line.trim();
            if (!t) continue;
            send({ type: 'log', line: t });
            // Détecter la progression : "Batch X : Y/Z insérés"
            const m = t.match(/Batch \d+ : (\d+)\/(\d+) ins/);
            if (m) send({ type: 'progress', current: parseInt(m[1]), total: parseInt(m[2]) });
          }
        });

        child.stderr?.on('data', (chunk: Buffer) => { stderrBuf += chunk.toString('utf-8'); });

        child.on('close', async (code: number | null) => {
          const scriptError = code !== 0;
          const report = parseImportReport(stdoutBuf);

          // Enregistrer dans data_sources si import réel (pas dry-run)
          let dataSourceId: string | null = null;
          if (!scriptError && !dryRun && report.carreauxInseres && report.carreauxInseres > 0 && report.tableTarget) {
            try {
              const supabase = createAdminClient();
              const originalFilename = mode === 'manual' && file
                ? file.name
                : report.fichierSource || 'carreaux-import';
              const { data: srcData, error: srcErr } = await supabase
                .from('data_sources')
                .insert({
                  name: report.tableTarget,
                  type: 'carreaux',
                  category: 'carreaux',
                  organization_id: '00000000-0000-0000-0000-000000000001',
                  original_filename: originalFilename,
                  file_format: path.extname(originalFilename).replace('.', '') || 'geojson',
                  row_count: report.carreauxTraites || 0,
                  valid_count: report.carreauxInseres || 0,
                  error_count: (report.carreauxTraites || 0) - (report.carreauxInseres || 0),
                  mapping: {},
                  geo_config: { table_name: report.tableTarget },
                  status: 'active',
                })
                .select('id')
                .single();
              if (!srcErr) {
                dataSourceId = srcData?.id ?? null;
                console.log('[import-carreaux] Data source enregistrée:', dataSourceId);
              } else {
                console.error('[import-carreaux] Erreur data_source:', srcErr.message);
              }
            } catch (regErr: any) {
              console.error('[import-carreaux] Erreur data_source:', regErr.message);
            }
          }

          send({
            type: 'done',
            success: !scriptError,
            mode,
            dryRun,
            report: !scriptError ? report : null,
            output: stdoutBuf,
            errors: stderrBuf || null,
            dataSourceId,
            error: scriptError ? 'Le script Python a rencontré une erreur' : undefined,
            hint: scriptError && stderrBuf.includes('ModuleNotFoundError')
              ? 'Module Python manquant. Lancez: python -m pip install -r C:\\GENESIS\\genesis_etl\\requirements.txt'
              : undefined,
          });
          try { controller.close(); } catch {}
        });

        child.on('error', (err: Error) => {
          console.error('[import-carreaux] spawn error:', err);
          send({ type: 'done', success: false, error: err.message });
          try { controller.close(); } catch {}
        });
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
        'Connection': 'keep-alive',
      },
    });
  } catch (error: any) {
    console.error('[import-carreaux] Erreur globale:', error);
    return NextResponse.json(
      { error: 'Erreur serveur', details: error.message },
      { status: 500 }
    );
  }
}

// =============================================================================
// Parse le rapport d'import
// =============================================================================

function parseImportReport(stdout: string): any {
  const report: any = {};
  const lines = stdout.split('\n');

  for (const line of lines) {
    if (line.includes('Fichier source')) {
      report.fichierSource = line.split(':').slice(1).join(':').trim();
    }
    if (line.includes('Table cible')) {
      report.tableTarget = line.split(':').slice(1).join(':').trim();
    }
    if (line.includes('Lignes chargées')) {
      report.lignesChargees = parseInt(line.split(':')[1]?.trim() || '0');
    }
    if (line.includes('Carreaux traités')) {
      report.carreauxTraites = parseInt(line.split(':')[1]?.trim() || '0');
    }
    if (line.includes('Carreaux insérés')) {
      report.carreauxInseres = parseInt(line.split(':')[1]?.trim() || '0');
    }
  }

  return report;
}

// =============================================================================
// GET : Diagnostic complet Python + statut du service
// =============================================================================

export async function GET() {
  const etlPath = path.join(process.cwd(), '..', 'genesis_etl');
  const scriptPath = path.join(etlPath, 'scripts', 'carreaux_import.py');

  let pythonPath = '';
  let pythonVersion = '';
  let pythonMethod = '';
  let diagnostic: PythonDiagnostic | null = null;
  let error = '';

  try {
    const result = findPythonPath();
    pythonPath = result.pythonPath;
    pythonMethod = result.diagnostic.method;
    diagnostic = result.diagnostic;

    pythonVersion = execFileSync(pythonPath, ['--version'], {
      encoding: 'utf-8',
      timeout: 5000,
      windowsHide: true,
    }).trim();
  } catch (err: any) {
    pythonPath = '';
    pythonVersion = '';
    error = err.message;
    diagnostic = err.diagnostic || null;
  }

  return NextResponse.json({
    available: fs.existsSync(scriptPath),
    scriptPath,
    etlPath,
    pythonPath: pythonPath || 'Non trouvé',
    pythonVersion: pythonVersion || 'N/A',
    pythonMethod,
    pythonFound: !!pythonPath,
    diagnostic,
    error: error || null,
    env: {
      LOCALAPPDATA: process.env.LOCALAPPDATA || '(non défini)',
      USERPROFILE: process.env.USERPROFILE || '(non défini)',
      PYTHON_PATH: process.env.PYTHON_PATH || '(non défini)',
    },
  });
}
