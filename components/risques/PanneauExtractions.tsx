'use client';

/**
 * @file components/risques/PanneauExtractions.tsx
 *
 * Les extractions d'un jeu de zones — Phase 4 du chantier zones -> CP.
 *
 * ── CE QUE CE PANNEAU AJOUTE AU BOUTON « EXPORTER (EXCEL) » ─────────────
 *
 * Le bouton d'export voisin recalcule le plan à chaque clic : il suit le jeu.
 * Extraire, c'est au contraire FIGER — enregistrer les multiplicateurs tels
 * qu'ils sont, sous un numéro de version, pour pouvoir dire plus tard ce qui
 * est réellement parti au DSP. Les deux gestes se ressemblent à l'écran et ne
 * répondent pas à la même question ; le panneau le dit en toutes lettres,
 * parce que rien dans deux boutons côte à côte ne le laisse deviner.
 *
 * ── LE RECALAGE EST UNE CASE, PAS UN AUTRE BOUTON ───────────────────────
 *
 * Un recalage produit une version comme une autre : même geste, même table,
 * seule l'origine change. En faire un second bouton laisserait croire à un
 * mécanisme différent — et la Phase 5 s'en sert justement pour annoter la
 * courbe d'alignement, pas pour calculer autrement.
 *
 * La case n'apparaît qu'à partir de la deuxième extraction : recaler ce qui
 * n'a jamais été diffusé n'a pas de sens, et proposer le choix trop tôt
 * invite à cocher au hasard.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Download, PackageCheck, RefreshCw } from 'lucide-react';
import { adminFetch } from '@/lib/admin-fetch';
import { formaterNombre, formaterDecimal } from '@/lib/format/nombre';
import { fInter, fMono } from '@/lib/design/polices';

/** Une extraction, telle que `GET /api/zones/jeux/[id]/extractions` la rend. */
export interface Extraction {
  id: string;
  version: number;
  origine: 'initiale' | 'recalage';
  commentaire: string;
  seuil_couverture_cp: number;
  mode_plan: string;
  n_cp: number;
  n_retenus: number;
  taux_utile: number | null;
  part_plan_en_zone: number | null;
  created_at: string;
}

type Etat = 'chargement' | 'echec' | 'pret';

interface Props {
  /** `null` tant que le jeu est un brouillon : on n'extrait pas un sans-nom. */
  jeuId: string | null;
  /**
   * Change à chaque reconstruction du jeu. Une extraction figée reste valable,
   * mais la liste doit se relire : le plan courant n'est plus le même.
   */
  cleFraicheur?: string | number;
}

