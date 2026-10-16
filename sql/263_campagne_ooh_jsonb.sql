-- 263 — Lecture d'une campagne OOH et de la liste des campagnes OOH d'un espace, en jsonb (2026-10-16)
--
-- Spec : docs/superpowers/specs/2026-10-16-ooh-campagnes-design.md § 4.5 et § 5.
-- `campagne_ooh_jsonb` rend la campagne, ses lignes OOH (avec placés, à vérifier et non placés) et ses emplacements en
-- GeoJSON. RETURNS jsonb et non TABLE : TF4 porte ≈ 1 230 points, au-delà des 1 000 lignes que PostgREST laisse
-- passer d'une RPC tabulaire (`max_rows`, CLAUDE.md « Troncature PostgREST »). Elle lit `p_limite + 1` emplacements
-- et rend `tronque` ; elle rend `null` si la campagne n'est pas dans `p_org` (la route en fait un 404).
-- `campagnes_ooh_jsonb` rend les campagnes de `p_org` ayant au moins une ligne `ooh` (borne 200 : un espace a peu de
-- campagnes ; au-delà, `tronque` le dit).
--
-- EXPLAIN ANALYZE : voir le bloc « Mesure » en fin de fichier (fixture de 1 230 panneaux, transaction annulée).
--
-- Non gardé : `p_campagne`/`p_org` nuls → `null` / liste vide. `p_limite` nul ou < 1 → 22023.
-- Droits : `service_role` seul (routes par `createAdminClient`), SECURITY INVOKER. Rejouable (CREATE OR REPLACE).

begin;

create or replace function public.campagne_ooh_jsonb(p_campagne uuid, p_org uuid, p_limite integer default 20000)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_campagne jsonb;
  v_lignes   jsonb;
  v_points   jsonb;
  v_lus      integer;
begin
  if p_limite is null or p_limite < 1 then
    raise exception 'p_limite doit être un entier positif' using errcode = '22023';
  end if;
  if p_campagne is null or p_org is null then
    return null;
  end if;

  select jsonb_build_object(
           'id', c.id, 'nom', c.nom, 'annonceur', c.annonceur, 'vague', c.vague,
           'date_debut', c.date_debut, 'date_fin', c.date_fin, 'budget_total_ttc', c.budget_total_ttc, 'metadata', c.metadata)
    into v_campagne
    from public.campagnes c
   where c.id = p_campagne and c.organization_id = p_org;
  if v_campagne is null then
    return null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', l.id, 'ordre', l.ordre, 'media', l.media, 'regie', l.regie, 'reseau', l.reseau, 'territoire', l.territoire,
           'nb_ecrans', l.nb_ecrans, 'format', l.format, 'nb_diffusions', l.nb_diffusions,
           'date_debut', l.date_debut, 'date_fin', l.date_fin, 'duree_libelle', l.duree_libelle, 'rang_option', l.rang_option,
           'plage_horaire', l.plage_horaire, 'montant_brut', l.montant_brut, 'montant_net', l.montant_net, 'frais', l.frais,
           'honoraires', l.honoraires, 'total_ttc', l.total_ttc, 'contacts_15_plus', l.contacts_15_plus,
           'contacts_18_24', l.contacts_18_24, 'details', l.details,
           'a_des_emplacements', l.data_source_id is not null,
           'nb_places', coalesce(s.nb_places, 0),
           'nb_a_verifier', coalesce(s.nb_a_verifier, 0),
           'nb_non_places', case when jsonb_typeof(l.details->'non_places') = 'array'
                                 then jsonb_array_length(l.details->'non_places') else 0 end
         ) order by l.ordre), '[]'::jsonb)
    into v_lignes
    from public.campagne_lignes l
    left join lateral (
      select count(*)::int as nb_places,
             (count(*) filter (where p.geoloc_qualite = 'a_verifier'))::int as nb_a_verifier
        from public.campagne_ligne_panneaux clp
        join public.panneaux_affichage p on p.id = clp.panneau_id
       where clp.ligne_id = l.id
    ) s on true
   where l.campagne_id = p_campagne and l.media = 'ooh';

  select count(*)::int,
         coalesce(jsonb_agg(x.entite order by x.rang) filter (where x.rang <= p_limite), '[]'::jsonb)
    into v_lus, v_points
    from (
      select row_number() over (order by l.ordre, p.id) as rang,
             jsonb_build_object(
               'type', 'Feature',
               'geometry', jsonb_build_object('type', 'Point', 'coordinates', jsonb_build_array(p.lng, p.lat)),
               'properties', jsonb_build_object(
                 'id', p.id, 'ligne_id', l.id, 'nom_lieu', p.nom_lieu, 'adresse', p.adresse, 'ville', p.ville,
                 'code_postal', p.code_postal, 'code_insee', p.code_insee, 'regie', p.regie, 'reseau', p.reseau,
                 'type_lieu', p.type_lieu, 'type_panneau', p.type_panneau, 'numerique', p.numerique,
                 'nb_ecrans', coalesce(clp.nb_ecrans, p.nb_ecrans), 'formats', coalesce(clp.formats, p.formats),
                 'contacts_semaine', p.contacts_semaine, 'contacts_18_25_semaine', p.contacts_18_25_semaine,
                 'geoloc_methode', p.geoloc_methode, 'geoloc_qualite', p.geoloc_qualite, 'geoloc_score', p.geoloc_score,
                 'geoloc_libelle', p.geoloc_libelle, 'reference_panneau', p.reference_panneau, 'metadata', p.metadata)
             ) as entite
        from public.campagne_lignes l
        join public.campagne_ligne_panneaux clp on clp.ligne_id = l.id
        join public.panneaux_affichage p on p.id = clp.panneau_id
       where l.campagne_id = p_campagne and l.media = 'ooh'
       order by l.ordre, p.id
       limit p_limite + 1
    ) x;

  return jsonb_build_object('campagne', v_campagne, 'lignes', v_lignes, 'emplacements', v_points, 'tronque', v_lus > p_limite);
