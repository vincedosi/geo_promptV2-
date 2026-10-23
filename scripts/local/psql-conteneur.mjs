/**
 * Ce que partagent les scripts de construction (`construire_carreau_couverture`, `construire_carreau_risque`,
 * `construire_couverture_rayon`) : `psql` dans le conteneur de la base LOCALE — Kong, la passerelle HTTP du stack,
 * coupe à 60 s et `authenticator` à 8 s, une bande dense dure plus —, le format des nombres et les zones lointaines.
 */
import { execFileSync } from 'node:child_process';

export const CONTENEUR = process.env.CONTENEUR_PG ?? 'supabase_db_genesis_app';

/** Une requête, sa sortie sans blancs autour. Lève si psql échoue. */
export function psql(sql) {
  // Pas de `-i` : `psql -c` ne lit jamais l'entrée standard, et la lui passer le ferait bloquer quand elle est fermée
  // (lancement en arrière-plan).
  return execFileSync(
    'docker',
    ['exec', CONTENEUR, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1', '-tAc', sql],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
}

export const nb = (n) => new Intl.NumberFormat('fr-FR').format(n);

/**
 * Les zones d'outre-mer, une bande chacune sous une clé de journal >= 1000 : un découpage uniforme de -61,6 à 56,0
 * mettrait toute la métropole dans une ou deux bandes. Seules la Martinique et La Réunion : le carroyage Filosofi 2021
 * à 200 m ne publie ni la Guadeloupe, ni la Guyane, ni Mayotte (une donnée absente, pas un zéro).
 */
export const ZONES_LOINTAINES = [
  { id: 1000, nom: 'Martinique', ouest: -61.6, est: -60.6 },
  { id: 1001, nom: 'La Réunion', ouest: 55.0, est: 56.0 },
];
