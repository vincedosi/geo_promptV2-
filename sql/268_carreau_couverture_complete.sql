-- sql/268 — `carreau_couverture` est-elle COMPLÈTE ? Un certificat, et une lecture qui ne coûte rien (lot 4, relecture
-- de T4 ; avant T5).
--
-- LE DÉFAUT CORRIGÉ. `construire_denominateur_iris` (sql/267) refusait une table « incomplète » en comparant le total du
-- journal `carreau_couverture_bandes` au nombre de lignes de `carreau_couverture`. Or chaque bande écrit ses lignes ET sa
-- ligne de journal dans la MÊME transaction (sql/266) : les deux s'accordent PAR CONSTRUCTION. Un `--tout` interrompu
-- après 10 bandes sur 26 laisse une table partielle cohérente avec son journal — le contrôle passait. La couverture d'une
-- zone (T5) aurait chiffré à 0 tout ce qui tombe dans une bande manquante, sans le dire.
--
-- LA RÉFÉRENCE INDÉPENDANTE. Seul `carreaux_filosofi` dit combien de lignes la table DOIT avoir. Le compter coûte
-- ≈ 150 ms et ≈ 57 000 pages (mesuré le 22/10, `EXPLAIN (ANALYZE, BUFFERS)` : index-only parallèle), autant pour la
-- table étroite : trop pour CHAQUE chiffrage d'écran (Lyon 5 km lit 207 pages). D'où un CERTIFICAT, posé une fois par
-- construction :
--   - `certifier_carreau_couverture()` compte les deux tables et le journal, et range le résultat (une ligne) dans
--     `carreau_couverture_controle` ; le script de construction l'appelle en fin de course ;
--   - `carreau_couverture_complete()` relit le certificat (1 ligne) et le journal (26 lignes) et rend NULL si la table
--     est complète, sinon un MOTIF : `jamais_certifiee`, `incomplete` (lignes ≠ carreaux, ou journal ≠ lignes, au moment
--     de la certification), `journal_different_du_certificat` (des bandes ont disparu ou changé de taille depuis),
--     `modifiee_depuis_certification` (une bande a été réécrite après : un `--tout` en cours, une `--bande N` rejouée).
--   - `vider_carreau_couverture()` efface aussi le certificat : une table vidée n'est plus certifiée.
--
-- ⚠ CE QUE LE CERTIFICAT NE VOIT PAS. Une ligne effacée de `carreau_couverture` à la main, hors journal ; un rechargement
-- de `carreaux_filosofi` (07-carreaux-insee.sh) sans reconstruction — le certificat garde l'ancien compte. Le second est
-- la réserve r1 de la relecture de T3 (vague finale du lot) : `11-reconstruire.sh` doit périmer la table sur ce
-- rechargement ; une recertification, elle, le verrait (`incomplete`).
--
-- APPELANTS : `construire_denominateur_iris` (recréée ici, même corps, contrôle remplacé) et `couverture_geometrie`
-- (sql/269, refus `couverture_non_construite` + motif). REJOUABLE : `if not exists`, `create or replace`, aucun `drop`.
-- La migration certifie la table si elle est déjà construite (≈ 0,3 s).

create table if not exists public.carreau_couverture_controle (
  -- Une seule ligne : la clé est la constante `true`.
  unique_ligne        boolean primary key default true check (unique_ligne),
  n_carreaux_filosofi bigint not null,
  n_lignes            bigint not null,
  n_journal           bigint not null,
  n_bandes            integer not null,
  certifie_le         timestamptz not null default clock_timestamp()
);

comment on table public.carreau_couverture_controle is
  'Certificat de completude de carreau_couverture (une ligne) : comptes de carreaux_filosofi, de la table et du journal '
  'a la certification. Lu par carreau_couverture_complete(). sql/268.';

alter table public.carreau_couverture_controle enable row level security;
revoke all on table public.carreau_couverture_controle from public, anon, authenticated;
grant select on table public.carreau_couverture_controle to service_role;

create or replace function public.certifier_carreau_couverture()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_filo bigint;
  v_lig  bigint;
  v_jour bigint;
  v_nb   integer;
  v_le   timestamptz := clock_timestamp();
begin
  select count(*) into v_filo from public.carreaux_filosofi;
  select count(*) into v_lig from public.carreau_couverture;
  select coalesce(sum(n_carreaux), 0), count(*) into v_jour, v_nb from public.carreau_couverture_bandes;

  insert into public.carreau_couverture_controle as c
         (unique_ligne, n_carreaux_filosofi, n_lignes, n_journal, n_bandes, certifie_le)
  values (true, v_filo, v_lig, v_jour, v_nb, v_le)
  on conflict (unique_ligne) do update
     set n_carreaux_filosofi = excluded.n_carreaux_filosofi, n_lignes = excluded.n_lignes,
         n_journal = excluded.n_journal, n_bandes = excluded.n_bandes, certifie_le = excluded.certifie_le;

  return jsonb_build_object(
    'complete', v_lig = v_filo and v_jour = v_lig and v_lig > 0,
    'n_carreaux_filosofi', v_filo, 'n_lignes', v_lig, 'n_journal', v_jour, 'n_bandes', v_nb, 'certifie_le', v_le);
end;
$fn$;

comment on function public.certifier_carreau_couverture() is
  'Compte carreaux_filosofi, carreau_couverture et son journal, et range le certificat (carreau_couverture_controle). '
  'A appeler en fin de construction (scripts/construire_carreau_couverture.mjs). ~0,3 s. sql/268.';

revoke all on function public.certifier_carreau_couverture() from public, anon, authenticated;
grant execute on function public.certifier_carreau_couverture() to service_role;

