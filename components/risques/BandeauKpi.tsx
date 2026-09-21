'use client';

/**
 * Les six chiffres qui restent sous les yeux, quelle que soit l'étape.
 *
 * ── POURQUOI ILS SONT PERMANENTS ──────────────────────────────────────────
 *
 * Chaque étape du parcours change un réglage qui change ces six nombres. Les
 * afficher dans un seul panneau obligerait à revenir le consulter après chaque
 * geste — et c'est exactement ce que faisait l'écran précédent, dont les KPI
 * vivaient dans l'onglet Territoires pendant qu'on réglait les rayons ailleurs.
 *
 * ── LE TAUX D'UTILE EST LE CHIFFRE QUI COMPTE ─────────────────────────────
 *
 * Il chute fortement aux petits rayons, et il doit être vu **avant** l'achat,
 * pas après. C'est le seul des six qui porte l'accent de marque.
 *
 * ⚠ Il est calculé **à la maille affichée**, pas au code postal. Le DSP achète
 * au code postal, mais aucun dénominateur fiable n'existe à cette maille :
 * 181 codes postaux partagent leur contour avec un autre (71 groupes), et la
 * règle « le centroïde le plus proche » n'y est alors pas un ordre total. Le
 * taux d'utile réel, celui du plan, se calcule à l'étape Zones sur les codes
 * postaux effectivement retenus. L'infobulle le dit.
 *
 * ── CHAQUE CHIFFRE PORTE SA DÉFINITION ────────────────────────────────────
 *
 * Aucun des six ne se comprend sans précaution : le compte de sites ne
 * s'additionne pas avec la population, la part est relative au carroyage et non
 * aux 67,76 millions de l'INSEE, les codes postaux affichés sont touchés et non
 * retenus. `Kpi` rend donc la note OBLIGATOIRE, et l'infobulle porte la phrase
 * complète.
 */
import React from 'react';
import { fInter } from '@/lib/design/polices';
import { formaterNombre, formaterDecimal } from '@/lib/format/nombre';
import { Kpi } from '@/components/risques/Kpi';
import { LIBELLE_DIMENSION, type Dimension } from '@/lib/risques/dimensions';
import type { Bandes } from '@/components/risques/use-bandes';
import type { CompteSites } from '@/components/risques/use-sites-compte';
import type { PointCourbe } from '@/components/risques/use-courbe-rayon';

interface Props {
  bandes: Bandes | null;
  sites: CompteSites | null;
  /** La courbe cumulée, pour le gain marginal. `null` si indisponible. */
  courbe: PointCourbe[] | null;
  /** Le plus grand rayon du profil, en mètres — l'abscisse du gain marginal. */
  rayonMax: number | null;
  maille: Dimension;
  libelleCible: string;
}

/** Un pourcentage à une décimale, ou `null` si le dénominateur manque. */
function pct(numerateur: number, denominateur: number | null | undefined): number | null {
  if (!denominateur || denominateur <= 0) return null;
  return Math.round((numerateur / denominateur) * 1000) / 10;
}

/**
 * Habitants gagnés par 100 m de rayon supplémentaire, au rayon courant.
 *
 * ⚠ Lu sur la courbe DÉJÀ calculée, jamais recalculé : la courbe est
 * pré-agrégée et son incrément est la différence de deux cumuls arrondis —
 * refaire la soustraction ici à partir d'autre chose donnerait un second
 * chiffre, et les deux finiraient par diverger.
 */
function gainMarginal(courbe: PointCourbe[] | null, rayonM: number | null): number | null {
  if (!courbe || courbe.length === 0 || rayonM === null) return null;
  // Le palier le plus proche AU-DESSOUS du rayon courant : c'est lui qui porte
  // « ce que les 100 prochains mètres apportent ».
  // Les champs sont courts parce qu'ils voyagent par centaines : `r` le rayon
  // en mètres, `p` la population cumulée, `i` l'incrément du palier.
  let choisi: PointCourbe | null = null;
  for (const pt of courbe) {
    if (pt.r <= rayonM) choisi = pt;
    else break;
  }
  return choisi?.i ?? null;
}

export function BandeauKpi({
  bandes, sites, courbe, rayonMax, maille, libelleCible,
}: Props) {
  const total = bandes?.total ?? null;
  const partFrance = bandes ? pct(bandes.total, bandes.population_reference) : null;
  const tauxUtile = bandes ? pct(bandes.total, bandes.pop_unites_touchees) : null;
  const gain = gainMarginal(courbe, rayonMax);

  /*
   * Un tiret et non un zéro tant que la donnée n'est pas là. Zéro se lirait
   * « personne n'est exposé », qui est une réponse ; « — » dit qu'il n'y en a
   * pas encore.
   */
  const ou = (v: number | null, suffixe = '') =>
    v === null ? '—' : `${formaterNombre(v)}${suffixe}`;

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
        valeur={ou(total)}
        libelle={libelleCible.toLowerCase()}
        note="somme exclusive : un carreau, une classe"
        accent
      />
      <Kpi
        valeur={partFrance === null ? '—' : `${formaterDecimal(partFrance)} %`}
        libelle="du territoire étudié"
        note="rapporté au carroyage, pas aux 67,8 M de l’INSEE"
      />
      <Kpi
        valeur={sites ? `${formaterNombre(sites.retenus)} / ${formaterNombre(sites.total)}` : '—'}
        libelle="sites retenus"
        note="ne s’additionne pas avec la population"
      />
      <Kpi
        valeur={ou(bandes?.n_codes_postaux ?? null)}
        libelle="codes postaux touchés"
        note="les retenus se décident à l’étape Zones"
      />
      <Kpi
        valeur={tauxUtile === null ? '—' : `${formaterDecimal(tauxUtile)} %`}
        libelle="taux d’utile"
        note={`à la maille ${LIBELLE_DIMENSION[maille].toLowerCase()}`}
        accent
      />
      <Kpi
        valeur={gain === null ? '—' : `+${formaterNombre(gain)}`}
        libelle="par 100 m de plus"
        note={rayonMax === null ? 'aucun anneau posé' : `au rayon de ${formaterNombre(rayonMax)} m`}
      />
      {/*
        Les infobulles portent la phrase complète. Elles vivent ici et non dans
        `Kpi` : la note est une précaution courte, l'infobulle une définition,
        et les confondre obligerait à choisir entre un bandeau illisible et une
        définition tronquée.
      */}
      <span
        style={{
          fontFamily: fInter, fontSize: 10, color: 'var(--text-tertiary)',
          alignSelf: 'center', maxWidth: 260, lineHeight: 1.45,
        }}
        title={
          'Taux d’utile : part des habitants des unités touchées qui vivent réellement en zone. '
          + 'Il chute aux petits rayons — on achète un territoire entier pour n’en viser qu’une '
          + 'fraction. Le taux du PLAN, calculé sur les codes postaux réellement retenus, '
          + 'apparaît à l’étape Zones.'
        }
      >
        Ces six chiffres suivent les filtres et le profil. Survolez-en un pour sa définition.
      </span>
    </div>
  );
}
