'use client';

/**
 * @file CorrelationTool — outil « Corrélation » du panneau Analyse
 * (Tâche 13, 2026-09-13).
 *
 * Répond à « ma campagne a-t-elle arrosé les codes postaux qui comptent ? » :
 * nuage de points impressions livrées × indicateur INSEE, un point par code
 * postal, plus le coefficient de Pearson et le nombre de points.
 *
 * **Le coefficient n'est jamais montré seul.** `r` et `n` vont ensemble : un
 * r = 0,9 sur 4 codes postaux ne dit rien, et la jointure de la RPC est
 * INTERNE — elle écarte en silence les CP sans valeur d'indicateur. La
 * couverture (appariés / touchés par la campagne) est donc affichée à côté.
 *
 * **Chargé au premier dépliage, jamais au montage** (cache `useRef`) : deux
 * listes (campagnes et indicateurs) préchargées à l'ouverture de /map, c'est
 * exactement ce que CLAUDE.md interdit.
 *
 * Cet outil ne pose AUCUN dégradé sur la carte — il ne lit pas la carte et
 * n'en peint rien : pas de `DegradeId`, rien à éteindre.
 */
import { useRef, useState } from 'react';
import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip as RTooltip } from 'recharts';
import { adminFetch } from '@/lib/admin-fetch';
import { C, fInter, fMono } from './tokens';
import { labelStyle } from './styles';
import { formaterNombre, formaterNombreAbrege } from '@/lib/format/nombre';

interface CampagneItem {
  id: string;
  name?: string | null;
  nom?: string | null;
}

interface IndicateurRegistre {
  indicator_code: string;
  label: string;
  famille: string | null;
}

interface ResultatCorrelation {
  r: number;
  n: number;
  points: { code: string; x: number; y: number }[];
  indicateur: { code: string; label: string; unit: string | null; calcule_le: string | null };
  couverture: { cp_apparies: number; cp_campagne: number | null };
}

/**
 * Lecture en clair d'un coefficient. Les seuils sont ceux qu'on emploie
 * couramment en analyse de campagne ; ils sont là pour empêcher de sur-lire un
 * r = 0,25, pas pour trancher une question scientifique.
 */
/** Sous ce nombre de points, un coefficient ne se commente pas. */
const N_MIN_INTERPRETATION = 30;

function lireCoefficient(r: number, n: number): string {
  // L'en-tete de ce fichier promet qu'« un r = 0,9 sur 4 codes postaux ne dit
  // rien ». Le seul garde-fou etait n < 3, justifie par la LISIBILITE du
  // nuage — pas par la signification. Un indicateur peu couvert sur une
  // campagne locale rendait donc « 0,92 · relation positive forte » sur cinq
  // points, avec le n affiche juste a cote pour le contredire.
  if (n < N_MIN_INTERPRETATION) return `trop peu de points pour interpréter (n = ${n})`;
  const a = Math.abs(r);
  const sens = r >= 0 ? 'positive' : 'négative';
  if (a < 0.1) return 'aucune relation linéaire';
  if (a < 0.3) return `relation ${sens} très faible`;
  if (a < 0.5) return `relation ${sens} faible`;
  if (a < 0.7) return `relation ${sens} modérée`;
  return `relation ${sens} forte`;
}

