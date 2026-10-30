import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Garde-fou : aucune lecture de donnée client hors du périmètre de l'appelant.
 *
 * ── Le défaut que ce test verrouille ────────────────────────────────────────
 *
 * Les routes parlent à la base par la clé service_role, qui CONTOURNE la RLS.
 * Ce qui décide qu'un client MARINE ne lit pas les concessions BMW n'est donc
 * pas la base : c'est chaque route, une par une. Le 2026-10-08, deux routes
 * sur dix-sept appliquaient la règle. Les quinze autres — battle
 * d'isochrones, liste des natures, panneaux, Voronoï, clusters, outils du
 * chat — rendaient les POI, leurs noms ou leurs coordonnées à quiconque était
 * connecté.
 *
 * Aucune n'était fausse au moment de son écriture : la règle n'existait que
 * dans deux fichiers, et rien ne forçait la troisième route à la connaître.
 *
 * ── Ce que le test exige ────────────────────────────────────────────────────
 *
 * Tout fichier de `app/api` (hors `/api/admin`, réservé au super_admin) et de
 * `lib/` qui lit une table de données client doit passer par la règle :
 * `lib/auth/perimetre-donnees.ts` ou `lib/auth/getOrgSourceIds.ts` (les outils
 * du chat et leur `orgContext.ts` sont supprimés depuis le 2026-10-12).
 *
 * Quand ce test échoue : brancher `filtrerParSourcesVisibles` (ou
 * `reserverAuSuperAdmin`). Si la lecture est vraiment sans risque, l'inscrire
 * ci-dessous AVEC sa justification — une décision écrite, pas un oubli.
 */

const RACINE = process.cwd();

/**
 * Tables et RPC dont le contenu appartient à une organisation.
 *
 * Depuis sql/288 (2026-10-28, lot « Catalogue et groupes »), un INDICATEUR peut être privé à un espace : le registre,
 * ses valeurs matérialisées, la table de l'abstention et chaque RPC qui calcule sur un indicateur en font partie.
 * Ces lectures passent par `indicateursVisibles` (perimetre-donnees.ts).
 *
 * Les trois tables d'indicateurs sont reconnues en LITTÉRAL QUELCONQUE, pas seulement dans `from('…')` : l'export de
 * stratégie écrivait `const SOURCE = { table: 'indicator_cp_values' }` puis `.from(SOURCE.table)`, et lisait les
 * valeurs d'un indicateur privé sans que ce verrou le voie (relecture T1-T3, n° 1 et 3).
 *
 * ⚠ Le verrou vérifie que le fichier IMPORTE la règle, pas qu'il l'APPELLE au bon endroit : c'est à la relecture et
 * aux tests d'accès croisé (tests/integration/indicateurs-privables.test.ts) de le prouver.
 */
const LECTURE_CLIENT = new RegExp(
  String.raw`from\(\s*'(poi_france|panneaux_affichage|isochrones_cache|poi_clusters|poi_cluster_history|clustering_models|clustering_jobs|geography_zones)'\s*\)`
  + String.raw`|'(cible_indicator_registry|indicator_cp_values|dataset_abstention_2022)'`
  + String.raw`|rpc\(\s*'(get_voronoi[a-z_]*|get_battle_geometry|compte_poi_par_categorie|poi_count_by_categorie|get_poi_near_panneau|panneaux_near_point|count_poi_by_categorie_source|get_poi_categories|types_poi_clustering`
  + String.raw`|get_civic_layer_geojson|get_indicator_threshold_selection|calculer_score_composite[a-z_]*|materialize_indicator_cp_values|etat_indicateur_cp|zone_seuil_territoire|alignement_par_maille_geo`
  + String.raw`|materialiser_indicateur_cp|correlation_campagne_indicateur|apply_zone_weights_to_strategy`
  // ④ finitions (2026-10-30) : POI d'une zone (bataille V2, sql/297) et typologies d'une zone (sql/298).
  + String.raw`|poi_de_zone|typologies_de_zone)'`,
);

const REGLE = /from '@\/lib\/auth\/(perimetre-donnees|getOrgSourceIds)'/;

