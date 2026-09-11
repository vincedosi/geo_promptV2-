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

const mapInit = lire('app/copilote/_hooks/useMapInit.ts');
const mapLayers = lire('app/copilote/_hooks/useMapLayers.ts');
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
  it('ne demande aucune tuile sous le zoom 9', () => {
    // Mesuré : une tuile z5 pèse 1 694 kB pour 31 149 IRIS dont chacun fait
    // 0,6 px. Le plancher est posé aux TROIS endroits, et chacun compte : la
    // source (MapLibre ne demande rien en dessous), la couche, et la route.
    expect(mapInit).toMatch(/tiles:\s*\[`\$\{window\.location\.origin\}\/api\/tiles\/iris[^\]]*\],\s*\n\s*minzoom:\s*9/);
    const route = lire('app/api/tiles/iris/[z]/[x]/[y]/route.ts');
    expect(route).toContain('ZOOM_PLANCHER = 9');
  });

  it('les trois couches IRIS partagent le même plancher', () => {
    const planchers = [...mapInit.matchAll(/id:\s*'iris-(fill|border|extrusion)'[\s\S]{0,400}?minzoom:\s*(\d+)/g)]
      .map(m => ({ couche: m[1], minzoom: Number(m[2]) }));
    expect(planchers).toHaveLength(3);
    for (const p of planchers) {
      expect(p.minzoom, `iris-${p.couche}`).toBe(9);
    }
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

  it('la hauteur est un multiple de la largeur de maille, jamais des mètres', () => {
    // Une hauteur absolue donnait 0,2× de relief en vue large et 17× en vue
    // rapprochée sur les carreaux — défaut mesuré puis corrigé le même jour.
    // Ici l'échelle vient de `superficie_km2`, que la tuile porte.
    const bloc = mapLayers.slice(mapLayers.indexOf('applyIrisHauteur'));
    expect(bloc).toContain("['get', 'superficie_km2']");
    expect(bloc).toContain('sqrt');
  });

  it('la couche en relief porte la MÊME couleur que le plat', () => {
    // Basculer en 3D ne doit pas changer la lecture, seulement l'axe sur
    // lequel on la lit.
    expect(mapLayers).toContain("setPaintProperty('iris-extrusion', 'fill-extrusion-color', expr)");
  });
});
