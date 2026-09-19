-- ============================================================================
-- sql/159_empreinte_zones_geometrie.sql — corrections de relecture du lot
-- Campagne (2026-09-13)
--
-- ── 1. L'empreinte de dérive portait sur la mauvaise chose ────────────────
--
-- `strategie_versions.empreinte_zones` gardait `{ zone_id: updated_at }`. Une
-- relecture indépendante a montré que ce choix produisait DEUX défauts opposés,
-- tous deux mauvais :
--
--   · **Faux positif garanti.** Le seul UPDATE applicatif sur
--     `custom_geo_zones` est `PATCH /api/custom-geo/[id]`, dont le schéma
--     n'accepte QUE `name` et `description`. Renommer une zone — geste
--     purement cosmétique — bougeait donc `updated_at` via le trigger
--     `custom_geo_zones_before_write`, la stratégie était déclarée « dérivée »,
--     et l'activation restait bloquée jusqu'à republication.
--
--   · **La justification était fausse.** L'en-tête de sql/157 affirmait que
--     « le lot Zones vient d'ajouter CINQ façons de modifier une zone ». Les
--     cinq (intersection, soustraction, import de CP, rayon, dessin) **CRÉENT
--     une nouvelle zone** ; aucune ne modifie une zone existante. Le scénario
--     que la fonctionnalité prétendait couvrir n'était atteignable par aucun
--     chemin du code.
--
-- L'empreinte porte donc désormais sur le CONTENU : hachage de la géométrie,
-- plus les comptes de CP et d'IRIS résolus. Ces comptes ne sont pas du
-- décor — c'est la liste de codes postaux que consomme le DSP, et une
-- résolution rejouée qui en rend moins change le ciblage sans que la géométrie
-- ait bougé d'un octet.
--
-- Le seul cas utile que `updated_at` couvrait déjà — la SUPPRESSION d'une zone
-- — continue de fonctionner : une zone absente ne figure pas dans le résultat,
-- et `zonesModifiees` la signale comme retirée.
--
-- ── 2. « Attribué en base, donc pas de course » était faux ────────────────
--
-- sql/157 affirmait qu'attribuer le numéro de version dans la même instruction
-- que l'insertion évitait la course entre deux publications simultanées. C'est
-- inexact, et la relecture l'a démontré : `INSERT … SELECT max(version)+1` sans
-- verrou est exactement aussi exposé qu'un `SELECT max` suivi d'un `INSERT` —
-- en READ COMMITTED, deux transactions lisent le même `max` et l'une viole la
-- contrainte `UNIQUE`, avec un message illisible plutôt qu'un numéro correct.
--
-- D'où le `pg_advisory_xact_lock` sur l'identifiant de stratégie.
--
-- Et l'idempotence, qui manquait : republier sans rien avoir changé créait
-- `v1` puis `v2` avec la MÊME empreinte et la même charge utile, ce qui vidait
-- de son sens le numéro de version affiché par le pré-vol.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.empreinte_zones(p_zone_ids uuid[])
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $fn$
  SELECT COALESCE(jsonb_object_agg(z.id::text, e.empreinte), '{}'::jsonb)
  FROM public.custom_geo_zones z
  CROSS JOIN LATERAL (
    SELECT md5(
      COALESCE(ST_AsBinary(z.geometry)::text, '')
      -- La liste de codes postaux compte AUTANT que la geometrie : c'est elle
      -- que consomme le DSP. Une resolution rejouee qui rend moins de CP change
      -- le ciblage sans que la geometrie ait bouge d un octet.
      || ':' || COALESCE(z.feature_count_cp::text, '')
      || ':' || COALESCE(z.feature_count_iris::text, '')
    ) AS empreinte
  ) e
  WHERE z.id = ANY(p_zone_ids);
$fn$;

COMMENT ON FUNCTION public.empreinte_zones(uuid[]) IS
  'Empreinte de CONTENU des zones d une strategie publiee — Tache 19, corrigee sql/159. Remplace updated_at, qui produisait deux defauts opposes : un RENOMMAGE (seul UPDATE que PATCH /api/custom-geo/[id] autorise) bloquait l activation ; et aucun chemin applicatif ne modifiant la geometrie d une zone existante, la derive que la fonctionnalite pretendait detecter n etait atteignable par rien. Le hachage porte sur la geometrie ET sur les comptes de CP/IRIS resolus, parce que c est la liste de codes postaux que consomme le DSP.';

REVOKE ALL ON FUNCTION public.empreinte_zones(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.empreinte_zones(uuid[]) TO service_role;

-- ── Publication : verrou consultatif + idempotence ────────────────────────
CREATE OR REPLACE FUNCTION public.publier_strategie(
  p_strategie_id uuid,
  p_publiee_par  uuid,
  p_empreinte    jsonb,
  p_charge_utile jsonb
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_precedente record;
  v_res jsonb;
BEGIN
  -- Verrou consultatif de TRANSACTION, corrige apres relecture.
  --
  -- La version precedente affirmait que « le numero est attribue EN BASE, donc
  -- pas de course ». C'etait FAUX : un `INSERT ... SELECT max(version)+1` sans
  -- verrou est exactement aussi sujet a la course qu'un SELECT suivi d'un
  -- INSERT — en READ COMMITTED, deux transactions concurrentes lisent le meme
  -- max et l'une viole la contrainte UNIQUE avec un message illisible.
  PERFORM pg_advisory_xact_lock(hashtext(p_strategie_id::text));

  -- Idempotence : republier sans rien avoir change creait v1 puis v2 avec la
  -- MEME empreinte et la meme charge utile, et le numero de version affiche
  -- par le pre-vol perdait tout sens. On rend la version existante.
  SELECT id, version, publiee_le INTO v_precedente
  FROM public.strategie_versions
  WHERE strategie_id = p_strategie_id
    AND empreinte_zones = p_empreinte
    AND charge_utile   = p_charge_utile
  ORDER BY version DESC LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'id', v_precedente.id, 'version', v_precedente.version,
      'publiee_le', v_precedente.publiee_le,
      'n_zones', (SELECT count(*) FROM jsonb_object_keys(p_empreinte)),
      'deja_publiee', true
    );
  END IF;

  INSERT INTO public.strategie_versions
    (strategie_id, version, publiee_par, empreinte_zones, charge_utile)
  SELECT p_strategie_id,
         COALESCE((SELECT max(version) FROM public.strategie_versions
                    WHERE strategie_id = p_strategie_id), 0) + 1,
         p_publiee_par, p_empreinte, p_charge_utile
  RETURNING jsonb_build_object(
    'id', id, 'version', version, 'publiee_le', publiee_le,
    'n_zones', (SELECT count(*) FROM jsonb_object_keys(empreinte_zones)),
    'deja_publiee', false
  ) INTO v_res;

  RETURN v_res;
END $fn$;

COMMENT ON FUNCTION public.publier_strategie(uuid, uuid, jsonb, jsonb) IS
  'Publie une version de strategie (Tache 19, sql/157, corrigee sql/159). Verrou consultatif de TRANSACTION sur l id de strategie : la version precedente affirmait qu attribuer le numero « en base » suffisait a eviter la course, ce qui etait faux — un INSERT ... SELECT max+1 sans verrou est aussi expose qu un SELECT suivi d un INSERT. Idempotente : republier avec la meme empreinte ET la meme charge utile rend la version existante au lieu d en creer une jumelle, qui viderait de sens le numero affiche par le pre-vol.';

REVOKE ALL ON FUNCTION public.publier_strategie(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publier_strategie(uuid, uuid, jsonb, jsonb) TO service_role;
