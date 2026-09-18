-- sql/181 — Entrées `data_registry` pour le risque industriel
--
-- `data_registry` est le registre que le routeur multi-agents interroge pour
-- savoir QUELLES données existent et où elles vivent. Trois jeux majeurs y
-- manquaient : les 96 427 installations classées, les 664 périmètres PPRT et
-- la population exposée — soit tout le chantier risque, invisible au registre.
--
-- ── POURQUOI `metadata` PORTE LA LIMITE, PAS SEULEMENT LA TABLE ───────────
--
-- Les entrées existantes se contentent de `{"table": "..."}`. Ça suffit quand
-- la donnée est homogène. Ici elle ne l'est pas : un périmètre PPRT vient d'un
-- arrêté préfectoral, un rayon de 500 m vient d'un réglage d'interface. Un
-- agent qui lirait « population exposée » sans savoir d'où vient la zone
-- produirait une phrase fausse avec un chiffre juste.
--
-- D'où `indicatif_possible` et `couverture` : ce que le registre annonce doit
-- pouvoir être repris tel quel dans une réponse, sans aller relire le code.
--
-- ⚠ AU PASSAGE, UNE ENTRÉE PÉRIMÉE QUI N'EST PAS CORRIGÉE ICI : `ooh_panneaux`
--    pointe vers `{"table": "global_ooh"}`, une table FUSIONNÉE dans
--    `panneaux_affichage` en 07/2026. La corriger sort du périmètre de ce
--    chantier et toucherait le routeur OOH ; signalée plutôt que rafistolée
--    au passage.

insert into public.data_registry (slug, label, category, description, metadata, is_active)
values
  (
    'risque_sites_icpe',
    'Installations classées (ICPE)',
    'risque',
    'Sites industriels soumis à la réglementation ICPE, importés de Géorisques. '
    || 'La gravité (statut Seveso, IED, autorisation…) vit dans `sous_categorie`, '
    || 'la nature du risque dans `metadata.libelle_nature`.',
    jsonb_build_object(
      'table', 'poi_france',
      'filtre', 'categorie = ''risque_industriel''',
      'source', 'Géorisques — api/v1/installations_classees',
      'couverture', 'France entière, 101 départements',
      -- La pagination de l'API n'est pas stable : deux imports successifs ne
      -- rendent pas exactement le même ensemble (~5 % de rotation mesurée).
      -- Un agent qui compare deux comptages doit le savoir.
      'stabilite', 'referentiel vivant, pagination source instable (~5 % de rotation par import)'
    ),
    true
  ),
  (
    'risque_perimetres_pprt',
    'Périmètres PPRT (servitudes PM3)',
    'risque',
    'Périmètres réglementaires opposables en urbanisme, déposés par les DDT au '
    || 'Géoportail de l''Urbanisme. C''est l''ENVELOPPE du plan, pas son zonage '
    || 'interne rouge/bleu/gris — ce dernier n''est publié nulle part en vecteur national.',
    jsonb_build_object(
      'table', 'pprt_perimetres',
      'source', 'Géoplateforme IGN — WFS wfs_sup:assiette_sup_s, suptype=pm3',
      'couverture', '664 assiettes, 609 generateurs, 87 departements sur les 88 qui ont un PPRT',
      'granularite', 'enveloppe uniquement — le zonage R/r/B/b n''est pas disponible',
      'fraicheur', 'par document depose : de 2016-10 a 2026-09'
    ),
    true
  ),
  (
    'risque_population_exposee',
    'Population exposée aux risques industriels',
    'risque',
    'Nombre d''habitants vivant dans la zone de danger d''un site classé, '
    || 'réparti au prorata de surface des carreaux INSEE de 200 m. '
    || 'ATTENTION : selon le site, la zone est soit la servitude PPRT publiée par '
    || 'l''État, soit un rayon choisi dans l''interface. Le champ `indicatif` le dit.',
    jsonb_build_object(
      'table', 'seveso_exposition',
      'rpc', 'population_exposee_site',
      'source_population', 'carreaux_filosofi 200 m (champ metadata->>''ind'')',
      -- Le drapeau que rien ne doit perdre : un chiffre sur servitude et un
      -- chiffre sur rayon choisi ne se citent pas de la même façon.
      'indicatif_possible', true,
      'modes', jsonb_build_array('pprt', 'buffer'),
      'alimentation', 'a la demande au premier clic, jamais en masse (cout I/O)'
    ),
    true
  )
on conflict (slug) do update
  set label       = excluded.label,
      category    = excluded.category,
      description = excluded.description,
      metadata    = excluded.metadata,
      is_active   = excluded.is_active;
