-- ============================================================================
-- sql/148_materialisations_indicateurs_cp.sql — Tâche 12/13 (2026-09-13)
--
-- Journal des matérialisations d'`indicator_cp_values`, plus deux fonctions
-- qui s'en servent. Écrit en réponse à un défaut trouvé en relecture.
--
-- ── LE DÉFAUT : la PRÉSENCE de valeurs ne dit pas qu'on a déjà calculé ──────
--
-- `indicator_cp_values` est peuplée À LA DEMANDE : au 2026-09-13 elle ne
-- portait que 2 des 19 indicateurs actifs du registre. Les routes d'analyse
-- matérialisaient donc « si absent », en testant la présence de lignes.
--
-- Or `materialize_indicator_cp_values` peut écrire ZÉRO ligne, et c'est un cas
-- RÉEL, pas théorique : l'indicateur `part_couples_enfants` pointe sur
-- `iris.part_couples_avec_enfants`, **entièrement vide** — mesuré :
-- 0 renseigné sur 49 448 IRIS — tout en étant `active` dans le registre, donc
-- proposé à l'utilisateur dans la liste déroulante de l'outil.
--
-- Conséquence : le test de présence ne trouvait jamais rien, et l'indicateur
-- se rematérialisait À CHAQUE LANCEMENT. Chaque tentative est un `Seq Scan`
-- complet d'`iris` :
--
--     GroupAggregate (actual rows=0)
--       Buffers: shared hit=11766 read=22123      ← ~173 Mo lus DU DISQUE
--       ->  Seq Scan on iris  (Rows Removed by Filter: 49448)
--     Execution Time: 1267.693 ms
--
-- Avec un quota de 12 lancements/minute/utilisateur, sur un disque Nano
-- plafonné à 5 Mo/s et 250 IOPS : la famille exacte des incidents du 28/03 et
-- du 08/04 (CLAUDE.md). Il suffisait d'ajouter cet indicateur à un score et de
-- bouger un curseur de poids.
--
-- ── LE SECOND DÉFAUT : deux indicateurs quotidiens figés, et mal datés ──────
--
-- Les sources `pollen` et `atmo` ne se comportent PAS comme les 16 colonnes
-- IRIS : `materialize_indicator_cp_values` les lit au `max(date_ech)` de
-- `pollen_map_daily` / `atmo_map_daily`, tables rafraîchies chaque jour et
-- purgées à J-2. Ne matérialiser que ce qui est absent les gelait donc pour
-- toujours au jour du premier calcul. Et la route affichait la date du CALCUL,
-- pas celle de la DONNÉE : « calculé le 13/09 » sous une mesure du 03/07.
--
-- D'où `date_donnee` dans le journal, et le drapeau `perime` d'`etat_indicateur_cp`,
-- qui ne vaut `true` QUE pour ces deux sources — recalculer les colonnes IRIS
-- « par fraîcheur » ferait payer un balayage complet pour un résultat
-- identique, elles ne bougent qu'à un import.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.indicator_cp_materializations (
  indicator_code text PRIMARY KEY,
  computed_at    timestamptz NOT NULL DEFAULT now(),
  /** Nombre de lignes réellement écrites — ZÉRO est une information, pas un échec. */
  n_lignes       integer     NOT NULL,
  data_source    text        NOT NULL,
  /** Date de la DONNÉE (sources quotidiennes), pas du calcul. NULL sinon. */
  date_donnee    date
);

COMMENT ON TABLE public.indicator_cp_materializations IS
  'Journal des materialisations de indicator_cp_values — Tache 12/13, sql/148. Existe parce que la PRESENCE de valeurs ne suffit pas a savoir si un indicateur a deja ete calcule : materialize_indicator_cp_values peut inserer ZERO ligne (colonne source entierement vide, ex. part_couples_avec_enfants : 0 renseigne sur 49448 IRIS), et un appelant qui teste la presence rematerialise alors A CHAQUE LANCEMENT — un seq scan complet d iris, ~173 Mo lus et 1,3 s, sur un Nano plafonne a 5 Mo/s.';

-- Aucune policy : deny-all, les routes passent en service_role (comme le reste
-- des tables de service du projet).
ALTER TABLE public.indicator_cp_materializations ENABLE ROW LEVEL SECURITY;

