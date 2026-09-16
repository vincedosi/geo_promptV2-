import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
// Script Node en .mjs, importé plutôt que recopié : la règle de comptage
// d'« un export mort » doit rester définie UNE fois (cf. les quinze `fmtNum`
// de DUP-001). `allowJs` le résout, ses signatures sont inférées.
import { lancerKnip, construireRapport } from '../../../scripts/catalogue.mjs';

/**
 * Le catalogue est GENERE (npm run catalogue). Ce test verrouille trois
 * choses :
 *   - qu'il existe et annonce son caractere genere ;
 *   - que le nombre d'exports morts REELLEMENT MESURE ne remonte pas au-dessus
 *     du cliquet ;
 *   - que le fichier commite dit la meme chose que la mesure — autrement dit
 *     qu'il n'est pas perime.
 *
 * Un cliquet plutot qu'un « zero mort » : un seuil irrealiste finit toujours
 * desactive, et la migration de navigation de 2026-09 laisse legitimement des
 * exports en transit. On autorise la baisse, jamais la hausse.
 *
 * ── Ce que ce test ne faisait PAS, et pourquoi c'etait le defaut meme ──────
 *
 * Jusqu'au 2026-09-16, il lisait `docs/CATALOGUE_CODE.md` et comparait le
 * nombre que **le fichier annonce sur lui-meme** au cliquet. Il ne lancait
 * jamais knip. C'est exactement le trou que son propre en-tete racontait : le
 * catalogue est reste a 188 du 12/09 au 15/09 pendant que la realite etait a
 * 208, sur sept taches, parce qu'aucune d'elles n'avait relance
 * `npm run catalogue`. Le correctif de l'epoque avait releve le cliquet a 196
 * sans toucher au mecanisme — un chantier qui ajoute vingt exports morts et ne
 * regenere pas le fichier serait passe exactement pareil.
 *
 * knip est donc LANCE ici (~8 s sur cette machine, d'ou le delai releve). Le
 * cout est le prix d'une mesure ; la version precedente etait gratuite et ne
 * mesurait rien.
 *
 * ── Historique du cliquet ─────────────────────────────────────────────────
 *
 * Pose le 2026-09-12 apres la tache 23 : premiere mesure 202, ramenee a 188
 * dans le meme commit (14 residus de la migration nav-5-themes traites).
 * Releve a 197 le 2026-09-15 (Tache 16, chantier suivi-v2) : la mesure reelle
 * sur HEAD etait alors de 208, le cliquet etait deja silencieusement depasse.
 * Ramene a 196 apres relecture de la Tache 16 (`SuiviCpRow`, export mort
 * introduit par la tache elle-meme). Ramene a 195 le 2026-09-16, valeur
 * mesuree apres le lot tests/docs — un cliquet pose au-dessus de la valeur
 * atteignable laisse passer sa propre dette.
 */
const CLIQUET_EXPORTS_MORTS = 195;

describe('catalogue du code', () => {
  it('existe et se declare genere', () => {
    expect(existsSync('docs/CATALOGUE_CODE.md')).toBe(true);
    const texte = readFileSync('docs/CATALOGUE_CODE.md', 'utf8');
    expect(texte).toMatch(/généré/i);
    expect(texte).toMatch(/npm run catalogue/);
  });

  it(
    'le nombre d exports morts MESURE ne remonte pas, et le fichier commite dit la meme chose',
    // Délai TRÈS large, et à dessein : knip est un processus fils qui met ~7 s
    // seul, mais il concourt ici avec 137 fichiers de test en parallèle sur les
    // mêmes cœurs. Un délai serré transformerait la contention machine en échec
    // de test — exactement le flake que ce lot vient de refermer sur
    // `dsp/dv360-auth`. La suite complète dure ~110 s au total : ce plafond ne
    // peut être atteint que si knip est réellement bloqué.
    { timeout: 300_000 },
    () => {
      const rapport = construireRapport(lancerKnip());
      const mesure: number = rapport.totalExportsMorts;

      expect(
        mesure,
        `knip mesure ${mesure} exports morts, le cliquet est a ${CLIQUET_EXPORTS_MORTS}. `
        + 'Soit retirer les exports devenus inutiles, soit — si la hausse est assumee et '
        + 'expliquee — relever le cliquet EN ECRIVANT POURQUOI dans l\'historique ci-dessus.',
      ).toBeLessThanOrEqual(CLIQUET_EXPORTS_MORTS);

      const texte = readFileSync('docs/CATALOGUE_CODE.md', 'utf8');
      const m = texte.match(/exports morts\s*:\s*(\d+)/i);
      expect(m, 'le catalogue doit annoncer « exports morts : N »').not.toBeNull();
      const annonce = Number(m![1]);

      expect(
        annonce,
        `docs/CATALOGUE_CODE.md annonce ${annonce} exports morts, knip en mesure ${mesure}. `
        + 'Le fichier commite est PERIME : lancer `npm run catalogue` et committer le resultat '
        + 'DANS LE MEME COMMIT que le changement de code (CLAUDE.md § Documentation). '
        + "C'est precisement l'ecart qui est reste invisible du 12/09 au 15/09, sur sept taches, "
        + 'parce que ce test se contentait de relire le nombre que le fichier ecrivait sur lui-meme.',
      ).toBe(mesure);
    },
  );
});
