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
 *
 * Round 3 de correction : les deux extractions ci-dessous (`valeurDeLaProp`,
 * `corpsDuHandler`) ont été durcies après qu'un relecteur a démontré qu'un
 * simple reformattage multi-lignes d'une prop JSX (`attribut={\n valeur\n}`,
 * ce que Prettier peut produire) faisait rougir ce test SANS que le câblage
 * ne change — un faux rouge qui aurait fini par le faire désactiver.
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
 * Extrait la valeur d'une prop JSX `attribut={...}`, tolérante aux espaces
 * ET aux sauts de ligne des deux côtés de la valeur — round 3 de correction :
 * la première version (`\{([\w.?]+)\}` sans `\s*`) produisait un faux rouge
 * sur un simple reformattage multi-lignes (`attribut={\n  valeur\n}`), que
 * Prettier ou une relecture future peuvent produire sans rien casser.
 */
function valeurDeLaProp(attribut: string): string | null {
  const re = new RegExp(`\\b${attribut}=\\{\\s*([\\w.?]+)\\s*\\}`);
  return SOURCE.match(re)?.[1] ?? null;
}

/**
 * Extrait le corps d'un `const <nom> = ...;` par COMPTAGE D'ACCOLADES depuis
 * la première `{` suivant la déclaration jusqu'à sa fermeture équilibrée —
 * round 3 de correction : la première version s'arrêtait au premier `};`
 * littéral rencontré, ce qui aurait coupé l'extraction trop tôt si un futur
 * handler contenait une instruction intermédiaire se terminant par un objet
 * littéral (`const x = { a: 1 };`) avant son appel à `verifierPerimetre(`.
 */
function corpsDuHandler(nom: string): string {
  const marqueur = `const ${nom}`;
  const debut = SOURCE.indexOf(marqueur);
  expect(debut, `déclaration "${marqueur}" introuvable dans PanneauAnalyse.tsx`).toBeGreaterThanOrEqual(0);
  const ouvrante = SOURCE.indexOf('{', debut);
  expect(ouvrante, `accolade ouvrante du corps introuvable pour "${marqueur}"`).toBeGreaterThan(debut);
  let profondeur = 0;
  let i = ouvrante;
  for (; i < SOURCE.length; i++) {
    if (SOURCE[i] === '{') profondeur++;
    else if (SOURCE[i] === '}') {
      profondeur--;
      if (profondeur === 0) break;
    }
  }
  expect(i, `accolade fermante du corps introuvable pour "${marqueur}"`).toBeLessThan(SOURCE.length);
  return SOURCE.slice(debut, i + 1);
}

