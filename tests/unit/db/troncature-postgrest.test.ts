import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, sep } from 'node:path';

/**
 * @file tests/unit/db/troncature-postgrest.test.ts — VERROU DE FAMILLE.
 *
 * ── Le défaut, rencontré CINQ fois ─────────────────────────────────────────
 *
 * **PostgREST tronque à 5 000 lignes TOUTE fonction `RETURNS TABLE` (ou
 * `SETOF`), sans erreur, sans avertissement, sans en-tête.** L'appelant reçoit
 * un tableau parfaitement valide de 5 000 éléments et n'a aucun moyen de
 * savoir qu'il en manquait 1 187. Aucun `try/catch`, aucun `if (error)`,
 * aucune assertion de type ne peut voir passer ça.
 *
 *   1. `correlation_campagne_indicateur` — 2026-09-13, corrigée sql/154
 *   2. `codes_postaux_du_perimetre`      — 2026-09-15, corrigée sql/168-169
 *   3. `calculer_score_composite`        — 2026-09-15, corrigée sql/170
 *   4. `get_zone_centroids` + `codes_postaux_dans_bbox` — 2026-09-15,
 *      corrigées sql/243-245 (2026-10-10)
 *   5. `get_strategy_comparison_data`    — 2026-09-16, trouvée PAR CE TEST
 *
 * Quatre correctifs ponctuels n'ont pas empêché le cinquième. Ce fichier est la
 * réponse structurelle demandée par `docs/SUITE_TRONCATURE_POSTGREST.md` §2 et
 * par la règle « Troncature PostgREST » de `CLAUDE.md`.
 *
 * ── Ce qu'il exige ─────────────────────────────────────────────────────────
 *
 * Toute RPC `RETURNS TABLE`/`SETOF` appelée depuis `app/` ou `lib/` doit avoir
 * une entrée dans `BORNES` ci-dessous, avec l'UNE de ces deux natures :
 *
 *   `borne`  — la borne est démontrable et écrite. Un `LIMIT` dans le corps,
 *              un argument tableau fourni par l'appelant, une table de
 *              référence dont la taille est connue et petite.
 *   `dette`  — aucune borne : la troncature est possible ou avérée. Ces
 *              entrées DOIVENT être nommées dans
 *              `docs/SUITE_TRONCATURE_POSTGREST.md`, sinon ce test échoue —
 *              on ne peut pas faire taire le verrou sans écrire la dette.
 *
 * Une RPC `RETURNS TABLE` nouvellement appelée sans entrée fait échouer la
 * suite. C'est le point : la question « combien de lignes au maximum ? » est
 * posée AVANT la mise en production, pas trois mois après, par hasard, en
 * comptant les codes postaux d'une carte.
 */

const RACINE = process.cwd();

type Nature = 'borne' | 'dette';
interface Justification { nature: Nature; raison: string }

/**
 * La borne de chaque RPC `RETURNS TABLE` appelée par l'application.
 * Les chiffres sont mesurés ou lus dans le corps SQL, jamais supposés.
 */
