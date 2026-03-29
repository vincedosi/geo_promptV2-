/**
 * Upload iris.pmtiles → GitHub Releases (tag: iris-pmtiles-latest)
 * Utilise le CLI `gh` disponible dans les runners GitHub Actions.
 * Pas de limite de taille (GitHub Releases supporte jusqu'à 2 GB par asset).
 */
import { execSync } from 'child_process';
import { statSync } from 'fs';

const FILE = 'iris.pmtiles';
const TAG  = 'iris-pmtiles-latest';

const size = statSync(FILE).size;
console.log(`[upload] ${FILE} (${(size / 1024 / 1024).toFixed(1)} MB)`);

// Supprimer l'asset existant s'il existe (évite "asset already exists")
try {
  execSync(`gh release delete-asset ${TAG} ${FILE} --yes`, { stdio: 'pipe' });
  console.log(`[upload] Asset précédent supprimé`);
} catch {
  // Pas d'asset existant — normal lors du premier run
}

// Créer la release si elle n'existe pas encore
try {
  execSync(`gh release view ${TAG}`, { stdio: 'pipe' });
  console.log(`[upload] Release ${TAG} existante`);
} catch {
  execSync(
    `gh release create ${TAG} --title "IRIS PMTiles (latest)" --notes "Géométries IRIS France — générées automatiquement" --prerelease`,
    { stdio: 'inherit' },
  );
  console.log(`[upload] Release ${TAG} créée`);
}

// Upload de l'asset
execSync(`gh release upload ${TAG} ${FILE} --clobber`, { stdio: 'inherit' });

const repo = process.env.GITHUB_REPOSITORY ?? 'vincedosi/geo_promptV2-';
const url  = `https://github.com/${repo}/releases/download/${TAG}/${FILE}`;
console.log(`[upload] OK → ${url}`);
