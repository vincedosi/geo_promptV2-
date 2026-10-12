-- 249 — Matérialisation d'un indicateur par code postal SANS course (2026-10-12)
--
-- ── Le défaut ────────────────────────────────────────────────────────────────
--
-- Deux PREMIERS calculs de corrélation (`/api/analyses/correlation`) ou de
-- score (`/api/analyses/score`) lancés en même temps sur le même indicateur
-- répondaient 500 :
--
--     duplicate key value violates unique constraint "indicator_cp_values_pkey"
--
-- Les deux requêtes voient l'indicateur absent (`etat_indicateur_cp`), et
-- toutes deux appellent `materialiser_indicateur_cp` → `materialize_indicator_cp_values`
-- (sql/106). Celle-ci fait `DELETE … WHERE indicator_code = p` puis un
-- `INSERT INTO indicator_cp_values` SANS `ON CONFLICT` : la seconde
-- transaction ne voit pas les lignes non validées de la première, son DELETE
-- n'efface rien, et son INSERT bute sur la clé primaire
-- (`indicator_code, postal_code`) dès que la première valide.
-- Revue finale du lot 4 Angular, I-2a (registre, ligne 88).
--
-- ── Le correctif ─────────────────────────────────────────────────────────────
--
-- 1. Un verrou consultatif de TRANSACTION, par indicateur, en tête de
--    `materialize_indicator_cp_values` : deux matérialisations du MÊME
--    indicateur se suivent au lieu de se croiser. Deux indicateurs différents
--    ne s'attendent pas. Le verrou tombe seul à la fin de la transaction.
-- 2. Ceinture et bretelles : chaque INSERT porte
--    `ON CONFLICT (indicator_code, postal_code) DO UPDATE` — un appelant qui
--    ne passerait pas par ce verrou (une future fonction) remplace la valeur
--    au lieu d'échouer. `DO UPDATE` et non `DO NOTHING` : `ROW_COUNT` compte
--    alors les lignes réellement écrites, et le journal (sql/148) ne note pas
--    « 0 ligne » — ce qui ferait dire « source vide » à la route.
--
-- La seconde requête recalcule après la première (un balayage d'`iris` de
-- plus) : c'est le coût assumé d'un premier calcul doublé, borné par le quota
-- d'analyses. L'éviter demanderait de relire le journal sous le verrou, avec
-- une horloge commune aux deux transactions — hors du périmètre de ce
-- correctif.
--
-- `CREATE OR REPLACE`, signature et type de retour inchangés : aucun `DROP`
-- (CLAUDE.md, base locale partagée). Rejouable sans dégât.
--
-- Vérification (base locale, 2026-10-12) — deux sessions psql simultanées :
--     BEGIN; SELECT materialize_indicator_cp_values('<code>'); -- session A, sans COMMIT
--     SELECT materialize_indicator_cp_values('<code>');        -- session B : ATTEND
--     COMMIT;                                                  -- session A
--     → la session B rend le même nombre de lignes, sans erreur.
-- (Avant ce correctif, la session B levait `indicator_cp_values_pkey`.)

CREATE OR REPLACE FUNCTION public.materialize_indicator_cp_values(p_indicator_code text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  reg record;
  v_expr text;
  n int := 0;
BEGIN
  -- Une matérialisation à la fois PAR INDICATEUR (voir l'en-tête).
  PERFORM pg_advisory_xact_lock(hashtext('indicator_cp_values:' || p_indicator_code));

  SELECT * INTO reg FROM cible_indicator_registry
   WHERE indicator_code = p_indicator_code AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'indicateur inconnu ou inactif %', p_indicator_code; END IF;

  DELETE FROM indicator_cp_values WHERE indicator_code = p_indicator_code;

  IF reg.data_source = 'iris_column' THEN
    IF reg.normalize = 'pct_of_population' THEN
      v_expr := format('(i.%I::float / nullif(i.population,0) * 100)', reg.data_column);
    ELSE
      v_expr := format('i.%I', reg.data_column);
    END IF;
    EXECUTE format(
      'INSERT INTO indicator_cp_values (indicator_code, postal_code, value)
       SELECT %L, pcc.code_postal,
              sum(%s * coalesce(i.population,0)) / nullif(sum(coalesce(i.population,0)),0)
         FROM iris i
         JOIN postal_code_commune pcc ON pcc.code_commune = i.code_commune
        WHERE %s IS NOT NULL
          AND (i.is_true_iris OR NOT EXISTS (
                SELECT 1 FROM iris t WHERE t.code_commune = i.code_commune AND t.is_true_iris))
        GROUP BY pcc.code_postal
       HAVING sum(coalesce(i.population,0)) > 0
       ON CONFLICT (indicator_code, postal_code)
       DO UPDATE SET value = EXCLUDED.value, computed_at = EXCLUDED.computed_at',
      p_indicator_code, v_expr, v_expr);
  ELSIF reg.data_source = 'abstention' THEN
    EXECUTE format(
      'INSERT INTO indicator_cp_values (indicator_code, postal_code, value)
       SELECT %L, code_postal, %I FROM dataset_abstention_2022 WHERE %I IS NOT NULL
       ON CONFLICT (indicator_code, postal_code)
       DO UPDATE SET value = EXCLUDED.value, computed_at = EXCLUDED.computed_at',
      p_indicator_code, reg.data_column, reg.data_column);
  ELSIF reg.data_source = 'pollen' THEN
    EXECUTE format(
      'INSERT INTO indicator_cp_values (indicator_code, postal_code, value)
       SELECT %L, code_postal, %I FROM pollen_map_daily
        WHERE date_ech = (SELECT max(date_ech) FROM pollen_map_daily) AND %I IS NOT NULL
       ON CONFLICT (indicator_code, postal_code)
       DO UPDATE SET value = EXCLUDED.value, computed_at = EXCLUDED.computed_at',
      p_indicator_code, reg.data_column, reg.data_column);
  ELSE -- atmo
    EXECUTE format(
      'INSERT INTO indicator_cp_values (indicator_code, postal_code, value)
       SELECT %L, code_postal, %I FROM atmo_map_daily
        WHERE date_ech = (SELECT max(date_ech) FROM atmo_map_daily) AND %I IS NOT NULL
       ON CONFLICT (indicator_code, postal_code)
       DO UPDATE SET value = EXCLUDED.value, computed_at = EXCLUDED.computed_at',
      p_indicator_code, reg.data_column, reg.data_column);
  END IF;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

COMMENT ON FUNCTION public.materialize_indicator_cp_values(text) IS
  'Materialise un indicateur par code postal (sql/106). sql/249 : verrou consultatif par indicateur et ON CONFLICT DO UPDATE - deux premiers calculs simultanes ne levent plus indicator_cp_values_pkey.';

REVOKE ALL ON FUNCTION public.materialize_indicator_cp_values(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.materialize_indicator_cp_values(text) TO service_role;