const BORNES: Record<string, Justification> = {
  calculer_score_composite: {
    nature: 'borne',
    raison:
      "Enveloppe TABLE de calculer_score_composite_jsonb (sql/170). Son seul appelant "
      + "restant, /api/custom-geo/source/score, plafonne à 1 500 codes postaux — un choix "
      + "produit (zone trop large à créer), pas une contrainte technique. "
      + "/api/analyses/score, qui va jusqu'aux 6 187 CP de France, appelle la jumelle jsonb. "
      + "⚠ Relever ce plafond au-dessus de 5 000 ramène la troncature en silence.",
  },
  classer_territoires: {
    nature: 'borne',
    raison:
      "Argument p_limite (défaut 10), appliqué en LIMIT dans le corps (sql/150). "
      + "L'outil copilote classement_territoires ne demande qu'un classement.",
  },
  compte_poi_par_categorie: {
    nature: 'borne',
    raison:
      "GROUP BY categorie sur la liste de catégories passée en argument (p_categories text[]) : "
      + "une ligne par catégorie demandée, quelques dizaines au plus (sql/136).",
  },
  count_emetteurs_par_radio: {
    nature: 'borne',
    raison: "Une ligne par radio de la table `radios` — 861 lignes (sql/078).",
  },
  get_active_data_registry: {
    nature: 'borne',
    raison: "Une ligne par entrée active de `data_registry`, table de configuration (sql/058).",
  },
  get_campaign_available_metrics: {
    nature: 'borne',
    raison:
      "Une ligne par métrique ACTIVE de `dsp_metrics_registry` (field, has_data) — la largeur "
      + "d'un schéma, pas un volume de données, dont 5 colonnes natives énumérées dans le "
      + "corps. Quelques dizaines de lignes au grand maximum.",
  },
  get_campaign_last_data_dates: {
    nature: 'borne',
    raison:
      "Une ligne par campagne du tableau p_ids fourni par l'appelant (sql/095). Les deux "
      + "appelants passent les ids d'une page de liste déjà paginée.",
  },
  get_dsp_campaign_stats: {
    nature: 'borne',
    raison:
      "Un GROUP BY campaign_id sur dsp_campaign_data : une ligne par campagne du compte, "
      + "des dizaines. (Le volume de dsp_campaign_data — 280 k lignes — est agrégé en base, "
      + "il ne traverse pas PostgREST.)",
  },
  get_iris_fill_status: {
    nature: 'borne',
    raison:
      "Une ligne par colonne numérique d'`iris` — 41 aujourd'hui, et le plafond de 100 "
      + "arguments de PostgreSQL mord bien avant les 5 000 (cf. F2 de sql/152).",
  },
  get_iris_metric_columns: {
    nature: 'borne',
    raison:
      "Idem : une ligne par colonne métrique d'`iris`, lue dans information_schema — 41 "
      + "aujourd'hui, 51 indicateurs déclarés au registre donc 51 au plafond prévisible.",
  },
  get_strategy_comparison_data: {
    nature: 'dette',
    raison:
      "AUCUNE BORNE, et c'est ce test qui l'a trouvée (2026-09-16). La fonction rend UNE "
      + "LIGNE PAR LIGNE de dsp_campaign_data pour la campagne de la stratégie — ni GROUP BY, "
      + "ni LIMIT, et ses deux arguments de date sont passés `undefined` par son unique "
      + "appelant (/api/bidding/strategies/[id]/final-report). Une campagne réelle porte "
      + "280 000 lignes (incident du 08/04) : le bilan exécutif Gemini est donc calculé sur "
      + "les 5 000 premières, et rend un rapport partiel mais parfaitement plausible. "
      + "Défaut C de docs/SUITE_TRONCATURE_POSTGREST.md.",
  },
  get_table_sizes: {
    nature: 'borne',
    raison: "Une ligne par table du schéma public — une soixantaine (sql/004).",
  },
  get_voronoi_by_category: {
    nature: 'borne',
    raison:
      "LIMIT 5000 explicite en fin de corps (sql/164). Borne réelle, mais posée EXACTEMENT "
      + "au plafond de PostgREST : relever ce LIMIT sans passer la fonction en jsonb "
      + "rendrait la troncature invisible au lieu de rendre plus de polygones.",
  },
  smart_demographie_top_villes: {
    nature: 'borne',
    raison:
      "Argument p_limit (défaut 10) appliqué en LIMIT, sur un corpus lui-même plafonné aux "
      + "300 premières villes par nombre de POI (sql/059).",
  },
};

// ── Balayage ────────────────────────────────────────────────────────────────

function fichiers(dossier: string, extensions: string[]): string[] {
  const trouves: string[] = [];
  if (!existsSync(dossier)) return trouves;
  for (const entree of readdirSync(dossier)) {
    if (entree === 'node_modules' || entree === '.next') continue;
    const chemin = join(dossier, entree);
    if (statSync(chemin).isDirectory()) trouves.push(...fichiers(chemin, extensions));
    else if (extensions.some((x) => entree.endsWith(x))) trouves.push(chemin);
  }
  return trouves;
}

