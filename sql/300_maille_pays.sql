-- sql/300 — La maille `pays` des plateformes, et leurs codes pays en base (⑤ finitions, T1 ; plan
-- `docs/superpowers/plans/2026-10-30-carte-en-parcours-jeu-de-zones.md`, A-1, A-2, E7).
--
-- POURQUOI. Une zone « France métropolitaine » ou « France entière » créée en ③ (recette `pays`, sql/296) s'achète en
-- ⑤ par le ciblage PAYS natif de chaque plateforme, sans liste de codes postaux (décision Q-2 du 30/10). C'est une
-- maille de plus, portée par `plateformes_geo` comme les six autres (spec § 16.2-3 : jamais en dur) : une ligne par
-- plateforme, native et disponible. `zone_set_plateformes` la choisit par sa clé étrangère, sans rien d'autre à changer.
--
-- LES CODES PAYS, EN BASE (A-2) : `codes_pays` dit ce que la plateforme cible pour chaque code de la recette `pays` —
-- `METRO` → `["FR"]`, `FR` → `["FR", "GP", "MQ", "GF", "RE", "YT"]` : la plupart des plateformes rangent les DROM
-- comme des pays distincts (Q-2, à confirmer dans un compte). Une correction est une `update`, sans livraison.
-- L'extraction FIGE ces codes dans ses unités (A-6) : changer la table après coup ne change pas une extraction relue.
--
-- CE QUI RESTE « À VÉRIFIER » PAR RECETTE (relecture 1) : `pays_a_verifier` liste les codes de recette (`METRO`, `FR`)
-- dont le ciblage n'est pas confirmé dans un compte. Seed : `{FR}` partout — que les DROM soient des pays distincts
-- n'est vérifié chez AUCUNE plateforme ; `METRO` → `FR` l'est (doc publique de DV360, Meta, TikTok ; TTD l'est déjà
-- par sa ligne entière, `a_verifier`). AUCUN défaut ne change : c'est un avertissement, rendu par le serveur dans le
-- résumé figé de l'extraction (`pays_a_verifier`) et lu par l'écran (`paysAVerifier`, lib/zones/conversion.ts).
--
-- EN DUR, À DESSEIN, côté code : les LIBELLÉS des codes (`NOMS_PAYS`) et le département de chaque DROM
-- (`DEPARTEMENT_DROM`, GP → 971…) vivent dans lib/zones/conversion.ts (copie Angular) — des faits géographiques, pas
-- des règles de plateforme. Un code ajouté ici sans libellé là-bas fait échouer `tests/integration/plateformes-geo.test.ts`.
--
-- CONTRÔLES (l'erreur tombe à l'écriture, chez celui qui la commet — patron de `plateformes_geo_limites_valides`) :
--   • `plateformes_geo_codes_pays_valides` : un objet aux clés EXACTEMENT `FR` et `METRO`, chacune une liste non vide
--     de codes ISO 3166 à deux lettres MAJUSCULES, sans doublon (un code deux fois ferait échouer l'index
--     `zseu_code_unique` de l'extraction, sql/278) ;
--   • `plateformes_geo_codes_pays_maille` : une ligne `pays` a ses codes, toute autre ligne n'en a pas ;
--   • `plateformes_geo_pays_a_verifier_valide` : `pays_a_verifier` ⊂ {METRO, FR}, présent sur une ligne `pays`
--     seulement (`{}` = tout est confirmé).
--   `PlateformeGeoSchema` (lib/zones/plateformes.ts) lit la même règle.
--
-- EXCEPTION ÉCRITE à « aucun DROP » (plan, Global Constraints) : la contrainte `plateformes_geo_maille_check` est
-- REDÉFINIE pour admettre `pays`, dans un bloc gardé (on ne la redéfinit que si elle ne l'admet pas encore) — patron de
-- `custom_geo_zones_recette_forme` (sql/296). Aucune fonction ni table n'est supprimée.
--
-- ⚠ BASE PARTAGÉE. Une fois appliquée, le registre rend 17 lignes : le code d'une branche dont `MAILLES` ne connaît pas
-- `pays` (`lireRegles` valide TOUTES les lignes par Zod) refuse la lecture du registre — ⑤, l'enregistrement d'un jeu,
-- l'extraction et le pavage en cercles y répondent 500. Rien n'est cassé dans les branches qui portent ce fichier.
--
-- E7 : `zone_set_extraction_unites.pop_totale` reçoit enfin son commentaire (vide jusqu'ici) : pour un CERCLE extrait,
-- c'est la population de sa CELLULE hexagonale de pavage (sql/276), pas celle du disque acheté.
--
-- REJOUABLE : contraintes gardées, `add column if not exists`, `create or replace`, `on conflict do nothing` (comme
-- sql/274 : rejouer ne remet pas le seed sur une ligne corrigée par `update`, mode d'édition prévu par Q-7).
-- Appliquer par `psql -1`. Droits inchangés (service_role seul, sql/274).
--
-- MESURES (base locale, 30/10, après application ; `EXPLAIN (ANALYZE, BUFFERS)`) :
--   lecture du registre par `lireRegles` (17 lignes, tri par `ordre`, `limit 51`)  0,09 ms · 4 accès (seq scan d'une
--     page + tri en mémoire, 31 kB)
--   une ligne de la clé étrangère (`zone_set_plateformes` → `plateformes_geo_pkey`)  0,42 ms · 2 accès (index only)
--   migration rejouée sur la base déjà migrée (transaction annulée, `\timing`) : 6,4 ms en tout ; appliquée deux fois
--     par `psql -1`, empreinte (contenu + contraintes) identique après chaque passe.
--   Aucune lecture de carreau, aucune table volumineuse : 17 lignes, une page.

-- ── La maille `pays` admise ──────────────────────────────────────────────────────────────────────────────────────────
do $do$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.plateformes_geo'::regclass
                    and conname = 'plateformes_geo_maille_check'
                    and pg_get_constraintdef(oid) like '%''pays''%') then
    alter table public.plateformes_geo
      drop constraint if exists plateformes_geo_maille_check,
      add constraint plateformes_geo_maille_check
        check (maille in ('polygone', 'cp', 'iris', 'commune', 'departement', 'cercle', 'pays'));
  end if;
end
$do$;

-- ── Les codes pays ───────────────────────────────────────────────────────────────────────────────────────────────────
alter table public.plateformes_geo add column if not exists codes_pays jsonb;

comment on column public.plateformes_geo.codes_pays is
  'Maille pays seulement : les codes ISO 3166 que la plateforme cible pour chaque code de la recette pays (sql/296), '
  'cles METRO et FR. Fige dans les unites de l''extraction (zone_set_extraction_unites). NULL sur toute autre maille. '
  'sql/300 (finitions de 5, T1).';

-- IMMUTABLE : appelée par un CHECK. plpgsql et non sql : `jsonb_object_keys` et `jsonb_array_elements` lèvent sur un
-- type inattendu, et SQL ne garantit pas l'ordre d'évaluation d'un `and`. NULL est admis ici : la présence des codes
-- est la règle de `plateformes_geo_codes_pays_maille`.
create or replace function public.plateformes_geo_codes_pays_valides(p_codes jsonb)
returns boolean
language plpgsql immutable set search_path to 'public' as $fn$
declare
  v_liste jsonb;
begin
  if p_codes is null then
    return true;
  end if;
  if jsonb_typeof(p_codes) <> 'object' then
    return false;
  end if;
  if (select array_agg(k order by k collate "C") from jsonb_object_keys(p_codes) k) is distinct from array['FR', 'METRO'] then
    return false;
  end if;
  for v_liste in select value from jsonb_each(p_codes) loop
    if jsonb_typeof(v_liste) <> 'array' or jsonb_array_length(v_liste) = 0 then
      return false;
    end if;
    if exists (select 1 from jsonb_array_elements(v_liste) c
                where jsonb_typeof(c) <> 'string' or (c #>> '{}') !~ '^[A-Z]{2}$') then
      return false;
    end if;
    if (select count(distinct c) <> count(*) from jsonb_array_elements(v_liste) c) then
      return false;
    end if;
  end loop;
  return true;
end
$fn$;
revoke all on function public.plateformes_geo_codes_pays_valides(jsonb) from public, anon, authenticated;
grant execute on function public.plateformes_geo_codes_pays_valides(jsonb) to service_role;

do $do$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.plateformes_geo'::regclass and conname = 'plateformes_geo_codes_pays_valides') then
    alter table public.plateformes_geo
      add constraint plateformes_geo_codes_pays_valides check (public.plateformes_geo_codes_pays_valides(codes_pays));
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.plateformes_geo'::regclass and conname = 'plateformes_geo_codes_pays_maille') then
    alter table public.plateformes_geo
      add constraint plateformes_geo_codes_pays_maille check ((maille = 'pays') = (codes_pays is not null));
  end if;
end
$do$;

-- ── Ce qui reste à vérifier, par code de recette (relecture 1) ──────────────────────────────────────────────────────
alter table public.plateformes_geo add column if not exists pays_a_verifier text[];

comment on column public.plateformes_geo.pays_a_verifier is
  'Maille pays seulement : les codes de recette (METRO, FR) dont le ciblage n''est pas confirme dans un compte. '
  'Avertissement seulement, aucun defaut n''en depend. {} = tout confirme ; NULL sur toute autre maille. sql/300.';

-- Les lignes `pays` posées avant cette colonne (premier passage de sql/300) ; une ligne déjà réglée (`{}` après
-- confirmation) n'est pas remise à `{FR}` par un rejeu. Posée AVANT l'insert : un CHECK se vérifie sur la ligne
-- proposée, même quand `on conflict do nothing` l'écarte ensuite.
update public.plateformes_geo set pays_a_verifier = '{FR}' where maille = 'pays' and pays_a_verifier is null;

do $do$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.plateformes_geo'::regclass and conname = 'plateformes_geo_pays_a_verifier_valide') then
    alter table public.plateformes_geo
      add constraint plateformes_geo_pays_a_verifier_valide check (
        (maille = 'pays') = (pays_a_verifier is not null)
        and (pays_a_verifier is null or pays_a_verifier <@ array['METRO', 'FR']::text[]));
  end if;
end
$do$;

-- ── Les quatre lignes `pays` (A-1) ───────────────────────────────────────────────────────────────────────────────────
-- `doc_url` : celle de la ligne CP (DV360, Meta) ou département (TikTok) de la plateforme ; TTD : nulle (doc derrière
-- connexion, comme ses trois autres lignes), donc « à vérifier ». `ordre` : la dernière de chaque plateforme.
insert into public.plateformes_geo
  (plateforme, maille, libelle, natif, disponible, limites, doc_url, releve_le, a_verifier, note, ordre, codes_pays,
   pays_a_verifier)
values
  ('dv360', 'pays', 'Pays', true, true, '{}',
   'https://developers.google.com/display-video/api/guides/concepts/targeting/geography', '2026-10-30', false,
   'Les DROM sont des pays distincts chez la plupart des plateformes : France entière = FR + 5 codes ; à confirmer dans un compte.',
   28, '{"METRO": ["FR"], "FR": ["FR", "GP", "MQ", "GF", "RE", "YT"]}', '{FR}'),
  ('ttd', 'pays', 'Pays', true, true, '{}', null, '2026-10-30', true,
   'Les DROM sont des pays distincts chez la plupart des plateformes : France entière = FR + 5 codes ; à confirmer dans un compte. Doc derrière connexion.',
   55, '{"METRO": ["FR"], "FR": ["FR", "GP", "MQ", "GF", "RE", "YT"]}', '{FR}'),
  ('meta', 'pays', 'Pays', true, true, '{}',
   'https://developers.facebook.com/docs/marketing-api/audiences/reference/basic-targeting', '2026-10-30', false,
   'Les DROM sont des pays distincts chez la plupart des plateformes : France entière = FR + 5 codes ; à confirmer dans un compte.',
   78, '{"METRO": ["FR"], "FR": ["FR", "GP", "MQ", "GF", "RE", "YT"]}', '{FR}'),
  ('tiktok', 'pays', 'Pays', true, true, '{}',
   'https://ads.tiktok.com/help/article/location-targeting', '2026-10-30', false,
   'Les DROM sont des pays distincts chez la plupart des plateformes : France entière = FR + 5 codes ; à confirmer dans un compte.',
   115, '{"METRO": ["FR"], "FR": ["FR", "GP", "MQ", "GF", "RE", "YT"]}', '{FR}')
on conflict (plateforme, maille) do nothing;

-- ── E7 : ce que compte `pop_totale` d'une unité figée ────────────────────────────────────────────────────────────────
comment on column public.zone_set_extraction_unites.pop_totale is
  'Population totale de l''unite, a la cible du jeu. CERCLE : celle de sa cellule hexagonale de pavage (sql/276), pas '
  'celle du disque achete. Territoire (CP, commune, departement, IRIS) : celle du territoire. Polygone : celle de la '
  'zone. Pays : la population carroyee du territoire (metropole, ou DROM par son departement). NULL = non carroye '
  '(population inconnue, jamais 0). sql/300.';
