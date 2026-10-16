import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Garde-fous de la couche IRIS (TER-001, TER-003, TER-006).
 *
 * Ces tests lisent le code source plutôt que d'exécuter MapLibre : une couche
 * cartographique ne s'instancie pas en test unitaire, et c'est précisément ce
 * qui a permis au défaut de durer six mois — la couche IRIS pointait vers un
 * fichier absent de la production, sans qu'aucune erreur ne se déclenche nulle
 * part.
 *
 * Ce qu'ils verrouillent est donc ce qui se lit dans le source, et rien de plus.
 */

const RACINE = process.cwd();
const lire = (p: string) => readFileSync(join(RACINE, p), 'utf8');

const mapInit = lire('app/map/_hooks/useMapInit.ts');
const mapLayers = lire('app/map/_hooks/useMapLayers.ts');
const vercelignore = lire('.vercelignore');

describe('la couche IRIS doit pouvoir s afficher en production', () => {
  it('ne dépend plus d un fichier exclu du déploiement', () => {
    // Le défaut d'origine : `pmtiles:///iris_france.pmtiles`, un fichier de
    // 361 Mo que `.vercelignore` exclut. En production, l'URL rendait la page
    // 404 de Next — `<!DOCTYP` au lieu de `PMTiles`.
    expect(vercelignore).toContain('*.pmtiles');   // l'exclusion est toujours là
    expect(mapInit).not.toContain('pmtiles://');   // la carte n'en dépend plus
  });

  it('sert les IRIS par une route de tuiles interne', () => {
    expect(mapInit).toContain('/api/tiles/iris/{z}/{x}/{y}');
  });

  it('place la route sous /api/tiles, seul préfixe déjà protégé', () => {
    // `middleware.ts` est PROTÉGÉ par CLAUDE.md, et son matcher raisonne par
    // segment : `/api/iris/:path*` ne couvrirait pas `/api/iris-tiles`. Placer
    // la route sous `/api/tiles/` la protège sans toucher au fichier.
    const middleware = lire('middleware.ts');
    expect(middleware).toContain("'/api/tiles/:path*'");
    expect(middleware).toContain("'/api/tiles'");
  });
});

