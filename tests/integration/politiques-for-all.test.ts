/**
 * Invariant de structure : aucune politique `FOR ALL` pour un client (sql/238).
 *
 * Une politique FOR ALL vaut aussi pour SELECT. Depuis sql/234, anon et
 * authenticated n'ont plus aucun droit d'écriture : une politique FOR ALL ne
 * peut donc plus servir QU'À LIRE, sous un nom qui fait croire à une politique
 * d'écriture. C'est ainsi que `bidding_zone_configs_modify` a laissé un admin
 * d'espace lire les 13 377 lignes d'une autre organisation après sql/234.
 *
 * Ce test lit `pg_policies` directement (PostgREST ne l'expose pas) : une
 * politique FOR ALL rajoutée demain, même « bien filtrée », doit être écrite
 * INSERT / UPDATE / DELETE, et sa lecture passer par une politique SELECT.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { Client } from 'pg';
import './_client'; // charge .env.development.local AVANT .env.local

const base = new Client({ connectionString: process.env.DATABASE_URL });
let connecte = false;

afterAll(async () => {
  if (connecte) await base.end();
});

describe('pg_policies — pas de FOR ALL hors service_role', () => {
  it('aucune politique FOR ALL ne s applique à un client', async () => {
    expect(process.env.DATABASE_URL ?? '').toMatch(/127\.0\.0\.1|localhost/);
    await base.connect();
    connecte = true;
    const { rows } = await base.query<{ tablename: string; policyname: string }>(`
      select tablename, policyname
        from pg_policies
       where schemaname = 'public'
         and cmd = 'ALL'
         and roles <> '{service_role}'::name[]
         and coalesce(qual, '') <> '(auth.role() = ''service_role''::text)'
       order by 1, 2`);
    expect(rows).toEqual([]);
  });

  it('aucune politique SELECT n ouvre tout à un admin d espace', async () => {
    // Le motif de la fuite : le rôle `admin` cité sans filtre d'organisation.
    const { rows } = await base.query<{ tablename: string; policyname: string }>(`
      select tablename, policyname
        from pg_policies
       where schemaname = 'public'
         and cmd = 'SELECT'
         and qual like '%''admin''%'
         and qual not like '%get_user_org%'
       order by 1, 2`);
    expect(rows).toEqual([]);
  });
});
