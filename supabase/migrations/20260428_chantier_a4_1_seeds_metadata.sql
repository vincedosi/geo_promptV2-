-- Chantier A4.1 — Seeds metadata (5 algos + 8 objectives)

INSERT INTO public.bidding_algorithms
  (code, display_name, display_name_fr, family, library, config_schema,
   supports_drift_detection, supports_online_learning, is_baseline, display_order, description)
VALUES
  ('hoeffding_adaptive_tree', 'Hoeffding Adaptive Tree', 'Arbre Hoeffding adaptatif', 'tree', 'river',
   '{"grace_period":200,"max_depth":10,"split_criterion":"info_gain","leaf_prediction":"adaptive"}'::jsonb,
   true, true, false, 10,
   'Arbre de décision online avec adaptation aux drifts. Bon défaut pour signaux non-linéaires.'),
  ('linucb', 'LinUCB Contextual Bandit', 'Bandit contextuel LinUCB', 'bandit', 'custom',
   '{"alpha":1.0,"context_features":["dow","tier","weather"]}'::jsonb,
   false, true, false, 20,
   'Bandit contextuel à régression linéaire. Excellent quand peu de features et exploration nécessaire.'),
  ('thompson_sampling', 'Thompson Sampling', 'Échantillonnage de Thompson', 'bandit', 'custom',
   '{"prior":"beta","alpha":1,"beta":1}'::jsonb,
   false, true, false, 30,
   'Bandit bayésien. Convergence rapide avec exploration intelligente, parfait pour les KPIs binaires.'),
  ('gbm_online', 'Online Gradient Boosting', 'Gradient Boosting online', 'tree', 'river',
   '{"n_models":10,"learning_rate":0.05,"max_depth":6}'::jsonb,
   true, true, false, 40,
   'Boosting online avec faible profondeur. Souvent le plus performant si volume de données suffisant.'),
  ('baseline_random', 'Random Bid Multiplier', 'Multiplicateur aléatoire', 'baseline', 'custom',
   '{"min_multiplier":0.5,"max_multiplier":1.5}'::jsonb,
   false, false, true, 100,
   'Baseline aléatoire pour comparaison de référence.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.bidding_objectives
  (code, display_name, display_name_fr, optimization_direction, required_metrics, formula, unit, display_order, description)
VALUES
  ('maximize_impressions', 'Maximize Impressions', 'Maximiser les impressions', 'maximize',
   '["impressions"]'::jsonb, NULL, 'count', 10,
   'Brand awareness pure. Volume max, peu de discrimination géographique.'),
  ('maximize_viewability', 'Maximize Viewability', 'Maximiser la visibilité', 'maximize',
   '["impressions","viewable_impressions"]'::jsonb, 'viewable_impressions::numeric / NULLIF(impressions, 0)', 'rate', 20,
   'Maximise le ratio d''impressions visibles (standard MRC).'),
  ('maximize_ctr', 'Maximize CTR', 'Maximiser le CTR', 'maximize',
   '["impressions","clicks"]'::jsonb, 'clicks::numeric / NULLIF(impressions, 0)', 'rate', 30,
   'Maximise le taux de clic. Sensible mais parfois biaisé par bots.'),
  ('maximize_visits', 'Maximize Visits', 'Maximiser les visites', 'maximize',
   '["visits"]'::jsonb, NULL, 'count', 40,
   'Maximise le nombre de visites site post-impression. Signal mid-funnel.'),
  ('maximize_leads', 'Maximize Leads', 'Maximiser les leads', 'maximize',
   '["leads"]'::jsonb, NULL, 'count', 50,
   'Maximise les conversions bas-funnel. Signal le plus fiable mais le plus rare.'),
  ('minimize_cpa', 'Minimize CPA', 'Minimiser le CPA', 'minimize',
   '["spend","leads"]'::jsonb, 'spend / NULLIF(leads, 0)', 'currency_eur', 60,
   'Minimise le coût par acquisition (€/lead).'),
  ('minimize_cpc', 'Minimize CPC', 'Minimiser le CPC', 'minimize',
   '["spend","clicks"]'::jsonb, 'spend / NULLIF(clicks, 0)', 'currency_eur', 70,
   'Minimise le coût par clic.'),
  ('maximize_roas', 'Maximize ROAS', 'Maximiser le ROAS', 'maximize',
   '["spend"]'::jsonb, NULL, 'rate', 80,
   'Maximise le ROAS (Return on Ad Spend). Nécessite revenue tracking — formule à compléter selon attribution.')
ON CONFLICT (code) DO NOTHING;
