-- sql/315 — B9 (ARB-7 = A, amendement E1, Q7 = A) : les deux réglages de la MAILLE PAR DÉFAUT de ⑤, en base.
--
-- LA RÈGLE (lib/zones/conversion-defaut.ts, copiée côté Angular) : parmi les mailles natives et disponibles d'une
-- plateforme, celles dont la couverture simulée (part de la population de la zone dans les unités retenues) atteint la
-- COUVERTURE CIBLE ; parmi elles, celle de taux utile maximal, départagée à ± ÉCART DE DÉPARTAGE points de taux utile
-- (ordre de finesse « sûre, exacte, plus fine » tant que B16 n'a pas branché la poussée). Si aucune n'atteint la cible :
-- celle de couverture maximale.
--
-- CE QUE POSE CETTE MIGRATION.
--   1. `reglages_conversion` (sql/309) : `couverture_cible_defaut` = 80 (%, paramètre partagé avec le futur seuil
--      optimal D1 / Q40) et `ecart_departage_defaut` = 5 (points de taux utile). Posées une fois (`on conflict do
--      nothing`) : une valeur réglée ensuite par `update` n'est pas remise au défaut.
--   2. Deux CHECK : la couverture cible dans ]0, 100], l'écart dans [0, 100].
--
-- LECTURE : `GET /api/zones/plateformes` (`lireReglagesDefaut`, lib/zones/conversion-serveur.ts) les rend avec le
-- registre. Clé absente ou lecture en échec : le repli documenté `REGLAGES_DEFAUT_REPLI` (mêmes valeurs), dit au journal.
--
-- Rejouable (`on conflict do nothing`, CHECK sous garde), aucun DROP. `psql -1`.

insert into public.reglages_conversion (cle, valeur, description)
values
  ('couverture_cible_defaut', 80,
   'Maille par defaut de (5) : couverture simulee minimale (en % de la population de la zone) pour qu''une maille soit '
   'candidate au taux utile maximal ; si aucune ne l''atteint, la maille de couverture maximale (B9, ARB-7 ; sql/315). '
   'Parametre partage avec le seuil optimal D1 / Q40.'),
  ('ecart_departage_defaut', 5,
   'Maille par defaut de (5) : ecart de taux utile (en points) sous lequel deux mailles candidates sont departagees par '
   'l''ordre de finesse, puis par le mode de poussee quand B16 le branche (B9, ARB-7 ; sql/315).')
on conflict (cle) do nothing;

do $do$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.reglages_conversion'::regclass and conname = 'reglages_conversion_couverture_cible_bornee') then
    alter table public.reglages_conversion
      add constraint reglages_conversion_couverture_cible_bornee
      check (cle <> 'couverture_cible_defaut' or (valeur > 0 and valeur <= 100));
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.reglages_conversion'::regclass and conname = 'reglages_conversion_ecart_departage_borne') then
    alter table public.reglages_conversion
      add constraint reglages_conversion_ecart_departage_borne
      check (cle <> 'ecart_departage_defaut' or (valeur >= 0 and valeur <= 100));
  end if;
end
$do$;
