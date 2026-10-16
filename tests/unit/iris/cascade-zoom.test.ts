import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { IRIS_ZOOM_PLANCHER, IRIS_TILE_VERSION } from '@/lib/version';
import {
  valeurNormaliseeExpr, echelleLogExpr, donneeIrisExploitableExpr,
  niveauAuZoom, echelleDe, uniteIris, type BornesIris,
} from '@/lib/iris/echelle';

/**
 * Cascade de zoom des IRIS (sql/138-140).
 *
 * La couche IRIS avait un plancher a z9 alors que la carte demarre a z5,5 :
 * sous le minzoom d'une source, MapLibre ne demande AUCUNE tuile et n'emet
 * aucune erreur. Activer la couche depuis la vue France ne montrait rien.
 *
 * La reponse n'est pas de baisser le plancher sur les IRIS bruts — une tuile z8
 * parisienne couvre 4 251 IRIS — mais d'AGREGER, comme les carreaux : des
 * departements sous z7, des communes a z7-z8, des IRIS au-dela.
 *
 * Ces tests verrouillent ce qui se verifie sans MapLibre ni base : la coherence
 * des paliers, la forme des expressions, et le fait que la regle d'agregation
 * n'a qu'UNE definition.
 */

const lire = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const sqlAgg    = lire('sql/138_iris_agregats_cascade.sql');
const sqlTuile  = lire('sql/139_get_iris_tile_cascade.sql');
const sqlBornes = lire('sql/140_iris_bornes_echelle.sql');
const mapLayers = lire('app/map/_hooks/useMapLayers.ts');

/** Bornes de reference : `population`, mesurees le 2026-09-12. */
const POPULATION: BornesIris = {
  colonne: 'population', classe: 'effectif',
  log_min: 1.398, log_max: 4.782, val_min: 24.99, val_max: 60555.21,
};
const TAUX: BornesIris = {
  colonne: 'taux_proprio', classe: 'proportion',
  log_min: 1.696, log_max: 1.960, val_min: 49.63, val_max: 91.3,
};

describe('les paliers couvrent le zoom par defaut de la carte', () => {
  it('le plancher descend au meme niveau que les carreaux', () => {
    // DEFAULT_ZOOM vaut 5,5. Un plancher a 9 rendait la couche muette au
    // chargement : c'est LE defaut remonte par l'utilisateur.
    const mapInit = lire('app/map/_hooks/useMapInit.ts');
    expect(mapInit).toContain('const DEFAULT_ZOOM = 5.5;');
    expect(IRIS_ZOOM_PLANCHER).toBeLessThanOrEqual(5);
  });

  it('la cascade SQL couvre tout le zoom a partir du plancher, sans trou', () => {
    // Les trois paliers doivent se toucher : un trou rendrait une bande de
    // zoom vide, et une carte vide passe pour une panne.
    expect(sqlTuile).toMatch(/IF z IS NULL OR z < 4 THEN\s*\n\s*RETURN NULL/);
    expect(sqlTuile).toMatch(/IF z <= 6 THEN[\s\S]{0,120}iris_agg_departement/);
    expect(sqlTuile).toMatch(/ELSIF z <= 8 THEN[\s\S]{0,120}iris_agg_commune/);
    expect(sqlTuile).toMatch(/ELSE[\s\S]{0,200}v_table := 'iris';/);
  });

  it('le front nomme le MEME palier que le SQL', () => {
    // Le panneau annonce « Départements » / « Communes » / « IRIS ». S'il
    // decoupait autrement que la RPC, il mentirait sur ce qui est affiche.
    expect(niveauAuZoom(4)).toBe('departement');
    expect(niveauAuZoom(6)).toBe('departement');
    expect(niveauAuZoom(7)).toBe('commune');
    expect(niveauAuZoom(8)).toBe('commune');
    expect(niveauAuZoom(9)).toBe('iris');
    expect(niveauAuZoom(14)).toBe('iris');
  });

  it('un zoom fractionnaire nomme la tuile REELLEMENT servie', () => {
    // MapLibre demande la tuile `floor(zoom)`. A 6,5 la tuile est la z6, donc
    // des departements — le panneau annoncait « Communes ». Constate au
    // navigateur, sur tout le demi-cran superieur de CHAQUE palier : la
    // premiere version de ce test ne testait que des entiers et laissait
    // passer le defaut.
    expect(niveauAuZoom(5.5)).toBe('departement');
    expect(niveauAuZoom(6.5)).toBe('departement');
    expect(niveauAuZoom(6.99)).toBe('departement');
    expect(niveauAuZoom(7.01)).toBe('commune');
    expect(niveauAuZoom(8.9)).toBe('commune');
    expect(niveauAuZoom(9.01)).toBe('iris');
  });

  it('la version de tuile a ete bumpee avec le changement de schema', () => {
    // Les memes coordonnees servent desormais un AUTRE objet, et la feature
    // porte `niveau`. Sans bump, une tuile en cache (1 semaine au CDN) serait
    // servie sans `niveau` : le filtre « vrais IRIS » la masquerait entierement.
    expect(IRIS_TILE_VERSION).toBeGreaterThanOrEqual(2);
  });
});

