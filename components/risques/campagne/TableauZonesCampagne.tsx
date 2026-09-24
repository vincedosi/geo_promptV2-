'use client';

/**
 * Le tableau des zones de l'étape ⑤, TRIÉ PAR ÉCART au plan.
 *
 * L'ordre répond à la question du media planner : « où la campagne s'écarte-t-
 * elle le plus de ce qu'on a décidé ? », mesurée en points de part du plan —
 * là où se déplacent des budgets.
 *
 * Un clic sélectionne la zone : la carte se recadre sur elle et la souligne.
 */
import React, { useMemo, useState } from 'react';
import { fInter, fMono } from '@/lib/design/polices';
import { formaterDecimal, formaterNombre, formaterNombreCourt } from '@/lib/format/nombre';
import { RAMPE_CSS, trancheDivergente } from '@/lib/campagne/palette-divergente';
import { useSimulation } from '@/components/risques/campagne/ContexteSimulation';
import type { LigneZone } from '@/lib/simulation/vue';

/** Au-delà, on replie : 580 bassins nationaux ne se lisent pas d'un coup. */
const LIGNES_VISIBLES = 40;

/**
 * L'écart en POINTS DE PART, et non l'indice : un bassin de 0,1 % du plan à
 * l'indice 10 pèse moins, en budget comme en habitants, que la vallée de la
 * chimie à l'indice 130. Trié par indice, le tableau ouvrait sur des
 * micro-bassins et reléguait les écarts qui coûtent.
 */
const ecart = (z: LigneZone) => Math.abs(z.part_diffusee - z.part_plan);

export function TableauZonesCampagne() {
  const { vue, zoneActive, setZoneActive } = useSimulation();
  const [tout, setTout] = useState(false);

  const lignes = useMemo(
    () => (vue?.zones ?? []).filter((z) => z.part_plan > 0).sort((a, b) => ecart(b) - ecart(a)),
    [vue],
  );
  if (!vue) return null;
  const affichees = tout ? lignes : lignes.slice(0, LIGNES_VISIBLES);

  return (
    <div style={{ flexShrink: 0, maxHeight: '38%', overflow: 'auto', borderTop: '1px solid var(--border-subtle)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: fInter, fontSize: 11 }}>
        <thead>
          <tr style={{ position: 'sticky', top: 0, background: 'var(--bg-level-2)', zIndex: 1 }}>
            {['Zone', 'Exposés', 'Part du plan', 'Part diffusée', 'Indice', 'Impr. utiles',
              'Taux d’utile', 'Coût / exposé touché'].map((t, i) => (
              <th key={t} style={{
                textAlign: i === 0 ? 'left' : 'right', fontWeight: 400,
                color: 'var(--text-tertiary)', padding: '7px 10px',
                borderBottom: '0.5px solid var(--border-default)', whiteSpace: 'nowrap',
              }}>{t}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {affichees.map((z) => {
            const actif = zoneActive === z.id;
            const t = z.indice == null ? null : trancheDivergente(z.indice - 100);
            const sens = z.indice == null ? '' : z.indice < 90 ? 'sous' : z.indice > 110 ? 'sur' : '';
            return (
              <tr
                key={z.id}
                onClick={() => setZoneActive(actif ? null : z.id)}
                style={{ cursor: 'pointer', background: actif ? 'var(--bg-level-2)' : undefined }}
              >
                <td style={cellule(true)}>{z.nom}</td>
                <td style={cellule()}>{formaterNombre(z.pop_exposee)}</td>
                <td style={cellule()}>{formaterDecimal(z.part_plan * 100, 1)} %</td>
                <td style={cellule()}>{formaterDecimal(z.part_diffusee * 100, 1)} %</td>
                <td style={cellule()}>
                  {/* La couleur en pastille À CÔTÉ du chiffre, jamais sous lui :
                      les tranches extrêmes sont foncées dans un thème et claires
                      dans l'autre, et aucun jeton de texte ne se lit sur les deux. */}
                  <span aria-hidden style={{
                    display: 'inline-block', width: 9, height: 9, borderRadius: 2, marginRight: 6,
                    verticalAlign: '-1px',
                    background: t == null ? 'var(--bg-level-3)' : RAMPE_CSS[t],
                  }} />
                  <span style={{ fontFamily: fMono }}>
                    {z.indice == null ? '—' : Math.round(z.indice)}
                  </span>
                  <span style={{ marginLeft: 6, color: 'var(--text-tertiary)', fontFamily: fInter, fontSize: 10 }}>{sens}</span>
                </td>
                <td style={cellule()}>{formaterNombreCourt(Math.round(z.utiles))}</td>
                <td style={cellule()}>{z.taux_utile == null ? '—' : `${formaterDecimal(z.taux_utile * 100, 1)} %`}</td>
                <td style={cellule()}>{z.cout_expose_touche == null ? '—' : `${formaterDecimal(z.cout_expose_touche, 3)} €`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {lignes.length > LIGNES_VISIBLES && (
        <button
          type="button"
          onClick={() => setTout((v) => !v)}
          style={{
            margin: '8px 10px', background: 'none', border: 0, cursor: 'pointer',
            fontFamily: fInter, fontSize: 11, color: 'var(--brand-teal)',
          }}
        >
          {tout ? 'Replier' : `Afficher les ${formaterNombre(lignes.length)} zones`}
        </button>
      )}
    </div>
  );
}

function cellule(premiere = false): React.CSSProperties {
  return {
    padding: '6px 10px',
    borderBottom: '0.5px solid var(--border-subtle)',
    textAlign: premiere ? 'left' : 'right',
    fontFamily: premiere ? fInter : fMono,
    color: 'var(--text-primary)',
    whiteSpace: 'nowrap',
  };
}