/** Le jour et l'heure, en français, sans dépendance ajoutée. */
function dateFr(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function PanneauExtractions({ jeuId, cleFraicheur }: Props) {
  const [extractions, setExtractions] = useState<Extraction[]>([]);
  const [etat, setEtat] = useState<Etat>('chargement');
  const [erreur, setErreur] = useState<string | null>(null);
  const [commentaire, setCommentaire] = useState('');
  const [recalage, setRecalage] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const charger = useCallback(async () => {
    if (!jeuId) { setExtractions([]); setEtat('pret'); return; }
    setEtat('chargement');
    setErreur(null);
    try {
      const rep = await adminFetch(`/api/zones/jeux/${jeuId}/extractions`);
      if (!rep.ok) {
        const corps = await rep.json().catch(() => null);
        setErreur(corps?.error ?? 'Extractions illisibles.');
        setEtat('echec');
        return;
      }
      const corps = await rep.json();
      setExtractions(corps.extractions ?? []);
      setEtat('pret');
    } catch {
      setErreur('Extractions illisibles — le serveur n’a pas répondu.');
      setEtat('echec');
    }
  }, [jeuId]);

  useEffect(() => { void charger(); }, [charger, cleFraicheur]);

  const extraire = useCallback(async () => {
    if (!jeuId || enCours) return;
    setEnCours(true);
    setErreur(null);
    setMessage(null);
    try {
      const rep = await adminFetch(`/api/zones/jeux/${jeuId}/extractions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origine: recalage ? 'recalage' : 'initiale',
          commentaire: commentaire.trim(),
        }),
      });
      const corps = await rep.json().catch(() => null);
      if (!rep.ok) {
        setErreur(corps?.error ?? 'Extraction impossible.');
        return;
      }
      /*
       * ⚠ Le cas « déjà extraite » n'est PAS une erreur, et il ne doit pas non
       * plus passer pour une création. Sans ce message, cliquer deux fois
       * donnerait l'impression d'avoir produit deux versions — alors que la
       * route a rendu la même, parce que rien n'avait changé.
       */
      setMessage(
        corps?.deja_extraite
          ? `Rien n’a changé depuis la v${corps.version} : c’est elle qui reste en vigueur.`
          : `Extraction v${corps.version} enregistrée — elle ne bougera plus.`,
      );
      setCommentaire('');
      setRecalage(false);
      await charger();
    } catch {
      setErreur('Extraction impossible — le serveur n’a pas répondu.');
    } finally {
      setEnCours(false);
    }
  }, [jeuId, enCours, recalage, commentaire, charger]);

  if (!jeuId) {
    return (
      <p style={styleAide}>
        Enregistrez d’abord ce jeu de zones : une extraction porte son nom et son
        numéro de version.
      </p>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={styleAide}>
        Extraire fige les multiplicateurs tels qu’ils sont, sous un numéro de version.
        À la différence de « Exporter (Excel) », qui recalcule à chaque clic et suit
        donc vos réglages, une extraction ne bouge plus — c’est elle qui dira, plus
        tard, ce qui est réellement parti au DSP.
      </p>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          value={commentaire}
          onChange={(e) => setCommentaire(e.target.value)}
          placeholder="Pourquoi cette extraction (facultatif)"
          aria-label="Commentaire de l’extraction"
          maxLength={500}
          style={{ ...styleSaisie, flex: '1 1 260px' }}
        />
        <button
          type="button"
          onClick={() => void extraire()}
          disabled={enCours}
          style={{
            ...styleBoutonTeal,
            opacity: enCours ? 0.5 : 1,
            cursor: enCours ? 'not-allowed' : 'pointer',
          }}
        >
          {enCours ? <Loader2 size={13} className="animate-spin" /> : <PackageCheck size={13} />}
          Extraire pour le custom bidding
        </button>
      </div>

      {extractions.length > 0 && (
        <label style={{ ...styleAide, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={recalage}
            onChange={(e) => setRecalage(e.target.checked)}
            style={{ accentColor: 'var(--brand-teal)' }}
          />
          <span>
            C’est un recalage — cette version corrige une diffusion déjà mesurée.
          </span>
        </label>
      )}

      {message && (
        <p role="status" style={styleMessage}>{message}</p>
      )}
      {erreur && (
        <p role="status" style={styleAlerte}>{erreur}</p>
      )}

      {etat === 'chargement' && (
        <p style={styleAide}>
          <Loader2 size={13} className="animate-spin" style={{ verticalAlign: -2, marginRight: 6 }} />
          Lecture des extractions…
        </p>
      )}

      {etat === 'pret' && extractions.length === 0 && (
        <p style={styleAide}>
          Aucune extraction pour l’instant. La première fixera la référence à laquelle
          la diffusion sera comparée.
        </p>
      )}

      {etat === 'pret' && extractions.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <th scope="col" style={th('left')}>Version</th>
                <th scope="col" style={th('left')}>Extraite le</th>
                <th scope="col" style={th()}>Seuil</th>
                <th scope="col" style={th()}>CP retenus</th>
                <th scope="col" style={th()}>Taux d’utile</th>
                <th scope="col" style={th('left')}>&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {extractions.map((e) => (
                <tr key={e.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ ...td, textAlign: 'left' }}>
                    <span style={{ color: 'var(--text-primary)' }}>v{e.version}</span>
                    {e.origine === 'recalage' && (
                      <span style={styleEtiquette}>
                        <RefreshCw size={10} style={{ verticalAlign: -1, marginRight: 3 }} />
                        recalage
                      </span>
                    )}
                    {e.commentaire && (
                      <span style={styleCommentaire} title={e.commentaire}>{e.commentaire}</span>
                    )}
                  </td>
                  <td style={{ ...td, textAlign: 'left', fontFamily: fInter }}>{dateFr(e.created_at)}</td>
                  <td style={td}>{formaterDecimal(Number(e.seuil_couverture_cp), 0)} %</td>
                  <td style={td}>
                    {formaterNombre(e.n_retenus)}
                    <span style={{ color: 'var(--text-tertiary)' }}> / {formaterNombre(e.n_cp)}</span>
                  </td>
                  {/* `—` et non « 0 % » : aucun code postal retenu n'est pas un
                      taux nul, c'est l'absence de ratio. */}
                  <td style={td}>
                    {e.taux_utile == null ? '—' : `${formaterDecimal(Number(e.taux_utile), 1)} %`}
                  </td>
                  <td style={{ ...td, textAlign: 'left' }}>
                    {/* Un lien et non un `fetch` : le navigateur gère le
                        téléchargement, son nom de fichier et sa reprise. */}
                    <a
                      href={`/api/zones/jeux/${jeuId}/extractions/${e.version}/export`}
                      style={styleLien}
                    >
                      <Download size={12} />
                      Excel
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Styles — jetons du design system, jamais de couleur littérale
   ══════════════════════════════════════════════════════════════════════════ */

const th = (align: 'left' | 'right' = 'right'): React.CSSProperties => ({
  padding: '6px 8px', textAlign: align, fontWeight: 400, fontSize: 11,
  fontFamily: fInter, color: 'var(--text-tertiary)',
});

const td: React.CSSProperties = {
  padding: '7px 8px', textAlign: 'right', fontFamily: fMono, fontSize: 12,
  color: 'var(--text-secondary)',
};

const styleAide: React.CSSProperties = {
  margin: 0, fontFamily: fInter, fontSize: 12, lineHeight: 1.5,
  color: 'var(--text-tertiary)',
};

const styleSaisie: React.CSSProperties = {
  padding: '8px 12px', borderRadius: 6, fontFamily: fInter, fontSize: 13,
  background: 'var(--bg-level-2)',
  border: '0.5px solid var(--border-subtle)',
  color: 'var(--text-primary)',
};

const styleBoutonTeal: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 7,
  padding: '8px 16px', borderRadius: 6,
  fontFamily: fInter, fontSize: 12, fontWeight: 500,
  background: 'transparent',
  border: '0.5px solid var(--brand-teal)',
  color: 'var(--brand-teal)',
};

const styleLien: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  fontFamily: fInter, fontSize: 12, textDecoration: 'none',
  color: 'var(--brand-teal)',
};

const styleEtiquette: React.CSSProperties = {
  marginLeft: 6, padding: '2px 8px', borderRadius: 4,
  fontFamily: fInter, fontSize: 10,
  background: 'var(--bg-level-3)',
  border: '0.5px solid var(--border-default)',
  color: 'var(--text-tertiary)',
};

const styleCommentaire: React.CSSProperties = {
  display: 'block', marginTop: 2,
  fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260,
};

const styleMessage: React.CSSProperties = {
  margin: 0, padding: '8px 12px', borderRadius: 6,
  fontFamily: fInter, fontSize: 12, lineHeight: 1.5,
  background: 'var(--brand-teal-10)',
  border: '0.5px solid var(--brand-teal-30)',
  color: 'var(--brand-teal)',
};

const styleAlerte: React.CSSProperties = {
  margin: 0, padding: '8px 12px', borderRadius: 6,
  fontFamily: fInter, fontSize: 12, lineHeight: 1.5,
  background: 'rgba(255,87,87,0.1)',
  border: '0.5px solid rgba(255,87,87,0.2)',
  color: 'var(--danger)',
};