export function CorrelationTool() {
  const [ouvert, setOuvert] = useState(false);
  const chargeRef = useRef(false);

  const [campagnes, setCampagnes] = useState<CampagneItem[]>([]);
  const [indicateurs, setIndicateurs] = useState<IndicateurRegistre[]>([]);
  const [chargementListes, setChargementListes] = useState(false);

  const [campagneId, setCampagneId] = useState('');
  const [variable, setVariable] = useState('');
  const [calcul, setCalcul] = useState(false);
  const [resultat, setResultat] = useState<ResultatCorrelation | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const basculerOuvert = () => {
    const prochain = !ouvert;
    setOuvert(prochain);
    if (!prochain || chargeRef.current) return;
    chargeRef.current = true;
    setChargementListes(true);
    // Deux appels seulement — très loin du plafond de 3 requêtes Supabase
    // simultanées (CLAUDE.md), et aucun n'est déclenché au montage.
    Promise.all([
      adminFetch('/api/digital/campaigns').then((r) => (r.ok ? r.json() : [])),
      adminFetch('/api/cibles/indicators').then((r) => (r.ok ? r.json() : { indicators: [] })),
    ])
      .then(([listeCampagnes, listeIndicateurs]) => {
        setCampagnes(Array.isArray(listeCampagnes) ? listeCampagnes : []);
        setIndicateurs(Array.isArray(listeIndicateurs?.indicators) ? listeIndicateurs.indicators : []);
      })
      .catch(() => {
        setErreur('Listes indisponibles.');
        chargeRef.current = false; // un nouveau dépliage retentera
      })
      .finally(() => setChargementListes(false));
  };

  const lancer = async () => {
    if (!campagneId || !variable || calcul) return;
    setCalcul(true);
    setErreur(null);
    try {
      const res = await adminFetch(
        `/api/analyses/correlation?campaignId=${encodeURIComponent(campagneId)}&variable=${encodeURIComponent(variable)}`,
        { cache: 'no-store' },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Erreur ${res.status}`);
      setResultat(data);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
      setResultat(null);
    } finally {
      setCalcul(false);
    }
  };

  const styleChamp = {
    width: '100%', background: C.bgInput, border: `0.5px solid ${C.border}`,
    borderRadius: 6, padding: '8px 10px', fontFamily: fInter, fontSize: 12,
    color: C.text, cursor: 'pointer',
  } as const;

  const styleAxe = { fill: C.textDim, fontSize: 9, fontFamily: fMono };

  return (
    <div>
      <button
        onClick={basculerOuvert}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 14px', background: 'var(--bg-level-2)',
          border: 'none', borderTop: '1px solid var(--border-subtle)',
          borderLeft: '2px solid rgba(78,205,196,0.25)',
          borderBottom: `0.5px solid ${C.border}`, cursor: 'pointer',
        }}
      >
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)', flexShrink: 0 }} />
        <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', flex: 1, textAlign: 'left' }}>
          Corrélation
        </span>
        <span style={{ color: C.textDim, fontSize: 10 }}>{ouvert ? '▲' : '▼'}</span>
      </button>

      {ouvert && (
        <div style={{ padding: 16, borderBottom: `0.5px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 12 }}>

          <div style={{ fontFamily: fInter, fontSize: 11, color: C.textDim, lineHeight: 1.5 }}>
            Compare les impressions livrées par code postal à un indicateur INSEE,
            pour voir si la campagne a arrosé les zones qui comptent.
          </div>

          {chargementListes ? (
            <div style={{ fontFamily: fMono, fontSize: 11, color: C.textDim }}>Chargement…</div>
          ) : (
            <>
              <div>
                <div style={labelStyle}>Campagne</div>
                {/* Le resultat est PERIME des qu'un champ change : sans cela,
                    choisir une autre campagne laissait a l'ecran le r, le n, la
                    couverture et le nuage de la PRECEDENTE — et comme le bloc
                    de resultat n'affichait pas le nom de la campagne, rien ne
                    trahissait le decalage. */}
                <select value={campagneId} onChange={(e) => { setCampagneId(e.target.value); setResultat(null); }} style={styleChamp}>
                  <option value="">Choisir une campagne…</option>
                  {campagnes.map((c) => (
                    <option key={c.id} value={c.id}>{c.name ?? c.nom ?? c.id}</option>
                  ))}
                </select>
              </div>

              <div>
                <div style={labelStyle}>Indicateur</div>
                <select value={variable} onChange={(e) => { setVariable(e.target.value); setResultat(null); }} style={styleChamp}>
                  <option value="">Choisir un indicateur…</option>
                  {indicateurs.map((i) => (
                    <option key={i.indicator_code} value={i.indicator_code}>
                      {i.famille ? `${i.famille} — ` : ''}{i.label}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          <button
            onClick={lancer}
            disabled={!campagneId || !variable || calcul}
            style={{
              background: 'transparent', border: '0.5px solid var(--brand-teal)',
              color: 'var(--brand-teal)', borderRadius: 6, padding: '8px 16px',
              fontFamily: fInter, fontSize: 12, fontWeight: 500,
              cursor: !campagneId || !variable || calcul ? 'not-allowed' : 'pointer',
              opacity: !campagneId || !variable || calcul ? 0.4 : 1,
            }}
          >
            {calcul ? 'Calcul…' : 'Calculer la corrélation'}
          </button>

          {erreur && (
            <div style={{
              padding: '8px 10px', borderRadius: 4, background: C.redDim,
              border: `0.5px solid ${C.redBorder}`, color: C.red,
              fontFamily: fInter, fontSize: 11, lineHeight: 1.5,
            }}>{erreur}</div>
          )}

          {resultat && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

              {/* r et n ne se séparent jamais — voir l'en-tête du fichier. */}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <span style={{ fontFamily: fMono, fontSize: 20, color: C.text }}>
                  {resultat.r.toFixed(2)}
                </span>
                <span style={{ fontFamily: fInter, fontSize: 11, color: C.textSec }}>
                  {lireCoefficient(resultat.r, resultat.n)}
                </span>
              </div>

              <div style={{ fontFamily: fMono, fontSize: 10, color: C.textDim, lineHeight: 1.6 }}>
                {campagnes.find((c) => c.id === campagneId)?.name
                  ?? campagnes.find((c) => c.id === campagneId)?.nom ?? '—'}
                <br />
                n = {formaterNombre(resultat.n)} codes postaux
                {resultat.couverture.cp_campagne != null && (
                  <> sur {formaterNombre(resultat.couverture.cp_campagne)} touchés par la campagne</>
                )}
                <br />
                {resultat.indicateur.label}
                {resultat.indicateur.calcule_le && (
                  <> · calculé le {new Date(resultat.indicateur.calcule_le).toLocaleDateString('fr-FR')}</>
                )}
              </div>

              {/* Sous trois points, un nuage n'est pas lisible et le coefficient
                  ne vaut rien : on le dit plutôt que de dessiner deux points. */}
              {resultat.n < 3 ? (
                <div style={{
                  padding: '8px 10px', borderRadius: 4, background: C.amberDim,
                  border: '0.5px solid rgba(247,183,49,0.25)', color: C.amber,
                  fontFamily: fInter, fontSize: 11, lineHeight: 1.5,
                }}>
                  Trop peu de codes postaux appariés pour une corrélation lisible.
                  L’indicateur n’est peut-être pas renseigné sur le territoire de la campagne.
                </div>
              ) : (
                <div style={{ background: C.bgInput, border: `0.5px solid ${C.border}`, borderRadius: 6, padding: 8 }}>
                  <ResponsiveContainer width="100%" height={220}>
                    <ScatterChart margin={{ top: 8, right: 12, bottom: 24, left: 4 }}>
                      <XAxis
                        type="number" dataKey="x" name="Impressions"
                        tick={styleAxe} axisLine={{ stroke: C.border }} tickLine={false}
                        tickFormatter={(v: number) => formaterNombreAbrege(v)}
                        label={{ value: 'Impressions', position: 'insideBottom', offset: -12, fill: C.textDim, fontSize: 9, fontFamily: fInter }}
                      />
                      <YAxis
                        type="number" dataKey="y" name={resultat.indicateur.label}
                        tick={styleAxe} axisLine={{ stroke: C.border }} tickLine={false}
                        width={38}
                      />
                      <ZAxis range={[16, 16]} />
                      <RTooltip
                        cursor={{ strokeDasharray: '3 3', stroke: C.border }}
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const d = payload[0]?.payload as { code: string; x: number; y: number };
                          return (
                            <div style={{
                              background: 'var(--card)', border: `0.5px solid ${C.border}`,
                              borderRadius: 4, padding: '6px 10px', fontFamily: fMono, fontSize: 10,
                              color: C.textSec,
                            }}>
                              <div style={{ color: C.text }}>{d.code}</div>
                              <div>{formaterNombre(d.x)} impressions</div>
                              <div>{resultat.indicateur.label} : {d.y.toFixed(1)}</div>
                            </div>
                          );
                        }}
                      />
                      <Scatter data={resultat.points} fill="var(--brand-teal)" fillOpacity={0.55} />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
