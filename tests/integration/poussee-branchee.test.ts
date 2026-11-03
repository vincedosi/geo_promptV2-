/**
 * sql/322 (B16) — `plateformes_geo.poussee_branchee` : le ciblage géo d'une maille est-il poussé par API par le
 * produit ? Lu par la règle de la maille par défaut (`modePoussee`, `departageParPoussee`) et servi par
 * `GET /api/zones/plateformes` (`lireRegles`, avec `lirePoids` pour les mécanismes de poids, amendement E2).
 *
 * Verrouille : la seule ligne branchée est celle dont le code de poussée existe (DV360 au CP, `pousser-ciblage.ts`,
 * seul canal câblé de ⑦) ; la migration se rejoue et ne remet pas une valeur corrigée au relevé ; le serveur lit la
 * colonne et l'ensemble des mécanismes de poids.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lirePoids, lireRegles } from '@/lib/zones/conversion-serveur';
import { creerClientTest } from './_client';
import { psql, psqlBrut } from './_psql';

const MIGRATION = readFileSync(join(process.cwd(), 'sql', '322_poussee_branchee.sql'), 'utf8');

describe('sql/322 — poussée branchée au registre', () => {
  it('seule DV360 / CP est branchée, et c’est la maille que le code de poussée envoie', () => {
    expect(psql(`select string_agg(plateforme || '/' || maille, ',' order by plateforme, maille)
                   from public.plateformes_geo where poussee_branchee;`)).toBe('dv360/cp');
    expect(existsSync(join(process.cwd(), 'lib', 'dsp', 'dv360', 'pousser-ciblage.ts'))).toBe(true);
    const pousser = readFileSync(join(process.cwd(), 'app', 'api', 'campaigns', '[campaignId]', 'activation', 'pousser', 'route.ts'), 'utf8');
    expect(pousser).toMatch(/const CANAUX_CABLES = \['dv360'\] as const;/);
  });

  it('rejouable, et une valeur corrigée n’est pas remise au relevé (transaction annulée)', () => {
    const r = psqlBrut(`begin;
      ${MIGRATION}
      update public.plateformes_geo set poussee_branchee = true where plateforme = 'meta' and maille = 'cercle';
      update public.plateformes_geo set poussee_branchee = false where plateforme = 'dv360' and maille = 'cp';
      ${MIGRATION}
      select string_agg(plateforme || '/' || maille, ',' order by plateforme, maille) from public.plateformes_geo where poussee_branchee;
      rollback;`);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim().split('\n').at(-1)).toBe('meta/cercle');
  });

  it('la colonne est non nulle', () => {
    const r = psqlBrut(`begin; update public.plateformes_geo set poussee_branchee = null where plateforme = 'dv360' and maille = 'cp'; rollback;`);
    expect(r.status).not.toBe(0);
  });

  it('lireRegles lit la colonne ; lirePoids sans maille lit tous les mécanismes (PostgREST, service_role)', async () => {
    const client = creerClientTest() as never;
    const regles = await lireRegles(client);
    expect(regles.filter((l) => l.poussee_branchee).map((l) => `${l.plateforme}/${l.maille}`)).toEqual(['dv360/cp']);
    const poids = await lirePoids(client, ['dv360', 'ttd', 'meta', 'tiktok']);
    expect(poids.length).toBe(Number(psql('select count(*) from public.plateformes_poids;')));
  });
});
