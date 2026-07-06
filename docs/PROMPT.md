"Audit sécurité Supabase sur le projet vkkdbygwbrxyogqosten (relance get_advisors type security si besoin de la liste fraîche) : environ 78 fonctions SECURITY DEFINER sont exécutables par anon et/ou authenticated sans restriction, dont des fonctions d'écriture (import_carreaux_batch, import_iris_batch, truncate_laposte_hexasmal, insert_subzone_from_geojson, update_laposte_centroids, populate_geom_3857_batch).
Pour chacune :

Grep le repo pour voir si elle est appelée via supabase.rpc() côté navigateur, ou seulement côté serveur (route /api/* avec le client admin)
Appel serveur uniquement → REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated (service_role garde l'accès)
Appel client mais page derrière login → REVOKE ... FROM anon, garde authenticated
Appel volontairement public (rare, à confirmer) → laisse anon mais ajoute un check interne dans la fonction
Corrige aussi la policy INSERT sur smart_prompt_feedback (WITH CHECK (true), à restreindre)
Ne touche pas à get_isochrone_battle, clip_geojson_to_france, clip_rings_to_france
Relance get_advisors à la fin pour vérifier que les deux lints security_definer sont retombés