import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Le groupe d'espaces ne porte RIEN (spec carte-en-parcours V9 ; sql/289, A-9) : il range la colonne d'Accès en
 * dossiers, et c'est tout. Aucun droit, aucune donnée, aucune recommandation ne s'y attache.
 *
 * Le jour où une route de la carte lirait `organizations.groupe_espace`, un groupe se mettrait à décider de ce qu'on
 * voit — un second modèle de droits, sans écran ni règle écrite. Ce test l'interdit : seuls l'administration
 * (`app/api/admin`, les deux lecteurs d'administration de `lib/espaces` ci-dessous) et l'écran Accès d'Angular (hors
 * `features/carte`) le nomment.
 *
 * L'exemption de `lib/espaces` est NOMINATIVE (revue finale du lot, n° 4) : ce dossier porte aussi des fichiers de la
 * règle de droits (`appartenance.ts`, importé par `lib/auth/getSessionOrg.ts`), où un `groupe_espace` deviendrait une
 * règle de droit. Un lecteur exempté appelé hors administration ne doit pas exposer le groupe : la fiche d'un jeu
 * (`app/api/map/catalogue/fiche`) lit donc les noms des espaces elle-même, sans `lireEspacesBruts`.
 */
const EXEMPTES_LIB_ESPACES = new Set(['lib/espaces/lister-espaces.ts', 'lib/espaces/types.ts']);
const RACINE = process.cwd();

function fichiers(dossier: string): string[] {
  const out: string[] = [];
  for (const nom of readdirSync(dossier)) {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) out.push(...fichiers(chemin));
    else if (/\.(tsx?|html)$/.test(nom)) out.push(chemin);
  }
  return out;
}

const rel = (f: string) => relative(RACINE, f).split(sep).join('/');
const mentionne = (f: string) => readFileSync(join(RACINE, f), 'utf8').includes('groupe_espace');

describe('groupe d espaces — lu par l administration seule', () => {
  const surveilles = [
    ...fichiers(join(RACINE, 'app')).map(rel).filter((f) => !f.startsWith('app/api/admin/')),
    ...fichiers(join(RACINE, 'lib')).map(rel).filter((f) => !EXEMPTES_LIB_ESPACES.has(f)),
    ...fichiers(join(RACINE, 'angular', 'src', 'app', 'features', 'carte')).map(rel),
  ];

  it('le motif n est pas aveugle : l administration le nomme bien', () => {
    expect(surveilles.length).toBeGreaterThan(300);
    expect(mentionne('lib/espaces/lister-espaces.ts')).toBe(true);
    expect(mentionne('app/api/admin/organizations/[id]/route.ts')).toBe(true);
    // La règle de droits de `lib/espaces` est bien surveillée, elle.
    expect(surveilles).toContain('lib/espaces/appartenance.ts');
  });

  it('aucun fichier de la carte ni route hors /api/admin ne mentionne groupe_espace', () => {
    expect(surveilles.filter(mentionne)).toEqual([]);
  });
});
