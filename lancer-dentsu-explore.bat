@echo off
setlocal
title dentsu.explore - lancement local
cd /d "%~dp0"

rem Lance tout l'environnement local : Docker, base Supabase, API Next (:3000),
rem interface Angular (:4200). Remplace lancer-magelian.bat (19/10), qui ne
rem lancait pas l'Angular.

rem Bash portable (git a ete reinstalle dans C:\GENESIS\PortableGit le 21/09)
set "BASH=C:\GENESIS\PortableGit\bin\bash.exe"
if not exist "%BASH%" set "BASH=C:\Program Files\Git\bin\bash.exe"
if not exist "%BASH%" (
  echo [ERREUR] bash introuvable. Attendu : C:\GENESIS\PortableGit\bin\bash.exe
  pause & exit /b 1
)
set "PATH=C:\GENESIS\PortableGit\bin;C:\GENESIS\PortableGit\cmd;%PATH%"

echo.
echo === 1/5  Docker ===
"%BASH%" scripts/local/00-docker-up.sh
if errorlevel 1 ( echo [ERREUR] Docker ne demarre pas. & pause & exit /b 1 )

echo.
echo === 2/5  Base locale (conteneurs Supabase dans Docker) ===
rem Windows reserve parfois une plage de ports (WinNAT) qui couvre 54321-54324 :
rem la base echoue alors en "access forbidden". Redemarrer WinNAT libere la plage.
set "RESERVE="
for /f "tokens=1,2" %%a in ('netsh interface ipv4 show excludedportrange protocol^=tcp ^| findstr /R "^ *[0-9]"') do (
  if %%a LEQ 54324 if %%b GEQ 54321 set "RESERVE=1"
)
if defined RESERVE (
  echo Ports 54321-54324 reserves par Windows : redemarrage de WinNAT...
  net session >nul 2>&1
  if errorlevel 1 (
    echo Droits administrateur necessaires : relance du .bat en administrateur.
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b 0
  )
  net stop winnat >nul 2>&1
  net start winnat >nul 2>&1
  echo WinNAT redemarre, ports liberes.
)
"%BASH%" scripts/local/01-supabase-up.sh
if errorlevel 1 ( echo [ERREUR] Supabase ne demarre pas. & pause & exit /b 1 )

echo.
echo === 3/5  Sante de la base ===
"%BASH%" scripts/local/12-sante.sh
if errorlevel 1 echo [ATTENTION] 12-sante signale un defaut : lire ci-dessus avant de continuer.

echo.
echo === 4/5  API Next (http://localhost:3000) ===
if not exist "node_modules" (
  echo Dependances absentes : npm install...
  call npm install
)
netstat -ano | findstr /R /C:":3000 .*LISTENING" >nul
if not errorlevel 1 (
  echo Un serveur ecoute deja sur le port 3000 : pas de second lancement.
) else (
  start "dentsu.explore - API Next :3000" cmd /k "cd /d %~dp0 && npm run dev"
)

echo.
echo === 5/5  Interface Angular (http://localhost:4200, /api vers :3000) ===
if not exist "angular\node_modules" (
  echo Dependances Angular absentes : npm install...
  pushd angular & call npm install & popd
)
netstat -ano | findstr /R /C:":4200 .*LISTENING" >nul
if not errorlevel 1 (
  echo Un serveur ecoute deja sur le port 4200 : pas de second lancement.
) else (
  start "dentsu.explore - Angular :4200" cmd /k "cd /d %~dp0angular && npm start"
)

echo.
echo Attente des serveurs (premiere compilation : jusqu'a une minute)...
set /a ESSAIS=0
:attente
timeout /t 5 /nobreak >nul
set /a ESSAIS+=1
netstat -ano | findstr /R /C:":4200 .*LISTENING" >nul
if errorlevel 1 if %ESSAIS% LSS 24 goto attente

start "" http://localhost:4200

echo.
echo Tout est lance.
echo   Interface Angular : http://localhost:4200
echo   Ancienne interface React (outil de dev jusqu'au lot 7) : http://localhost:3000/map
echo   Studio Supabase : http://127.0.0.1:54323
echo Pour tout arreter : fermer les deux fenetres "dentsu.explore - ...".
echo Attention : fermer la fenetre ne tue pas toujours les processus node enfants
echo (verrou sur .next) ; en cas de doute : taskkill /F /IM node.exe
pause
