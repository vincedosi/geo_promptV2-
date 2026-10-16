import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * L'import ArcGIS de Brest est supprimé (spec 2026-10-16-ooh-campagnes § 1 décision 6, § 10) : route, page, et tout
 * lien qui y menait — React (gelé, mais un lien mort y mènerait à un 404) comme Angular.
 */
const RACINE = process.cwd();

function fichiers(dossier: string): string[] {
  const out: string[] = [];
  for (const nom of readdirSync(dossier)) {
    if (nom === 'node_modules' || nom === '.next') continue;
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) out.push(...fichiers(chemin));
    else if (/\.(ts|tsx|html)$/.test(nom)) out.push(chemin);
  }
  return out;
}

describe('import ArcGIS — retiré', () => {
  it('la route et la page n existent plus', () => {
    expect(existsSync(join(RACINE, 'app', 'api', 'admin', 'import-ooh', 'arcgis', 'route.ts'))).toBe(false);
    expect(existsSync(join(RACINE, 'app', 'admin', 'ooh-import', 'page.tsx'))).toBe(false);
  });

  it('aucun lien ni appel ne vise /admin/ooh-import ou /api/admin/import-ooh', () => {
    const candidats = ['app', 'components', 'lib', join('angular', 'src')].flatMap((d) => fichiers(join(RACINE, d)));
    const fautifs = candidats
      .filter((f) => /['"`]\/admin\/ooh-import['"`]|\/api\/admin\/import-ooh/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(RACINE, f).split(sep).join('/'));
    expect(fautifs).toEqual([]);
  });

  it('plus aucune entrée « Import OOH » dans la navigation Angular', () => {
    for (const f of [
      'angular/src/app/layout/navigation.ts',
      'angular/src/app/features/carte/panneaux/reglages.component.ts',
      'angular/src/app/features/accueil/accueil.page.ts',
    ]) {
      expect(readFileSync(join(RACINE, f), 'utf8'), f).not.toMatch(/libelle:\s*'Import OOH'/);
    }
  });
});
