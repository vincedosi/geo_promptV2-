import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

/**
 * Le catalogue est GENERE (npm run catalogue). Ce test ne verifie pas son
 * contenu ligne a ligne — il verrouille deux choses seulement :
 *   - qu'il existe et annonce son caractere genere ;
 *   - que le nombre d'exports morts ne REMONTE pas au-dessus du cliquet.
 *
 * Un cliquet plutot qu'un « zero mort » : un seuil irrealiste finit toujours
 * desactive, et la migration de navigation de 2026-09 laisse legitimement des
 * exports en transit. On autorise la baisse, jamais la hausse.
 *
 * Valeur posee le 2026-09-12, APRES la tache 23 : premiere mesure 202,
 * ramenee a 188 dans le meme commit (14 residus de la migration nav-5-themes
 * traites — fichiers orphelins de l'ex-FilterPanel supprimes, exports
 * jamais consommes hors de leur fichier depouilles de `export`). Voir
 * .superpowers/sdd/2026-09-12-refonte-navigation-5-themes/tache-23-report.md
 * pour le detail du tri.
 */
const CLIQUET_EXPORTS_MORTS = 188;

describe('catalogue du code', () => {
  it('existe et se declare genere', () => {
    expect(existsSync('docs/CATALOGUE_CODE.md')).toBe(true);
    const texte = readFileSync('docs/CATALOGUE_CODE.md', 'utf8');
    expect(texte).toMatch(/généré/i);
    expect(texte).toMatch(/npm run catalogue/);
  });

  it('le nombre d exports morts ne remonte pas', () => {
    const texte = readFileSync('docs/CATALOGUE_CODE.md', 'utf8');
    const m = texte.match(/exports morts\s*:\s*(\d+)/i);
    expect(m, 'le catalogue doit annoncer « exports morts : N »').not.toBeNull();
    expect(Number(m![1])).toBeLessThanOrEqual(CLIQUET_EXPORTS_MORTS);
  });
});
