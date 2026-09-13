'use client';

/**
 * Onglet « Fraîcheur données » de /admin/health.
 *
 * Montre, pour chaque source non socio-démo, d'où elle vient, comment elle
 * entre, où elle atterrit et de quand elle date. Le périmètre exclut POI, IRIS
 * et Filosofi, qui relèvent de /admin/qualite-donnees.
 *
 * L'onglet ne mesure RIEN à l'ouverture : il lit le dernier relevé persisté et
 * affiche sa date. C'est l'utilisateur qui décide de relancer, parce que les
 * lectures se paient sur un disque Nano plafonné à 5 Mo/s.
 *
 * Deux boutons et non un, parce que les deux mesures ne coûtent pas la même
 * chose : la passe ordinaire lit moins de 15 Mo, celle du flux routier en lit
 * 347 (mesuré). Un bouton unique ferait payer le second coût à chaque clic.
 */
import { useState, useEffect, useCallback } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import type { NatureSource, EtatFraicheur } from '@/lib/donnees/registre-fraicheur';

interface SourceAffichee {
  id: string;
  libelle: string;
  nature: NatureSource;
  provenance: string;
  collecte: string;
  table: string | null;
  cadenceAttendueJours: number | null;
  coutMesure: 'leger' | 'lourd';
  note: string | null;
  etat: EtatFraicheur;
  ageJours: number | null;
  nLignes: number | null;
  nEstime: boolean;
  donneeMin: string | null;
  donneeMax: string | null;
  ingestionMax: string | null;
  nonMesure: string | null;
}

interface Reponse {
  sources: SourceAffichee[];
  mesureLe: string | null;
  dureeMs: number | null;
}

const C = {
  bgElevated: 'var(--bg-surface)',
  bgSurface:  'var(--bg-level-2)',
  border:     'var(--border-subtle)',
  accent:     'var(--brand-teal)',
  text:       'var(--text-primary)',
  textDim:    'var(--text-secondary)',
  textSec:    'var(--text-tertiary)',
  green:      'var(--success)',
  warn:       '#fbbf24',
  red:        '#f87171',
};
const fontMono = "'JetBrains Mono', monospace";
const fontInter = "'Inter', system-ui, sans-serif";

const LIBELLE_NATURE: Record<NatureSource, string> = {
  live: 'Live',
  cache: 'Cache daté',
  referentiel: 'Référentiel',
  derive: 'Dérivé',
};

/**
 * Ce que chaque nature dit du stockage. C'est la distinction qui décide si une
 * donnée a le droit de vivre en base, donc elle est écrite, pas sous-entendue.
 */
const EXPLICATION_NATURE: Record<NatureSource, string> = {
  live: 'Appelée à chaque usage, jamais stockée. Rien à périmer.',
  cache: 'Copie datée qui expire. Stockée pour rendre la lecture possible, pas pour faire référence.',
  referentiel: 'Millésime figé, réimporté à la main. Le risque est qu’il vieillisse sans qu’on le voie.',
  derive: 'Calculée depuis une autre donnée du projet.',
};

function couleurEtat(etat: EtatFraicheur): string {
  if (etat === 'a_jour') return C.green;
  if (etat === 'en_retard') return C.red;
  if (etat === 'jamais_mesure') return C.warn;
  return C.textSec;
}

function formaterAge(ageJours: number): string {
  if (ageJours < 1) return 'aujourd’hui';
  if (ageJours < 60) return `il y a ${ageJours} j`;
  const mois = Math.round(ageJours / 30);
  return `il y a ${mois} mois`;
}

function libelleEtat(etat: EtatFraicheur, ageJours: number | null): string {
  if (etat === 'a_jour') return 'À jour';
  if (etat === 'en_retard') return ageJours !== null ? `En retard de ${ageJours} j` : 'En retard';
  if (etat === 'jamais_mesure') return 'Jamais mesuré';
  // `sans_objet` : aucune cadence attendue, donc aucun retard possible. L'age
  // reste l'information utile, il est donne sans verdict.
  return ageJours !== null ? formaterAge(ageJours) : '—';
}

/** Une date affichée sans son heure quand l'heure n'apprend rien. */
function formaterDate(valeur: string | null): string {
  if (!valeur) return '—';
  // Une année seule (millésime d'un comptage) n'est pas une date à formater.
  if (/^\d{4}$/.test(valeur)) return valeur;
  const d = new Date(valeur);
  if (Number.isNaN(d.getTime())) return valeur;
  return d.toLocaleDateString('fr-FR');
}

