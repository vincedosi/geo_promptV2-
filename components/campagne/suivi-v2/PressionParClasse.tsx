'use client';

/**
 * « Pression par classe » — ce que la campagne a réellement servi à chaque
 * classe de zone, rapporté à ce que le plan lui destinait.
 *
 * ── L'INDICE ─────────────────────────────────────────────────────────────
 *
 * Part des impressions rapportée à la part du PLAN, ×100.
 *   100 → la classe reçoit exactement ce que le plan lui destinait ;
 *   150 → la moitié en plus ;
 *    30 → moins du tiers.
 *
 * Le repère à 100 est TRACÉ sur les barres, et c'est ce qui rend l'écran
 * lisible sans calcul mental : l'œil voit l'écart, pas seulement la longueur.
 *
 * ── LE DÉNOMINATEUR EST LE PLAN, PAS LA POPULATION ───────────────────────
 *
 * L'onglet « Diffusion » que ce bloc remplace comparait à la population,
 * faute de plan. Les deux questions se ressemblent mais une seule est
 * actionnable : on ne corrige pas une démographie, on corrige une enchère.
 *
 * ── AUCUNE VENTILATION ───────────────────────────────────────────────────
 *
 * Les impressions ne sont plus réparties du code postal vers le carreau :
 * `campaign_cp_rollup` et `zone_set_cp` sont au même grain. Ce que l'écran
 * affiche est mesuré, pas estimé — et c'est la première fois.
 */
import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { adminFetch } from '@/lib/admin-fetch';
import { formaterNombre } from '@/lib/format/nombre';
import { COULEUR_NIVEAU_CSS } from '@/lib/carte/palette-zones-risque';
import { libelleClasse, anneauxParNiveau } from '@/lib/risques/libelle-classe';
import { normaliserProfil, type Niveau } from '@/lib/risques/profil';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

/**
 * Plafond de l'échelle des barres.
 *
 * Un indice peut dépasser 200 ; laisser l'échelle suivre le maximum écraserait
 * toutes les autres barres contre le repère et rendrait le bloc illisible dès
 * qu'une classe minuscule reçoit un peu trop. Au-delà, la barre est tronquée
 * et le CHIFFRE reste affiché en entier — c'est lui qui fait foi.
 */
const INDICE_MAX_ECHELLE = 200;

interface ClassePression {
  classe: string;
  n_cp: number;
  n_cp_retenus: number;
  impressions: number;
  depense: number;
  part_impressions_pct: number;
  part_plan_pct: number;
  indice: number | null;
  cpm: number | null;
}

interface Payload {
  classes: ClassePression[];
  impressions_totales: number;
  part_hors_zone_pct: number;
  n_cp: number;
  jeu: { id: string; nom: string; version: number; profil: unknown };
}

interface Props {
  campaignId: string;
}

