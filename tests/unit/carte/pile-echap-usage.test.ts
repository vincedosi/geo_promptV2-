import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * @file tests/unit/carte/pile-echap-usage.test.ts — verrou structurel :
 * tout appel à `empiler(` doit vivre dans un `useEffect` à tableau de
 * dépendances VIDE, sauf exception documentée et justifiée.
 *
 * ── Pourquoi ce test existe (round de correction 2, Tâche 8, 2026-09-12) ──
 *
 * C'est la TROISIÈME fois que cette famille de défaut apparaît dans ce
 * chantier — invisible aux tests unitaires parce qu'elle vit dans le
 * COUPLAGE React, pas dans la logique pure :
 *
 *   1. `OverlayPanel.tsx` / l'ancien `AIOverlay.tsx`, supprimé au lot 5 (round 1) : `onClose` est une
 *      fonction fléchée inline côté `page.tsx`, recréée à chaque rendu de
 *      `MapPage` (qui se re-rend à chaque jeton de streaming du chat).
 *      `handleClose` en dépendait, donc l'effet d'empilage se rejouait à
 *      chaque rendu.
 *   2. `ClusterResultsOverlay.tsx` (round 2) : même défaut, `onClose` vient
 *      de `ClusteringSection.tsx:216` (`() => setVersionOuverte(null)`).
 *   3. Le round 1 avait corrigé `empiler()` (le module PUR conserve
 *      désormais la position d'un id déjà présent) — mais ce correctif ne
 *      suffit PAS : React exécute le NETTOYAGE de l'ancien effet
 *      (`depiler(id)`) AVANT de relancer le nouveau quand une dépendance
 *      change. Au moment où le nouvel effet appelle `empiler(id, …)`, l'id
 *      vient d'être retiré par le nettoyage — il est vu comme NOUVEAU et
 *      repart au sommet. Le module pur ne peut rien y faire : c'est l'ORDRE
 *      cleanup-puis-effet de React qui contourne la protection.
 *
 * La seule protection qui tient : que l'effet qui appelle `empiler(` ne se
 * relance JAMAIS après le montage, c'est-à-dire un tableau de dépendances
 * littéralement vide (`[]`). Un callback stabilisé par `useCallback(…, [])`
 * + une ref pour la valeur "fraîche" (patron déjà écrit trois fois :
 * `OverlayPanel.tsx`, `ClusterResultsOverlay.tsx`, et jadis `AIOverlay.tsx`) rend ça
 * possible sans perdre la fraîcheur de la fonction réellement appelée.
 *
 * ── Les deux exceptions légitimes ──────────────────────────────────────────
 *
 * Deux composants (`OverlayPanel`, `ClusterResultsOverlay` ; `AIOverlay` était le troisième)
 * MONTENT et DÉMONTENT avec l'overlay qu'ils représentent : leur effet
 * d'empilage n'a besoin de tourner qu'une fois, à l'exécution — deps `[]`.
 *
 * Trois autres (`MagelianOverlay`, la comparaison de `ClusterPanel`, le rail
 * masqué de `page.tsx`) sont des instances QUI PERSISTENT tout au long du
 * cycle ouverture/fermeture (l'overlay MAGELIAN vit dans le layout, le panel
 * de clustering et la page carte ne démontent jamais) : leur push/pop est
 * gouverné par un booléen qui change de valeur AU FIL DU TEMPS (`open`,
 * `compareMode`, `railMasque`) — cette dépendance est structurellement
 * nécessaire, un tableau vide ne pourrait pas réagir à ce changement.
 * Elles restent sûres à condition qu'AUCUNE fonction à l'identité instable
 * ne soit list ée dans leurs deps à côté du booléen — vérifié ci-dessous.
 *
 * Style de test repris de ceux déjà présents dans ce projet
 * (`tests/unit/db/suppressions-sans-garde.test.ts`,
 * `tests/unit/carte/panneau-analyse-garde.test.ts`) : un balayage du code
 * SOURCE, pas une simulation de son comportement. Extraction tolérante aux
 * espaces et sauts de ligne (round 3 de la Tâche 7 avait déjà appris cette
 * leçon à la dure).
 */

const RACINE = process.cwd();

/** Le module qui DÉFINIT `empiler()` — pas un appelant, exclu du balayage. */
const MODULE_PILE = join('lib', 'carte', 'pile-echap.ts').split(sep).join('/');

/**
 * Exceptions documentées : fichier → tableau de dépendances EXACT attendu
 * (normalisé, espaces retirés) + justification. Toute entrée doit être
 * un booléen/chaîne primitif SEUL — jamais une fonction à identité
 * instable — sans quoi elle reproduirait exactement le défaut que ce test
 * verrouille.
 */
const EXCEPTIONS = new Map<string, { deps: string; raison: string }>([
  ['app/map/page.tsx', {
    deps: '[railMasque]',
    raison: 'Instance persistante (la page ne démonte jamais) : le push/pop ' +
      'du rail masqué doit réagir à `railMasque` changeant de valeur au fil ' +
      'du temps — un tableau vide ne pourrait pas le voir. Le callback ' +
      'empilé (`() => setRailMasque(false)`) n\'est PAS dans le tableau de ' +
      'dépendances : seul `railMasque` gouverne le cycle, jamais une ' +
      'identité de fonction instable.',
  }],
  ['app/map/_components/ClusterPanel.tsx', {
    deps: '[compareMode]',
    raison: 'Instance persistante (le panel ne démonte jamais entre deux ' +
      'sélections de POI) : le mode comparaison doit réagir à `compareMode` ' +
      'changeant de valeur. `exitCompare` n\'est délibérément PAS dans le ' +
      'tableau de dépendances (eslint-disable existant) : seul `compareMode` ' +
      'gouverne le cycle.',
  }],
  ['components/magelian/MagelianOverlay.tsx', {
    deps: '[open]',
    raison: 'Instance persistante (vit dans le layout, ne démonte jamais ' +
      'entre deux ouvertures) : le push/pop doit réagir à `open` changeant ' +
      'de valeur. Round de correction 2 : le callback empilé est ' +
      '`fermerPourPile`, un wrapper stable (`useCallback` à deps vides + ref ' +
      'vers `handleClose`) — `handleClose` lui-même n\'est PLUS dans le ' +
      'tableau de dépendances, précisément parce que son identité change ' +
      'quand `closing` bascule (round 2 : c\'était le défaut sur ' +
      'ClusterResultsOverlay, reproduit ici jusqu\'à cette correction).',
  }],
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

/**
 * Découpe le texte source en portées `useEffect(...)`, par comptage de
 * parenthèses équilibrées depuis le `(` qui suit `useEffect` — tolérant aux
 * corps d'effet multi-lignes, aux fonctions imbriquées, etc.
 */
function porteesUseEffect(source: string): string[] {
  const portees: string[] = [];
  let idx = 0;
  while (true) {
    const pos = source.indexOf('useEffect(', idx);
    if (pos === -1) break;
    const debutParen = pos + 'useEffect'.length;
    let profondeur = 0;
    let i = debutParen;
    for (; i < source.length; i++) {
      if (source[i] === '(') profondeur++;
      else if (source[i] === ')') {
        profondeur--;
        if (profondeur === 0) break;
      }
    }
    if (i >= source.length) break; // parenthèses déséquilibrées : on arrête proprement
    portees.push(source.slice(pos, i + 1));
    idx = i + 1;
  }
  return portees;
}

/**
 * Extrait le tableau de dépendances : le DERNIER `[...]` équilibré du texte
 * de l'appel — toujours le dernier argument de `useEffect(callback, deps)`,
 * donc forcément après tout crochet éventuel dans le corps du callback.
 * Normalisé (espaces/sauts de ligne retirés) pour ne pas rougir sur un
 * simple reformattage.
 */
function tableauDeDependances(porteeUseEffect: string): string | null {
  const debut = porteeUseEffect.lastIndexOf('[');
  if (debut === -1) return null;
  let profondeur = 0;
  let i = debut;
  for (; i < porteeUseEffect.length; i++) {
    if (porteeUseEffect[i] === '[') profondeur++;
    else if (porteeUseEffect[i] === ']') {
      profondeur--;
      if (profondeur === 0) break;
    }
  }
  if (i >= porteeUseEffect.length) return null;
  return porteeUseEffect.slice(debut, i + 1).replace(/\s+/g, '');
}

interface Occurrence { fichier: string; deps: string | null; }

function relevePileEchap(): Occurrence[] {
  const occurrences: Occurrence[] = [];
  for (const dossier of ['app', 'components', 'lib']) {
    for (const chemin of fichiers(join(RACINE, dossier))) {
      const relatif = relative(RACINE, chemin).split(sep).join('/');
      if (relatif === MODULE_PILE) continue;
      const source = readFileSync(chemin, 'utf8');
      if (!source.includes('empiler(')) continue;
      for (const portee of porteesUseEffect(source)) {
        if (!portee.includes('empiler(')) continue;
        occurrences.push({ fichier: relatif, deps: tableauDeDependances(portee) });
      }
    }
  }
  return occurrences;
}

describe('empiler() vit toujours dans un useEffect a deps stables', () => {
  it('le scan trouve bien du code (il doit pouvoir echouer)', () => {
    // Sans ce garde, un scan casse (mauvais chemin, extension oubliee...)
    // rendrait les tests suivants verts a vide.
    expect(fichiers(join(RACINE, 'app')).length).toBeGreaterThan(200);
  });

  it('trouve au moins les six appelants connus de empiler(', () => {
    const occurrences = relevePileEchap();
    expect(occurrences.length).toBeGreaterThanOrEqual(6);
  });

  it('chaque appel a empiler() est dans un useEffect a deps vides, ou dans une exception documentee', () => {
    const occurrences = relevePileEchap();
    const fautives: string[] = [];
    for (const { fichier, deps } of occurrences) {
      if (deps === '[]') continue;
      const exception = EXCEPTIONS.get(fichier);
      if (exception && deps === exception.deps) continue;
      fautives.push(`${fichier} : deps="${deps ?? '(introuvable)'}" (attendu "[]" ou l'exception documentee)`);
    }
    expect(fautives, `Appels a empiler() hors de la regle :\n${fautives.join('\n')}`).toEqual([]);
  });

  it('aucune exception documentee n est perimee', () => {
    const occurrences = relevePileEchap();
    for (const [fichier, { deps }] of EXCEPTIONS) {
      const trouve = occurrences.find(o => o.fichier === fichier);
      expect(trouve, `${fichier} : plus aucun appel a empiler() trouve — retirer l'exception`).toBeTruthy();
      expect(trouve?.deps, `${fichier} : les deps ont change, mettre a jour l'exception ou le code`).toBe(deps);
    }
  });

  it('chaque exception porte une justification substantielle', () => {
    for (const [fichier, { raison }] of EXCEPTIONS) {
      expect(raison.length, `${fichier} : justification trop courte`).toBeGreaterThan(80);
    }
  });
});
