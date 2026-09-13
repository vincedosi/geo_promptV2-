-- ============================================================================
-- sql/147_correlation_campagne_indicateur.sql — Tâche 13 (2026-09-13)
--
-- « Ma campagne a-t-elle arrosé les codes postaux qui comptent ? »
-- Apparie les impressions livrées par code postal avec un indicateur INSEE.
--
-- DEUX raisons pour lesquelles cette jointure vit en SQL et non en TypeScript,
-- contrairement à ce que le plan prévoyait (une fonction `apparier`) :
--
--  1. LA SOMME SUR LES ACTEURS EST OBLIGATOIRE. La clé primaire de
--     `campaign_cp_rollup` est (campaign_id, postal_code, ACTEUR) : un même
--     code postal y apparaît une fois par acteur (DSP, social, régie…).
--     Mesure du 2026-09-13 sur une campagne réelle : **10 205 lignes pour
--     2 041 codes postaux**, cinq acteurs. Corréler sans sommer d'abord ferait
--     peser un CP jusqu'à cinq fois dans un coefficient censé compter des
--     codes postaux.
--
--  2. 10 205 LIGNES DÉPASSENT LE PLAFOND POSTGREST (5 000 par défaut,
--     ARCHITECTURE.md). Les faire descendre dans Node pour les agréger aurait
--     été plus lourd ET silencieusement tronqué — le pire des deux.
--
-- Lit les ROLLUPS, jamais `dsp_campaign_data` (règle du cockpit de suivi).
--
-- Mesure : 11 ms à cache chaud (zéro lecture disque), 364 ms à froid, pour
-- 2 041 codes postaux. Les deux Seq Scan portent sur des tables de 10 205 et
-- 8 138 lignes ; le planificateur les choisit parce que la base ne contient
-- aujourd'hui qu'une campagne — le préfixe de la clé primaire prendra le relais
-- dès qu'il y en aura plusieurs. Aucun index ajouté sur la foi d'une seule
-- campagne.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.correlation_campagne_indicateur(
  p_campaign_id uuid,
  p_indicator_code text
) RETURNS TABLE (postal_code text, impressions bigint, valeur numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  WITH imps AS (
    SELECT r.postal_code, SUM(r.impressions)::bigint AS impressions
    FROM public.campaign_cp_rollup r
    WHERE r.campaign_id = p_campaign_id
      AND r.postal_code IS NOT NULL
    GROUP BY r.postal_code
  )
  -- Jointure INTERNE : un code postal sans valeur d'indicateur ne peut pas
  -- entrer dans une corrélation. Le nombre de CP écartés se déduit côté route
  -- (impressions totales vs appariées) et part dans la réponse — un
  -- coefficient calculé sur 200 CP quand la campagne en couvre 2 041 ne dit
  -- pas la même chose, et le taire serait mentir par omission.
  SELECT i.postal_code, i.impressions, v.value
  FROM imps i
  JOIN public.indicator_cp_values v
    ON v.postal_code = i.postal_code
   AND v.indicator_code = p_indicator_code
  ORDER BY i.postal_code;
$fn$;

COMMENT ON FUNCTION public.correlation_campagne_indicateur(uuid, text) IS
  'Impressions livrees par code postal (SOMMEES sur les acteurs) appariees a un indicateur INSEE — Tache 13, sql/147. La somme est obligatoire : la PK de campaign_cp_rollup est (campaign_id, postal_code, actor), donc un CP apparait jusqu a 5 fois (mesure 2026-09-13 : 10205 lignes pour 2041 CP). Lit les rollups, JAMAIS dsp_campaign_data.';

REVOKE ALL ON FUNCTION public.correlation_campagne_indicateur(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.correlation_campagne_indicateur(uuid, text) TO service_role;


-- ============================================================================
-- Combien de codes postaux une campagne touche-t-elle ?
--
-- Existe parce que supabase-js ne sait pas faire un `COUNT(DISTINCT)` : un
-- `count: 'exact'` sur `campaign_cp_rollup` compterait une ligne PAR ACTEUR et
-- annoncerait 10 205 « codes postaux » là où la campagne en touche 2 041 —
-- cinq fois trop, avec l'aplomb d'un chiffre exact.
--
-- Séparée de la fonction d'appariement ci-dessus, et non une colonne de plus
-- sur ses lignes : elle doit répondre AUSSI quand zéro code postal s'apparie,
-- c'est-à-dire précisément quand l'utilisateur a le plus besoin de savoir sur
-- quelle part de sa campagne porte le coefficient qu'on lui montre.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.compte_cp_campagne(p_campaign_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT COUNT(DISTINCT r.postal_code)::integer
  FROM public.campaign_cp_rollup r
  WHERE r.campaign_id = p_campaign_id AND r.postal_code IS NOT NULL;
$fn$;

COMMENT ON FUNCTION public.compte_cp_campagne(uuid) IS
  'Nombre de codes postaux DISTINCTS touches par une campagne — Tache 13, sql/147. Existe parce que supabase-js ne sait pas faire un COUNT(DISTINCT) : un count exact sur campaign_cp_rollup compterait une ligne PAR ACTEUR (10205 pour 2041 CP) et annoncerait cinq fois trop. Sert a dire sur quelle part de la campagne une correlation porte, y compris quand ZERO code postal s apparie.';

REVOKE ALL ON FUNCTION public.compte_cp_campagne(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compte_cp_campagne(uuid) TO service_role;
