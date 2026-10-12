/**
 * Revue finale du lot 4 Angular, I-2a : deux PREMIERS calculs de corrélation simultanés répondaient 500
 * (`indicator_cp_values_pkey`) — `materialize_indicator_cp_values` (sql/106) insérait sans `ON CONFLICT`, et rien
 * n'empêchait deux matérialisations du même indicateur de se croiser.
 *
 * Ce test verrouille le correctif (sql/249) dans le texte des migrations : la DERNIÈRE définition de la fonction
 * prend un verrou consultatif par indicateur AVANT son `DELETE`, et chacun de ses `INSERT` porte un
 * `ON CONFLICT … DO UPDATE` (pas `DO NOTHING`, qui ferait compter 0 ligne et dire « source vide » au journal).
 * La course elle-même a été rejouée sur la base locale (deux sessions psql) : voir l'en-tête de sql/249.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const FONCTION = /CREATE OR REPLACE FUNCTION public\.materialize_indicator_cp_values\(/;

/** Les migrations numérotées qui (re)définissent la fonction, dans l'ordre d'application. */
function definitions(): { fichier: string; corps: string }[] {
  return readdirSync('sql')
    .filter((f) => /^\d{3}_.*\.sql$/.test(f))
    .sort()
    .map((f) => ({ fichier: f, texte: readFileSync(`sql/${f}`, 'utf8') }))
    .filter(({ texte }) => FONCTION.test(texte))
    .map(({ fichier, texte }) => {
      const debut = texte.search(FONCTION);
      const fin = texte.indexOf('END $$;', debut);
      return { fichier, corps: texte.slice(debut, fin) };
    });
}

describe('materialize_indicator_cp_values : pas de course entre deux premiers calculs (sql/249)', () => {
  it('la dernière définition est celle de sql/249', () => {
    expect(definitions().at(-1)?.fichier).toBe('249_materialisation_indicateur_sans_course.sql');
  });

  it('verrou consultatif par indicateur, posé AVANT le DELETE', () => {
    const { corps } = definitions().at(-1)!;
    const verrou = corps.indexOf("pg_advisory_xact_lock(hashtext('indicator_cp_values:' || p_indicator_code))");
    expect(verrou).toBeGreaterThan(0);
    expect(verrou).toBeLessThan(corps.indexOf('DELETE FROM indicator_cp_values'));
  });

  it('chaque INSERT porte ON CONFLICT … DO UPDATE (jamais DO NOTHING)', () => {
    const { corps } = definitions().at(-1)!;
    const inserts = corps.split('INSERT INTO indicator_cp_values').slice(1);
    expect(inserts).toHaveLength(4);
    for (const i of inserts) {
      const instruction = i.slice(0, i.indexOf("',"));
      expect(instruction).toContain('ON CONFLICT (indicator_code, postal_code)');
      expect(instruction).toContain('DO UPDATE SET value = EXCLUDED.value');
      expect(instruction).not.toContain('DO NOTHING');
    }
  });

  it('aucun DROP : CREATE OR REPLACE, signature inchangée (CLAUDE.md)', () => {
    const texte = readFileSync('sql/249_materialisation_indicateur_sans_course.sql', 'utf8');
    expect(texte).not.toMatch(/^\s*DROP\s/im);
    expect(texte).toContain('RETURNS integer');
  });
});
