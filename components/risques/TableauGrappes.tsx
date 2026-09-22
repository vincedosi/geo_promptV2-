'use client';

/**
 * Le tableau des BASSINS, sous les deux cartes de l'étape ④.
 *
 * ── CE QU'IL AJOUTE AUX CARTES ────────────────────────────────────────────
 *
 * Une carte montre où. Elle ne classe pas. Or la question de l'étape ④ est
 * « lesquels de ces bassins me coûtent le plus cher pour ce qu'ils visent »,
 * et c'est un classement : le taux d'utile PAR BASSIN, que ni la choroplèthe
 * ni le bandeau national ne disent.
 *
 * ⚠ Le survol d'une ligne met en évidence les codes postaux de ce bassin sur
 * la carte de droite, et rien d'autre : il ne DÉPLACE pas les cartes. Le
 * déplacement est un geste décidé — le clic — parce qu'un recadrage qui suit
 * la souris fait perdre le repère à chaque passage de curseur.
 */
import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { fInter, fMono } from '@/lib/design/polices';
import { formaterNombre } from '@/lib/format/nombre';
import { adminFetch } from '@/lib/admin-fetch';
import { COULEUR_NIVEAU_CSS } from '@/lib/carte/palette-zones-risque';

interface Grappe {
  id: string;
  rang: number;
  nom: string;
  niveau_dominant: string;
  n_sites: number;
  pop_exposee: number | null;
  n_cp: number;
  n_cp_retenus: number;
  /** Les codes postaux du bassin, livrés AVEC lui (sql/230). */
  codes_postaux: string[];
  bbox: [number, number, number, number] | null;
}

interface Props {
  jeuId: string;
  onRecadrer: (bbox: [number, number, number, number]) => void;
  /** Les codes postaux du bassin survolé, ou `null` au départ du curseur. */
  onSurvol: (codes: string[] | null) => void;
}

export function TableauGrappes({ jeuId, onRecadrer, onSurvol }: Props) {
  const [grappes, setGrappes] = useState<Grappe[] | null>(null);
  const [etat, setEtat] = useState<'chargement' | 'echec' | 'pret'>('chargement');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let annule = false;
    setEtat('chargement');
    // `adminFetch` : la route est gardée par `requireAuth`, qui lit le jeton
    // porteur — un `fetch` nu répond 401.
    adminFetch(`/api/zones/jeux/${jeuId}/grappes`)
      .then(async (r) => {
        const d = await r.json();
        if (annule) return;
        if (!r.ok || d.error) {
          setEtat('echec');
          setMessage(d.error ?? 'Bassins illisibles.');
          return;
        }
        setGrappes(d.grappes as Grappe[]);
        setEtat('pret');
      })
      .catch((e) => {
        if (annule) return;
        setEtat('echec');
        setMessage(e instanceof Error ? e.message : 'Chargement interrompu.');
      });
    return () => { annule = true; };
  }, [jeuId]);

  /*
   * ⚠ AUCUNE REQUÊTE AU SURVOL. Les codes postaux voyagent avec le bassin
   * (sql/230) : les chercher à la demande ferait une requête par ligne
   * survolée, et le survol est le geste le plus répété d'un tableau —
   * exactement la boucle qui a déjà épuisé le budget d'I/O de ce projet.
   * Mesuré : 580 bassins et leurs 2 255 codes postaux pèsent 186 ko, soit
   * moins qu'une tuile.
   */

  if (etat === 'chargement') {
    return (
      <Cadre>
        <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
        <span style={{ marginLeft: 6 }}>Chargement des bassins…</span>
      </Cadre>
    );
  }
  if (etat === 'echec') {
    return <Cadre><span style={{ color: 'var(--danger)' }}>{message}</span></Cadre>;
  }
  if (!grappes || grappes.length === 0) {
    return <Cadre><span>Aucun bassin — le profil ne retient aucun site.</span></Cadre>;
  }

  return (
    <div style={{
      flexShrink: 0, maxHeight: 190, overflow: 'auto',
      borderTop: '1px solid var(--border-subtle)',
      background: 'var(--bg-level-1)',
    }}>
      <table style={{
        width: '100%', borderCollapse: 'collapse',
        fontFamily: fInter, fontSize: 11, color: 'var(--text-secondary)',
      }}>
        <thead>
          <tr style={{ background: 'var(--bg-level-2)' }}>
            <Th>Bassin</Th>
            <Th align="right">Sites</Th>
            <Th align="right">Exposés</Th>
            <Th align="right">Codes postaux</Th>
            <Th align="right">Achetés</Th>
            <Th align="right" aide="Codes postaux achetés rapportés à ceux que le bassin touche">
              Part achetée
            </Th>
          </tr>
        </thead>
        <tbody onMouseLeave={() => onSurvol(null)}>
          {grappes.map((g) => {
            const part = g.n_cp > 0 ? Math.round((g.n_cp_retenus / g.n_cp) * 100) : null;
            return (
              <tr
                key={g.id}
                onMouseEnter={() => onSurvol(g.codes_postaux)}
                onClick={() => { if (g.bbox) onRecadrer(g.bbox); }}
                title={g.bbox ? 'Recadrer les deux cartes sur ce bassin'
                  : 'Ce bassin n’a pas d’enveloppe : rien à recadrer'}
                style={{
                  cursor: g.bbox ? 'pointer' : 'default',
                  borderTop: '0.5px solid var(--border-subtle)',
                }}
              >
                <Td>
                  <span style={{
                    display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
                    marginRight: 7,
                    background: COULEUR_NIVEAU_CSS[
                      g.niveau_dominant === 'haut' ? 'haut' : 'bas'],
                  }} />
                  {g.nom}
                </Td>
                <Td align="right" mono>{g.n_sites}</Td>
                <Td align="right" mono>{formaterNombre(Number(g.pop_exposee ?? 0))}</Td>
                <Td align="right" mono>{formaterNombre(g.n_cp)}</Td>
                <Td align="right" mono>{formaterNombre(g.n_cp_retenus)}</Td>
                {/* `null` et non « 0 % » : un bassin sans code postal touché
                    n'a pas une part nulle, il n'a pas de part du tout. */}
                <Td align="right" mono>{part == null ? '—' : `${part} %`}</Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Cadre({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      flexShrink: 0, padding: '9px 14px',
      borderTop: '1px solid var(--border-subtle)',
      background: 'var(--bg-level-1)',
      fontFamily: fInter, fontSize: 11, color: 'var(--text-secondary)',
      display: 'flex', alignItems: 'center',
    }}>
      {children}
    </div>
  );
}

function Th({ children, align, aide }: {
  children: React.ReactNode; align?: 'right'; aide?: string;
}) {
  return (
    <th title={aide} style={{
      textAlign: align ?? 'left', padding: '6px 10px', fontWeight: 500,
      color: 'var(--text-primary)', whiteSpace: 'nowrap',
    }}>
      {children}
    </th>
  );
}

function Td({ children, align, mono }: {
  children: React.ReactNode; align?: 'right'; mono?: boolean;
}) {
  return (
    <td style={{
      textAlign: align ?? 'left', padding: '5px 10px',
      fontFamily: mono ? fMono : undefined, whiteSpace: 'nowrap',
    }}>
      {children}
    </td>
  );
}
