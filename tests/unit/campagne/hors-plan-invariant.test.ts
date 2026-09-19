import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

import { calculerAlignement, type UniteAlignement as UniteScore } from '@/lib/campagne/alignement';
import { calculerConstats, type UniteConstat } from '@/lib/campagne/constats';
import {
  construireSeriesCourbe, preparerDispersion, selectionnerAnnotations, LIMITE_COURBE,
  type UniteAlignement as UniteCourbe,
} from '@/lib/campagne/graphique-ecart';
import { trierDeregles, graviteEcart, type UniteMaille } from '@/components/campagne/suivi-v2/TableauDeregles';

/**
 * @file tests/unit/campagne/hors-plan-invariant.test.ts — VERROU DE FAMILLE.
 *
 * ── Le défaut, rencontré QUATRE fois ───────────────────────────────────────
 *
 * Une unité géographique **hors plan** — du volume livré là où aucun plan ne
 * l'attendait — a `plan = 0` et donc `ecart_pct = null` : aucun pourcentage
 * n'est définissable sur un plan nul. Elle traverse par conséquent tous les
 * filtres écrits pour un nombre, et disparaît. Sur la campagne démo elles
 * pèsent **19,6 % des codes postaux** (≈ 400 sur 2 041), et 7 des 100
 * départements.
 *
 * Ce n'est pas un cas de bord : c'est **la sur-pression la plus pure qui
 * soit**, la totalité du volume étant en trop. C'est donc précisément ce
 * qu'un écran de suivi existe pour montrer, et c'est ce qui se perdait.
 *
 *   1. `calculer_alignement_geo` (sql/165) — plan nul ignoré, ruling T6-3
 *   2. `alignement_dispersion_cp` (sql/165) — `width_bucket` NULL, tranche à part
 *   3. `calculerConstats` (ruling T11-2) — filtre sur `ecart_pct`, exclusion muette
 *   4. `construireSeriesCourbe` — tri par plan décroissant + `slice`, et le
 *      commentaire de la fonction affirmait par écrit faire l'inverse
 *
 * ── Ce que ce fichier ajoute aux tests de chaque module ────────────────────
 *
 * Les quatre correctifs sont déjà testés, chacun chez lui. Ce qu'aucun d'eux
 * ne peut voir, c'est le CINQUIÈME consommateur — celui qu'on écrira le mois
 * prochain, avec le même filtre et le même angle mort.
 *
 * D'où deux choses ici, et pas une :
 *   - une **propriété**, vérifiée sur UN SEUL jeu de données traversant TOUS
 *     les consommateurs à la fois : le volume hors plan est soit compté, soit
 *     tenu à part, jamais escamoté ;
 *   - un **recensement** : tout module qui parle de `hors_plan` doit figurer
 *     dans `POLITIQUES` avec sa politique écrite. Un nouveau consommateur fait
 *     échouer la suite jusqu'à ce que quelqu'un réponde à la question.
 */

const RACINE = process.cwd();

/**
 * Jeu de référence partagé. Dix unités, dont **trois hors plan** portant
 * 1 000 + 600 + 400 = 2 000 impressions, soit 25 % du volume total (8 000).
 * Les sept autres suivent exactement leur plan.
 *
 * Toutes les valeurs attendues plus bas sont calculées à la main à partir de
 * ce tableau — aucune ne passe par la fonction qu'elle vérifie.
 */
const BRUT = [
  { code: '01', nom: 'Ain', plan: 1500, reel: 1500 },
  { code: '02', nom: 'Aisne', plan: 1200, reel: 1200 },
  { code: '03', nom: 'Allier', plan: 900, reel: 900 },
  { code: '04', nom: 'Alpes', plan: 800, reel: 800 },
  { code: '05', nom: 'Hautes-Alpes', plan: 700, reel: 700 },
  { code: '06', nom: 'Alpes-Maritimes', plan: 600, reel: 600 },
  { code: '07', nom: 'Ardèche', plan: 300, reel: 300 },
  // ── hors plan : du volume, aucun plan ───────────────────────────────────
  { code: '97', nom: 'Guadeloupe', plan: 0, reel: 1000 },
  { code: '98', nom: 'Martinique', plan: 0, reel: 600 },
  { code: '99', nom: 'Guyane', plan: 0, reel: 400 },
] as const;

