import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, sep } from 'node:path';

/**
 * @file tests/unit/db/troncature-postgrest.test.ts — VERROU DE FAMILLE.
 *
 * ── Le défaut, rencontré CINQ fois ─────────────────────────────────────────
 *
 * **PostgREST coupe à `db-max-rows` TOUTE fonction `RETURNS TABLE` (ou
 * `SETOF`), sans erreur, sans avertissement, sans en-tête.** L'appelant reçoit
 * un tableau parfaitement valide et n'a aucun moyen de savoir qu'il en
 * manquait. Aucun `try/catch`, aucun `if (error)`, aucune assertion de type ne
 * peut voir passer ça.
 *
 * **Le plafond vaut 1 000** (`supabase/config.toml`, `max_rows = 1000` ;
 * `PGRST_DB_MAX_ROWS=1000` dans le conteneur), et il frappe les requêtes de
 * table ET les RPC tabulaires — mesuré le 2026-10-10 : `get_zone_centroids`
 * rendait 1 000 lignes sur 6 187. **Ce fichier disait 5 000 jusqu'à cette
 * date** : c'était le réglage du projet hébergé, supprimé le 2026-09-21. Les
 * bornes justifiées « sous 5 000 » ne bornaient donc plus rien — le score
 * composite d'une zone de 1 429 CP rendait 1 000 lignes. Le test ci-dessous
 * lit désormais le plafond dans `supabase/config.toml`.
 *
 *   1. `correlation_campagne_indicateur` — 2026-09-13, corrigée sql/154
 *   2. `codes_postaux_du_perimetre`      — 2026-09-15, corrigée sql/168-169
 *   3. `calculer_score_composite`        — 2026-09-15, corrigée sql/170 ; son
 *      dernier appelant tabulaire (`/api/custom-geo/source/score`) passé à la
 *      jumelle le 2026-10-10
 *   4. `get_zone_centroids` + `codes_postaux_dans_bbox` — 2026-09-15,
 *      corrigées sql/243-245 (2026-10-10)
 *   5. `get_strategy_comparison_data`    — 2026-09-16, trouvée PAR CE TEST ;
 *      close le 2026-10-12 par retrait de son unique appelant (bilan Gemini)
 *   6. `get_voronoi_by_category`         — 2026-10-10, 4 653 cellules → 1 000,
 *      corrigée sql/246 ; la jumelle `_jsonb` est lue depuis le 2026-10-12 par
 *      la route directe `GET /api/voronoi` (`app/api/voronoi/route.ts`, borne
 *      5 000, `tronque`), qui remplace l'outil copilote
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
  classer_territoires: {
    nature: 'borne',
    raison:
      "Argument p_limite (défaut 10), ramené entre 1 et 100 dans le corps et appliqué en "
      + "LIMIT (sql/150) ; l'outil copilote le borne aussi à 100 (resoudreLimite).",
  },
  compte_poi_par_categorie: {
    nature: 'borne',
    raison:
      "GROUP BY categorie sur la liste de catégories passée en argument (p_categories text[]) : "
      + "une ligne par catégorie demandée, quelques dizaines au plus (sql/136).",
  },
  count_emetteurs_par_radio: {
    nature: 'dette',
    raison:
      "Une ligne par radio AYANT un émetteur (GROUP BY radio_id sur emetteur_radio_stations, "
      + "sql/078) : 861 lignes mesurées le 2026-10-10, sous le plafond de 1 000 — mais la "
      + "table `radios` en compte 1 175. Le jour où plus de 1 000 radios ont un émetteur, "
      + "/api/radio/stations perd des compteurs en silence. Pas de troncature AUJOURD'HUI.",
  },
  get_dept_representative_communes: {
    nature: 'borne',
    raison:
      "Une ligne par département de ref_departements ayant un centroïde — 104 mesurées le "
      + "2026-10-10, table de référence (définie hors migrations, cf. TABULAIRES_HORS_MIGRATIONS).",
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
      + "arguments de PostgreSQL mord bien avant les 1 000 (cf. F2 de sql/152).",
  },
  get_iris_metric_columns: {
    nature: 'borne',
    raison:
      "Idem : une ligne par colonne métrique d'`iris`, lue dans information_schema — 41 "
      + "aujourd'hui, 51 indicateurs déclarés au registre donc 51 au plafond prévisible.",
  },
  get_table_sizes: {
    nature: 'borne',
    raison: "Une ligne par table du schéma public — 119 mesurées le 2026-10-10 (sql/004).",
  },
  get_zone_radius_targets: {
    nature: 'dette',
    raison:
      "Une ligne par polygone disjoint (ST_Dump) d'une zone custom, sans LIMIT (définie hors "
      + "migrations, cf. TABULAIRES_HORS_MIGRATIONS). 565 au plus mesurées le 2026-10-10, sous "
      + "le plafond de 1 000 ; mais une zone faite de plus de 1 000 poches (1 500 CP disjoints "
      + "en admettent) ferait perdre des rayons à l'export tiktok_geo, en silence.",
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

/**
 * RPC tabulaires appelées par l'application mais créées HORS de `sql/` et de
 * `supabase/migrations/` — dans la console de l'ancien projet hébergé, puis
 * ramenées par le dump. Le balayage ci-dessus ne les voit pas : sans cette
 * table, elles échappaient au verrou. Type de retour lu dans `pg_proc` le
 * 2026-10-10 (`pg_get_function_result`), sur la base locale.
 *
 * Le jour où l'une d'elles est versionnée dans `sql/`, le test
 * « … vraiment hors migrations » échoue : retirer alors l'entrée.
 */