function Badge({ children, couleur }: { children: React.ReactNode; couleur: string }) {
  return (
    <span style={{
      fontFamily: fontInter,
      fontSize: 10,
      color: couleur,
      background: `${couleur}1a`,
      border: `1px solid ${couleur}44`,
      borderRadius: 4,
      padding: '2px 7px',
      whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  );
}

export default function FraicheurPanel() {
  const [data, setData] = useState<Reponse | null>(null);
  const [chargement, setChargement] = useState(true);
  const [mesureEnCours, setMesureEnCours] = useState<'leger' | 'lourd' | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(async () => {
    setChargement(true);
    setErreur(null);
    try {
      const res = await adminFetch('/api/admin/fraicheur-donnees');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Lecture impossible.');
      setData(json);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Lecture impossible.');
    }
    setChargement(false);
  }, []);

  useEffect(() => { charger(); }, [charger]);

  const mesurer = useCallback(async (inclureLourd: boolean) => {
    setMesureEnCours(inclureLourd ? 'lourd' : 'leger');
    setErreur(null);
    try {
      const res = await adminFetch('/api/admin/fraicheur-donnees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inclureLourd }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'La mesure a échoué.');
      setData(json);
      if (json.persiste === false) {
        setErreur('Mesure faite, mais elle n’a pas pu être enregistrée : elle sera perdue au rechargement.');
      }
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'La mesure a échoué.');
    }
    setMesureEnCours(null);
  }, []);

  const sources = data?.sources ?? [];
  const enRetard = sources.filter((s) => s.etat === 'en_retard').length;
  const jamais = sources.filter((s) => s.etat === 'jamais_mesure').length;

  const boutonBase: React.CSSProperties = {
    borderRadius: 6,
    padding: '8px 14px',
    fontFamily: fontInter,
    fontWeight: 500,
    fontSize: 12,
    cursor: 'pointer',
    background: 'transparent',
  };
  const thStyle: React.CSSProperties = {
    textAlign: 'left',
    padding: '8px 10px',
    fontFamily: fontInter,
    fontWeight: 400,
    fontSize: 10,
    color: C.textSec,
    borderBottom: `1px solid ${C.border}`,
    whiteSpace: 'nowrap',
  };
  const tdStyle: React.CSSProperties = {
    padding: '10px',
    fontFamily: fontMono,
    fontSize: 11,
    color: C.textDim,
    verticalAlign: 'top',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Bandeau : ce que l'onglet mesure, et ce qu'il ne mesure pas */}
      <div style={{
        background: C.bgElevated,
        border: `1px solid ${C.border}`,
        borderRadius: 2,
        padding: '14px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        flexWrap: 'wrap',
      }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ fontFamily: fontInter, fontSize: 12, color: C.text, marginBottom: 4 }}>
            Sources hors socle socio-démographique
          </div>
          <div style={{ fontFamily: fontInter, fontSize: 11, color: C.textSec, lineHeight: 1.5 }}>
            POI, IRIS et Filosofi relèvent de la page qualité des données.
            {' '}Cet onglet ne mesure rien à l’ouverture : il lit le dernier relevé.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {enRetard > 0 && <Badge couleur={C.red}>{enRetard} en retard</Badge>}
          {jamais > 0 && <Badge couleur={C.warn}>{jamais} jamais mesuré</Badge>}
          <button
            onClick={() => mesurer(false)}
            disabled={mesureEnCours !== null || chargement}
            style={{
              ...boutonBase,
              border: `0.5px solid ${C.accent}`,
              color: C.accent,
              opacity: mesureEnCours !== null || chargement ? 0.5 : 1,
            }}
          >
            {mesureEnCours === 'leger' ? 'Mesure en cours…' : 'Relancer la mesure'}
          </button>
        </div>
      </div>

      {erreur && (
        <div style={{
          background: 'rgba(248,113,113,0.1)',
          border: '1px solid rgba(248,113,113,0.2)',
          borderRadius: 2,
          padding: '10px 14px',
          fontFamily: fontInter,
          fontSize: 12,
          color: C.red,
        }}>
          {erreur}
        </div>
      )}

      {/* Date du relevé */}
      <div style={{ fontFamily: fontMono, fontSize: 11, color: C.textSec }}>
        {chargement
          ? 'Lecture du relevé…'
          : data?.mesureLe
            ? `Relevé du ${new Date(data.mesureLe).toLocaleString('fr-FR')}${data.dureeMs != null ? ` · ${data.dureeMs} ms` : ''}`
            : 'Aucun relevé : rien n’a encore été mesuré.'}
      </div>

      {/* Tableau */}
      <div style={{
        background: C.bgElevated,
        border: `1px solid ${C.border}`,
        borderRadius: 2,
        overflowX: 'auto',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
          <thead>
            <tr style={{ background: C.bgSurface }}>
              <th style={thStyle}>Donnée</th>
              <th style={thStyle}>État</th>
              <th style={thStyle}>Stockage</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Lignes</th>
              <th style={thStyle}>Millésime</th>
              <th style={thStyle}>Dernière entrée</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s, idx) => (
              <tr
                key={s.id}
                style={{ borderTop: idx === 0 ? 'none' : `1px solid ${C.border}` }}
              >
                <td style={{ ...tdStyle, minWidth: 200 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: fontInter, fontSize: 12, color: C.text }}>{s.libelle}</span>
                    <Badge couleur={s.nature === 'live' ? C.accent : C.textSec}>
                      {LIBELLE_NATURE[s.nature]}
                    </Badge>
                  </div>
                  <div style={{ fontFamily: fontInter, fontSize: 11, color: C.textSec, lineHeight: 1.5 }}>
                    {s.provenance}
                  </div>
                  <div style={{ fontFamily: fontInter, fontSize: 11, color: C.textSec, lineHeight: 1.5 }}>
                    {s.collecte}
                  </div>
                  {s.note && (
                    <div style={{
                      marginTop: 6,
                      paddingLeft: 8,
                      borderLeft: `2px solid ${C.border}`,
                      fontFamily: fontInter,
                      fontSize: 11,
                      color: C.textSec,
                      lineHeight: 1.5,
                    }}>
                      {s.note}
                    </div>
                  )}
                </td>

                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  <Badge couleur={couleurEtat(s.etat)}>
                    {libelleEtat(s.etat, s.ageJours)}
                  </Badge>
                  {/* La mesure lourde a son propre bouton : elle lit 347 Mo,
                      contre moins de 15 Mo pour toutes les autres réunies. */}
                  {s.coutMesure === 'lourd' && (
                    <div style={{ marginTop: 8 }}>
                      <button
                        onClick={() => mesurer(true)}
                        disabled={mesureEnCours !== null || chargement}
                        style={{
                          ...boutonBase,
                          padding: '5px 10px',
                          fontSize: 11,
                          border: `0.5px solid var(--border-default)`,
                          color: C.textDim,
                          opacity: mesureEnCours !== null || chargement ? 0.5 : 1,
                        }}
                        title="Cette mesure balaye la table : 347 Mo lus, environ 1,8 s"
                      >
                        {mesureEnCours === 'lourd' ? 'Mesure…' : 'Mesurer'}
                      </button>
                      <div style={{ fontFamily: fontInter, fontSize: 10, color: C.textSec, marginTop: 4, maxWidth: 130, lineHeight: 1.4 }}>
                        347 Mo lus, hors mesure ordinaire
                      </div>
                    </div>
                  )}
                </td>
                <td style={tdStyle}>
                  {s.table
                    ? <span style={{ color: C.textDim, wordBreak: 'break-word' }}>{s.table}</span>
                    : <span style={{ color: C.accent }}>hors base</span>}
                </td>

                <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {s.nLignes != null
                    ? `${s.nEstime ? '~' : ''}${s.nLignes.toLocaleString('fr-FR')}`
                    : '—'}
                  {s.nEstime && (
                    <div style={{ fontFamily: fontInter, fontSize: 10, color: C.textSec, marginTop: 2 }}>
                      estimé
                    </div>
                  )}
                </td>

                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  {s.donneeMin && s.donneeMax && formaterDate(s.donneeMin) !== formaterDate(s.donneeMax)
                    ? `${formaterDate(s.donneeMin)} → ${formaterDate(s.donneeMax)}`
                    : formaterDate(s.donneeMax)}
                </td>

                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  {formaterDate(s.ingestionMax)}
                  {s.cadenceAttendueJours != null && (
                    <div style={{ fontFamily: fontInter, fontSize: 10, color: C.textSec, marginTop: 2 }}>
                      attendu tous les {s.cadenceAttendueJours} j
                    </div>
                  )}
                </td>

              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legende des natures. Elle vit ici et non dans chaque ligne : la meme
          phrase repetee dix fois est du bruit, pas de l'information. */}
      <div style={{
        background: C.bgElevated,
        border: `1px solid ${C.border}`,
        borderRadius: 2,
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}>
        <div style={{ fontFamily: fontInter, fontSize: 11, color: C.textSec }}>
          Ce que la nature dit du stockage
        </div>
        {(Object.keys(LIBELLE_NATURE) as NatureSource[]).map((n) => (
          <div key={n} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
            <span style={{ minWidth: 90, flexShrink: 0 }}>
              <Badge couleur={n === 'live' ? C.accent : C.textSec}>{LIBELLE_NATURE[n]}</Badge>
            </span>
            <span style={{ fontFamily: fontInter, fontSize: 11, color: C.textSec, lineHeight: 1.5 }}>
              {EXPLICATION_NATURE[n]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