describe('PanneauAnalyse — verrou structurel de la garde de perimetre (spec §5)', () => {
  it.each(PROPS_DE_LANCEMENT)(
    'la prop JSX "%s" est cablee sur son handler garde attendu ("%s")',
    (attribut, attendu) => {
      const valeur = valeurDeLaProp(attribut);
      expect(valeur, `prop JSX "${attribut}" introuvable — a-t-elle ete renommee/retiree de PanneauAnalyse.tsx ?`).not.toBeNull();
      expect(valeur).toBe(attendu);
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
    const blocClusteringSection = SOURCE.match(/<ClusteringSection[\s\S]*?\/>/)?.[0];
    expect(blocClusteringSection, '<ClusteringSection ... /> introuvable dans PanneauAnalyse.tsx').toBeTruthy();
    expect(blocClusteringSection).toMatch(/verifierPerimetre=\{\s*verifierPerimetre\s*\}/);
  });

  it('l outil Score composite (POST /api/analyses/score) recoit verifierPerimetre en prop', () => {
    // Tache 12 (2026-09-13), meme patron que ClusteringWizard ci-dessus : le
    // calcul est lance DANS le composant enfant, pas par une prop de
    // PanneauAnalyse — la garde ne peut donc pas etre enveloppee ici, elle est
    // relayee. Sans elle, un score porterait sur les 6 187 CP de France.
    const bloc = SOURCE.match(/<ScoreCompositeTool[\s\S]*?\/>/)?.[0];
    expect(bloc, '<ScoreCompositeTool ... /> introuvable dans PanneauAnalyse.tsx').toBeTruthy();
    expect(bloc).toMatch(/verifierPerimetre=\{\s*verifierPerimetre\s*\}/);
  });

  it('ScoreCompositeTool appelle verifierPerimetre() AVANT son fetch de calcul', () => {
    // Relayer la prop ne suffit pas : la Tache 7 a vecu exactement ce defaut
    // (garde relayee au wizard de clustering mais jamais appelee). On lit donc
    // le source de l'enfant, pas seulement le cablage du parent.
    const source = readFileSync(
      join(process.cwd(), 'app/map/_components/filter-panel/ScoreCompositeTool.tsx'),
      'utf-8',
    );
    const appelGarde = source.indexOf('verifierPerimetre()');
    const appelCalcul = source.indexOf("'/api/analyses/score'");
    expect(appelGarde, 'ScoreCompositeTool n appelle jamais verifierPerimetre()').toBeGreaterThanOrEqual(0);
    expect(appelCalcul, 'ScoreCompositeTool n appelle jamais /api/analyses/score').toBeGreaterThanOrEqual(0);
    expect(appelGarde, 'verifierPerimetre() doit etre appele AVANT le fetch de calcul').toBeLessThan(appelCalcul);
  });

  it('aucune des props de lancement n est cablee nue sur son identifiant brut issu de "props"', () => {
    // Regression directe du defaut d'origine (round 1) : onLoadClusters
    // transmis tel quel, sans garde. Tolerant aux espaces/sauts de ligne
    // (round 3), sinon un reformattage masquerait la regression au lieu de
    // rester neutre.
    const PROPS_BRUTES_INTERDITES: Array<[attribut: string, brut: string]> = [
      ['onLoadClusters', 'props.onLoadClusters'],
      ['onApplyBattle', 'onApplyBattle'],
      ['handleBattle', 'handleBattle'],
      ['handleCheckORS', 'handleCheckORS'],
      ['handleCheckV2', 'handleCheckV2'],
      ['handleFillMissingV2', 'handleFillMissingV2'],
      ['handleBattleV2', 'handleBattleV2'],
    ];
    for (const [attribut, brut] of PROPS_BRUTES_INTERDITES) {
      const re = new RegExp(`\\b${attribut}=\\{\\s*${brut.replace('.', '\\.')}\\s*\\}`);
      expect(SOURCE, `"${attribut}" semble cablee sur son identifiant brut "${brut}" (sans garde)`).not.toMatch(re);
    }
  });
});

/**
 * Tâche 13 (2026-09-13) — l'outil Corrélation est le SEUL outil de calcul du
 * panneau Analyse sans garde de périmètre. Ce test existe pour que cette
 * absence reste un choix documenté et non un oubli : si quelqu'un ajoute un
 * jour un balayage géographique à cet outil, il tombera dessus.
 */
describe('PanneauAnalyse — Correlation, absence de garde ASSUMEE', () => {
  it('est monte sans verifierPerimetre, et le commentaire dit pourquoi', () => {
    const bloc = SOURCE.match(/<CorrelationTool[\s\S]{0,40}?\/>/)?.[0];
    expect(bloc, '<CorrelationTool /> introuvable dans PanneauAnalyse.tsx').toBeTruthy();
    expect(bloc).not.toMatch(/verifierPerimetre/);
    // La justification doit rester ecrite a cote du montage.
    const avant = SOURCE.slice(Math.max(0, SOURCE.indexOf('<CorrelationTool') - 700), SOURCE.indexOf('<CorrelationTool'));
    expect(avant, 'la raison de l absence de garde doit rester ecrite pres du montage').toMatch(/campagne/i);
  });

  it('CorrelationTool ne lance aucun calcul geographique non borne', () => {
    const source = readFileSync(
      join(process.cwd(), 'app/map/_components/filter-panel/CorrelationTool.tsx'),
      'utf-8',
    );
    // Son seul appel de calcul est borne par un campaignId.
    expect(source).toMatch(/\/api\/analyses\/correlation\?campaignId=/);
    expect(source).not.toMatch(/bbox/);
  });
});
