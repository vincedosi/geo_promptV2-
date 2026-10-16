-- 262 — Panneaux enrichis : ce que la régie dit d'un emplacement (2026-10-16)
--
-- Spec : docs/superpowers/specs/2026-10-16-ooh-campagnes-design.md § 1 (décision 8), § 4.3.
-- La table des panneaux doit porter le MAXIMUM d'information. Douze colonnes s'ajoutent à `panneaux_affichage` ;
-- les colonnes existantes (`regie`, `type_panneau`, `adresse`, `ville`, `code_postal`, `code_insee`,
-- `code_departement`, `nb_faces`, `reference_panneau`, `source`, `source_ref`, `data_source_id`, `organization_id`,
-- `metadata`) sont remplies par le script quand on peut. `metadata` garde la ligne d'origine EN ENTIER.
--
-- `geoloc_*` dit comment le point a été placé : méthode (référentiel des gares SNCF, adresse BAN, alias manuel
-- vérifié par l'INSEE, coordonnées fournies), qualité (`sure` / `a_verifier` — jamais placé en silence), score (BAN,
-- ou 1 pour une correspondance exacte au référentiel), libellé reconnu (pour juger d'un coup d'œil).
-- Les CHECK sont posés par un bloc DO gardé par `pg_constraint` (rejouable, aucun DROP).
-- Coût : `ADD COLUMN` sans défaut, métadonnée seule (aucune réécriture de table). Rejouable.

begin;

alter table public.panneaux_affichage
  add column if not exists nom_lieu               text,
  add column if not exists reseau                 text,
  add column if not exists type_lieu              text,
  add column if not exists numerique              boolean,
  add column if not exists nb_ecrans              integer,
  add column if not exists formats                text[],
  add column if not exists contacts_semaine       integer,
  add column if not exists contacts_18_25_semaine integer,
  add column if not exists geoloc_methode         text,
  add column if not exists geoloc_qualite         text,
  add column if not exists geoloc_score           double precision,
  add column if not exists geoloc_libelle         text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'panneaux_geoloc_methode_check') then
    alter table public.panneaux_affichage add constraint panneaux_geoloc_methode_check
      check (geoloc_methode is null or geoloc_methode in ('referentiel_gares', 'adresse_ban', 'alias_manuel', 'coordonnees_fournies'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'panneaux_geoloc_qualite_check') then
    alter table public.panneaux_affichage add constraint panneaux_geoloc_qualite_check
      check (geoloc_qualite is null or geoloc_qualite in ('sure', 'a_verifier'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'panneaux_geoloc_score_check') then
    alter table public.panneaux_affichage add constraint panneaux_geoloc_score_check
      check (geoloc_score is null or (geoloc_score >= 0 and geoloc_score <= 1));
  end if;
end
$$;

comment on column public.panneaux_affichage.geoloc_qualite is
  'sure | a_verifier : un emplacement incertain est marque, jamais place en silence (sql/262).';

notify pgrst, 'reload schema';

commit;