/** `{ nom de RPC → fichiers appelants }`, d'après les `.rpc('nom'` de app/ et lib/. */
const RPC_APPELEES = (() => {
  const m = new Map<string, Set<string>>();
  for (const dossier of ['app', 'lib']) {
    for (const chemin of fichiers(join(RACINE, dossier), ['.ts', '.tsx'])) {
      const relatif = chemin.slice(RACINE.length + 1).split(sep).join('/');
      const source = readFileSync(chemin, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
      for (const appel of source.matchAll(/\.rpc[<(\s][^'"`]*['"`]([a-z0-9_]+)['"`]/gi)) {
        if (!m.has(appel[1])) m.set(appel[1], new Set());
        m.get(appel[1])!.add(relatif);
      }
    }
  }
  return m;
})();

/**
 * `{ nom de fonction → type de retour }`, d'après les migrations versionnées.
 * La DERNIÈRE définition rencontrée gagne : les fichiers sont parcourus dans
 * l'ordre lexicographique, qui est l'ordre d'application des migrations —
 * c'est ainsi que `calculer_score_composite` est lue dans sql/170 (enveloppe)
 * et non dans sql/146 (corps d'origine).
 */
const RETOUR_PAR_FONCTION = (() => {
  const m = new Map<string, { retour: string; fichier: string }>();
  const sources = [
    ...fichiers(join(RACINE, 'sql'), ['.sql']).sort(),
    ...fichiers(join(RACINE, 'supabase', 'migrations'), ['.sql']).sort(),
  ];
  for (const chemin of sources) {
    const relatif = chemin.slice(RACINE.length + 1).split(sep).join('/');
    const sql = readFileSync(chemin, 'utf8');
    for (const decl of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-z0-9_]+)\s*\(/gi)) {
      const apres = sql.slice(decl.index!, decl.index! + 4000);
      const retour = apres.match(/\)\s*RETURNS\s+((?:SETOF\s+)?[a-zA-Z_][\w. ]*)/i);
      m.set(decl[1].toLowerCase(), { retour: (retour?.[1] ?? '?').trim(), fichier: relatif });
    }
  }
  return m;
})();

const estTabulaire = (retour: string) => /^(TABLE|SETOF)\b/i.test(retour);

describe('troncature PostgREST à 5 000 lignes — verrou de famille', () => {
  it('le balayage a bien trouvé les RPC et les migrations (garde-fou du test)', () => {
    // Sans cette garde, un changement de convention d'appel viderait la carte
    // et TOUS les contrôles ci-dessous passeraient à vide.
    expect(RPC_APPELEES.size, 'aucun appel .rpc() trouvé dans app/ et lib/').toBeGreaterThan(50);
    expect(RETOUR_PAR_FONCTION.size, 'aucune CREATE FUNCTION trouvée dans sql/ ni supabase/migrations/').toBeGreaterThan(80);
  });

  it('toute RPC RETURNS TABLE appelée par l app a une borne écrite', () => {
    const sansJustification: string[] = [];
    for (const [nom, appelants] of RPC_APPELEES) {
      const def = RETOUR_PAR_FONCTION.get(nom);
      if (!def || !estTabulaire(def.retour)) continue;
      if (BORNES[nom]) continue;
      sansJustification.push(`${nom} (${def.retour}, ${def.fichier}) ← ${[...appelants].join(', ')}`);
    }

    expect(
      sansJustification.sort(),
      'Ces RPC rendent un ENSEMBLE DE LIGNES et sont appelées par l\'application, sans que '
      + 'personne ait écrit combien de lignes elles peuvent rendre :\n'
      + sansJustification.map((x) => `  ${x}`).join('\n')
      + '\n\nPostgREST coupe à 5 000 lignes SANS ERREUR. Deux issues, pas trois :\n'
      + '  - la borne est démontrable (LIMIT, argument fourni, table de référence connue) : '
      + 'ajouter une entrée { nature: "borne" } à BORNES avec le chiffre et sa source ;\n'
      + '  - elle ne l\'est pas : passer la fonction en RETURNS jsonb (patron sql/154, 168-170), '
      + 'ou ajouter { nature: "dette" } ET nommer la fonction dans '
      + 'docs/SUITE_TRONCATURE_POSTGREST.md.',
    ).toEqual([]);
  });

  it('chaque borne écrite reste attachée à une RPC réellement appelée', () => {
    // Sinon la table enfle de justifications périmées et perd sa valeur de
    // recensement : on ne saurait plus lesquelles décrivent le code d'aujourd'hui.
    const orphelines = Object.keys(BORNES)
      .filter((nom) => {
        const def = RETOUR_PAR_FONCTION.get(nom);
        return !RPC_APPELEES.has(nom) || !def || !estTabulaire(def.retour);
      })
      .sort();
    expect(
      orphelines,
      `Entrées de BORNES qui ne correspondent plus à une RPC RETURNS TABLE appelée : `
      + `${orphelines.join(', ')}. La fonction a-t-elle été passée en jsonb (bonne nouvelle, `
      + `retirer l'entrée) ou l'appel a-t-il disparu ?`,
    ).toEqual([]);
  });

  it('toute DETTE est nommée dans docs/SUITE_TRONCATURE_POSTGREST.md', () => {
    // C'est ce qui empêche de faire taire le verrou : déclarer « dette »
    // oblige à écrire la dette là où quelqu'un la relira.
    const doc = readFileSync(join(RACINE, 'docs', 'SUITE_TRONCATURE_POSTGREST.md'), 'utf8');
    const muettes = Object.entries(BORNES)
      .filter(([nom, j]) => j.nature === 'dette' && !doc.includes(nom))
      .map(([nom]) => nom)
      .sort();
    expect(
      muettes,
      `Dettes de troncature déclarées ici mais absentes de docs/SUITE_TRONCATURE_POSTGREST.md : `
      + `${muettes.join(', ')}. Une troncature connue qui n'est écrite que dans un fichier de `
      + `test est une troncature que personne ne corrigera.`,
    ).toEqual([]);
  });

  it('chaque justification dit quelque chose de vérifiable', () => {
    // Un garde-fou contre le « ok » ou le « borné » qui viderait la table de
    // son sens sans la faire rougir.
    const creuses = Object.entries(BORNES)
      .filter(([, j]) => j.raison.trim().length < 60 || !/\d/.test(j.raison))
      .map(([nom]) => nom);
    expect(
      creuses,
      `Justifications trop courtes ou sans aucun chiffre : ${creuses.join(', ')}. `
      + `Une borne s'écrit avec le nombre de lignes et d'où il vient.`,
    ).toEqual([]);
  });
});