const TABULAIRES_HORS_MIGRATIONS: Record<string, string> = {
  get_dept_representative_communes: 'TABLE(code_dept text, nom_dept text, code_commune text)',
  get_zone_radius_targets:
    'TABLE(lat double precision, lng double precision, radius_km double precision, area_km2 double precision)',
};

const RETOUR_EFFECTIF = (() => {
  const m = new Map(RETOUR_PAR_FONCTION);
  for (const [nom, retour] of Object.entries(TABULAIRES_HORS_MIGRATIONS)) {
    if (!m.has(nom)) m.set(nom, { retour, fichier: '(hors migrations, pg_proc 2026-10-10)' });
  }
  return m;
})();

/**
 * Le plafond réel, lu dans la configuration du stack plutôt qu'écrit en dur :
 * ce fichier a affirmé 5 000 pendant un mois, le chiffre d'un projet supprimé.
 */
const PLAFOND_POSTGREST = (() => {
  const toml = readFileSync(join(RACINE, 'supabase', 'config.toml'), 'utf8');
  const m = toml.match(/^\s*max_rows\s*=\s*(\d+)/m);
  return m ? Number(m[1]) : NaN;
})();

const estTabulaire = (retour: string) => /^(TABLE|SETOF)\b/i.test(retour);

describe('troncature PostgREST à db-max-rows (1 000 lignes) — verrou de famille', () => {
  it('le plafond du stack est bien celui que la règle annonce (1 000)', () => {
    // Si quelqu'un relève `max_rows`, CLAUDE.md, docs/SUITE_TRONCATURE_POSTGREST.md
    // et les bornes ci-dessous doivent être relus : ils raisonnent tous sur 1 000.
    expect(
      PLAFOND_POSTGREST,
      'supabase/config.toml : max_rows a changé. Mettre à jour CLAUDE.md § « Troncature '
      + 'PostgREST », docs/SUITE_TRONCATURE_POSTGREST.md et les raisons de BORNES.',
    ).toBe(1000);
  });

  it('les RPC déclarées hors migrations le sont vraiment, et sont appelées', () => {
    const fausses = Object.keys(TABULAIRES_HORS_MIGRATIONS)
      .filter((nom) => RETOUR_PAR_FONCTION.has(nom) || !RPC_APPELEES.has(nom))
      .sort();
    expect(
      fausses,
      `Entrées de TABULAIRES_HORS_MIGRATIONS désormais versionnées dans sql/ ou plus appelées : `
      + `${fausses.join(', ')}. Retirer l'entrée.`,
    ).toEqual([]);
  });

  it('le balayage a bien trouvé les RPC et les migrations (garde-fou du test)', () => {
    // Sans cette garde, un changement de convention d'appel viderait la carte
    // et TOUS les contrôles ci-dessous passeraient à vide.
    expect(RPC_APPELEES.size, 'aucun appel .rpc() trouvé dans app/ et lib/').toBeGreaterThan(50);
    expect(RETOUR_PAR_FONCTION.size, 'aucune CREATE FUNCTION trouvée dans sql/ ni supabase/migrations/').toBeGreaterThan(80);
  });

  it('toute RPC RETURNS TABLE appelée par l app a une borne écrite', () => {
    const sansJustification: string[] = [];
    for (const [nom, appelants] of RPC_APPELEES) {
      const def = RETOUR_EFFECTIF.get(nom);
      if (!def || !estTabulaire(def.retour)) continue;
      if (BORNES[nom]) continue;
      sansJustification.push(`${nom} (${def.retour}, ${def.fichier}) ← ${[...appelants].join(', ')}`);
    }

    expect(
      sansJustification.sort(),
      'Ces RPC rendent un ENSEMBLE DE LIGNES et sont appelées par l\'application, sans que '
      + 'personne ait écrit combien de lignes elles peuvent rendre :\n'
      + sansJustification.map((x) => `  ${x}`).join('\n')
      + `\n\nPostgREST coupe à ${PLAFOND_POSTGREST} lignes (db-max-rows) SANS ERREUR. Deux issues, pas trois :\n`
      + `  - la borne est démontrable ET sous ${PLAFOND_POSTGREST} (LIMIT, argument fourni, table de `
      + 'référence connue) : ajouter une entrée { nature: "borne" } à BORNES avec le chiffre et sa source ;\n'
      + '  - elle ne l\'est pas : passer la fonction en RETURNS jsonb (patron sql/154, 168-170, 243-246), '
      + 'ou ajouter { nature: "dette" } ET nommer la fonction dans '
      + 'docs/SUITE_TRONCATURE_POSTGREST.md.',
    ).toEqual([]);
  });

  it('chaque borne écrite reste attachée à une RPC réellement appelée', () => {
    // Sinon la table enfle de justifications périmées et perd sa valeur de
    // recensement : on ne saurait plus lesquelles décrivent le code d'aujourd'hui.
    const orphelines = Object.keys(BORNES)
      .filter((nom) => {
        const def = RETOUR_EFFECTIF.get(nom);
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