const ASSUMEES = new Map<string, string>([
  ['lib/auth/perimetre-donnees.ts', 'L\'application de la règle elle-même.'],
  ['lib/import/inserter.ts',
   'Écrivain des imports, appelé seulement par /api/admin/import-* (super_admin).'],
  ['lib/ooh/plan/ecrire.ts',
   'Écrivain du script scripts/ooh/importer-plan.ts (service_role, hors route) : il écrit les panneaux d\'une campagne '
   + 'dans une source PRIVÉE de l\'espace et ne rend rien à un appelant HTTP.'],
  ['lib/import/geo-enricher.ts',
   'Enrichissement des imports, appelé seulement depuis /api/admin (super_admin).'],
  ['lib/supabase/tables.ts', 'Types et commentaires : aucune requête exécutée.'],
  ['lib/isochrones/fetcher.ts',
   'Lit et écrit le cache par la clé que lui passe l\'appelant '
   + '(/api/isochrone-battle, seul appelant depuis le retrait du chat).'],
  ['lib/poi/categories.ts',
   'getDistinctCategories sert au contrôle interne ; ce qui est montré passe par '
   + 'getCategoriesVisibles, dans le même fichier, qui prend le périmètre.'],
  ['app/api/zones/jeux/[id]/export/route.ts',
   'Ne lit que categorie=risque_industriel (installations classées Géorisques, '
   + 'référentiel public) ; le jeu de zones est déjà contrôlé par org_id.'],
  ['app/api/zones/jeux/[id]/extractions/[version]/export/route.ts',
   'Même raison que l\'export du jeu : sites ICPE publics, jeu contrôlé par org_id.'],
  ['lib/analyses/indicateurs.ts',
   'Matérialisation d\'un indicateur (`assurerIndicateurCp`), appelée seulement par /api/analyses/score et '
   + '/api/analyses/correlation, qui refusent un indicateur hors de `indicateursVisibles` AVANT de l\'appeler.'],
  ['lib/zones/executer-recette.ts',
   'La recette `seuil_territoire` refuse tout indicateur absent de `ctx.indicateurs` (absent = refus) ; son seul '
   + 'appelant, `executerDansEspace` (lib/zones/session-zones.ts), le remplit par `indicateursVisiblesDeLaSession`.'],
  ['lib/donnees/registre-fraicheur.ts',
   'Descripteurs de la page Fraîcheur (administration, /api/admin/fraicheur-donnees) : le nom de table sert à mesurer '
   + 'une DATE d\'ingestion (max(computed_at)), jamais une valeur d\'indicateur.'],
  ['lib/clustering/lire-clusters.ts',
   'Lectures paginées de poi_clusters / poi_france pour les routes /api/poi-clusters, '
   + 'qui appellent reserverAuSuperAdmin AVANT (clustering réservé au super_admin, 2026-10-08).'],
]);

function fichiers(dossier: string): string[] {
  const out: string[] = [];
  for (const nom of readdirSync(dossier)) {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) out.push(...fichiers(chemin));
    else if (/\.tsx?$/.test(nom) && !/\.(test|spec)\.tsx?$/.test(nom)) out.push(chemin);
  }
  return out;
}

const candidats = [...fichiers(join(RACINE, 'app', 'api')), ...fichiers(join(RACINE, 'lib'))]
  .map((f) => relative(RACINE, f).split(sep).join('/'))
  .filter((f) => !f.startsWith('app/api/admin/'));

describe('périmètre des données — chaque lecture de donnée client passe par la règle', () => {
  const lecteurs = candidats.filter((f) => LECTURE_CLIENT.test(readFileSync(join(RACINE, f), 'utf8')));

  it('trouve bien des lecteurs (le motif n est pas devenu aveugle)', () => {
    expect(lecteurs.length).toBeGreaterThan(15);
  });

  for (const f of lecteurs) {
    it(f, () => {
      if (ASSUMEES.has(f)) return;
      const source = readFileSync(join(RACINE, f), 'utf8');
      expect(REGLE.test(source), `${f} lit une table de données client sans la règle de périmètre`).toBe(true);
    });
  }

  it('chaque exception déclarée existe encore et lit encore une table client', () => {
    for (const f of ASSUMEES.keys()) {
      expect(lecteurs, `exception obsolète : ${f}`).toContain(f);
    }
  });
});

describe('API clustering — réservée au super_admin', () => {
  // Les modèles portent sur les POI de TOUTES les organisations : aucun
  // filtrage ligne à ligne n'est possible, la seule fermeture est la garde.
  const routes = candidats.filter((f) => f.startsWith('app/api/poi-clusters/') && f.endsWith('route.ts'));

  it('les routes existent', () => {
    expect(routes.length).toBeGreaterThan(10);
  });

  for (const f of routes) {
    it(f, () => {
      const source = readFileSync(join(RACINE, f), 'utf8');
      const handlers = (source.match(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g) ?? []).length;
      const gardes = (source.match(/await reserverAuSuperAdmin\(/g) ?? []).length;
      expect(gardes, `${f} : ${handlers} handler(s), ${gardes} garde(s)`).toBe(handlers);
    });
  }
});

describe('campagnes multi-média — toute lecture d une route passe par l espace actif', () => {
  // Les campagnes et leurs panneaux sont PRIVÉS à un espace (spec 2026-10-16-ooh-campagnes, décision 5). Les routes
  // lisent par service_role : c'est le `p_org` de l'espace actif, et lui seul, qui cloisonne.
  const LECTURE_CAMPAGNE = /rpc\(\s*'(campagne_ooh_jsonb|campagnes_ooh_jsonb)'|from\(\s*'(campagnes|campagne_lignes|campagne_ligne_panneaux)'\s*\)/;
  const routes = candidats.filter((f) => f.startsWith('app/api/') && LECTURE_CAMPAGNE.test(readFileSync(join(RACINE, f), 'utf8')));

  it('les routes de campagne existent (le motif n est pas aveugle)', () => {
    expect(routes.length).toBeGreaterThanOrEqual(2);
  });

  for (const f of routes) {
    it(f, () => {
      const source = readFileSync(join(RACINE, f), 'utf8');
      // `orgIdActif` (lib/auth/getSessionOrg.ts) lit la session et valide l'UUID de l'espace.
      expect(source, `${f} doit lire la session`).toMatch(/\b(getSessionOrg|orgIdActif)\(/);
      expect(source, `${f} doit passer l espace actif à la RPC`).toMatch(/p_org:\s*orgId/);
    });
  }
});