-- ── Matérialisation instrumentée ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.materialiser_indicateur_cp(p_indicator_code text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  reg    record;
  v_n    integer;
  v_date date;
BEGIN
  SELECT * INTO reg FROM public.cible_indicator_registry
   WHERE indicator_code = p_indicator_code AND active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'indicateur inconnu ou inactif %', p_indicator_code;
  END IF;

  v_n := public.materialize_indicator_cp_values(p_indicator_code);

  IF reg.data_source = 'pollen' THEN
    SELECT max(date_ech) INTO v_date FROM public.pollen_map_daily;
  ELSIF reg.data_source = 'atmo' THEN
    SELECT max(date_ech) INTO v_date FROM public.atmo_map_daily;
  ELSE
    v_date := NULL;
  END IF;

  INSERT INTO public.indicator_cp_materializations (indicator_code, computed_at, n_lignes, data_source, date_donnee)
  VALUES (p_indicator_code, now(), v_n, reg.data_source, v_date)
  ON CONFLICT (indicator_code) DO UPDATE
    SET computed_at = EXCLUDED.computed_at,
        n_lignes    = EXCLUDED.n_lignes,
        data_source = EXCLUDED.data_source,
        date_donnee = EXCLUDED.date_donnee;

  RETURN jsonb_build_object(
    'n_lignes', v_n, 'data_source', reg.data_source,
    'date_donnee', v_date, 'computed_at', now()
  );
END $fn$;

COMMENT ON FUNCTION public.materialiser_indicateur_cp(text) IS
  'Enveloppe instrumentee de materialize_indicator_cp_values — Tache 12, sql/148. Journalise le NOMBRE de lignes ecrites (zero compris) et, pour les sources pollen/atmo, la date de la donnee. Sans ce journal, un indicateur dont la colonne source est vide se rematerialise indefiniment.';

-- ── État, sans rien recalculer ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.etat_indicateur_cp(p_indicator_code text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT jsonb_build_object(
    'connu',       (r.indicator_code IS NOT NULL),
    'data_source', r.data_source,
    'journalise',  (m.indicator_code IS NOT NULL),
    'n_lignes',    m.n_lignes,
    'computed_at', m.computed_at,
    'date_donnee', m.date_donnee,
    -- Des valeurs présentes SANS journal = matérialisées avant sql/148.
    'a_des_valeurs', EXISTS (
      SELECT 1 FROM public.indicator_cp_values v WHERE v.indicator_code = p_indicator_code),
    'valeurs_calculees_le', (
      SELECT max(v.computed_at) FROM public.indicator_cp_values v WHERE v.indicator_code = p_indicator_code),
    -- Seules les sources quotidiennes se périment (voir l'en-tête).
    'perime', CASE
      WHEN r.data_source = 'pollen' THEN
        COALESCE(m.date_donnee, '-infinity'::date) < (SELECT max(date_ech) FROM public.pollen_map_daily)
      WHEN r.data_source = 'atmo' THEN
        COALESCE(m.date_donnee, '-infinity'::date) < (SELECT max(date_ech) FROM public.atmo_map_daily)
      ELSE false
    END
  )
  FROM (SELECT p_indicator_code AS code) q
  LEFT JOIN public.cible_indicator_registry r
    ON r.indicator_code = q.code AND r.active
  LEFT JOIN public.indicator_cp_materializations m ON m.indicator_code = q.code;
$fn$;

COMMENT ON FUNCTION public.etat_indicateur_cp(text) IS
  'Dit si un indicateur est calculable, deja calcule, vide ou perime — SANS rien recalculer (Tache 12, sql/148). perime ne vaut true que pour les sources quotidiennes pollen/atmo, dont indicator_cp_values fige le max(date_ech) du jour de la materialisation.';

REVOKE ALL ON FUNCTION public.materialiser_indicateur_cp(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.materialiser_indicateur_cp(text) TO service_role;
REVOKE ALL ON FUNCTION public.etat_indicateur_cp(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.etat_indicateur_cp(text) TO service_role;

-- ── Amorçage : les indicateurs déjà matérialisés avant ce journal ──────────
-- Sans cette ligne, `rev_median` et `abstention_pres_2022` seraient vus comme
-- « jamais tentés » et rematérialisés une fois chacun pour rien.
INSERT INTO public.indicator_cp_materializations (indicator_code, computed_at, n_lignes, data_source, date_donnee)
SELECT v.indicator_code, max(v.computed_at), count(*)::int, r.data_source, NULL
FROM public.indicator_cp_values v
JOIN public.cible_indicator_registry r ON r.indicator_code = v.indicator_code
GROUP BY v.indicator_code, r.data_source
ON CONFLICT (indicator_code) DO NOTHING;
