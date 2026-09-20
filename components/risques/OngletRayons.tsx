'use client';

/**
 * L'atelier « Rayons » : on règle le profil, et on voit ce qu'il classe.
 *
 * ── LES DEUX MOITIÉS, ET POURQUOI ELLES SONT CÔTE À CÔTE ─────────────────
 *
 * À gauche, le RÉGLAGE : les anneaux de chaque niveau. À droite, la
 * CONSÉQUENCE : combien d'habitants tombent dans chaque bande. Les séparer en
 * deux écrans obligerait à mémoriser un nombre pour juger d'un réglage, ce qui
 * est exactement ce qu'on demande d'éviter.
 *
 * ── LA COURBE RESTE, ET ELLE RÉPOND À UNE AUTRE QUESTION ─────────────────
 *
 * `OngletRayonInfluence` montre la population couverte de 100 m à 10 km, en
 * continu. Elle sert à CHOISIR un rayon — à lire où la courbe décroche. Le
 * tableau des bandes, lui, chiffre un profil DÉJÀ choisi. L'une explore,
 * l'autre mesure.
 *
 * ⚠ Elles ne portent pas les mêmes nombres, et l'écran doit le dire. La courbe
 * est MARGINALE : une courbe par gravité, chacune exacte pour sa propre
 * question, mais un carreau proche des deux niveaux compte dans les deux. Le
 * tableau applique la règle d'affectation unique. Les additionner donnerait
 * 537 919 habitants de trop sur la France — mesuré le 2026-09-19.
 */
import React from 'react';
import { Loader2 } from 'lucide-react';
import { PanneauProfil } from '@/components/risques/PanneauProfil';
import { TableauBandes } from '@/components/risques/TableauBandes';
import { OngletRayonInfluence } from '@/components/risques/OngletRayonInfluence';
import type { ResultatCourbe } from '@/components/risques/use-courbe-rayon';
import { useBandes } from '@/components/risques/use-bandes';
import { Kpi } from '@/components/risques/Kpi';
import { formaterNombre } from '@/lib/format/nombre';
import { fInter, fMono } from '@/lib/design/polices';
import { LIBELLE_NIVEAU, anneauxDuNiveau, NIVEAUX, type ProfilRayons } from '@/lib/risques/profil';
import type { Dimension } from '@/lib/risques/dimensions';

interface Props {
  profil: ProfilRayons;
  cible: string;
  libelleCible: string;
  maille: Dimension;
  parent: string | null;
  nomPerimetre: string;
  /**
   * Filtres hérités, relayés TELS QUELS à la courbe.
   *
   * ⚠ `perim` porte un code UNIQUE et non une liste : c'est la forme que
   * `OngletRayonInfluence` attend, et la retyper ici ferait diverger deux
   * contrats pour le même objet.
   */
  gravites: string[];
  natures: string[];
  perim: { niveau: 'region' | 'departement'; code: string } | null;
  /**
   * Les bandes, CHARGÉES PAR L'OVERLAY et non par cet onglet.
   *
   * ⚠ Ce n'est pas un détail d'organisation. Tant que l'appel vivait ici, il
   * repartait à chaque retour sur l'onglet — et le tableau se vidait le temps
   * de la réponse, alors que rien n'avait changé. Hissé d'un cran, il survit
   * au changement d'onglet : basculer devient instantané.
   */
  bandes: ReturnType<typeof useBandes>;
  /** La courbe, chargée par l'overlay elle aussi. */
  courbe: ResultatCourbe;
}

