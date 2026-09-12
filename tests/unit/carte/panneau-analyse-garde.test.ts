import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @file tests/unit/carte/panneau-analyse-garde.test.ts — verrou structurel
 * de la garde de périmètre (round 2 de correction, Tâche 7, 2026-09-12).
 *
 * Pourquoi ce test existe plutôt qu'un test unitaire de plus sur
 * `lib/carte/garde-perimetre.ts` : le round 1 de cette tâche avait ajouté
 * `lancementsAutorises`, une fonction qui énumérait joliment les cinq outils
 * mais recopiait une seule valeur booléenne cinq fois — et qui n'était
 * appelée NULLE PART en production. Un test qui l'exerçait passait au vert
 * même quand `onLoadClusters={props.onLoadClusters}` (nu, sans garde) était
 * réellement câblé dans `PanneauAnalyse.tsx`. Ce test-ci lit le SOURCE réel
 * du composant : il aurait attrapé ce défaut, et attrapera sa réapparition.
 *
 * Style de test repris de ceux déjà présents dans ce projet
 * (`tests/unit/api/validation-corps.test.ts` balaie les routes,
 * `tests/unit/db/suppressions-sans-garde.test.ts` balaie les suppressions,
 * `tests/unit/securite/aucun-secret-en-dur.test.ts` balaie les fichiers
 * suivis) : un balayage du code source, pas une simulation de son
 * comportement.
 *
 * ⚠️ TOUTE NOUVELLE PROP DE LANCEMENT D'ANALYSE ajoutée à `PanneauAnalyse.tsx`
 * (un nouvel outil, un nouveau bouton qui déclenche un calcul PostGIS/ORS/API)
 * DOIT être ajoutée à `PROPS_DE_LANCEMENT` ci-dessous. Une prop absente de
 * cette liste n'est couverte par AUCUN garde-fou automatique.
 */
const SOURCE = readFileSync(
  join(process.cwd(), 'app/map/_components/panneaux/PanneauAnalyse.tsx'),
  'utf-8',
);

/**
 * [nom de la prop JSX, identifiant attendu] tel que câblé dans le JSX de
 * PanneauAnalyse.tsx. L'identifiant attendu doit être un handler LOCAL qui
 * appelle `verifierPerimetre()` avant de déclencher le calcul réel (voir
 * `HANDLERS_GARDES` plus bas) — jamais la prop brute reçue de `page.tsx`.
 */
const PROPS_DE_LANCEMENT: Array<[attribut: string, attendu: string]> = [
  ['handleVoronoi', 'handleVoronoi'],
  ['handleCheckV2', 'handleCheckV2Garde'],
  ['handleFillMissingV2', 'handleFillMissingV2Garde'],
  ['handleBattleV2', 'handleBattleV2Garde'],
  ['handleCheckORS', 'handleCheckORSGarde'],
  ['handleBattle', 'handleBattleGarde'],
  ['onApplyBattle', 'handleApplyBattleGarde'],
  ['onLoadClusters', 'handleLoadClustersGarde'],
];

/** Handlers locaux qui doivent exister (déclarés par `const <nom> = ...`)
 *  et qui doivent tous appeler `verifierPerimetre()` dans leur corps. */
const HANDLERS_GARDES = [
  'handleVoronoi',
  'handleCheckORSGarde',
  'handleBattleGarde',
  'handleCheckV2Garde',
  'handleFillMissingV2Garde',
  'handleBattleV2Garde',
  'handleApplyBattleGarde',
  'handleLoadClustersGarde',
];

/**
 * Extrait le corps d'un `const <nom> = ...;` — jusqu'au PREMIER `};`
 * rencontré après la déclaration. Les handlers de ce fichier sont soit des
 * fonctions fléchées sur une ligne, soit un petit bloc `async (...) => {...}`
 * sans `};` imbriqué avant leur propre fermeture : le premier `};` rencontré
 * est donc bien LE LEUR, jamais celui d'un handler suivant.
 */
function corpsDuHandler(nom: string): string {
  const re = new RegExp(`const ${nom}[^=]*=[\\s\\S]*?\\};`);
  const m = SOURCE.match(re);
  expect(m, `déclaration "const ${nom} = ...;" introuvable dans PanneauAnalyse.tsx`).not.toBeNull();
  return m![0];
}

describe('PanneauAnalyse — verrou structurel de la garde de perimetre (spec §5)', () => {
  it.each(PROPS_DE_LANCEMENT)(
    'la prop JSX "%s" est cablee sur son handler garde attendu ("%s")',
    (attribut, attendu) => {
      const re = new RegExp(`\\b${attribut}=\\{([\\w.?]+)\\}`);
      const m = SOURCE.match(re);
      expect(m, `prop JSX "${attribut}" introuvable — a-t-elle ete renommee/retiree de PanneauAnalyse.tsx ?`).not.toBeNull();
      expect(m![1]).toBe(attendu);
    },
  );

  it.each(HANDLERS_GARDES)('le handler "%s" appelle bien verifierPerimetre()', (nom) => {
    expect(corpsDuHandler(nom)).toContain('verifierPerimetre(');
  });

  it('le wizard de clustering (POST /api/poi-clusters/run) recoit verifierPerimetre en prop', () => {
    // Le VRAI calcul du clustering ne passe pas par onLoadClusters (un simple
    // GET de relecture d'un modele deja calcule) mais par ClusteringWizard,
    // monte par ClusterPanel, monte par ClusteringSection. La garde y est
    // relayee via la prop verifierPerimetre jusqu'a ClusteringWizard, qui
    // l'appelle avant son fetch POST (round 2 de correction).
    expect(SOURCE).toMatch(/<ClusteringSection[\s\S]*?verifierPerimetre=\{verifierPerimetre\}/);
  });

  it('aucune des props de lancement n est cablee nue sur son identifiant brut issu de "props"', () => {
    // Regression directe du defaut d'origine (round 1) : onLoadClusters
    // transmis tel quel, sans garde.
    const PATTERNS_INTERDITS = [
      /onLoadClusters=\{props\.onLoadClusters\}/,
      /onApplyBattle=\{onApplyBattle\}/,
      /handleBattle=\{handleBattle\}/,
      /handleCheckORS=\{handleCheckORS\}/,
      /handleCheckV2=\{handleCheckV2\}/,
      /handleFillMissingV2=\{handleFillMissingV2\}/,
      /handleBattleV2=\{handleBattleV2\}/,
    ];
    for (const re of PATTERNS_INTERDITS) {
      expect(SOURCE).not.toMatch(re);
    }
  });
});
