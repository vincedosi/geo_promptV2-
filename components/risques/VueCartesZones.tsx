'use client';

/**
 * La zone cartographique du module de risque : une carte, ou deux.
 *
 * ── CE QUE CE COMPOSANT DÉCIDE ────────────────────────────────────────────
 *
 * À l'étape ④, et à elle seule, la carte se dédouble : **les rayons à gauche,
 * les codes postaux à droite**, caméras liées. Ailleurs, une seule carte, avec
 * un interrupteur pour passer de l'une à l'autre.
 *
 * La raison est dans le produit : l'étape ④ EST l'endroit où l'on décide ce
 * qu'on achète, et cette décision est la comparaison de deux découpages qui ne
 * coïncident pas. Partout ailleurs, il n'y a rien à comparer — et deux cartes
 * prendraient la place d'une.
 *
 * ── LES DEUX CARTES SONT MONTÉES EN PERMANENCE ────────────────────────────
 *
 * ⚠ Même règle que la carte des rayons depuis le 2026-09-21 : on ne démonte
 * pas une carte MapLibre en changeant d'étape. La remonter rechargerait fond,
 * tuiles et position, et ferait perdre la vue à chaque aller-retour — le geste
 * le plus fréquent du module. Celle qu'on ne regarde pas garde donc une
 * largeur nulle et `visibility: hidden`, jamais `display: none` : ses couches
 * resteraient sinon démontées, et le retour coûterait un rechargement complet.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, Map as IconeCarte, Grid3x3 } from 'lucide-react';
import maplibregl from 'maplibre-gl';
import { fInter, fMono } from '@/lib/design/polices';
import { formaterNombre, formaterDecimal } from '@/lib/format/nombre';
import { CarteRisque } from '@/components/risques/CarteRisque';
import {
  CarteCodesPostaux, LIBELLE_COLORATION, type ColorationCp,
} from '@/components/risques/CarteCodesPostaux';
import { TableauGrappes } from '@/components/risques/TableauGrappes';
import { CarteCampagne } from '@/components/risques/campagne/CarteCampagne';
import { TableauZonesCampagne } from '@/components/risques/campagne/TableauZonesCampagne';
import type { ProfilRayons, Niveau } from '@/lib/risques/profil';
import type { Etape } from '@/lib/risques/etape';

interface Props {
  etape: Etape;
  profil: ProfilRayons;
  codeProfilZones: string;
  /** L'aperçu de rayon en cours de réglage — relayé tel quel à la carte. */
  apercu?: { niveau: Niveau | null; rayonM: number } | null;
  gravites: string[];
  natures: string[];
  fusionner: boolean;
  /** Le jeu construit, ou `null` : la carte des codes postaux n'a rien à dire. */
  jeuId: string | null;
  seuil: number;
  carteSeule: boolean;
  onCarteSeule: (v: boolean) => void;
}

interface Chiffres {
  n_total: number;
  n_affiches: number;
  n_retenus: number;
  taux_utile: number | null;
}