const VOLUME_TOTAL = 8000;      // 6000 au plan + 2000 hors plan
const VOLUME_HORS_PLAN = 2000;
const CODES_HORS_PLAN = ['97', '98', '99'];

const ecartPct = (u: { plan: number; reel: number }) =>
  (u.plan === 0 ? null : Math.round(((u.reel / u.plan) - 1) * 1000) / 10);

describe('unités hors plan — le volume sans plan ne se perd nulle part', () => {
  it('le jeu de référence est bien ce que les valeurs attendues supposent', () => {
    // Garde-fou : si quelqu'un retouche BRUT, ce cas rougit AVANT les autres
    // et dit pourquoi, au lieu de les laisser échouer un par un.
    expect(BRUT.reduce((s, u) => s + u.reel, 0)).toBe(VOLUME_TOTAL);
    expect(BRUT.filter((u) => u.plan === 0).reduce((s, u) => s + u.reel, 0)).toBe(VOLUME_HORS_PLAN);
    expect(BRUT.filter((u) => u.plan === 0).map((u) => u.code)).toEqual(CODES_HORS_PLAN);
  });

  it('le SCORE mesure la sur-pression du volume hors plan, il ne l ignore pas', () => {
    const unites: UniteScore[] = BRUT.map((u) => ({ code: u.code, reel: u.reel, plan: u.plan }));
    const r = calculerAlignement(unites, 10, 1);
    expect(r).not.toBeNull();
    // Chaque unité au plan est conforme (réel = plan) : 7 conformes sur 10.
    // Les trois hors plan ont haut = 0 × 1,1 = 0, donc TOUT leur réel est en
    // trop : 2 000 sur 8 000 = 25 % — pénalité 25, score 75.
    expect(r!.sur_pression_imps).toBe(VOLUME_HORS_PLAN);
    expect(r!.sous_pression_imps).toBe(0);
    expect(r!.sur_pression_pct).toBe(25);
    expect(r!.score).toBe(75);
    expect(r!.conformes_pct).toBe(70);
  });

  it('les CONSTATS nomment les unités hors plan et chiffrent leur totalité', () => {
    const unites: UniteConstat[] = BRUT.map((u) => ({
      code: u.code, nom: u.nom, ecart_pct: ecartPct(u), impressions: u.reel,
      cpm: 10, hors_plan: u.plan === 0, volume_deplace: u.plan === 0 ? u.reel : 0,
    }));
    const sur = calculerConstats({ unites, cpm_moyen: 10, canaux: [] })
      .find((c) => c.id === 'sur_pression');
    expect(sur, 'aucun constat de sur-pression sur un jeu où 25 % du volume est hors plan').toBeDefined();
    // Les deux plus gros hors-plan : 1 000 et 600 impressions à 10 € de CPM
    // = 10 € + 6 € = 16 € déplaçables, et c'est '97' qui mène.
    expect(sur!.cible).toBe('97');
    expect(sur!.titre).toContain('(97)');
    expect(sur!.titre).toContain('(98)');
    expect(sur!.titre.replace(/[\s  ]/g, '')).toContain('16€');
  });

  it('la COURBE garde les trois unités hors plan malgré le tri par plan décroissant', () => {
    const unites: UniteCourbe[] = BRUT.map((u) => ({
      code: u.code, nom: u.nom, impressions: u.reel, spend: null, cpm: null,
      plan: u.plan, ecart_pct: ecartPct(u), hors_plan: u.plan === 0,
      volume_deplace: u.plan === 0 ? u.reel : Math.abs(u.reel - u.plan),
    }));
    // Maille région : plafond 12, dix unités — le plafond ne mord PAS ici, et
    // ce cas vérifie la CONSERVATION du volume. Le cas « plafond dépassé »,
    // celui où le `slice` coupe réellement, est le suivant : il était absent
    // de ce verrou, et la relecture des corrections l'a démontré en
    // réintroduisant le `slice(0, limite)` sans faire rougir une seule ligne
    // de ce fichier. Un verrou de famille qui laisse passer LE défaut qu'il
    // annonce en tête ne garde rien.
    const serie = construireSeriesCourbe(unites, 'region');
    const gardes = serie.filter((p) => CODES_HORS_PLAN.includes(p.code));
    expect(gardes.map((p) => p.code).sort()).toEqual(CODES_HORS_PLAN);
    // Et leur volume est rendu comme de la SUR-pression entière, pas comme un zéro.
    expect(gardes.reduce((s, p) => s + p.gapSur, 0)).toBe(VOLUME_HORS_PLAN);
    expect(gardes.reduce((s, p) => s + p.gapSous, 0)).toBe(0);
    // Conservation globale : aucune impression n'a disparu de la série.
    expect(serie.reduce((s, p) => s + p.reel, 0)).toBe(VOLUME_TOTAL);
  });

  it('la COURBE garde les unités hors plan même quand le plafond MORD', () => {
    // LE cas que ce verrou annonce et ne couvrait pas. Une unité hors plan a
    // `plan = 0` : le tri par plan décroissant la met DERNIÈRE, donc c'est
    // exactement elle que `slice(0, limite)` ampute en premier.
    //
    // Quinze unités de remplissage, toutes au plan et toutes plus grosses que
    // n'importe quelle unité de BRUT : elles raflent les douze places de la
    // maille région. Si le `slice` revient, les trois unités hors plan sont
    // les trois premières à disparaître — et ce cas rougit.
    const REMPLISSAGE = Array.from({ length: 15 }, (_, i) => ({
      code: `R${i}`, nom: `Remplissage ${i}`, plan: 5000, reel: 5000,
    }));
    const versUnite = (u: { code: string; nom: string; plan: number; reel: number }): UniteCourbe => ({
      code: u.code, nom: u.nom, impressions: u.reel, spend: null, cpm: null,
      plan: u.plan, ecart_pct: ecartPct(u), hors_plan: u.plan === 0,
      volume_deplace: u.plan === 0 ? u.reel : Math.abs(u.reel - u.plan),
    });
    const unites: UniteCourbe[] = [
      ...BRUT.map((u) => versUnite({ code: u.code, nom: u.nom, plan: u.plan, reel: u.reel })),
      ...REMPLISSAGE.map(versUnite),
    ];
    expect(unites.length, 'le jeu doit dépasser LIMITE_COURBE.region (12)')
      .toBeGreaterThan(LIMITE_COURBE.region);

    const serie = construireSeriesCourbe(unites, 'region');
    const codes = serie.map((p) => p.code);
    for (const code of CODES_HORS_PLAN) {
      expect(codes, `l'unité hors plan ${code} a été coupée par le plafond`).toContain(code);
    }
    // Et leur volume reste compté comme de la sur-pression entière.
    const gardes = serie.filter((p) => CODES_HORS_PLAN.includes(p.code));
    expect(gardes.reduce((s, p) => s + p.gapSur, 0)).toBe(VOLUME_HORS_PLAN);
  });

  it('l HISTOGRAMME tient les CP hors plan à part, sans les fondre ni les perdre', () => {
    // Tranche à bornes nulles = les CP à plan nul (sql/165 : `width_bucket`
    // sur un `ecart_pct` NULL rend NULL).
    const { barres, horsPlan } = preparerDispersion([
      { borne_basse: null, borne_haute: -50, n_cp: 12, impressions: 1200 },
      { borne_basse: -10, borne_haute: 10, n_cp: 40, impressions: 4800 },
      { borne_basse: null, borne_haute: null, n_cp: 3, impressions: VOLUME_HORS_PLAN },
    ]);
    expect(horsPlan).toEqual({ n_cp: 3, impressions: VOLUME_HORS_PLAN });
    // Les CP hors plan ne prennent AUCUNE position sur l'axe des écarts : ils
    // n'y en ont pas. Les fondre dans la bande extrême les ferait lire comme
    // « sur-pression forte mesurée », ce qui est faux — rien n'a été mesuré.
    expect(barres.map((b) => b.index)).toEqual([0, 3]);
    expect(barres.reduce((s, b) => s + b.impressions, 0) + horsPlan!.impressions).toBe(1200 + 4800 + VOLUME_HORS_PLAN);
  });

  it('le TABLEAU classe les unités hors plan en sur-pression, au maximum de gravité', () => {
    const unites: UniteMaille[] = BRUT.map((u) => ({
      code: u.code, nom: u.nom, impressions: u.reel, spend: 0, cpm: null,
      plan: u.plan, ecart_pct: ecartPct(u), hors_plan: u.plan === 0,
    }));
    const sur = trierDeregles(unites, 'sur').map((u) => u.code);
    expect(sur).toEqual(CODES_HORS_PLAN);
    expect(trierDeregles(unites, 'sous')).toEqual([]);
    // Indice 6 = `--diverge-sur-3`, l'extrémité sur-pression de la rampe à
    // sept paliers. Une unité hors plan n'a pas d'écart, mais elle a un SENS.
    expect(graviteEcart(null, true)).toBe(6);
  });

  it('la seule EXCLUSION est délibérée, et elle est documentée : les annotations', () => {
    // `selectionnerAnnotations` classe par |ecart_pct| ; une unité hors plan
    // n'en a pas. L'annoter « 0 % » serait pire que ne pas l'annoter — d'où
    // l'exclusion, qui est un choix et non un oubli. Ce cas existe pour que
    // la distinction reste visible à côté des cinq précédents.
    const points = BRUT.map((u) => ({ code: u.code, ecart_pct: ecartPct(u) }));
    const annotes = selectionnerAnnotations(points, 5).map((p) => p.code);
    for (const code of CODES_HORS_PLAN) expect(annotes).not.toContain(code);
  });

  // ── Recensement : tout nouveau consommateur doit déclarer sa politique ────

  /**
   * Chaque module qui manipule `hors_plan` / `horsPlan`, et ce qu'il en fait.
   * Ajouter un module sans l'inscrire ici fait échouer le test suivant : la
   * question « qu'advient-il du volume sans plan ? » se pose alors AVANT la
   * mise en production, pas quatre fois après.
   */
  const POLITIQUES: Record<string, string> = {
    'lib/campagne/constats.ts':
      'COMPTE — ruling T11-2 : comptées AVANT le filtre sur ecart_pct, avec la totalité de leur volume.',
    'lib/campagne/graphique-ecart.ts':
      'COMPTE + À PART — places réservées sur la courbe (moitié du plafond), tranche séparée dans '
      + "l'histogramme, et EXCLUSION assumée des annotations (pas d'écart à classer).",
    'lib/campagne/vignette-carte.ts':
      'À PART — peintes en gris `--donnee-absente`, jamais dans une teinte de l’échelle en cours, '
      + 'qui les ferait lire comme une valeur mesurée.',
    'components/campagne/suivi-v2/TableauDeregles.tsx':
      'COMPTE — sur-pression, gravité maximale (indice 6), jamais en sous-pression.',
    'components/campagne/suivi-v2/GraphiqueEcart.tsx':
      'AFFICHE — rend la ligne hors plan de `preparerDispersion` comme une note, pas comme une barre.',
    'components/campagne/suivi-v2/CarteVignette.tsx':
      'À PART — relaie le drapeau à `vignette-carte.ts` comme propriété d’absence.',
    'components/campagne/suivi-v2/SuiviV2.tsx':
      'TRANSPORTE — assemble et passe les unités aux composants ci-dessus, sans filtrer.',
    'app/api/campaigns/[campaignId]/alignement/maille/route.ts':
      'TRANSPORTE — déclare `hors_plan` au contrat de la route et documente le ruling T6-3 : '
      + 'la RPC trie sur `volume_deplace` et jamais sur `ecart_pct`, un ratio NULL remontant en '
      + "tête d'un tri `desc` (NULLS FIRST par défaut en PostgreSQL). Ne filtre rien.",
    'app/map/_components/DiffusionMapLayer.tsx':
      'À PART — passe `hors_plan` comme propriété d’absence à `expressionEtapes`, qui les peint '
      + 'en `--donnee-absente` plutôt que dans une teinte de la rampe divergente ; et elles sont '
      + 'exclues des étiquettes par `zonesAAnnoter`, sans écart à classer (même raison que les '
      + 'annotations de la courbe).',
  };

  /**
   * Consommateurs qui traitent le cas SANS employer le mot — ils testent
   * `plan > 0` directement. Le balayage ne peut pas les voir, mais ils sont
   * couverts par un cas de comportement ci-dessus, ce qui est plus fort qu'une
   * ligne de recensement. Listés pour que le contrôle « politique périmée »
   * ne les réclame pas, et pour qu'on sache qu'ils existent.
   */
  const SANS_LE_MOT = new Set([
    // `calculerAlignement` : `if (u.plan > 0 && …)` pour la sous-pression, et
    // `if (u.reel > haut)` SANS cette garde pour la sur-pression — c'est
    // exactement là que se joue « COMPTE ». Cas « le SCORE mesure… » ci-dessus.
    'lib/campagne/alignement.ts',
  ]);

  it('tout module qui manipule hors_plan a déclaré ce qu il en fait', () => {
    function fichiers(dossier: string): string[] {
      const trouves: string[] = [];
      for (const entree of readdirSync(dossier)) {
        if (entree === 'node_modules' || entree === '.next') continue;
        const chemin = join(dossier, entree);
        if (statSync(chemin).isDirectory()) trouves.push(...fichiers(chemin));
        else if (/\.tsx?$/.test(entree)) trouves.push(chemin);
      }
      return trouves;
    }

    const consommateurs: string[] = [];
    for (const dossier of ['lib', 'components', 'app']) {
      for (const chemin of fichiers(join(RACINE, dossier))) {
        const relatif = chemin.slice(RACINE.length + 1).split(sep).join('/');
        const source = readFileSync(chemin, 'utf8');
        if (/\bhors_plan\b|\bhorsPlan\b/.test(source)) consommateurs.push(relatif);
      }
    }

    expect(consommateurs.length, 'aucun consommateur trouvé — le balayage a-t-il divergé ?').toBeGreaterThan(5);

    const nonDeclares = consommateurs.filter((f) => !POLITIQUES[f]).sort();
    expect(
      nonDeclares,
      'Ces modules manipulent des unités hors plan sans que leur politique soit écrite :\n'
      + nonDeclares.map((f) => `  ${f}`).join('\n')
      + '\n\nUne unité hors plan a `plan = 0` et donc `ecart_pct = null` : elle traverse tout '
      + 'filtre écrit pour un nombre et disparaît sans bruit. Quatre fois déjà. Répondre à la '
      + 'question — COMPTE, À PART, AFFICHE, TRANSPORTE, ou EXCLUT avec sa raison — puis '
      + 'ajouter une entrée à POLITIQUES et un cas au test du module.',
    ).toEqual([]);

    const perimees = Object.keys(POLITIQUES)
      .filter((f) => !consommateurs.includes(f) && !SANS_LE_MOT.has(f))
      .sort();
    expect(
      perimees,
      `Politiques déclarées pour des modules qui ne parlent plus de hors_plan : ${perimees.join(', ')}.`,
    ).toEqual([]);
  });
});
