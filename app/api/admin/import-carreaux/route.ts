import { NextRequest, NextResponse } from 'next/server';
import { execFile, execFileSync, execSync } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

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
    let pythonArgs: string[] = ['-X', 'utf8', scriptPath];
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

    console.log('[import-carreaux] Python:', pythonExe);
    console.log('[import-carreaux] Method:', pythonDiag?.method);
    console.log('[import-carreaux] Args:', pythonArgs);

    const execEnv = {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
    };

    // Exécuter le script Python
    // Stratégie: shell d'abord (fonctionne avec les alias Windows), puis execFile
    try {
      let stdout = '';
      let stderr = '';
      let usedMethod = '';
      let scriptError = false;

      // Tentative 1: via shell (cmd.exe résout les alias Microsoft Store)
      const execAsync = promisify(require('child_process').exec);
      const shellCmd = `"${pythonExe}" ${pythonArgs.map(a => `"${a}"`).join(' ')}`;
      console.log(`[import-carreaux] Shell command: ${shellCmd}`);

      try {
        const result = await execAsync(shellCmd, {
          cwd: etlPath,
          maxBuffer: 10 * 1024 * 1024,
          timeout: 30 * 60 * 1000,
          env: execEnv,
          windowsHide: true,
        });
        stdout = result.stdout;
        stderr = result.stderr;
        usedMethod = 'shell';
      } catch (shellErr: any) {
        // Exit code != 0 mais Python A TOURNÉ (il y a du stderr avec traceback)
        if (shellErr.stderr && shellErr.stderr.includes('Traceback')) {
          // Le SCRIPT a crashé, mais Python fonctionne
          stdout = shellErr.stdout || '';
          stderr = shellErr.stderr || '';
          usedMethod = 'shell';
          scriptError = true;
        } else if (shellErr.code === 'ENOENT' || (shellErr.stderr && shellErr.stderr.includes('introuvable'))) {
          // Python vraiment introuvable via shell, essayer execFile
          console.warn(`[import-carreaux] Shell failed (ENOENT), trying execFile...`);
          try {
            const result = await execFileAsync(pythonExe, pythonArgs, {
              cwd: etlPath,
              maxBuffer: 10 * 1024 * 1024,
              timeout: 30 * 60 * 1000,
              env: execEnv,
              windowsHide: true,
            });
            stdout = result.stdout;
            stderr = result.stderr;
            usedMethod = 'execFile';
          } catch (execFileErr: any) {
            if (execFileErr.stderr && execFileErr.stderr.includes('Traceback')) {
              stdout = execFileErr.stdout || '';
              stderr = execFileErr.stderr || '';
              usedMethod = 'execFile';
              scriptError = true;
            } else {
              return NextResponse.json(
                {
                  success: false,
                  error: `Python introuvable ou inaccessible. Vérifiez PYTHON_PATH dans .env.local`,
                  output: execFileErr.stdout || shellErr.stdout || '',
                  errors: execFileErr.stderr || shellErr.stderr || '',
                  pythonUsed: pythonExe,
                  pythonMethod: pythonDiag?.method,
                },
                { status: 200 }
              );
            }
          }
        } else {
          // Autre erreur du script (exit code != 0 mais pas ENOENT)
          stdout = shellErr.stdout || '';
          stderr = shellErr.stderr || '';
          usedMethod = 'shell';
          scriptError = true;
        }
      }

      // Si le script a crashé, retourner l'erreur clairement
      if (scriptError) {
        return NextResponse.json({
          success: false,
          error: 'Le script Python a rencontré une erreur',
          output: stdout,
          errors: stderr,
          pythonUsed: pythonExe,
          pythonMethod: `${pythonDiag?.method} → ${usedMethod}`,
          hint: stderr.includes('ModuleNotFoundError')
            ? 'Module Python manquant. Lancez: python -m pip install -r C:\\GENESIS\\genesis_etl\\requirements.txt'
            : null,
        }, { status: 200 });
      }

      const report = parseImportReport(stdout);

      return NextResponse.json({
        success: true,
        mode,
        dryRun,
        output: stdout,
        errors: stderr || null,
        report,
        pythonUsed: pythonExe,
        pythonMethod: `${pythonDiag?.method} → ${usedMethod}`,
        csvPath: mode === 'manual' ? csvPath : null,
      });
    } catch (error: any) {
      console.error('[import-carreaux] Erreur exec Python:', error);

      return NextResponse.json(
        {
          success: false,
          error: error.message,
          output: error.stdout || '',
          errors: error.stderr || '',
          code: error.code,
          pythonUsed: pythonExe,
          pythonMethod: pythonDiag?.method,
        },
        { status: 200 }
      );
    }
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
