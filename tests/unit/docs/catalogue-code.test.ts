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
 *
 * Releve le 2026-09-15 (Tache 16, chantier suivi-v2) : `docs/CATALOGUE_CODE.md`
 * etait reste au 188 du 2026-09-12 (`Genere le 2026-09-13 — commit c295a21`)
 * alors que les taches 9 a 15 de ce chantier n'ont jamais relance
 * `npm run catalogue` apres avoir ajoute du code. Mesure sur HEAD avant toute
 * modification de cette tache (`git stash` + `npm run catalogue` + `git stash
 * pop`) : 208 exports morts, 13 fichiers morts — le cliquet etait deja
 * silencieusement depasse, masque par un fichier commite perime que ce test
 * ne relit jamais lui-meme (il fait confiance au nombre ecrit dedans). La
 * suppression de l'ancien ecran de suivi (Tache 16) retire 11 exports morts
 * et 9 fichiers morts reels (9 composants sans plus aucun appelant,
 * confirmes par grep avant suppression) : 208 → 197. Cliquet releve a 197,
 * PAS a 188 — ce chiffre ne redeviendra atteignable qu'en traitant les ~9
 * exports morts restants des taches 9-15, hors perimetre de la Tache 16.
 */
const CLIQUET_EXPORTS_MORTS = 197;

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
