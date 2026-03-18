@echo off
ogr2ogr -f "PMTiles" -dsco MINZOOM=4 -dsco MAXZOOM=12 -dsco SIMPLIFICATION=0.00005 "C:\GENESIS\genesis_app\public\data\carreaux_filosofi.pmtiles" "C:\GENESIS\genesis_etl\data\processed\carreaux_filosofi.ndjson" -nln carreaux

echo.
echo Termine ! Fichier genere dans public\data\
pause