export function PressionParClasse({ campaignId }: Props) {
  const [data, setData] = useState<Payload | null>(null);
  const [etat, setEtat] = useState<'chargement' | 'echec' | 'pret'>('chargement');
  const [erreur, setErreur] = useState<string | null>(null);
  const monte = useRef(true);

  // ⚠ Remis à `true` à chaque montage : React monte, démonte puis remonte en
  // développement, et un drapeau posé une seule fois reste à `false` pour
  // toujours — l'écran resterait alors en chargement sans rien dire.
  useEffect(() => {
    monte.current = true;
    return () => { monte.current = false; };
  }, []);

  useEffect(() => {
    let annule = false;
    setEtat('chargement');
    (async () => {
      try {
        const rep = await adminFetch(`/api/campaigns/${campaignId}/pression-classes`, {
          cache: 'no-store',
        });
        const j = await rep.json().catch(() => ({}));
        if (annule || !monte.current) return;
        if (!rep.ok) {
          setErreur(typeof j?.error === 'string' ? j.error : 'Pression par classe indisponible.');
          setEtat('echec');
          return;
        }
        setData(j as Payload);
        setEtat('pret');
      } catch {
        if (!annule && monte.current) {
          setErreur('Erreur réseau.');
          setEtat('echec');
        }
      }
    })();
    return () => { annule = true; };
  }, [campaignId]);

  /*
   * Le profil vient de la RÉPONSE, pas d'une prop : c'est celui du jeu
   * RÉELLEMENT rattaché à la campagne, qui peut différer du profil ouvert
   * dans l'atelier. `normaliserProfil` ne lève jamais — le profil vient de la
   * base et a pu être écrit par une version antérieure du produit.
   */
  const anneauxPar = (() => {
    if (!data?.jeu.profil) return { haut: [], bas: [], autres: [] } as Record<Niveau, number[]>;
    try {
      return anneauxParNiveau(normaliserProfil(data.jeu.profil));
    } catch {
      return { haut: [], bas: [], autres: [] } as Record<Niveau, number[]>;
    }
  })();

  if (etat === 'chargement') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 2px' }}>
        <Loader2 size={13} className="animate-spin" style={{ color: 'var(--brand-teal)' }} />
        <span style={{ fontFamily: fInter, fontSize: 12, color: 'var(--text-tertiary)' }}>
          Mesure de la pression par classe…
        </span>
      </div>
    );
  }

  if (etat === 'echec' || !data) {
    return (
      <p
        role="status"
        style={{ margin: 0, fontFamily: fInter, fontSize: 12, color: 'var(--text-tertiary)' }}
      >
        {erreur ?? 'Pression par classe indisponible.'}
      </p>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
        <h3 style={{ margin: 0, fontFamily: fInter, fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
          Pression par classe
        </h3>
        <span style={{ fontFamily: fMono, fontSize: 11, color: 'var(--text-tertiary)' }}>
          {data.jeu.nom} · version {data.jeu.version}
        </span>
      </div>
      <p style={{ margin: '0 0 14px', fontFamily: fInter, fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        Part des impressions rapportée à la part du plan, ×100. Le repère à{' '}
        <span style={{ fontFamily: fMono }}>100</span> est ce que le plan destinait à la
        classe.{' '}
        {data.part_hors_zone_pct > 0 ? (
          <>
            <span style={{ fontFamily: fMono, color: 'var(--text-primary)' }}>
              {data.part_hors_zone_pct.toFixed(1)} %
            </span>{' '}
            des impressions sont tombées hors du jeu de zones.
          </>
        ) : (
          'Aucune impression hors du jeu de zones.'
        )}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {data.classes.map((c) => (
          <Barre
            key={c.classe}
            classe={c}
            libelle={libelleClasse(c.classe, anneauxPar)}
            couleur={couleurDeClasse(c.classe)}
          />
        ))}
      </div>

      <p style={{ margin: '12px 0 0', fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
        Mesuré au code postal, la maille d’achat du DSP et celle du plan : aucune
        répartition n’est supposée à l’intérieur d’un code postal. Un indice vide
        signale une classe sans plan — il n’y a rien à comparer, ce n’est pas un zéro.
      </p>
    </div>
  );
}

/** La teinte d'une classe, d'après son niveau. */
function couleurDeClasse(classe: string): string {
  if (classe === 'hors') return 'var(--donnee-absente)';
  const niveau = classe.split(':')[0] as Niveau;
  return COULEUR_NIVEAU_CSS[niveau] ?? 'var(--donnee-absente)';
}

function Barre({ classe, libelle, couleur }: {
  classe: ClassePression;
  libelle: string;
  couleur: string;
}) {
  const indice = classe.indice;
  const largeur = indice === null
    ? 0
    : Math.min(100, (indice / INDICE_MAX_ECHELLE) * 100);
  // La position du repère est la MÊME pour toutes les barres : c'est ce qui
  // permet de comparer d'un coup d'œil, sans lire les chiffres.
  const repere = (100 / INDICE_MAX_ECHELLE) * 100;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 3 }}>
        <span
          aria-hidden
          style={{ width: 8, height: 8, borderRadius: 2, background: couleur, flexShrink: 0 }}
        />
        <span style={{ fontFamily: fInter, fontSize: 12, color: 'var(--text-primary)', flex: 1 }}>
          {libelle}
        </span>
        <span style={{ fontFamily: fMono, fontSize: 12, color: 'var(--text-primary)' }}>
          {indice === null ? '—' : formaterNombre(Math.round(indice))}
        </span>
      </div>
      <div
        role="img"
        aria-label={
          indice === null
            ? `${libelle} : pas de plan, indice non calculable`
            : `${libelle} : indice ${Math.round(indice)} sur un repère de 100`
        }
        style={{
          position: 'relative', height: 8, borderRadius: 4,
          background: 'var(--bg-level-3)', overflow: 'hidden',
        }}
      >
        <div style={{ width: `${largeur}%`, height: '100%', background: couleur, opacity: 0.85 }} />
        <span
          aria-hidden
          style={{
            position: 'absolute', left: `${repere}%`, top: -2, bottom: -2, width: 1,
            background: 'var(--text-secondary)',
          }}
        />
      </div>
      <div style={{ display: 'flex', gap: 14, marginTop: 3, fontFamily: fMono, fontSize: 10.5, color: 'var(--text-tertiary)' }}>
        <span>{formaterNombre(classe.impressions)} imp.</span>
        <span>plan {classe.part_plan_pct.toFixed(2)} %</span>
        <span>servi {classe.part_impressions_pct.toFixed(2)} %</span>
        {classe.cpm !== null && <span>{classe.cpm.toFixed(2)} € CPM</span>}
        <span>
          {formaterNombre(classe.n_cp_retenus)} / {formaterNombre(classe.n_cp)} CP retenus
        </span>
      </div>
    </div>
  );
}