describe('la regle d agregation n a qu une definition', () => {
  it('classe_iris est la source, et les deux constructeurs la lisent', () => {
    // L'agregation (sommer ou moyenner ?) et les bornes (diviser par la
    // surface ? quel quantile ?) repondaient a la meme question. Deux copies,
    // c'est une divergence programmee au prochain indicateur importe.
    expect(sqlAgg).toContain('CREATE OR REPLACE FUNCTION public.classe_iris');
    expect(sqlAgg).toContain('classe_iris(c.column_name)');
    expect(sqlBornes).toContain('classe_iris(c.column_name)');
  });

  it('la classe est DERIVEE du nom, jamais une liste en dur', () => {
    // Les colonnes d'`iris` sont dynamiques (CLAUDE.md) : une liste serait
    // fausse au prochain import, et fausse en silence.
    const corps = sqlAgg.slice(sqlAgg.indexOf('FUNCTION public.classe_iris'));
    const definition = corps.slice(0, corps.indexOf('$function$;'));
    expect(definition).toContain("LIKE 'pop\\_%'");
    expect(definition).toContain("LIKE 'nb\\_%'");
    expect(definition).toContain("LIKE 'densite\\_%'");
    // Aucun nom d'indicateur precis ne doit apparaitre dans la regle.
    expect(definition).not.toContain('pop_15_29');
    expect(definition).not.toContain('taux_chomage');
  });

  it('une densite est RECALCULEE, jamais moyennee', () => {
    // Moyenner des densites de mailles inegales est faux : la moyenne des
    // quotients n'est pas le quotient des sommes.
    expect(sqlAgg).toContain('a.population / nullif(a.superficie_km2,0)');
  });

  it('la superficie agregee est la somme des IRIS, pas l aire du polygone', () => {
    // C'est ce qui rend les densites comparables d'un palier a l'autre PAR
    // CONSTRUCTION. Mesure : 638 019 km2 identiques aux trois paliers.
    expect(sqlAgg).toMatch(/sum\(ST_Area\(i\.geom_3857\)[\s\S]{0,120}AS\s*\n?\s*superficie_km2/);
  });
});

describe('les valeurs restent comparables entre paliers', () => {
  it('un effectif se rapporte a la surface, une proportion se lit telle quelle', () => {
    // Sans division, la somme d'un departement (~475 IRIS) saturerait toute
    // l'echelle et la vue France serait un aplat.
    expect(JSON.stringify(valeurNormaliseeExpr('population', 'effectif')))
      .toContain('superficie_km2');
    expect(JSON.stringify(valeurNormaliseeExpr('taux_proprio', 'proportion')))
      .not.toContain('superficie_km2');
    // Une densite est DEJA par km2 : la rediviser la reduirait au carre.
    expect(JSON.stringify(valeurNormaliseeExpr('densite_pop', 'densite')))
      .not.toContain('superficie_km2');
  });

  it('l echelle est logarithmique et ne peut pas produire log(0)', () => {
    // `log10(0)` vaut -Infinity et contaminerait toute l'interpolation en
    // silence. Le plancher est la borne basse mesuree.
    const expr = echelleLogExpr(POPULATION);
    expect(expr[0]).toBe('log10');
    expect(JSON.stringify(expr)).toContain(String(POPULATION.val_min));
  });

  it('une donnee absente est ecartee, jamais lue comme un zero', () => {
    // MVT OMET une propriete nulle. Sans garde, `to-number` la rendrait 0 et
    // la maille se peindrait au bas de l'echelle : « personne ici » au lieu de
    // « on ne sait pas ».
    const garde = JSON.stringify(donneeIrisExploitableExpr('population', 'effectif'));
    expect(garde).toContain('has');
    expect(garde).toContain('superficie_km2');
    // Une proportion n'a pas besoin du denominateur : l'exiger masquerait des
    // mailles parfaitement exploitables.
    expect(JSON.stringify(donneeIrisExploitableExpr('taux_proprio', 'proportion')))
      .not.toContain('superficie_km2');
  });

  it('l unite affichee porte son denominateur', () => {
    // Un effectif normalise affiche sans « /km² » se lit comme un total.
    expect(uniteIris('effectif')).toBe('/km²');
    expect(uniteIris('densite')).toBe('/km²');
    expect(uniteIris('proportion')).toBe('');
  });

  it('les bornes s adaptent aux helpers d echelle partages', () => {
    expect(echelleDe(POPULATION)).toEqual({ min: 1.398, max: 4.782 });
    expect(echelleDe(TAUX).max).toBeGreaterThan(echelleDe(TAUX).min);
  });
});

describe('le front ne peut pas figer ce que la base fait varier', () => {
  it('les bornes viennent de la base, pas d une table TypeScript', () => {
    // Les carreaux ont `lib/carreaux/bornes.ts`, une table statique — leurs
    // colonnes Filosofi sont figees. Celles d'`iris` sont dynamiques : une
    // table statique y serait fausse des le prochain indicateur importe.
    expect(sqlBornes).toContain('CREATE TABLE IF NOT EXISTS public.iris_bornes_echelle');
    expect(mapLayers).toContain("fetch('/api/iris/bornes')");
    const echelle = lire('lib/iris/echelle.ts');
    expect(echelle).not.toMatch(/pop_15_29\s*:/);   // aucune borne en dur
    expect(echelle).not.toMatch(/population\s*:\s*\{/);
  });

  it('la couche ne rebalaye plus `iris` a chaque changement d indicateur', () => {
    // `/api/iris/stats` faisait un percentile_cont sur 49 448 lignes PAR
    // COLONNE consultee — un full scan par indicateur, ce que le budget I/O
    // Nano ne peut pas absorber.
    // On vise l'APPEL, pas la mention : le commentaire qui explique pourquoi
    // cette route a ete abandonnee a toute sa place dans le fichier.
    expect(mapLayers).not.toMatch(/fetch\(\s*[`'"]\/api\/iris\/stats/);
  });

  it('le filtre « vrais IRIS » ne vide pas les paliers agreges', () => {
    // `is_true_iris` n'existe QU'AU palier IRIS. Filtrer dessus sans condition
    // masquerait tout departement et toute commune : `['get']` rend `null` sur
    // une propriete absente, et `null != true`.
    const bloc = mapLayers.slice(mapLayers.indexOf('const filter = irisTrueOnly'));
    const corps = bloc.slice(0, bloc.indexOf('setFilter'));
    expect(corps).toContain("['!=', ['get', 'niveau'], 'iris']");
  });

  it('la tuile porte le palier, pour que rien ne le devine', () => {
    expect(sqlTuile).toContain("%L::text AS niveau");
    expect(sqlTuile).toContain('superficie_km2');
  });
});
