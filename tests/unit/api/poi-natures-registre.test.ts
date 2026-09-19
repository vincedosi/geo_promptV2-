import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Verrou structurel sur un défaut d'I/O, pas sur un comportement.
 *
 * Le chemin générique de cette route pagine toutes les lignes de la catégorie
 * en tirant la colonne `metadata` entière. Sur les 138 423 installations
 * classées, c'est ~140 Mo de jsonb rapatriés pour en extraire quinze chaînes :
 * la famille de l'incident du 28/03. Si quelqu'un retire le cas registre, ce
 * test doit rougir AVANT que la production ne s'en aperçoive.
 */
const SRC = readFileSync(join(process.cwd(), 'app/api/map/poi-natures/route.ts'), 'utf8');

describe('poi-natures ne balaye pas les 138 423 ICPE', () => {
  it('sert la catégorie risque industriel depuis le registre borné', () => {
    expect(SRC).toContain('icpe_rubrique_familles');
    expect(SRC).toContain('CATEGORIE_ICPE');
  });

  it('court-circuite AVANT le chemin paginé', () => {
    const posRegistre = SRC.indexOf('if (categorie === CATEGORIE_ICPE)');
    const posPagination = SRC.indexOf("from('poi_france')");
    expect(posRegistre).toBeGreaterThan(-1);
    expect(posRegistre).toBeLessThan(posPagination);
  });

  it('inclut le libellé de repli — 70 % des sites n ont pas de rubrique exploitable', () => {
    expect(SRC).toContain('NATURE_NON_PRECISEE');
  });

  it('laisse le chemin générique intact pour les autres catégories', () => {
    // Pas de refactor non demandé : les lycées et les POI importés continuent
    // de passer par la pagination existante.
    expect(SRC).toContain("from('poi_france')");
    expect(SRC).toContain('naturesSet');
  });
});
