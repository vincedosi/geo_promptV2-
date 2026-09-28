@echo off
setlocal
title MAGELIAN - lancement local
cd /d "%~dp0"

rem Bash portable (git a ete reinstalle dans C:\GENESIS\PortableGit le 21/09)
set "BASH=C:\GENESIS\PortableGit\bin\bash.exe"
if not exist "%BASH%" set "BASH=C:\Program Files\Git\bin\bash.exe"
if not exist "%BASH%" (
  echo [ERREUR] bash introuvable. Attendu : C:\GENESIS\PortableGit\bin\bash.exe
  pause & exit /b 1
)
set "PATH=C:\GENESIS\PortableGit\bin;C:\GENESIS\PortableGit\cmd;%PATH%"

echo.
echo === 1/4  Docker ===
"%BASH%" scripts/local/00-docker-up.sh
if errorlevel 1 ( echo [ERREUR] Docker ne demarre pas. & pause & exit /b 1 )

echo.
echo === 2/4  Base locale (conteneurs Supabase dans Docker) ===
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
echo === 3/4  Sante de la base ===
"%BASH%" scripts/local/12-sante.sh
if errorlevel 1 echo [ATTENTION] 12-sante signale un defaut : lire ci-dessus avant de continuer.

echo.
echo === 4/4  Serveur Next (http://localhost:3000) ===
netstat -ano | findstr /R /C:":3000 .*LISTENING" >nul
if not errorlevel 1 (
  echo Un serveur ecoute deja sur le port 3000 : pas de second lancement.
) else (
  start "MAGELIAN - npm run dev" cmd /k "cd /d %~dp0 && npm run dev"
  echo Attente du serveur...
  timeout /t 15 /nobreak >nul
)
start "" http://localhost:3000/map

echo.
echo Tout est lance. Studio Supabase : http://127.0.0.1:54323
pause
