-- ============================================================================
-- sql/158_activation_lots.sql — historique des poussées vers les DSP
-- (Tâche 20, 2026-09-13)
--
-- Le plan réservait `sql/149` à cette tâche ; 146 à 157 ont été pris depuis.
--
-- ── Ce qui manquait ───────────────────────────────────────────────────────
--
-- Le push DV360 existait (`/api/admin/dsp/dv360/targeting/push` et
-- `/zones/push`) mais **nu** : aucune trace de ce qui était parti, vers quels
-- line items, avec quel résultat. Un push raté à moitié était donc
-- indiscernable d'un push réussi — et un retour arrière, impossible faute de
-- savoir ce qui avait été ajouté.
--
-- Ces deux tables l'ENVELOPPENT. Elles ne le réécrivent pas : `lib/dsp/dv360/`
-- et les routes de push restent intacts.
--
-- ── `etat_avant` est la clé du retour arrière, et il a une limite connue ──
--
-- Le push DV360 est ADDITIF : il ajoute des geo IDs au ciblage existant sans
-- effacer ce qui s'y trouvait. Défaire réellement une poussée demande donc de
-- retirer EXACTEMENT les geo IDs ajoutés par ce lot.
--
-- Or la route de push existante ne rend pas cette liste — elle rend un compte.
-- `etat_avant` garde donc le CONTEXTE de la poussée (annonceur, line item,
-- zone, horodatage), pas la liste des geo IDs. `/activation/rollback` est
-- explicite là-dessus : il marque le lot annulé dans MAGELIAN et rend
-- `retire_du_dsp: false`, plutôt que de reconstituer une liste à partir de la
-- zone — ce qui retirerait aussi des geo IDs posés par un autre lot ou par un
-- opérateur. Un retour arrière qui efface le ciblage de quelqu'un d'autre est
-- pire qu'un retour arrière absent.
--
-- Le vrai rollback suppose que la route de push rende les geo IDs assignés.
-- C'est une modification de cette route, donc hors du périmètre d'une tâche qui
-- devait l'envelopper.
--
-- ── Le statut « partiel » existe à part ───────────────────────────────────
-- Un lot où trois line items sur vingt ont échoué n'est ni un succès ni un
-- échec. Le ranger dans l'un des deux ferait perdre l'information qui compte.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.activation_lots (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id       uuid NOT NULL REFERENCES public.dsp_campaigns(id) ON DELETE CASCADE,
  org_id            uuid NOT NULL,
  /** Code du `dsp_channel_registry`. */
  canal             text NOT NULL,
  /** Version de stratégie publiée au moment de la poussée (Tâche 19). */
  version_strategie integer,
  statut            text NOT NULL DEFAULT 'en_cours'
                    CHECK (statut IN ('en_cours','termine','partiel','echec','annule')),
  lance_par         uuid NOT NULL,
  lance_le          timestamptz NOT NULL DEFAULT now(),
  termine_le        timestamptz
);

COMMENT ON TABLE public.activation_lots IS
  'Un lot = une poussee de ciblage vers un canal DSP, pour une campagne. Le push DV360 existait mais NU : ni pre-vol, ni statut par line item, ni historique, ni retour arriere. Ces tables l enveloppent sans le reecrire. Tache 20, sql/158.';

CREATE TABLE IF NOT EXISTS public.activation_cibles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id        uuid NOT NULL REFERENCES public.activation_lots(id) ON DELETE CASCADE,
  line_item_id  text NOT NULL,
  line_item_nom text,
  statut        text NOT NULL DEFAULT 'en_attente'
                CHECK (statut IN ('en_attente','pousse','echec','annule')),
  erreur        text,
  /** Contexte de la poussée, écrit AVANT l'appel sortant — voir l'en-tête. */
  etat_avant    jsonb,
  maj_le        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.activation_cibles.etat_avant IS
  'Contexte du line item AVANT la poussee (annonceur, zone, horodatage). Ecrit AVANT l appel sortant, jamais apres : un appel qui part et une ligne qui n est pas encore ecrite laisserait une poussee intracable. LIMITE CONNUE : ne contient PAS la liste des geo IDs assignes, que la route de push existante ne rend pas — d ou un rollback qui marque sans retirer du DSP.';

CREATE INDEX IF NOT EXISTS idx_activation_lots_campagne
  ON public.activation_lots (campaign_id, lance_le DESC);
CREATE INDEX IF NOT EXISTS idx_activation_cibles_lot
  ON public.activation_cibles (lot_id);

-- Deny-all : les routes passent en service_role, comme les autres tables de
-- service du projet.
ALTER TABLE public.activation_lots   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activation_cibles ENABLE ROW LEVEL SECURITY;
