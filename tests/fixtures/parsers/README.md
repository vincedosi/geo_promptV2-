# Fixtures des lecteurs de tableur

Fichiers binaires servant de référence aux tests de `lib/import/xlsx-reader.ts`,
`lib/import/ods-reader.ts` et des trois parsers qui les consomment.

| Fixture | Contenu | Produit par |
|---|---|---|
| `simple.xlsx` | Types variés : texte à espaces parasites, entiers, décimaux, zéro, dates, valeurs NA-like, colonne vide | SheetJS 0.18.5 |
| `empty-first-sheet.xlsx` | Feuille 1 vide, feuille 2 avec données — contrat « première feuille non vide » | SheetJS 0.18.5 |
| `dsp-campaign.xlsx` | Forme d'un export DSP : date, code postal, pays, régie, impressions, clics, dépense | SheetJS 0.18.5 |
| `legacy.xls` | Vrai binaire BIFF8, prouve que le refus du format est explicite | SheetJS 0.18.5 |
| `arcom-sheetjs.ods` | Référentiel radio Arcom : catégories valides, catégorie inconnue, fréquence illisible | SheetJS 0.18.5 |
| `arcom-libreoffice.ods` | Tics de LibreOffice : `table:number-columns-repeated`, `table:number-rows-repeated`, `text:p` multiples dans une cellule, `office:value` distinct du texte affiché, ligne vide, millier de cellules de padding | fabriqué à la main (jszip) |

## Pourquoi SheetJS comme générateur

Les fixtures `.xlsx` ont été écrites avec SheetJS **avant** son retrait du
projet (2026-09), volontairement : un fichier produit par le lecteur qu'on
teste ne peut pas révéler ses propres angles morts. Elles sont figées et
n'ont pas besoin d'être régénérées.

`arcom-libreoffice.ods` a été fabriqué à la main parce que SheetJS écrit un
ODS beaucoup plus régulier que LibreOffice : sans ça, le lecteur maison
n'aurait jamais rencontré les colonnes répétées ni les paragraphes multiples.

## Limite connue

Aucune fixture ne provient d'Excel ni de LibreOffice pour de vrai. Le
premier import du fichier Arcom officiel après cette migration reste à
vérifier en conditions réelles.
