/**
 * sql/315 (B9, ARB-7) — les deux réglages de la maille par défaut de ⑤ dans `reglages_conversion`, et leur lecture par
 * le serveur (`lireReglagesDefaut`, la lecture de `GET /api/zones/plateformes`).
 *
 * Verrouille : les valeurs posées (80 % de couverture cible, 5 points d'écart) sont celles du repli documenté
 * `REGLAGES_DEFAUT_REPLI` ; la migration se rejoue sans dégât et ne remet pas un réglage changé au défaut ; les CHECK
 * refusent une cible hors ]0, 100] et un écart hors [0, 100] ; le serveur lit les valeurs EN BASE (une valeur changée
 * dans une transaction est lue, pas le repli).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REGLAGES_DEFAUT_REPLI } from '@/lib/zones/conversion-defaut';
import { lireReglagesDefaut } from '@/lib/zones/conversion-serveur';
import { creerClientTest } from './_client';
import { psql, psqlBrut } from './_psql';

const MIGRATION = readFileSync(join(process.cwd(), 'sql', '315_maille_defaut_reglages.sql'), 'utf8');
const valeur = (cle: string) => psql(`select valeur::text from public.reglages_conversion where cle = '${cle}';`);

describe('sql/315 — réglages de la maille par défaut', () => {
  it('les valeurs en base sont celles du repli documenté', () => {
    expect(Number(valeur('couverture_cible_defaut'))).toBe(REGLAGES_DEFAUT_REPLI.couverture_cible);
    expect(Number(valeur('ecart_departage_defaut'))).toBe(REGLAGES_DEFAUT_REPLI.ecart_departage);
  });

  it('rejouable, et un réglage changé n’est pas remis au défaut (transaction annulée)', () => {
    const r = psqlBrut(`begin;
      update public.reglages_conversion set valeur = 70 where cle = 'couverture_cible_defaut';
      ${MIGRATION}
      ${MIGRATION}
      select valeur::text from public.reglages_conversion where cle = 'couverture_cible_defaut';
      rollback;`);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim().split('\n').at(-1)).toBe('70');
  });

  it('les CHECK refusent une cible hors ]0, 100] et un écart hors [0, 100]', () => {
    for (const [cle, v] of [['couverture_cible_defaut', 0], ['couverture_cible_defaut', 101], ['ecart_departage_defaut', -1]] as const) {
      const r = psqlBrut(`begin; update public.reglages_conversion set valeur = ${v} where cle = '${cle}'; rollback;`);
      expect(r.status, `${cle} = ${v}`).not.toBe(0);
      expect(r.stderr).toMatch(/reglages_conversion_(couverture_cible_bornee|ecart_departage_borne)/);
    }
  });

  it('lireReglagesDefaut lit la base (PostgREST, service_role)', async () => {
    expect(await lireReglagesDefaut(creerClientTest() as never)).toEqual({
      couverture_cible: Number(valeur('couverture_cible_defaut')),
      ecart_departage: Number(valeur('ecart_departage_defaut')),
    });
  });
});
