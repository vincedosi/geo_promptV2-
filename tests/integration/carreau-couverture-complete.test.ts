/**
 * `carreau_couverture_complete()` (sql/268, lot 4 — relecture de T4) — la table étroite est-elle COMPLÈTE ?
 *
 * Le contrôle de sql/267 (« total du journal = nombre de lignes ») était vrai PAR CONSTRUCTION : chaque bande écrit ses
 * lignes et sa ligne de journal dans la même transaction. Un `--tout` interrompu après 10 bandes sur 26 laissait une
 * table cohérente avec son journal… et partielle. Le contrôle passait.
 *
 * La complétude se juge désormais contre une RÉFÉRENCE indépendante : `certifier_carreau_couverture()` compte
 * `carreaux_filosofi` et la table (≈ 150 ms et 57 000 pages chacun : trop cher par requête) et range le résultat dans
 * `carreau_couverture_controle` ; `carreau_couverture_complete()` relit ce certificat et le journal (26 lignes), et rend
 * `null` ou un MOTIF. Toute bande écrite après la certification, ou tout écart de journal, invalide le certificat.
 *
 * Chaque scénario de panne est simulé dans une transaction ANNULÉE (base locale partagée) : rien ne reste.
 */
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const CONTENEUR = process.env.CONTENEUR_PG ?? 'supabase_db_genesis_app';

/** Un script psql ; rend la sortie brute (lignes). Lève si psql échoue. */
function psql(script: string): string[] {
  const r = spawnSync('docker', ['exec', '-i', CONTENEUR, 'psql', '-U', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], {
    input: script,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`psql (${r.status}) : ${r.stderr}`);
  return r.stdout.trim().split('\n');
}

/** Le motif rendu après les altérations `avant`, dans une transaction annulée. `''` = complète. */
function motifApres(avant: string): string {
  const sortie = psql(`begin;\n${avant}\nselect coalesce(public.carreau_couverture_complete(), '');\nrollback;`);
  return sortie[sortie.length - 1];
}

describe('sql/268 — carreau_couverture_complete', () => {
  it('la base locale, construite et certifiée : complète', () => {
    expect(motifApres('')).toBe('');
  });

  it('un --tout interrompu après 10 bandes sur 26 (table et journal cohérents ENTRE EUX) : refusée', () => {
    // Le scénario exact que le contrôle de sql/267 laissait passer : on retire du journal toutes les bandes sauf dix.
    // (La table n'est pas touchée : le contrôle ne la relit pas, il compare le journal au certificat.)
    expect(motifApres(`delete from public.carreau_couverture_bandes
      where bande not in (select bande from public.carreau_couverture_bandes order by bande limit 10);`))
      .toBe('journal_different_du_certificat');
  });

  it('une bande reconstruite après la certification : refusée jusqu\'à la prochaine certification', () => {
    expect(motifApres(`update public.carreau_couverture_bandes set construit_le = clock_timestamp() + interval '1 second'
      where bande = (select min(bande) from public.carreau_couverture_bandes);`))
      .toBe('modifiee_depuis_certification');
  });

  it('table vidée (préalable de --tout) : le certificat part avec elle', () => {
    expect(motifApres('select public.vider_carreau_couverture();')).toBe('jamais_certifiee');
  });

  it('jamais certifiée : refusée', () => {
    expect(motifApres('delete from public.carreau_couverture_controle;')).toBe('jamais_certifiee');
  });

  it('certificat d\'une table qui ne couvrait pas tous les carreaux : refusée', () => {
    expect(motifApres('update public.carreau_couverture_controle set n_lignes = n_lignes - 1;')).toBe('incomplete');
  });

  it('certifier recompte et rend un certificat complet', () => {
    const s = psql('begin;\nselect public.certifier_carreau_couverture()::text;\nrollback;');
    const c = JSON.parse(s[s.length - 1]) as { complete: boolean; n_lignes: number; n_carreaux_filosofi: number; n_journal: number };
    expect(c.complete).toBe(true);
    expect(c.n_lignes).toBe(c.n_carreaux_filosofi);
    expect(c.n_journal).toBe(c.n_lignes);
  });

  it('construire_denominateur_iris refuse une table partielle (55000), sans rien écrire', () => {
    const r = spawnSync('docker', ['exec', '-i', CONTENEUR, 'psql', '-U', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], {
      input: `begin;
        delete from public.carreau_couverture_bandes
         where bande not in (select bande from public.carreau_couverture_bandes order by bande limit 10);
        select public.construire_denominateur_iris();
        rollback;`,
      encoding: 'utf8',
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/incompl|certifi/i);
  });

  it('droits : service_role seul, sur les trois fonctions', () => {
    const lignes = psql(`select p.proname || ':' || has_function_privilege('anon', p.oid, 'execute')
                                || has_function_privilege('authenticated', p.oid, 'execute')
                                || has_function_privilege('service_role', p.oid, 'execute')
                           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public'
                            and p.proname in ('carreau_couverture_complete', 'certifier_carreau_couverture', 'vider_carreau_couverture')
                          order by 1;`);
    expect(lignes).toEqual([
      'carreau_couverture_complete:falsefalsetrue',
      'certifier_carreau_couverture:falsefalsetrue',
      'vider_carreau_couverture:falsefalsetrue',
    ]);
  });

  it('le certificat ne se forge pas : service_role le lit, ne l’écrit pas', () => {
    expect(psql(`select string_agg(p || ':' || has_table_privilege('service_role', 'public.carreau_couverture_controle', p), ' ')
                   from unnest(array['select', 'insert', 'update', 'delete']) p;`))
      .toEqual(['select:true insert:false update:false delete:false']);
  });
});
