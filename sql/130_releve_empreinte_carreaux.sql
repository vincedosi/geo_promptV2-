-- 130 — releve_empreinte_carreaux : rendre visible la péremption des bornes
--
-- ── LE DÉFAUT QUE CECI ADRESSE ──────────────────────────────────────────────
--
-- Les 28 bornes nationales de `lib/carreaux/bornes.ts` sont un INSTANTANÉ des
-- données Filosofi, mesuré le 2026-09-10 et écrit en dur dans le code. C'est
-- ce qui rend deux territoires comparables : une densité donne la même couleur
-- où qu'on soit sur la carte.
--
-- Mais le jour où quelqu'un ré-importe Filosofi — nouveau millésime, correction
-- d'un lot, reconstruction d'un agrégat — ces bornes décrivent une distribution
-- qui n'existe plus. ET RIEN NE LE SIGNALE. Aucune erreur, aucun test rouge,
-- aucune couche vide. La carte reste parfaitement plausible : elle est
-- simplement fausse.
--
-- C'est la forme de défaut la plus coûteuse : celle qu'on ne trouve qu'en se
-- demandant par hasard si un chiffre est crédible. Toute la session des 10 et
-- 11 septembre a consisté à en débusquer de cette famille.
--
-- Cette fonction ne corrige pas les bornes. Elle fournit le SIGNAL manquant,
-- affiché dans /admin/health sous « Fraîcheur des données ».
--
-- ── CE QUI EST RELEVÉ, ET POURQUOI CELA ─────────────────────────────────────
--
-- `carreaux_5km` (22 058 lignes) est dérivée du même import Filosofi que tout
-- le reste, et son balayage est trivial — quelques millisecondes, aucun risque
-- pour le budget I/O de Supabase Nano.
--
-- On relève ses trois valeurs et pas seulement son compte de lignes : un
-- nouveau millésime à maillage constant changerait les totaux de population et
-- de ménages SANS changer le nombre de carreaux. Un compte seul ne le verrait
-- pas — et c'est précisément le cas le plus probable.
--
-- `reltuples` de `carreaux_filosofi` est l'estimation du planificateur :
-- gratuite, aucun scan des 2,3 M de lignes. Elle couvre le cas qu'une empreinte
-- fondée sur les seuls agrégats manquerait : un ré-import du 200 m sans
-- reconstruction des paliers dérivés. Approximative par nature, d'où une
-- tolérance de 2 % appliquée côté applicatif.
--
-- ── CE QU'ON NE FAIT PAS, DÉLIBÉRÉMENT ──────────────────────────────────────
--
-- Ni `count(*)` exact ni `sum()` sur `carreaux_filosofi`. Une vérification de
-- fraîcheur qui coûterait un full scan de 4,6 Go serait désactivée au premier
-- incident I/O — donc inutile. Une garde qu'on finit par éteindre ne garde rien.
--
-- ── ENTRETIEN ───────────────────────────────────────────────────────────────
--
-- La valeur de référence vit dans `lib/carreaux/empreinte-source.ts`
-- (`EMPREINTE_MESURE`). Elle doit être mise à jour EN MÊME TEMPS que les bornes
-- de `bornes.ts`, jamais séparément : c'est le couple qui a du sens. Les
-- requêtes de re-mesure des bornes sont dans
-- `sql/123_carreaux_bornes_nationales.sql`.

CREATE OR REPLACE FUNCTION public.releve_empreinte_carreaux()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT jsonb_build_object(
    'carreaux_5km_lignes',      (SELECT count(*)          FROM carreaux_5km),
    'carreaux_5km_population',  (SELECT sum(ind)::bigint  FROM carreaux_5km),
    'carreaux_5km_menages',     (SELECT sum(men)::bigint  FROM carreaux_5km),
    'carreaux_filosofi_estime', (SELECT reltuples::bigint FROM pg_class WHERE relname = 'carreaux_filosofi')
  );
$function$;

REVOKE ALL ON FUNCTION public.releve_empreinte_carreaux() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.releve_empreinte_carreaux() TO service_role;
