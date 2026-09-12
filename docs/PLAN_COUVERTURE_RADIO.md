# PLAN — Couverture radio : de l'horizon théorique au signal réel

> Ouvert le 2026-09-12, sur remarque de Vincent : « pour calculer le rayon
> d'émission radio il faudrait la direction du signal, mais aussi la topologie
> du terrain — une montagne bloque le signal ».
>
> Statut : **non planifié en exécution**, bloqué sur deux jeux de données et un
> arbitrage produit. Ce document existe pour que la limite soit écrite plutôt
> que découverte par un client.

---

## Ce que le code fait aujourd'hui

`lib/radio/anfr-import.ts:187-191`, appelée à l'import ANFR et stockée dans
`emetteurs_radio.rayon_couverture_m` :

```ts
function estimateCoverage(puissanceW: number | null, hauteurM: number | null): number {
  const p = Math.max(puissanceW ?? 100, 1);
  const h = hauteurM ?? 30;
  return Math.min(4120 * (Math.sqrt(h) + Math.sqrt(1.5)) * Math.log(p) / Math.log(1000), 150000);
}
```

C'est la formule de l'**horizon radio** — la distance à laquelle la Terre
elle-même cache l'émetteur, `4120·(√h_émission + √h_réception)` en mètres, avec
un récepteur supposé à 1,50 m — pondérée par un facteur logarithmique de
puissance et plafonnée à 150 km.

Le rayon est ensuite consommé comme un **disque** :

| Où | Quoi |
|---|---|
| `sql/121_get_radio_coverage_geometry.sql:69` | `ST_Buffer(geom::geography, rayon_couverture_m)` puis `ST_Union` |
| `app/copilote/_hooks/useMapInit.ts:544` | cercle de couverture sur la carte |
| `app/map/_hooks/useRadioLayer.ts:229` | idem, couche `radio-coverage-fill` / `-line` |
| `app/api/custom-geo/source/radio/route.ts` | capture d'une zone custom depuis une couverture |

**Conséquence directe :** une zone custom capturée depuis une couverture radio
hérite de cette approximation. Elle part ensuite au DSP sous forme de liste de
codes postaux. L'erreur ne reste donc pas à l'écran — elle finit en achat média.

## Ce que la formule ignore

1. **La directivité.** Un émetteur FM n'arrose pas un disque. Les diagrammes
   d'antenne sont sectoriels, avec un azimut, une ouverture et un tilt. Un
   émetteur en bord de mer ou en bord de frontière est presque toujours
   directif : la moitié de son disque théorique arrose l'eau ou un pays voisin.
2. **Le relief.** C'est la remarque d'origine, et c'est le terme dominant en
   France : une vallée alpine, un massif entre l'émetteur et l'auditeur, et le
   signal s'arrête bien avant l'horizon géométrique. À l'inverse, une plaine
   porte plus loin que la formule ne le dit.
3. **La fréquence.** `emetteurs_radio.frequence_mhz` **existe en base et n'est
   jamais lue.** Or la FM (87,5-108 MHz) et le DAB+ (bande III, ~174-240 MHz)
   ne se propagent pas pareil : le DAB+ est plus sensible au masquage et à la
   diffraction. Deux émetteurs de même puissance et même hauteur reçoivent
   aujourd'hui le même rayon quel que soit leur système.
4. **Le seuil de réception.** Aucun champ minimal (en dBµV/m) n'est défini :
   « couvert » n'a pas de définition mesurable dans le modèle actuel.

## Ce qu'il faudrait, par ordre de coût

### Étape 0 — dire que c'est une estimation (petit, à faire en premier)

Aucune donnée nouvelle. La carte et le panneau Radio annoncent un rayon comme
s'il était mesuré. Il faut qu'ils disent « estimation — horizon théorique, sans
relief ni directivité », et que la capture d'une zone custom depuis une
couverture le répète au moment de la capture. Une valeur fausse annoncée comme
telle reste utilisable ; une valeur fausse annoncée comme vraie ne l'est pas.

### Étape 1 — la directivité (moyen)

Le jeu ANFR « Données sur les stations radioélectriques » porte l'azimut et les
caractéristiques d'antenne dans une table distincte de celle qui a été importée
(côté `SUP_ANTENNE`). La table `emetteurs_radio` actuelle n'a **ni azimut, ni
ouverture, ni tilt** — il faut donc étendre l'import avant de pouvoir calculer
quoi que ce soit de directionnel.

Sortie : un secteur (`ST_Buffer` découpé par l'azimut et l'ouverture) au lieu
d'un disque. Reste faisable en PostGIS.

### Étape 2 — le relief (gros, et hors Postgres)

Il faut un modèle numérique de terrain — IGN RGE ALTI (25 m, France, gratuit)
ou SRTM (30 m, mondial) — et un modèle de propagation :

- **ITU-R P.1546** : le standard pour la radiodiffusion, interpolation par
  courbes, demande un profil de terrain par azimut ;
- **Longley-Rice / ITM** : implémentations libres, plus fin, plus coûteux.

Le calcul se fait par rayon : on tire N azimuts depuis l'émetteur, on échantillonne
le profil altimétrique le long de chaque rayon, on applique la diffraction, et on
s'arrête au seuil de champ. Pour 11 836 émetteurs, c'est un travail par lots.

**Ce calcul n'a pas sa place sur Supabase Nano** (250 IOPS) ni dans une fonction
Vercel (60 à 300 s). Il relève du même véhicule que le clustering et le bidding
ML : **Modal**, en Python, avec `rasterio` pour le MNT — voir
`docs/PLAN_CLUSTERING.md` pour le patron. Résultat stocké en polygone par
émetteur, calculé une fois par import ANFR.

## Bloqué par

- **Le jeu ANFR d'antennes** (azimut, ouverture, tilt) n'est pas importé.
  Extension de `lib/radio/anfr-import.ts` à décider.
- **Aucun MNT dans le projet.** Choisir la source (RGE ALTI 25 m recommandé :
  France entière, DROM compris, licence ouverte) et où le stocker — un raster
  France à 25 m ne tient pas dans Supabase.
- **Modal n'est pas déployable en l'état** : `MODAL_TOKEN_ID` et
  `MODAL_TOKEN_SECRET` sont absentes de `.env.local`, et `MODAL_BIDDING_ML_URL`
  est vide. Même blocage que le portage du clustering.

## Arbitrage produit à rendre

La question n'est pas technique mais commerciale : **quelle précision le produit
doit-il promettre ?**

- Si la couverture radio sert à *illustrer* une zone d'écoute, l'étape 0 suffit
  et le disque peut rester, honnêtement étiqueté.
- Si elle sert à *acheter* — et c'est le cas dès qu'une zone custom en est
  capturée puis poussée au DSP — alors l'étape 2 n'est pas un raffinement, c'est
  une condition de justesse. Un massif de 1 500 m entre l'émetteur et une ville
  peut faire acheter une audience qui n'entend rien.

Tant que l'arbitrage n'est pas rendu, **l'étape 0 doit être faite** : c'est la
seule qui ne coûte rien et qui empêche de vendre une approximation pour une
mesure.
