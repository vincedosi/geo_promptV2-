-- sql/174 — Consolidation geographique des POI ICPE
--
-- POURQUOI CETTE FONCTION EXISTE : LA PAGINATION DE GEORISQUES N'EST PAS STABLE
--
-- Mesure du 2026-09-17, deux imports nationaux successifs :
--   passage 1 : 104 752 lignes recues -> 94 652 sites distincts en base
--   passage 2 : 104 073 lignes recues -> 99 152 sites en base (+4 500)
-- Le second passage a donc apporte 4 500 sites que le premier n'avait pas vus,
-- ET n'a pas revu 6 079 sites que le premier avait ecrits. L'API ne rend pas le
-- meme sous-ensemble d'une execution a l'autre : environ 5 % de rotation.
--
-- Consequence concrete : les colonnes geographiques ajoutees apres le premier
-- import ne se remplissent que pour les lignes que l'API veut bien renvoyer. Or
-- sans `code_departement`, `/api/map/pois` ne trouve RIEN quand on filtre par
-- departement — 6 079 sites en base et invisibles, sans erreur ni message.
--
-- Cette fonction repare ces lignes a partir de ce qu'elles portent DEJA
-- (`metadata->>'code_insee'`), sans rappeler l'API. Elle est appelee en fin
-- d'import : bornee par `where code_departement is null`, elle ne touche
-- normalement aucune ligne et ne coute donc rien.
--
-- LA DERIVATION EST LA MEME QUE COTE TypeScript (codeDepartementDepuisInsee) :
-- DROM et collectivites sur trois caracteres (97x, 98x), metropole sur deux,
-- Corse comprise (2A / 2B). Deriver du code INSEE et non du code postal est
-- deliberé : un code postal peut chevaucher deux departements (05130, 01590),
-- un code INSEE non.

create or replace function public.consolider_geo_icpe()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_reparees int;
  v_restantes int;
begin
  with derive as (
    select p.id,
           case
             when left(p.metadata->>'code_insee', 2) in ('97', '98')
               then left(p.metadata->>'code_insee', 3)
             else left(p.metadata->>'code_insee', 2)
           end as code_dept
    from public.poi_france p
    where p.source = 'georisques_icpe'
      and p.code_departement is null
      and length(coalesce(p.metadata->>'code_insee', '')) >= 2
  )
  update public.poi_france p
     set code_departement = d.code_dept,
         departement      = rd.nom_dept,
         region           = rr.nom_region
    from derive d
         join public.ref_departements rd on rd.code_dept = d.code_dept
    left join public.ref_regions     rr on rr.code_region = rd.code_region
   where p.id = d.id;

  get diagnostics v_reparees = row_count;

  select count(*) into v_restantes
    from public.poi_france
   where source = 'georisques_icpe' and code_departement is null;

  return jsonb_build_object(
    'reparees', v_reparees,
    'restantes_sans_departement', v_restantes
  );
end;
$function$;

comment on function public.consolider_geo_icpe() is
  'Repare code_departement/departement/region des POI ICPE a partir de metadata->>code_insee. Existe parce que la pagination de l API Georisques n est pas stable : ~5 % de rotation entre deux imports, donc certaines lignes ne sont jamais revues (sql/174, 2026-09-17). Bornee par code_departement is null : sans effet quand tout est deja renseigne.';