export function VueCartesZones({
  etape, profil, codeProfilZones, apercu, gravites, natures, fusionner,
  jeuId, seuil, carteSeule, onCarteSeule,
}: Props) {
  const double = etape === 'zones' && !!jeuId;
  /*
   * ⑤ Campagne a SA carte, et elle remplace les deux autres le temps de
   * l'étape : elle ne montre ni les anneaux ni le plan, mais ce qui a été
   * diffusé. Montée à la PREMIÈRE visite seulement — les étapes ① à ④ ne
   * doivent pas payer une instance MapLibre de plus — puis gardée, même règle
   * que les deux autres : on ne remonte pas une carte en changeant d'étape.
   */
  const campagne = etape === 'campagne';
  const [campagneMontee, setCampagneMontee] = useState(false);
  useEffect(() => { if (campagne) setCampagneMontee(true); }, [campagne]);
  const [vue, setVue] = useState<'rayons' | 'cp'>('rayons');
  const [coloration, setColoration] = useState<ColorationCp>('plan');
  const [chiffres, setChiffres] = useState<Chiffres | null>(null);
  const [surbrillance, setSurbrillance] = useState<string[] | null>(null);

  const rayonsRef = useRef<maplibregl.Map | null>(null);
  const cpRef = useRef<maplibregl.Map | null>(null);
  /*
   * ⚠ LE VERROU DE RÉENTRANCE, et il n'est pas optionnel.
   *
   * Lier deux caméras, c'est écrire « quand A bouge, place B ». Or placer B
   * émet `move` sur B, qui replace A, qui émet `move`… La boucle ne s'arrête
   * pas d'elle-même : elle sature la boucle d'événements et les deux cartes se
   * mettent à trembler. Le drapeau dit « ce mouvement vient de moi, ne le
   * renvoie pas ».
   */
  const enSync = useRef(false);

  const lier = useCallback((source: maplibregl.Map, cible: maplibregl.Map) => {
    const suivre = () => {
      if (enSync.current) return;
      enSync.current = true;
      // `jumpTo` et non `easeTo` : une animation sur la carte liée la ferait
      // arriver APRÈS celle qu'on manipule, et les deux ne montreraient le
      // même cadre qu'à l'arrêt.
      cible.jumpTo({
        center: source.getCenter(),
        zoom: source.getZoom(),
        bearing: source.getBearing(),
        pitch: source.getPitch(),
      });
      enSync.current = false;
    };
    source.on('move', suivre);
    return () => { source.off('move', suivre); };
  }, []);

  useEffect(() => {
    if (!double) return;
    const a = rayonsRef.current;
    const b = cpRef.current;
    if (!a || !b) return;
    // Au moment où la liaison s'établit, la carte des codes postaux vient
    // d'apparaître : on l'aligne une fois, sinon elle montrerait la France
    // pendant que l'autre montre l'Étang de Berre.
    b.jumpTo({ center: a.getCenter(), zoom: a.getZoom() });
    const d1 = lier(a, b);
    const d2 = lier(b, a);
    return () => { d1(); d2(); };
  }, [double, lier, jeuId]);

  const recadrer = useCallback((bbox: [number, number, number, number]) => {
    for (const m of [rayonsRef.current, cpRef.current]) {
      m?.fitBounds(bbox, { padding: 40, duration: 600 });
    }
  }, []);

  const montreCp = !campagne && (double || vue === 'cp');
  const montreRayons = !campagne && (double || vue === 'rayons');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', position: 'relative' }}>
        {/* ── Les rayons ────────────────────────────────────────────────── */}
        <div style={{
          position: 'relative',
          flex: montreRayons ? 1 : 0,
          minWidth: 0,
          width: montreRayons ? undefined : 0,
          visibility: montreRayons ? 'visible' : 'hidden',
        }}>
          <CarteRisque
            profil={profil}
            apercu={apercu}
            gravites={gravites}
            natures={natures}
            fusionner={fusionner}
            onCarte={(m) => { rayonsRef.current = m; }}
          />
          {double && <Etiquette texte="Zones en rayon" />}
        </div>

        {double && (
          <div style={{ width: 4, flexShrink: 0, background: 'var(--border-subtle)' }} />
        )}

        {/* ── Les codes postaux ─────────────────────────────────────────── */}
        <div style={{
          position: 'relative',
          flex: montreCp ? 1 : 0,
          minWidth: 0,
          width: montreCp ? undefined : 0,
          visibility: montreCp ? 'visible' : 'hidden',
        }}>
          <CarteCodesPostaux
            jeuId={jeuId}
            codeProfilZones={codeProfilZones}
            natures={natures}
            coloration={coloration}
            seuil={seuil}
            surbrillance={surbrillance}
            onCarte={(m) => { cpRef.current = m; }}
            onChiffres={setChiffres}
          />
          {double && <Etiquette texte="Zones en codes postaux" />}

          {/* Le choix de ce que la couleur encode. */}
          {montreCp && (
            <div style={{
              position: 'absolute', top: 10, right: 56, zIndex: 3,
              display: 'flex', gap: 2, padding: 2, borderRadius: 6,
              background: 'var(--card-overlay)',
              border: '0.5px solid var(--border-default)',
            }}>
              {(Object.keys(LIBELLE_COLORATION) as ColorationCp[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColoration(c)}
                  aria-pressed={coloration === c}
                  style={{
                    padding: '4px 8px', borderRadius: 4, border: 'none', cursor: 'pointer',
                    fontFamily: fInter, fontSize: 10,
                    background: coloration === c ? 'var(--brand-teal-10)' : 'transparent',
                    color: coloration === c ? 'var(--brand-teal)' : 'var(--text-secondary)',
                  }}
                >
                  {LIBELLE_COLORATION[c]}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── La diffusion, à l'étape ⑤ ─────────────────────────────────── */}
        {campagneMontee && (
          <div style={{
            position: 'relative',
            flex: campagne ? 1 : 0,
            minWidth: 0,
            width: campagne ? undefined : 0,
            visibility: campagne ? 'visible' : 'hidden',
          }}>
            <CarteCampagne />
          </div>
        )}

        {/* ── L'interrupteur, HORS des étapes ④ et ⑤ ────────────────────── */}
        {!double && !campagne && (
          <div style={{
            position: 'absolute', top: 10, right: 190, zIndex: 3,
            display: 'flex', gap: 2, padding: 2, borderRadius: 6,
            background: 'var(--card-overlay)',
            border: '0.5px solid var(--border-default)',
          }}>
            <BoutonVue actif={vue === 'rayons'} onClick={() => setVue('rayons')}
              icone={<IconeCarte size={11} />} texte="Rayons" />
            <BoutonVue
              actif={vue === 'cp'}
              onClick={() => setVue('cp')}
              icone={<Grid3x3 size={11} />}
              texte="Codes postaux"
              /* ⚠ Désactivé tant qu'aucun jeu n'est construit : la carte des
                 codes postaux n'existe que par rapport à un jeu, et basculer
                 dessus rendrait un écran vide qu'on lirait comme une panne. */
              desactive={!jeuId}
            />
          </div>
        )}

        <button
          type="button"
          onClick={() => onCarteSeule(!carteSeule)}
          aria-pressed={carteSeule}
          title={carteSeule ? 'Réafficher le panneau de l’étape'
            : 'Masquer le panneau et n’afficher que la carte'}
          style={{
            position: 'absolute', top: 10, right: 56, zIndex: 4,
            display: double || campagne ? 'none' : 'inline-flex', alignItems: 'center', gap: 5,
            padding: '5px 10px', borderRadius: 6, cursor: 'pointer',
            background: 'var(--card-overlay)',
            border: '0.5px solid var(--border-default)',
            fontFamily: fInter, fontSize: 11,
            color: carteSeule ? 'var(--brand-teal)' : 'var(--text-secondary)',
          }}
        >
          {carteSeule ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          {carteSeule ? 'Afficher le panneau' : 'Carte seule'}
        </button>
      </div>

      {/* ── Le bandeau, sous les deux cartes ─────────────────────────────── */}
      {double && (
        <div style={{
          flexShrink: 0, display: 'flex', gap: 18, flexWrap: 'wrap',
          padding: '8px 14px',
          borderTop: '1px solid var(--border-subtle)',
          background: 'var(--bg-level-2)',
          fontFamily: fInter, fontSize: 11, color: 'var(--text-secondary)',
        }}>
          <ChiffreBandeau libelle="Codes postaux du jeu"
            valeur={chiffres ? formaterNombre(chiffres.n_total) : '—'} />
          <ChiffreBandeau libelle="Retenus par le seuil"
            valeur={chiffres ? formaterNombre(chiffres.n_retenus) : '—'} />
          <ChiffreBandeau
            libelle="Taux d’utile"
            /* ⚠ `formaterDecimal` et non une interpolation : `${81.6}` écrit
               « 81.6 », avec un point. Le produit écrit ses nombres en
               français, et un point décimal au milieu d'un écran qui affiche
               « 1 927 » se remarque. */
            valeur={chiffres?.taux_utile != null
              ? `${formaterDecimal(chiffres.taux_utile, 1)} %` : '—'}
            /* ⚠ `null` se lit « aucun code postal retenu », jamais « 0 % ».
               0 % voudrait dire qu'on achète tout pour ne viser personne. */
            aide="Population exposée rapportée à celle des codes postaux achetés"
          />
          <ChiffreBandeau
            libelle="Affichés dans le cadre"
            valeur={chiffres ? formaterNombre(chiffres.n_affiches) : '—'}
            aide="La carte ne charge que la vue visible — jamais la France entière"
          />
        </div>
      )}

      {/* ── Le tableau des zones de la campagne, trié par écart ─────────── */}
      {campagne && <TableauZonesCampagne />}

      {/* ── Le tableau des bassins ───────────────────────────────────────── */}
      {double && jeuId && (
        <TableauGrappes
          jeuId={jeuId}
          onRecadrer={recadrer}
          onSurvol={setSurbrillance}
        />
      )}
    </div>
  );
}

function Etiquette({ texte }: { texte: string }) {
  return (
    <div style={{
      position: 'absolute', top: 10, left: 10, zIndex: 3,
      padding: '4px 9px', borderRadius: 6,
      background: 'var(--card-overlay)',
      border: '0.5px solid var(--border-default)',
      fontFamily: fInter, fontSize: 11, color: 'var(--text-primary)',
    }}>
      {texte}
    </div>
  );
}

function BoutonVue({ actif, onClick, icone, texte, desactive }: {
  actif: boolean; onClick: () => void; icone: React.ReactNode;
  texte: string; desactive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={desactive}
      aria-pressed={actif}
      title={desactive ? 'Construisez d’abord un jeu de zones' : texte}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '4px 8px', borderRadius: 4, border: 'none',
        cursor: desactive ? 'not-allowed' : 'pointer',
        opacity: desactive ? 0.45 : 1,
        fontFamily: fInter, fontSize: 10,
        background: actif ? 'var(--brand-teal-10)' : 'transparent',
        color: actif ? 'var(--brand-teal)' : 'var(--text-secondary)',
      }}
    >
      {icone}{texte}
    </button>
  );
}

function ChiffreBandeau({ libelle, valeur, aide }: {
  libelle: string; valeur: string; aide?: string;
}) {
  return (
    <div title={aide} style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
      <span>{libelle}</span>
      <span style={{ fontFamily: fMono, fontSize: 12, color: 'var(--text-primary)' }}>
        {valeur}
      </span>
    </div>
  );
}
