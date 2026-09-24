'use client';

/**
 * Les six chiffres de l'étape ⑤, à la place de ceux des étapes ① à ④.
 *
 * Même composant `Kpi`, même emplacement, même rythme : on change de question
 * (« combien d'habitants exposés » devient « la campagne tient-elle son
 * plan »), pas d'écran. Les chiffres suivent la PÉRIODE choisie — v1, v2 ou la
 * campagne entière — et le disent dans leur note.
 */
import React from 'react';
import { fInter } from '@/lib/design/polices';
import { formaterDecimal, formaterNombreCourt } from '@/lib/format/nombre';
import { Kpi } from '@/components/risques/Kpi';
import { useSimulation } from '@/components/risques/campagne/ContexteSimulation';
import { LIBELLE_PERIODE } from '@/lib/simulation/vue';

const pct = (x: number | null) => (x == null ? '—' : `${formaterDecimal(x * 100, 1)} %`);
const eur = (x: number | null, d = 2) => (x == null ? '—' : `${formaterDecimal(x, d)} €`);

export function BandeauCampagne() {
  const { vue, etat } = useSimulation();
  const i = vue?.indicateurs;
  const note = vue ? `${LIBELLE_PERIODE[vue.periode].toLowerCase()} · jours ${vue.jours[0]} à ${vue.jours[1]}` : '';

  return (
    <div
      style={{
        display: 'flex', gap: 26, flexWrap: 'wrap',
        padding: '10px 20px',
        borderTop: '0.5px solid var(--border-subtle)',
        borderBottom: '0.5px solid var(--border-subtle)',
        background: 'var(--bg-level-2)',
      }}
    >
      <Kpi
        valeur={i ? formaterNombreCourt(i.impressions) : '—'}
        libelle="impressions"
        note={vue ? note : etat === 'chargement' ? 'lecture de la simulation' : 'aucune campagne simulée'}
      />
      <Kpi
        valeur={i ? (i.score == null ? 'non calculable' : String(Math.round(i.score))) : '—'}
        libelle="alignement / 100"
        note={i?.raison ?? 'par zone, sur la population exposée'}
        accent
      />
      <Kpi
        valeur={pct(i?.part_en_zone ?? null)}
        libelle="part en zone"
        note="impressions sur les codes postaux achetés"
      />
      <Kpi
        valeur={pct(i?.taux_utile_reel ?? null)}
        libelle="taux d’utile réel"
        note="impressions qui touchent des exposés"
        accent
      />
      <Kpi
        valeur={i ? `${formaterNombreCourt(Math.round(i.depense))} €` : '—'}
        libelle="dépense"
        note="au CPM réel de chaque partenaire"
      />
      <Kpi
        valeur={eur(i?.cout_expose_touche ?? null, 3)}
        libelle="coût par exposé touché"
        note={i ? `${formaterNombreCourt(Math.round(i.exposes_touches))} exposés touchés au moins une fois` : 'portée estimée par zone'}
      />
      <span
        style={{
          fontFamily: fInter, fontSize: 10, color: 'var(--text-tertiary)',
          alignSelf: 'center', maxWidth: 260, lineHeight: 1.45,
        }}
        title={
          'Alignement : même règle que le Suivi de campagne (tolérance 10 %), calculée par '
          + 'bassin sur les impressions UTILES — celles qui touchent des habitants exposés. '
          + 'Le plan d’un bassin est sa part de la population exposée, jamais la population '
          + 'totale de ses codes postaux. Coût par exposé touché : dépense ÷ exposés touchés '
          + 'au moins une fois, estimés par une loi de Poisson.'
        }
      >
        Ces six chiffres suivent la période choisie. Survolez ce texte pour leurs définitions.
      </span>
    </div>
  );
}
