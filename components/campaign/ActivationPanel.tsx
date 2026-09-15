'use client';

/**
 * @file ActivationPanel — l'onglet Activation de l'overlay MAGELIAN
 * (Tâche 20, 2026-09-13).
 *
 * Le push DV360 existait, mais **nu** : ni pré-vol, ni statut par line item, ni
 * historique, ni retour arrière. Un push raté à moitié était indiscernable d'un
 * push réussi. Ce panneau est ce qui l'entoure.
 *
 * ── Trois écrans, dans l'ordre du geste ───────────────────────────────────
 *
 * 1. **Pré-vol** — en lecture seule, chargé à l'ouverture. Il dit ce qui
 *    partirait ET pourquoi on ne peut pas encore partir. Le bouton d'activation
 *    est branché sur son `activable` : une stratégie non publiée ou dérivée
 *    (Tâche 19) bloque, parce que pousser enverrait au DSP un périmètre que
 *    personne n'a validé.
 * 2. **Poussée** — flux NDJSON, une ligne par line item. Règle CLAUDE.md :
 *    jamais de traitement silencieux. Un bouton figé pendant vingt appels
 *    sortants ne dit ni où ça en est, ni ce qui est déjà parti.
 * 3. **Historique** — les lots passés, leur statut, et l'annulation.
 *
 * ── Ce que l'annulation ne fait pas, et qui est dit ───────────────────────
 * Elle marque le lot annulé dans MAGELIAN ; elle **ne retire rien du DSP**. La
 * poussée DV360 est additive et la route de push ne rend pas la liste exacte
 * des geo IDs assignés : les retirer risquerait d'effacer un ciblage posé
 * ailleurs. Le message de la route le dit, et il est affiché tel quel — un
 * retour arrière qui efface le travail de quelqu'un d'autre est pire qu'un
 * retour arrière absent.
 */