export function OngletRayons({
  profil, cible, libelleCible, maille, parent, nomPerimetre,
  gravites, natures, perim, bandes: resultatBandes, courbe,
}: Props) {
  const { etat, bandes, erreur, aConstruire } = resultatBandes;

  const parClasse = bandes?.par_classe ?? {};

  /** Total par niveau, déduit des classes — jamais demandé séparément. */
  const parNiveau = NIVEAUX.map((niveau) => {
    if (anneauxDuNiveau(profil, niveau).length === 0) return null;
    const somme = Object.entries(parClasse)
      .filter(([cle]) => cle.startsWith(`${niveau}:`))
      .reduce((t, [, v]) => t + v, 0);
    return { niveau, somme };
  }).filter((x): x is { niveau: (typeof NIVEAUX)[number]; somme: number } => x !== null);

  return (
    /*
     * ⚠ Plus de colonne de réglage à gauche. L'éditeur d'anneaux a rejoint le
     * TIROIR de la barre commune : il décide de la classe de chaque carreau,
     * donc des chiffres des TROIS onglets, et le laisser ici obligeait à
     * revenir sur celui-ci pour changer un rayon qu'on lisait ailleurs.
     */
    <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
      {/* ── Conséquence ─────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px', minWidth: 0 }}>
        {etat === 'echec' && (
          <div
            style={{
              padding: '10px 12px', marginBottom: 14,
              background: aConstruire ? 'rgba(247,183,49,0.1)' : 'rgba(255,87,87,0.1)',
              border: `0.5px solid ${aConstruire ? 'rgba(247,183,49,0.2)' : 'rgba(255,87,87,0.2)'}`,
              borderRadius: 6,
            }}
          >
            <p style={{
              fontFamily: fInter, fontSize: 12, margin: 0, lineHeight: 1.5,
              color: aConstruire ? 'var(--warning)' : 'var(--danger)',
            }}>
              {erreur}
            </p>
            {aConstruire && (
              <p style={{ fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)', margin: '6px 0 0' }}>
                Construction :{' '}
                <code style={{ fontFamily: fMono }}>node scripts/construire_carreau_risque.mjs</code>
              </p>
            )}
          </div>
        )}

        {etat === 'chargement' && !bandes && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            fontFamily: fInter, fontSize: 12, color: 'var(--text-tertiary)',
          }}>
            <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
            Classement des carreaux…
          </div>
        )}

        {bandes && (
          <>
            <div style={{ display: 'flex', gap: 28, marginBottom: 18, flexWrap: 'wrap' }}>
              <Kpi
                valeur={formaterNombre(bandes.total)}
                libelle={libelleCible.toLowerCase()}
                note="la somme des bandes égale ce total"
              />
              {parNiveau.map(({ niveau, somme }) => (
                <Kpi
                  key={niveau}
                  valeur={formaterNombre(somme)}
                  libelle={LIBELLE_NIVEAU[niveau].toLowerCase()}
                  note={niveau === 'haut'
                    ? 'prioritaire : un carreau proche des deux niveaux compte ici'
                    : 'hors des anneaux du seuil haut'}
                />
              ))}
              <Kpi
                valeur={formaterNombre(bandes.n_carreaux)}
                libelle="carreaux classés"
                note={`${nomPerimetre}, carroyage INSEE 200 m`}
              />
            </div>

            <p style={{
              fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)',
              margin: '0 0 16px', lineHeight: 1.5, maxWidth: 680,
            }}>
              Chaque carreau reçoit une seule classe : le seuil haut l’emporte sur le seuil bas,
              et le périmètre PPRT sur la bande calculée. C’est ce qui rend toutes les sommes
              additives — par niveau, par bande et par territoire.
            </p>

            <TableauBandes
              profil={profil}
              parClasse={parClasse}
              horsZone={bandes.hors_zone}
              total={bandes.total}
              libelleCible={libelleCible}
            />

            <div style={{ marginTop: 28, borderTop: '0.5px solid var(--border-subtle)', paddingTop: 16 }}>
              <p style={{
                fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)',
                margin: '0 0 10px', lineHeight: 1.5, maxWidth: 680,
              }}>
                La courbe ci-dessous répond à une autre question : où placer un anneau. Elle est
                lue par gravité, sans priorité entre niveaux — un carreau proche des deux y compte
                deux fois. Ses chiffres ne s’additionnent donc pas à ceux du tableau.
              </p>
              <OngletRayonInfluence
                cible={cible}
                libelleCible={libelleCible}
                niveaux={gravites}
                natures={natures}
                perim={perim}
                nomPerim={nomPerimetre}
                courbe={courbe}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
