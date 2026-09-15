/**
 * @file tests/unit/campaigns/version-strategie.test.ts — dérive d'une
 * stratégie publiée (Tâche 19, 2026-09-13).
 *
 * ── Ce que ces tests ne voyaient pas, et pourquoi (2026-09-15) ────────────
 * La première version de ce fichier ne nourrissait QUE des dates ISO, parce
 * que l'empreinte valait `{ zone_id: updated_at }` à l'écriture de la Tâche 19.
 * **sql/159 l'a remplacée par un md5 de contenu** et le TypeScript n'a pas
 * suivi : `Date.parse('e13279f2…')` vaut `NaN`, donc toute zone était déclarée
 * modifiée, toujours — la chaîne d'activation DV360 entière était bloquée en
 * production, et ces tests passaient au vert.
 *
 * D'où la règle de ce fichier : les cas nominaux utilisent des empreintes de
 * la FORME RÉELLE rendue par `empreinte_zones()` (md5, 32 caractères
 * hexadécimaux), relevée en base. Un test qui n'emploie que la forme d'hier ne
 * peut pas voir un changement de format.
 */
import { describe, it, expect } from 'vitest';
import { zonesModifiees } from '@/lib/campaigns/version-strategie';

/** Empreintes relevées en base (`select empreinte_zones(array[…])`, sql/159). */
const H1 = 'e13279f21b9ec2b78a8a2698a8fe54cc';
const H2 = 'f603ff2149a6c1fb0d3ef2d9a1a2b3c4';
const H3 = '0b9c1d2e3f4a5b6c7d8e9f0a1b2c3d4e';

describe('derive d une strategie publiee', () => {
  // ── Le cas qui aurait attrapé la régression ──────────────────────────────
  it('ne signale RIEN quand le hachage md5 est identique des deux cotes', () => {
    // Forme réelle de `empreinte_zones()` depuis sql/159. Avec l'ancienne
    // normalisation par `Date.parse`, ce cas rendait ['z1'] — et c'est lui qui
    // bloquait toute activation DSP.
    expect(zonesModifiees({ z1: H1 }, { z1: H1 })).toEqual([]);
  });

  it('ne signale rien sur plusieurs zones aux hachages identiques', () => {
    expect(zonesModifiees({ z1: H1, z2: H2 }, { z2: H2, z1: H1 })).toEqual([]);
  });

  it('signale la zone dont le hachage a change', () => {
    expect(zonesModifiees({ z1: H1, z2: H2 }, { z1: H1, z2: H3 })).toEqual(['z2']);
  });

  it('signale une zone ajoutee depuis la publication', () => {
    expect(zonesModifiees({ z1: H1 }, { z1: H1, z2: H2 })).toEqual(['z2']);
  });

  it('signale une zone retiree depuis la publication', () => {
    expect(zonesModifiees({ z1: H1, z2: H2 }, { z1: H1 })).toEqual(['z2']);
  });

  // ── Au-delà du plan ────────────────────────────────────────────────────
  it('rend un ordre STABLE, pour que le bandeau d alerte ne danse pas', () => {
    const publiee = { zb: H1, za: H1, zc: H1 };
    const courante = { zb: H2, za: H2, zc: H2 };
    expect(zonesModifiees(publiee, courante)).toEqual(['za', 'zb', 'zc']);
    // Deux appels sur les mêmes données donnent le même ordre.
    expect(zonesModifiees(publiee, courante)).toEqual(zonesModifiees(publiee, courante));
  });

  it('compare les empreintes comme des chaines OPAQUES, sans les interpreter', () => {
    // Deux empreintes ne diffèrent JAMAIS que par leur écriture : elles
    // sortent de la même fonction SQL. Toute « normalisation » (casse,
    // rognage, parsing) inventerait une équivalence que sql/159 ne garantit
    // pas — et c'est exactement ce que faisait `Date.parse`.
    expect(zonesModifiees({ z1: H1 }, { z1: H1.toUpperCase() })).toEqual(['z1']);
    expect(zonesModifiees({ z1: H1 }, { z1: ` ${H1}` })).toEqual(['z1']);
  });

  it('signale une zone dont l empreinte devient non comparable', () => {
    // On ne peut plus affirmer qu'elle n'a pas bougé : on alerte.
    expect(zonesModifiees({ z1: H1 }, { z1: '' })).toEqual(['z1']);
    expect(zonesModifiees({ z1: H1 }, { z1: 42 as unknown as string })).toEqual(['z1']);
    expect(zonesModifiees({ z1: H1 }, { z1: null as unknown as string })).toEqual(['z1']);
  });

  it('accepte encore une empreinte heritee au format date, sans la parser', () => {
    // `strategie_versions` était vide au moment du correctif (vérifié), mais
    // rien n'interdit une ligne écrite avant sql/159 : deux dates IDENTIQUES
    // restent « pas de dérive », deux dates différentes restent une dérive.
    expect(zonesModifiees(
      { z1: '2026-09-01T10:00:00Z' },
      { z1: '2026-09-01T10:00:00Z' },
    )).toEqual([]);
    expect(zonesModifiees(
      { z1: '2026-09-01T10:00:00Z' },
      { z1: '2026-09-02T08:00:00Z' },
    )).toEqual(['z1']);
  });

  it('ne jette sur aucune forme aberrante et rend toujours un tableau', () => {
    const aberrations: unknown[] = [null, undefined, [], 'texte', 42, { z1: null }, { z1: 42 }];
    for (const a of aberrations) {
      for (const b of aberrations) {
        const r = zonesModifiees(
          a as Record<string, string>,
          b as Record<string, string>,
        );
        expect(Array.isArray(r)).toBe(true);
      }
    }
  });

  it('rend une liste vide quand les deux empreintes sont vides', () => {
    expect(zonesModifiees({}, {})).toEqual([]);
  });
});
