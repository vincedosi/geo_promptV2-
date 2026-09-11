import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Garde-fou : aucune suppression Supabase ne part sans que son erreur soit lue.
 *
 * ── Le défaut que ce test verrouille ────────────────────────────────────────
 *
 * `await supabase.from(...).delete()` en début d'instruction ne capture RIEN :
 * supabase-js ne lève pas, il rend `{ error }`. Une suppression qui échoue passe
 * donc inaperçue.
 *
 * Ce n'est grave que dans un cas — mais ce cas est partout dans ce projet : le
 * patron **DELETE ciblé puis INSERT**, qui est ici la façon d'obtenir un import
 * rejouable. Si le DELETE échoue en silence et que l'INSERT réussit, le
 * remplacement demandé devient un DOUBLEMENT. Quatre sites étaient dans ce cas
 * au 2026-09-11, tous corrigés :
 *
 *  - `campaign_dsp_report` — le rapport DSP, et donc le taux de mesure affiché
 *    au média planner, aurait doublé (cette table n'a pas de clé primaire :
 *    son idempotence REPOSE sur le DELETE) ;
 *  - `bidding_strategy_subzones` — anciennes et nouvelles sous-zones côte à
 *    côte, donc des multiplicateurs en double sur les mêmes codes postaux ;
 *  - import OOH ArcGIS en mode remplacement — anciens panneaux conservés à côté
 *    des nouveaux ;
 *  - `emetteur_radio_stations` — 569 698 liaisons reconstruites par-dessus les
 *    anciennes.
 *
 * C'est la même famille qu'`ECH-001` : une opération qui se croit idempotente
 * et ne l'est pas.
 *
 * Quand ce test échoue : capturer le résultat du `delete()` et tester son
 * `.error` avant toute écriture qui en dépend. Si la suppression est vraiment
 * sans conséquence, l'inscrire ci-dessous AVEC sa justification.
 */

const RACINE = process.cwd();

/** `await supabase…` en début d'instruction : aucune affectation, donc aucune
 *  erreur lisible. */
const SANS_CAPTURE = /^\s*await\s+(?:supabase|sb|admin|adminClient)\b/;
const SUPPRESSION = /\.delete\s*\(/;

/**
 * Suppressions sans garde ASSUMÉES. Chaque entrée est une décision : la
 * suppression n'est suivie d'aucune écriture qui la présuppose, donc un échec
 * silencieux ne peut pas dupliquer de données.
 */
const ASSUMEES = new Map<string, string>([
  ['app/api/custom-geo/media-plan/snapshot/route.ts',
   'Détachement d\'un plan média : purge terminale, aucune écriture derrière.'],
  ['app/api/radio/data/route.ts',
   'Purge des journaux d\'import radio, sur demande explicite. Rien n\'est réécrit après.'],
  ['app/api/radio/import-arcom-ods/route.ts',
   'Suppression de radios bidon détectées au nettoyage. Aucune réinsertion de ces lignes.'],
  ['lib/demo/controller.ts',
   'Remise à zéro du bac à sable de démonstration, hors données de production.'],
]);

function fichiers(dossier: string): string[] {
  const trouves: string[] = [];
  for (const entree of readdirSync(dossier)) {
    const chemin = join(dossier, entree);
    if (entree === 'node_modules' || entree === '.next') continue;
    if (statSync(chemin).isDirectory()) trouves.push(...fichiers(chemin));
    else if (entree.endsWith('.ts') || entree.endsWith('.tsx')) trouves.push(chemin);
  }
  return trouves;
}

const sansGarde = new Set<string>();
for (const dossier of ['app', 'lib', 'scripts']) {
  for (const chemin of fichiers(join(RACINE, dossier))) {
    const lignes = readFileSync(chemin, 'utf8').split('\n');
    for (let i = 0; i < lignes.length; i++) {
      if (!SANS_CAPTURE.test(lignes[i])) continue;
      if (SUPPRESSION.test(lignes.slice(i, i + 8).join('\n'))) {
        sansGarde.add(relative(RACINE, chemin).split(sep).join('/'));
      }
    }
  }
}

describe('suppressions Supabase sans garde', () => {
  it('le scan trouve bien du code (il doit pouvoir echouer)', () => {
    // Sans ce garde, un scan casse rendrait le test suivant vert a vide.
    expect(fichiers(join(RACINE, 'app')).length).toBeGreaterThan(200);
  });

  it('aucune suppression sans garde en dehors de celles assumees', () => {
    const fautives = [...sansGarde].filter(f => !ASSUMEES.has(f)).sort();
    expect(fautives, `Suppressions dont l'erreur n'est pas lue :\n${fautives.join('\n')}`).toEqual([]);
  });

  it('la liste des assumees ne contient rien de perime', () => {
    const perimees = [...ASSUMEES.keys()].filter(f => !sansGarde.has(f)).sort();
    expect(perimees, `Ces fichiers n'ont plus de suppression sans garde : les retirer.\n${perimees.join('\n')}`).toEqual([]);
  });

  it('chaque suppression assumee porte une justification', () => {
    for (const [fichier, raison] of ASSUMEES) {
      expect(raison.length, `${fichier} : justification trop courte`).toBeGreaterThan(40);
    }
  });
});