import { useCallback, useEffect, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import { formaterNombre } from '@/lib/format/nombre';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

interface Prevol {
  strategie: { id: string; nom: string; statut: string; scope: string; zone_id: string | null;
               cpm_previsionnel: number | null; budget: number | null } | null;
  version_publiee: number | null;
  zones_modifiees: string[];
  n_codes_postaux: number;
  canaux_connectes: { provider: string; methode: string; statut: string }[];
  blocages: string[];
  activable: boolean;
}

interface Lot {
  id: string;
  canal: string;
  version_strategie: number | null;
  statut: string;
  lance_le: string;
  termine_le: string | null;
  cibles: Record<string, number>;
  n_cibles: number;
}

/** Une ligne du flux NDJSON de la poussée. */
interface LigneFlux {
  etape: string;
  n?: number;
  total?: number;
  line_item_id?: string;
  statut?: string;
  erreur?: string;
  pousses?: number;
  echecs?: number;
}

const COULEUR_STATUT: Record<string, string> = {
  termine: 'var(--success)',
  partiel: 'var(--warning)',
  echec: 'var(--danger)',
  annule: 'var(--text-tertiary)',
  en_cours: 'var(--brand-teal)',
};

export interface ActivationPanelProps {
  campaignId: string;
}

export function ActivationPanel({ campaignId }: ActivationPanelProps) {
  const [prevol, setPrevol] = useState<Prevol | null>(null);
  const [lots, setLots] = useState<Lot[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  const [flux, setFlux] = useState<LigneFlux[]>([]);
  const [enPoussee, setEnPoussee] = useState(false);
  const [messageAnnulation, setMessageAnnulation] = useState<string | null>(null);
  const [lotAAnnuler, setLotAAnnuler] = useState<string | null>(null);
  const [publication, setPublication] = useState(false);
  // Saisis par l'utilisateur : la route DV360 exige un annonceur et des line
  // items. Le pré-vol ne peut pas les deviner — la cascade de liaison DV360
  // vit dans l'étape Canaux du wizard, pas ici.
  const [advertiserId, setAdvertiserId] = useState('');
  const [lineItems, setLineItems] = useState('');

  const charger = useCallback(async () => {
    setChargement(true);
    setErreur(null);
    try {
      // Deux appels seulement — très loin du plafond de 3 requêtes Supabase
      // simultanées (CLAUDE.md).
      const [rPrevol, rHisto] = await Promise.all([
        adminFetch(`/api/campaigns/${campaignId}/activation/prevol`, { cache: 'no-store' }),
        adminFetch(`/api/campaigns/${campaignId}/activation/historique`, { cache: 'no-store' }),
      ]);
      if (rPrevol.ok) setPrevol(await rPrevol.json());
      else setErreur((await rPrevol.json().catch(() => ({}))).error ?? `Erreur ${rPrevol.status}`);
      if (rHisto.ok) setLots((await rHisto.json()).lots ?? []);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setChargement(false);
    }
  }, [campaignId]);

  useEffect(() => { void charger(); }, [charger]);

  /**
   * Publie la stratégie — B1, trouvé en relecture.
   *
   * Sans ce bouton, `/publier` n'avait **aucun appelant** dans tout le dépôt :
   * `strategie_versions` restait donc vide pour toute stratégie, le pré-vol
   * empilait éternellement le blocage « la stratégie n'a jamais été publiée »,
   * `activable` était TOUJOURS faux, et l'onglet Activation ne pouvait rien
   * faire pour aucune campagne. Sa place est ici, à côté du blocage qu'il lève.
   */
  const publier = async () => {
    if (publication || !prevol?.strategie) return;
    setPublication(true);
    setErreur(null);
    try {
      const res = await adminFetch(`/api/bidding/strategies/${prevol.strategie.id}/publier`, {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Erreur ${res.status}`);
      await charger();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setPublication(false);
    }
  };

  /**
   * Lance la poussée et consomme son flux NDJSON — B2, trouvé en relecture.
   *
   * `setFlux` et `setEnPoussee` étaient déclarés et **jamais appelés** : le
   * bloc « Flux de poussée » était du code mort, et les 271 lignes de
   * `/activation/pousser` — la route la plus risquée du lot, appels sortants
   * en boucle — n'étaient joignables que par un `curl` fabriqué à la main.
   *
   * Le flux est lu ligne à ligne plutôt qu'attendu en bloc : c'est tout
   * l'intérêt du NDJSON, et la règle CLAUDE.md sur les traitements silencieux.
   */
  const pousser = async () => {
    if (enPoussee || !prevol?.activable || !advertiserId.trim() || !lineItems.trim()) return;

    const cibles = lineItems
      .split(/[\s,;]+/)
      .map((v) => v.trim())
      .filter((v) => /^\d+$/.test(v))
      .map((line_item_id) => ({ line_item_id }));

    if (!cibles.length) {
      setErreur('Aucun identifiant de line item valide (chiffres uniquement).');
      return;
    }

    setEnPoussee(true);
    setErreur(null);
    setFlux([]);
    try {
      const res = await adminFetch(`/api/campaigns/${campaignId}/activation/pousser`, {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canal: 'dv360', advertiser_id: advertiserId.trim(), cibles }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? data.error ?? `Erreur ${res.status}`);
      }

      const lecteur = res.body.getReader();
      const decodeur = new TextDecoder();
      let reste = '';
      for (;;) {
        const { done, value } = await lecteur.read();
        if (done) break;
        reste += decodeur.decode(value, { stream: true });
        const lignes = reste.split('\n');
        // La dernière peut être incomplète : elle repart au tour suivant.
        reste = lignes.pop() ?? '';
        for (const l of lignes) {
          if (!l.trim()) continue;
          try { setFlux((prev) => [...prev, JSON.parse(l) as LigneFlux]); }
          catch { /* ligne tronquee : ignoree */ }
        }
      }
      await charger();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setEnPoussee(false);
    }
  };

  const annuler = async (lotId: string) => {
    setMessageAnnulation(null);
    try {
      const res = await adminFetch(`/api/campaigns/${campaignId}/activation/rollback`, {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lot_id: lotId, confirme: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Erreur ${res.status}`);
      // Le message de la route dit ce qui N'A PAS été fait : affiché tel quel.
      setMessageAnnulation(data.message);
      setLotAAnnuler(null);
      void charger();
    } catch (e) {
      setMessageAnnulation(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div style={{ padding: '20px 24px', fontFamily: fInter, color: 'var(--text-secondary)', overflowY: 'auto' }}>

      <h3 style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', margin: '0 0 6px' }}>
        Activation
      </h3>
      <p style={{ fontSize: 12, lineHeight: 1.6, margin: '0 0 20px', maxWidth: 640 }}>
        Ce qui partira vers les DSP, ce qui est déjà parti, et ce qui l’empêche.
      </p>

      {erreur && (
        <div style={{
          padding: '9px 11px', borderRadius: 6, marginBottom: 16,
          background: 'rgba(255,87,87,0.08)', border: '0.5px solid rgba(255,87,87,0.25)',
          color: 'var(--danger)', fontSize: 12,
        }}>{erreur}</div>
      )}

      {chargement && (
        <div style={{ fontFamily: fMono, fontSize: 12, color: 'var(--text-tertiary)' }}>Pré-vol en cours…</div>
      )}

      {/* ── 1. Pré-vol ─────────────────────────────────────────────────── */}
      {prevol && (
        <section style={{
          background: 'var(--surface)', border: '0.5px solid var(--border-subtle)',
          borderRadius: 8, padding: 14, marginBottom: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)' }} />
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>Pré-vol</span>
          </div>

          <div style={{ fontFamily: fMono, fontSize: 11, lineHeight: 1.8, color: 'var(--text-secondary)' }}>
            <div>Stratégie : {prevol.strategie?.nom ?? '—'}</div>
            <div>
              Version publiée : {prevol.version_publiee != null ? `v${prevol.version_publiee}` : 'jamais publiée'}
            </div>
            <div>Codes postaux : {formaterNombre(prevol.n_codes_postaux)}</div>
            <div>
              Canaux connectés : {prevol.canaux_connectes.length
                ? prevol.canaux_connectes.map((c) => c.provider).join(', ')
                : 'aucun'}
            </div>
          </div>

          {/* Les blocages sont la raison d'être de cet écran. */}
          {prevol.blocages.length > 0 && (
            <div style={{
              marginTop: 12, padding: '9px 11px', borderRadius: 6,
              background: 'rgba(247,183,49,0.08)', border: '0.5px solid rgba(247,183,49,0.25)',
              color: 'var(--warning)', fontSize: 11, lineHeight: 1.6,
            }}>
              {prevol.blocages.map((b) => <div key={b}>· {b}</div>)}

              {/* Le bouton qui lève le blocage est À CÔTÉ du blocage : c'est
                  le seul endroit où l'utilisateur le cherchera. */}
              {prevol.strategie && (prevol.version_publiee === null || prevol.zones_modifiees.length > 0) && (
                <button
                  onClick={publier}
                  disabled={publication}
                  style={{
                    marginTop: 10, background: 'transparent',
                    border: '0.5px solid var(--brand-teal)', color: 'var(--brand-teal)',
                    borderRadius: 6, padding: '6px 14px', fontFamily: fInter,
                    fontSize: 11, fontWeight: 500,
                    cursor: publication ? 'not-allowed' : 'pointer', opacity: publication ? 0.4 : 1,
                  }}
                >
                  {publication
                    ? 'Publication…'
                    : prevol.version_publiee === null
                      ? 'Publier la stratégie'
                      : `Republier (v${prevol.version_publiee} → v${prevol.version_publiee + 1})`}
                </button>
              )}
            </div>
          )}

          {prevol.activable && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{
                padding: '9px 11px', borderRadius: 6,
                background: 'rgba(61,255,160,0.08)', border: '0.5px solid rgba(61,255,160,0.2)',
                color: 'var(--success)', fontSize: 11,
              }}>
                Prêt à activer — v{prevol.version_publiee} sur {formaterNombre(prevol.n_codes_postaux)} codes postaux.
              </div>

              <input
                type="text" value={advertiserId}
                onChange={(e) => setAdvertiserId(e.target.value)}
                placeholder="Identifiant annonceur DV360"
                style={{
                  background: 'var(--bg-level-2)', border: '0.5px solid var(--border-subtle)',
                  borderRadius: 6, padding: '7px 10px', fontFamily: fMono, fontSize: 11,
                  color: 'var(--text-primary)',
                }}
              />
              <textarea
                value={lineItems} rows={2}
                onChange={(e) => setLineItems(e.target.value)}
                placeholder="Identifiants de line items, séparés par des virgules ou des retours à la ligne"
                style={{
                  background: 'var(--bg-level-2)', border: '0.5px solid var(--border-subtle)',
                  borderRadius: 6, padding: '7px 10px', fontFamily: fMono, fontSize: 11,
                  color: 'var(--text-primary)', resize: 'vertical',
                }}
              />
              <button
                onClick={pousser}
                disabled={enPoussee || !advertiserId.trim() || !lineItems.trim()}
                style={{
                  background: 'transparent', border: '0.5px solid var(--brand-teal)',
                  color: 'var(--brand-teal)', borderRadius: 6, padding: '7px 14px',
                  fontFamily: fInter, fontSize: 12, fontWeight: 500,
                  cursor: enPoussee || !advertiserId.trim() || !lineItems.trim() ? 'not-allowed' : 'pointer',
                  opacity: enPoussee || !advertiserId.trim() || !lineItems.trim() ? 0.4 : 1,
                }}
              >
                {enPoussee ? 'Poussée en cours…' : 'Pousser le ciblage vers DV360'}
              </button>
              {/* Le geste est SORTANT et additif : le dire avant, pas après. */}
              <div style={{ fontSize: 10, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                La poussée ajoute le ciblage aux line items ; elle n’efface rien de ce qui s’y
                trouve déjà, et ne peut pas être défaite depuis MAGELIAN.
              </div>
            </div>
          )}
        </section>
      )}

      {/* ── 2. Flux de poussée ─────────────────────────────────────────── */}
      {flux.length > 0 && (
        <section style={{
          background: 'var(--surface)', border: '0.5px solid var(--border-subtle)',
          borderRadius: 8, padding: 14, marginBottom: 16,
        }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 8 }}>
            Poussée {enPoussee ? 'en cours' : 'terminée'}
          </div>
          <div style={{
            fontFamily: fMono, fontSize: 10, lineHeight: 1.7, maxHeight: 220,
            overflowY: 'auto', color: 'var(--text-tertiary)',
          }}>
            {flux.map((l, i) => (
              <div key={i} style={{ color: l.statut === 'echec' ? 'var(--danger)' : undefined }}>
                {l.etape === 'debut' && `Départ — ${l.total} line item(s)`}
                {l.etape === 'cible' && `[${l.n}/${l.total}] ${l.line_item_id} · ${l.statut}${l.erreur ? ` — ${l.erreur}` : ''}`}
                {l.etape === 'fin' && `Terminé — ${l.pousses} poussé(s), ${l.echecs} échec(s)`}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── 3. Historique ──────────────────────────────────────────────── */}
      <section style={{
        background: 'var(--surface)', border: '0.5px solid var(--border-subtle)',
        borderRadius: 8, padding: 14,
      }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 10 }}>
          Historique des activations
        </div>

        {lots.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
            Aucune activation pour cette campagne.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {lots.map((lot) => (
              <div key={lot.id} style={{
                background: 'var(--bg-level-2)', border: '0.5px solid var(--border-subtle)',
                borderRadius: 6, padding: 10,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: fMono, fontSize: 11, color: 'var(--text-primary)' }}>
                    {lot.canal}
                  </span>
                  <span style={{
                    fontFamily: fMono, fontSize: 10,
                    color: COULEUR_STATUT[lot.statut] ?? 'var(--text-tertiary)',
                  }}>{lot.statut}</span>
                  <span style={{ marginLeft: 'auto', fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary)' }}>
                    {new Date(lot.lance_le).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
                  </span>
                </div>
                <div style={{ fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4 }}>
                  {lot.version_strategie != null && `v${lot.version_strategie} · `}
                  {formaterNombre(lot.n_cibles)} line item{lot.n_cibles > 1 ? 's' : ''}
                  {Object.entries(lot.cibles).map(([s, n]) => ` · ${n} ${s}`).join('')}
                </div>

                {lot.statut !== 'annule' && (
                  lotAAnnuler === lot.id ? (
                    <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: 'var(--warning)', flex: 1 }}>
                        Marquer ce lot annulé ?
                      </span>
                      <button
                        onClick={() => annuler(lot.id)}
                        style={{
                          background: 'transparent', border: '0.5px solid var(--danger)',
                          color: 'var(--danger)', borderRadius: 4, padding: '4px 10px',
                          fontFamily: fInter, fontSize: 11, cursor: 'pointer',
                        }}
                      >Confirmer</button>
                      <button
                        onClick={() => setLotAAnnuler(null)}
                        style={{
                          background: 'transparent', border: '0.5px solid var(--border-default)',
                          color: 'var(--text-secondary)', borderRadius: 4, padding: '4px 10px',
                          fontFamily: fInter, fontSize: 11, cursor: 'pointer',
                        }}
                      >Non</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setLotAAnnuler(lot.id)}
                      style={{
                        marginTop: 8, background: 'transparent',
                        border: '0.5px solid var(--border-default)',
                        color: 'var(--text-secondary)', borderRadius: 4, padding: '4px 10px',
                        fontFamily: fInter, fontSize: 11, cursor: 'pointer',
                      }}
                    >Annuler ce lot</button>
                  )
                )}
              </div>
            ))}
          </div>
        )}

        {messageAnnulation && (
          <div style={{
            marginTop: 12, padding: '9px 11px', borderRadius: 6,
            background: 'rgba(247,183,49,0.08)', border: '0.5px solid rgba(247,183,49,0.25)',
            color: 'var(--warning)', fontSize: 11, lineHeight: 1.6,
          }}>{messageAnnulation}</div>
        )}
      </section>
    </div>
  );
}
