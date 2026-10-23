/**
 * psql dans le conteneur de la base locale : les tests d'intégration qui lisent la base en SQL ou simulent une panne
 * dans une transaction annulée (`-X -q -At`, `ON_ERROR_STOP`). Un seul exécuteur pour tous.
 */
import { spawnSync } from 'node:child_process';

const CONTENEUR = process.env.CONTENEUR_PG ?? 'supabase_db_genesis_app';

/** Le résultat brut, sans lever : pour prouver qu'un script ÉCHOUE. */
export function psqlBrut(script: string) {
  return spawnSync('docker', ['exec', '-i', CONTENEUR, 'psql', '-U', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], {
    input: script, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
}

function sortie(script: string): string {
  const r = psqlBrut(script);
  if (r.status !== 0) throw new Error(`psql (${r.status}) : ${r.stderr}`);
  return r.stdout.trim();
}

/** Les lignes de sortie. Lève si psql échoue. */
export const psqlLignes = (script: string): string[] => sortie(script).split('\n');

/** La DERNIÈRE ligne de sortie. */
export const psql = (script: string): string => psqlLignes(script).at(-1)!;

/** Une requête à une ligne de résultat : ses colonnes, séparées par « | ». */
export const sql = (requete: string): string[] => sortie(requete).split('|');