describe('cascade de zoom des IRIS', () => {
  const version = lire('lib/version.ts');
  const route = lire('app/api/tiles/iris/[z]/[x]/[y]/route.ts');

  it('le plancher a UNE seule definition', () => {
    // Quatre copies du chiffre 9 vivaient dans deux fichiers. Il suffisait d'en
    // changer une pour que la couche demande des tuiles que la route refuse.
    expect(version).toMatch(/export const IRIS_ZOOM_PLANCHER = \d+;/);
    expect(route).toContain('IRIS_ZOOM_PLANCHER');
    expect(route).not.toMatch(/const\s+ZOOM_PLANCHER\s*=/);   // plus de copie locale
    expect(mapInit).toContain('IRIS_ZOOM_PLANCHER');
  });

  it('la source et les trois couches lisent cette constante, pas un litteral', () => {
    // Mesure : une tuile z5 pese 1 694 kB pour 31 149 IRIS dont chacun fait
    // 0,6 px. Le plancher compte aux QUATRE endroits -- la source (MapLibre ne
    // demande RIEN en dessous de son minzoom), et chacune des trois couches.
    const source = mapInit.slice(mapInit.indexOf("addSource(\'iris-source\'"));
    expect(source.slice(0, source.indexOf('});'))).toMatch(
      /[/]api[/]tiles[/]iris[\s\S]*?minzoom:\s*IRIS_ZOOM_PLANCHER/,
    );
    const planchers = [...mapInit.matchAll(
      /id:\s*'iris-(fill|border|extrusion)'[\s\S]{0,400}?minzoom:\s*([A-Za-z_]+|\d+)/g,
    )].map(m => ({ couche: m[1], minzoom: m[2] }));
    expect(planchers).toHaveLength(3);
    for (const p of planchers) {
      expect(p.minzoom, `iris-${p.couche}`).toBe('IRIS_ZOOM_PLANCHER');
    }
  });

  it('activer la couche sous le plancher remonte la camera', () => {
    // LE defaut remonte par l'utilisateur : la carte demarre a z5,5
    // (DEFAULT_ZOOM) et le plancher est a z9. Cocher la couche ne produisait
    // rien -- pas de tuile demandee, pas d'erreur, une carte vide qui se lit
    // comme une panne. On ne baisse PAS le plancher en echange : une tuile z8
    // parisienne couvre 4 251 IRIS, et la France tient en ~75 tuiles z8.
    const bloc = mapLayers.slice(mapLayers.indexOf('const setIrisVisible'));
    expect(bloc).toMatch(/getZoom\(\)\s*<\s*IRIS_ZOOM_PLANCHER/);
    expect(bloc).toMatch(/easeTo\(\{\s*zoom:\s*IRIS_ZOOM_PLANCHER/);
    // ... et seulement a l'activation : on ne contrarie pas un dezoom volontaire.
    expect(bloc.slice(0, bloc.indexOf('getZoom()'))).toContain('if (!next) return;');
  });

  it('le panneau annonce le plancher au lieu de laisser une carte vide muette', () => {
    // Le badge de zoom de useMapInit est du DOM hors React : le panneau n'avait
    // aucun moyen de savoir a quel zoom on se trouve.
    expect(mapLayers).toContain("map.on('zoomend', releve)");
    expect(mapLayers).toContain('irisZoomPlancher: IRIS_ZOOM_PLANCHER');
    const section = lire('app/map/_components/filter-panel/IrisSection.tsx');
    expect(section).toMatch(/zoomCourant\s*<\s*irisZoomPlancher/);
    expect(section).toContain('sousLePlancher &&');
  });
});

describe('is_true_iris ne doit jamais filtrer l affichage par défaut', () => {
  it('la tuile PORTE la colonne, mais la RPC ne filtre pas dessus', () => {
    // Mesuré : sur une tuile z10 de France rurale, 50 IRIS présents et ZÉRO
    // avec `is_true_iris`. Filtrer d'office effacerait la France rurale, où
    // l'IRIS est la commune entière. La colonne est émise pour que le filtre
    // optionnel de la couche fonctionne, jamais appliquée dans la RPC.
    const sql = lire('sql/137_get_iris_tile_mvt.sql');
    expect(sql).toContain("'boolean'");                 // la colonne est émise
    expect(sql).not.toMatch(/WHERE[^;]*is_true_iris/i); // mais jamais filtrée
  });

  it('le defaut est de NE PAS filtrer', () => {
    // CLAUDE.md : `is_true_iris = true` sert l'analyse statistique, JAMAIS
    // l'affichage. Le defaut etait `true` -- mesure sur une tuile z10 rurale :
    // 50 IRIS presents, ZERO passant le filtre. Les trois quarts du territoire
    // en blanc, sans rien pour l'expliquer.
    expect(mapLayers).toMatch(/\[irisTrueOnly,\s*setIrisTrueOnly\]\s*=\s*useState\(false\)/);
  });

  it('le filtre optionnel porte sur les trois couches', () => {
    // Oublier `iris-extrusion` laisserait le relief afficher des IRIS que le
    // plat vient de masquer.
    const bloc = mapLayers.slice(mapLayers.indexOf("const filter = irisTrueOnly"));
    expect(bloc).toContain("setFilter('iris-fill'");
    expect(bloc).toContain("setFilter('iris-border'");
    expect(bloc).toContain("setFilter('iris-extrusion'");
  });
});

describe('relief 3D des IRIS', () => {
  it('plat et relief ne sont jamais visibles ensemble', () => {
    // Géométries coplanaires à la base : les afficher ensemble produit du
    // z-fighting sur la face supérieure.
    expect(mapLayers).toMatch(/const plat\s*=\s*irisVisible && !iris3D/);
    expect(mapLayers).toMatch(/const relief\s*=\s*irisVisible &&\s*iris3D/);
  });

  it('la hauteur delegue a l expression PARTAGEE avec les carreaux', () => {
    // Une hauteur absolue donnait 0,2x de relief en vue large et 17x en vue
    // rapprochee sur les carreaux -- defaut mesure puis corrige. L'expression
    // partagee `hauteurExtrusionExpr` porte la lecon ; la recopier ici la
    // laisserait diverger au premier ajustement.
    const bloc = mapLayers.slice(mapLayers.indexOf('const applyIrisHauteur'));
    const corps = bloc.slice(0, bloc.indexOf('}, []);'));
    expect(corps).toContain('hauteurExtrusionExpr(');
    // Et l'echelle passee est la MEME que celle de la couleur : hauteur et
    // teinte doivent dire la meme chose, sinon la 3D contredit la carte.
    expect(corps).toContain('echelleLogExpr(bornes)');
    // La largeur de maille vient de superficie_km2, via le helper partage.
    const helpers = lire('lib/carreaux/expressions.ts');
    expect(helpers).toContain("['get', 'superficie_km2']");
  });

  it('la couche en relief porte la MÊME couleur que le plat', () => {
    // Basculer en 3D ne doit pas changer la lecture, seulement l'axe sur
    // lequel on la lit.
    expect(mapLayers).toContain("setPaintProperty('iris-extrusion', 'fill-extrusion-color', expr)");
  });
});