end;
$function$;

create or replace function public.campagnes_ooh_jsonb(p_org uuid, p_limite integer default 200)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_lus       integer;
  v_campagnes jsonb;
begin
  if p_limite is null or p_limite < 1 then
    raise exception 'p_limite doit être un entier positif' using errcode = '22023';
  end if;
  if p_org is null then
    return jsonb_build_object('campagnes', '[]'::jsonb, 'tronque', false);
  end if;

  select count(*)::int,
         coalesce(jsonb_agg(x.campagne order by x.rang) filter (where x.rang <= p_limite), '[]'::jsonb)
    into v_lus, v_campagnes
    from (
      select row_number() over (order by c.date_debut desc nulls last, c.nom, c.id) as rang,
             jsonb_build_object(
               'id', c.id, 'nom', c.nom, 'annonceur', c.annonceur, 'vague', c.vague,
               'date_debut', c.date_debut, 'date_fin', c.date_fin,
               'lignes', (
                 select coalesce(jsonb_agg(jsonb_build_object(
                          'id', l.id, 'ordre', l.ordre, 'media', l.media, 'regie', l.regie, 'reseau', l.reseau,
                          'territoire', l.territoire, 'nb_ecrans', l.nb_ecrans,
                          'nb_places', (select count(*) from public.campagne_ligne_panneaux clp where clp.ligne_id = l.id),
                          'nb_non_places', case when jsonb_typeof(l.details->'non_places') = 'array'
                                                then jsonb_array_length(l.details->'non_places') else 0 end
                        ) order by l.ordre), '[]'::jsonb)
                   from public.campagne_lignes l
                  where l.campagne_id = c.id and l.media = 'ooh')
             ) as campagne
        from public.campagnes c
       where c.organization_id = p_org
         and exists (select 1 from public.campagne_lignes l where l.campagne_id = c.id and l.media = 'ooh')
       order by c.date_debut desc nulls last, c.nom, c.id
       limit p_limite + 1
    ) x;

  return jsonb_build_object('campagnes', v_campagnes, 'tronque', v_lus > p_limite);
end;
$function$;

comment on function public.campagne_ooh_jsonb(uuid, uuid, integer) is
  'Campagne OOH d un espace : campagne, lignes OOH, emplacements GeoJSON ; null hors espace ; tronque au-dela de p_limite (sql/263).';
comment on function public.campagnes_ooh_jsonb(uuid, integer) is
  'Campagnes d un espace ayant une ligne OOH, avec leurs lignes OOH ; tronque au-dela de p_limite (sql/263).';

revoke all on function public.campagne_ooh_jsonb(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.campagnes_ooh_jsonb(uuid, integer) from public, anon, authenticated;
grant execute on function public.campagne_ooh_jsonb(uuid, uuid, integer) to service_role;
grant execute on function public.campagnes_ooh_jsonb(uuid, integer) to service_role;

notify pgrst, 'reload schema';

commit;

-- ── Mesure (EXPLAIN ANALYZE, 2026-10-16, base locale) ──────────────────────
-- Fixture : 1 campagne, 1 ligne OOH, 1 230 panneaux liés (le volume de TF4), transaction ANNULÉE.
-- Requête des emplacements (fenêtre + tri + LIMIT 20001) : Planning Time 0,380 ms, Execution Time 1,219 ms,
-- nœud racine Limit : Buffers shared hit=73 (aucune lecture disque), 1 230 lignes. Jointures par Hash Join ; la base
-- locale ne porte, fixture comprise, que 1 231 panneaux (1 de plus que la fixture), donc le planificateur lit `panneaux_affichage` en
-- Seq Scan (60 buffers) plutôt que par `panneaux_affichage_pkey` : sur une table de cette taille c'est le bon choix, et
-- la clé de jointure `panneau_id` = pkey reste indexée si la table grossit.
-- Appel complet `campagne_ooh_jsonb` (1 230 points, 840 727 caractères de jsonb) : 53,2 ms (\timing).
-- TF4 réelle (16/10, campagne importée dans l'espace `marine`, 11 lignes, base locale à 1 256 panneaux) :
-- 1 256 emplacements, requête des emplacements 1,24 ms (Planning 0,35 ms), nœud racine Limit : Buffers shared hit=397
-- (aucune lecture disque), Hash Join sur les trois tables, Seq Scan de `panneaux_affichage` (354 buffers : la table
-- ne porte que TF4) ; avant ANALYZE des tables fraîchement écrites, le planificateur prenait des Nested Loop par index
-- (2,8 ms, 5 603 buffers hit). Appel complet `campagne_ooh_jsonb` : 59 à 74 ms (\timing, 5 appels), 1 559 517
-- caractères de jsonb ; `campagnes_ooh_jsonb` (liste de l'espace) : 2,4 ms, 2 470 caractères.