create or replace function public.carreau_couverture_complete()
returns text
language sql
stable
security invoker
set search_path to 'public', 'pg_catalog'
as $fn$
  with c as (select * from public.carreau_couverture_controle limit 1),
       j as (select coalesce(sum(n_carreaux), 0) as n, count(*) as nb, max(construit_le) as le
               from public.carreau_couverture_bandes)
  select case
           when not exists (select 1 from c) then 'jamais_certifiee'
           when (select n_lignes <> n_carreaux_filosofi or n_journal <> n_lignes or n_lignes = 0 from c) then 'incomplete'
           when (select c.n_journal <> j.n or c.n_bandes <> j.nb from c, j) then 'journal_different_du_certificat'
           when (select j.le > c.certifie_le from c, j) then 'modifiee_depuis_certification'
         end
$fn$;

comment on function public.carreau_couverture_complete() is
  'NULL si carreau_couverture est complete (certificat valide), sinon le motif : jamais_certifiee, incomplete, '
  'journal_different_du_certificat, modifiee_depuis_certification. Lit 1 + 26 lignes. sql/268.';

revoke all on function public.carreau_couverture_complete() from public, anon, authenticated;
grant execute on function public.carreau_couverture_complete() to service_role;

-- `vider_carreau_couverture` (sql/266) : même corps, plus le certificat — une table vidée n'est plus certifiée.
create or replace function public.vider_carreau_couverture()
returns bigint
language plpgsql security definer set search_path to 'public' as $fn$
declare v_n bigint;
begin
  select count(*) into v_n from public.carreau_couverture;
  -- La table ET son journal, ensemble : un journal qui survit à sa table ferait sauter toutes les bandes au prochain
  -- lancement, et la table resterait vide (leçon du 22/09, 11-reconstruire.sh). Et le certificat (sql/268).
  truncate public.carreau_couverture;
  delete from public.carreau_couverture_bandes;
  delete from public.carreau_couverture_controle;
  return v_n;
end;
$fn$;

comment on function public.vider_carreau_couverture() is
  'Vide carreau_couverture, son journal de bandes ET son certificat (prealable de --tout). Rend le nombre de lignes '
  'effacees. sql/266, sql/268.';

revoke all on function public.vider_carreau_couverture() from public, anon, authenticated;
grant execute on function public.vider_carreau_couverture() to service_role;

-- `construire_denominateur_iris` (sql/267) : même corps, le contrôle de complétude remplacé par le certificat.
create or replace function public.construire_denominateur_iris()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
set work_mem to '128MB'
as $fn$
declare
  v_t0        timestamptz := clock_timestamp();
  v_n_iris    integer;
  v_n_carr    bigint;
  v_n_hors    bigint;
  v_n_cibles  integer;
  v_paires    text;
  v_motif     text;
begin
  -- La table étroite doit être COMPLÈTE : un dénominateur construit sur une table à moitié remplie serait faux pour
  -- chaque IRIS d'une bande manquante. Jusqu'au 22/10 (sql/267) : « journal = lignes », vrai par construction — un
  -- --tout interrompu passait. Désormais le certificat de sql/268, comparé à carreaux_filosofi.
  v_motif := public.carreau_couverture_complete();
  if v_motif is not null then
    raise exception 'carreau_couverture incomplete ou non certifiee (%) : la construire jusqu''au bout '
      '(scripts/construire_carreau_couverture.mjs, qui certifie en fin de course)', v_motif
      using errcode = '55000';
  end if;

  select count(*),
         string_agg(format('%s, sum(cc.pops[%s]::numeric)', quote_literal(code), rang_pop), ', ' order by rang_pop)
    into v_n_cibles, v_paires
    from public.cibles_exposition
   where actif and rang_pop is not null;

  if v_n_cibles = 0 or v_n_cibles > 50 then  -- jsonb_build_object : 100 arguments au plus
    raise exception 'cibles_exposition : % cibles actives avec un rang, attendu 1 à 50', v_n_cibles using errcode = '55000';
  end if;

  delete from public.unite_population_totale where maille = 'iris';

  execute format($q$
    insert into public.unite_population_totale (maille, code, populations, n_carreaux)
    select 'iris', cc.code_iris, jsonb_build_object(%s), count(*)
      from public.carreau_couverture cc
     where cc.code_iris is not null
     group by cc.code_iris$q$, v_paires);

  get diagnostics v_n_iris = row_count;
  select coalesce(sum(n_carreaux), 0) into v_n_carr from public.unite_population_totale where maille = 'iris';
  select count(*) into v_n_hors from public.carreau_couverture where code_iris is null;

  return jsonb_build_object(
    'ok', true,
    'n_iris', v_n_iris,
    'n_carreaux', v_n_carr,
    'n_carreaux_sans_iris', v_n_hors,
    'n_cibles', v_n_cibles,
    'duree_ms', extract(milliseconds from clock_timestamp() - v_t0)::int);
end;
$fn$;

comment on function public.construire_denominateur_iris() is
  'Construit la maille iris d''unite_population_totale DEPUIS carreau_couverture (meme regle que le numerateur de la '
  'couverture : centroide dans iris.geom). Jamais iris.population. Efface puis reecrit la seule maille iris, en une '
  'transaction ; refuse si carreau_couverture n''est pas certifiee complete (sql/268). A rejouer apres toute '
  'construction de carreau_couverture. sql/267, sql/268.';

revoke all on function public.construire_denominateur_iris() from public, anon, authenticated;
grant execute on function public.construire_denominateur_iris() to service_role;

-- Certifier la table déjà construite (base locale du 22/10). Une table vide ou partielle reçoit un certificat
-- « incomplete » : c'est vrai, et la reconstruction le remplacera.
select public.certifier_carreau_couverture()
 where exists (select 1 from public.carreau_couverture_bandes)
   and public.carreau_couverture_complete() is distinct from null;
