"""Le plan d'un jeu de ZONE en multiplicateur d'enchère (A1, séquence E4) et son plan CP par unité — port de
`lib/zones/plan.ts` (`planMultiplicateur`, `bornerMultiplicateur`) et `lib/zones/plan-jeu-zone.ts` (`planCpDeZone`,
`plansParPlateforme`).

Séquence E4, la même que la correction quotidienne (`docs/rebid-v2.md` § 2.4) :

    (1) brut(u)  = part(u) × poids de classe(u)          unités retenues seulement
    (2) m(u)     = brut(u) ÷ moyenne(brut)                moyenne arithmétique NON PONDÉRÉE = 1
    (3) m(u)     = clamp(m(u), bornes du mécanisme)       puis arrondi au millième (`numeric(6,3)`)
    (4) pas de renormalisation après écrêtage

Les unités CP (groupes de codes indiscernables, A2) sont ensuite DÉVELOPPÉES en codes selon la règle du registre
(`meme` répète, `divise` partage puis re-borne), et le bilan compte en UNITÉS.
"""

from collections.abc import Iterable

from optimisation.noyau.nombres import arrondi_js, somme_gauche
from optimisation.noyau.part_prevue import REPARTITION_GROUPE, VOLUME_ATTENDU, parts_prevues
from optimisation.noyau.regroupement import CLASSE_HORS, CpAgrege, regrouper_par_code_postal, taux_utile
from optimisation.noyau.types import (
    Ajustement,
    BilanMultiplicateur,
    BilanMultiplicateurZone,
    Bornes,
    CodeAjustement,
    CpZone,
    HorsZonePrevue,
    Jeu,
    LigneCouverture,
    LignePlan,
    LignePlanZone,
    MembresParCanonique,
    ModePlan,
    Plan,
    PlanZone,
    ReglagePlan,
    UnitePrevue,
    VolumesAttendus,
)

# Plafond de `bidding_zone_configs.bid_multiplier` (`numeric(6,3)`).
MULT_MAX = 999.999
# Plancher d'un multiplicateur NON NUL : un zéro d'arrondi devient 0,001, un zéro décidé reste zéro.
MULT_MIN_NON_NUL = 0.001
# Mode national : poids hors zone = ce facteur × le plus petit multiplicateur envoyé (`docs/rebid-v2.md` D7, § 3.2).
FACTEUR_HORS_ZONE_NATIONAL = 0.8
CODE_HORS_ZONE = "HORS_ZONE"
NORMALISATION_PLAN = "non_ponderee"
# La classe unique des codes postaux retenus d'un jeu de zone.
CLASSE_ZONE = "zone"

BORNES_TECHNIQUES = Bornes(min=MULT_MIN_NON_NUL, max=MULT_MAX)

JournalBornes = dict[CodeAjustement, Ajustement]


def _millieme(valeur: float) -> float:
    """`Math.round(valeur * 1000) / 1000`."""
    return arrondi_js(valeur, 3)


def borner_multiplicateur(m: float, bornes: Bornes, journal: JournalBornes) -> float:
    """`bornerMultiplicateur` : ramène à la plage PUIS arrondit au millième ; une borne franchie est consignée."""
    if bornes.min <= m <= bornes.max:
        return _millieme(m)
    code: CodeAjustement = "multiplicateur_min" if m < bornes.min else "multiplicateur_max"
    limite = bornes.min if code == "multiplicateur_min" else bornes.max
    calcule = _millieme(m)
    deja = journal.get(code)
    if deja is None:
        valeur = calcule
    elif code == "multiplicateur_min":
        valeur = min(deja["valeur"], calcule)
    else:
        valeur = max(deja["valeur"], calcule)
    # Une clé déjà présente garde sa place (ordre d'insertion d'une `Map` JS, comme d'un `dict`).
    journal[code] = {"code": code, "limite": limite, "valeur": valeur, "n": (deja["n"] if deja else 0) + 1}
    return _millieme(limite)


def moyenne_millieme(valeurs: list[float]) -> float | None:
    return _millieme(somme_gauche(valeurs) / len(valeurs)) if valeurs else None


def plan_multiplicateur(cps: list[CpAgrege], exclusif: bool, bornes: Bornes) -> Plan:
    """`planMultiplicateur` : seules les unités retenues entrent au plan, dans les deux modes ; le mode ne joue que sur
    la ligne `HORS_ZONE` (exclusif → `strict`, 0 ; pondéré → `national`, plancher)."""

    def en_plan(cp: CpAgrege) -> bool:
        return cp.retenu and cp.classe != CLASSE_HORS

    # (1) le brut des unités retenues à population connue
    bruts: list[float | None] = []
    for cp in cps:
        part = cp.pop_en_zone / cp.pop_totale if cp.pop_totale > 0 else None
        bruts.append(part * cp.poids if en_plan(cp) and part is not None else None)
    connus = [b for b in bruts if b is not None]
    moyenne_brut = somme_gauche(connus) / len(connus) if connus else 0.0

    journal: JournalBornes = {}
    normalises: list[float] = []
    envoyes: list[float] = []
    lignes: list[LignePlan] = []
    for cp, b in zip(cps, bruts, strict=True):
        # (2) normalisé ; une unité retenue sans part : le neutre × son poids
        if not en_plan(cp):
            m = 0.0
        elif b is None:
            m = cp.poids
        else:
            m = b / moyenne_brut if moyenne_brut > 0 else 0.0
        # (3) écrêté puis arrondi ; un zéro décidé reste zéro
        multiplicateur = borner_multiplicateur(m, bornes, journal) if m > 0 else 0.0
        if en_plan(cp) and b is not None:
            normalises.append(m)
            envoyes.append(multiplicateur)
        lignes.append(
            {
                "code_postal": cp.code_postal,
                "part_plan": 0.0,
                "multiplicateur": multiplicateur,
                "multiplicateur_calcule": m,
                "classe": cp.classe,
                "retenu": cp.retenu,
            }
        )
    # `part_plan` = m ÷ Σ m, la part qu'avait le multiplicateur ; ce n'est PAS la part prévue (A8).
    total = somme_gauche(ligne["multiplicateur"] for ligne in lignes)
    for ligne in lignes:
        ligne["part_plan"] = ligne["multiplicateur"] / total if total > 0 else 0.0

    positifs = [ligne["multiplicateur"] for ligne in lignes if ligne["multiplicateur"] > 0]
    plancher = max(MULT_MIN_NON_NUL, _millieme(FACTEUR_HORS_ZONE_NATIONAL * min(positifs))) if positifs else 0.0
    ajustements = list(journal.values())
    # Le poids de classe de HORS_ZONE dans l'échelle des bruts (A8) : le plancher avant normalisation et écrêtage.
    bruts_positifs = [b for b in connus if b > 0]
    classe_hors_zone = 0.0 if exclusif or not bruts_positifs else FACTEUR_HORS_ZONE_NATIONAL * min(bruts_positifs)

    bilan: BilanMultiplicateur = {
        "normalisation": "non_ponderee",
        "bornes": {"min": bornes.min, "max": bornes.max},
        "moyenne_avant_ecretage": moyenne_millieme(normalises),
        "moyenne_apres_ecretage": moyenne_millieme(envoyes),
        "n_ecretes": somme_entiere(a["n"] for a in ajustements),
        "ajustements": ajustements,
        "hors_zone": {
            "code": "HORS_ZONE",
            "mode": "strict" if exclusif else "national",
            "multiplicateur": 0.0 if exclusif else plancher,
            "part": 1,
            "classe": classe_hors_zone,
        },
    }
    return {
        "lignes": lignes,
        # Tout le plan tombe en zone par construction ; `None` quand il est vide.
        "part_plan_en_zone": 100.0 if total > 0 else None,
        "taux_utile": taux_utile(cps),
        "n_retenus": len([c for c in cps if c.retenu]),
        "multiplicateur": bilan,
    }


def somme_entiere(valeurs: Iterable[int]) -> int:
    total = 0
    for v in valeurs:
        total = total + v
    return total


def est_retenue(ligne: LigneCouverture, seuil: float) -> bool:
    """`estRetenue` (`lib/zones/conversion.ts`) : part non arrondie > 0 et ≥ seuil ; part inconnue → `incluse`.

    Une comparaison, dupliquée ici parce que l'extraction recalcule le plan à partir de la couverture et du seuil de la
    plateforme (signature de `planCpDeZone`) ; l'écran ⑤ garde la sienne. Les deux sont tenues par les fixtures.
    """
    if ligne.part_brute is None:
        return ligne.incluse is True
    return ligne.part_brute > 0 and ligne.part_brute >= seuil


def membres_de(ligne: LigneCouverture | None, code: str, groupes: MembresParCanonique) -> tuple[str, ...]:
    """`membresDe` : les membres déclarés par la ligne (sql/304), sinon le groupe `cp_groupe`, sinon le code seul."""
    if ligne is not None and ligne.membres:
        return ligne.membres
    groupe = groupes.get(code)
    return tuple(groupe) if groupe is not None else (code,)


def plan_cp_de_zone(
    lignes: list[LigneCouverture],
    seuil: float,
    mode_plan: ModePlan,
    groupes: MembresParCanonique,
    codes_exacts: list[str] | None = None,
    reglage: ReglagePlan | None = None,
    volumes: VolumesAttendus | None = None,
) -> PlanZone:
    """`planCpDeZone` : le plan CP d'un jeu de zone (voir l'en-tête du fichier TS pour chaque règle)."""
    reglage = reglage or ReglagePlan()
    # Code → unité : les membres que la couverture déclare, complétés par `cp_groupe`.
    canonique_de: dict[str, str] = {}
    for code, membres in groupes.items():
        for m in membres:
            canonique_de[m] = code
    for ligne in lignes:
        for m in membres_de(ligne, ligne.code, groupes):
            canonique_de[m] = ligne.code

    liste: dict[str, None] | None = None  # un `Set` JS : ordre d'insertion, sans doublon
    if codes_exacts is not None:
        liste = {canonique_de.get(c, c): None for c in codes_exacts}
    sources: list[LigneCouverture] = list(lignes)
    codes_couverture = {ligne.code for ligne in lignes}
    for code in liste or {}:
        if code not in codes_couverture:
            sources.append(LigneCouverture(code=code, pop_en_zone=0.0, pop_totale=None, part=None, part_brute=None))

    cps: list[CpZone] = []
    for ligne in sources:
        retenu = (ligne.code in liste) if liste is not None else est_retenue(ligne, seuil)
        cps.append(
            CpZone(
                code_postal=ligne.code,
                classe=CLASSE_ZONE if retenu else CLASSE_HORS,
                pop_en_zone=ligne.pop_en_zone if ligne.pop_en_zone is not None else 0.0,
                pop_totale=ligne.pop_totale if ligne.pop_totale is not None else 0.0,
                retenu=retenu,
            )
        )
    bornes = reglage.bornes or BORNES_TECHNIQUES
    divise = reglage.poids_groupe_cp == "divise"
    # Sans groupes : une ligne de plan par UNITÉ, un multiplicateur (A2) ; sémantique multiplicateur (A1).
    exclusif = mode_plan == "exclusif"
    plan = plan_multiplicateur(regrouper_par_code_postal(cps, Jeu(mode_plan=mode_plan, poids={})), exclusif, bornes)
    par_code: dict[str, LigneCouverture] = {ligne.code: ligne for ligne in sources}

    def membres_de_code(code: str) -> tuple[str, ...]:
        return membres_de(par_code.get(code), code, groupes)

    # Ce que reçoit chaque CODE d'une unité : la règle de groupe, puis l'écrêtage — UNE fois par unité.
    journal: JournalBornes = {}
    par_code_envoye: dict[str, float] = {}
    effectifs: list[float] = []
    for lp in plan["lignes"]:
        if lp["multiplicateur"] <= 0:
            continue
        n = len(membres_de_code(lp["code_postal"])) if divise else 1
        v = borner_multiplicateur(lp.get("multiplicateur_calcule", lp["multiplicateur"]) / n, bornes, journal)
        par_code_envoye[lp["code_postal"]] = v
        source = par_code.get(lp["code_postal"])
        if source is not None and source.pop_totale is not None and source.pop_totale > 0:
            effectifs.append(v * n)
    bilan = plan["multiplicateur"]

    # A8 : la part prévue, découplée du multiplicateur — unités retenues seulement, plus HORS_ZONE (D35).
    def volume_de(c: CpZone) -> float | None:
        v = volumes.par_code.get(c.code_postal) if volumes is not None else c.pop_totale
        return v if v is not None and v > 0 else None

    unites_prevues = [
        UnitePrevue(
            code=c.code_postal,
            membres=membres_de_code(c.code_postal),
            part=c.pop_en_zone / c.pop_totale if c.pop_totale > 0 else None,
            volume=volume_de(c),
            classe=1.0,
        )
        for c in cps
        if c.retenu
    ]
    volume_hors_zone: float | None = None
    if volumes is not None:
        volume_hors_zone = max(
            0.0, volumes.total - somme_gauche(u.volume if u.volume is not None else 0.0 for u in unites_prevues)
        )
    prevues = parts_prevues(
        unites_prevues, HorsZonePrevue(part=1.0, volume=volume_hors_zone, classe=bilan["hors_zone"]["classe"])
    )

    developpe: list[LignePlanZone] = []
    for lp in plan["lignes"]:
        canonique = lp["code_postal"]
        for code_postal in membres_de_code(canonique):
            source = par_code.get(canonique) if code_postal == canonique else None
            developpe.append(
                {
                    "code_postal": code_postal,
                    "code_canonique": canonique,
                    "classe": lp["classe"],
                    "retenu": lp["retenu"],
                    "multiplicateur": par_code_envoye.get(canonique, 0.0),
                    "pop_en_zone": source.pop_en_zone if source is not None else None,
                    "pop_totale": source.pop_totale if source is not None else None,
                    "part_en_zone": source.part if source is not None else None,
                    "part_prevue": prevues.par_code.get(code_postal) if lp["retenu"] else None,
                }
            )

    ajustements = list(journal.values())
    multiplicateur: BilanMultiplicateurZone = {
        "normalisation": bilan["normalisation"],
        "bornes": bilan["bornes"],
        "moyenne_avant_ecretage": bilan["moyenne_avant_ecretage"],
        # UNE unité de compte pour tout le bilan : l'UNITÉ CP. Moyenne des poids effectifs des unités.
        "moyenne_apres_ecretage": moyenne_millieme(effectifs),
        "n_ecretes": somme_entiere(a["n"] for a in ajustements),
        "ajustements": ajustements,
        "hors_zone": {
            **bilan["hors_zone"],
            "volume": volume_hors_zone,
            "univers": (volumes.univers or "FR") if volumes is not None else None,
            "part_prevue": prevues.hors_zone,
        },
        "unite_de_compte": "unite_cp",
        "poids_groupe_cp": reglage.poids_groupe_cp or "meme",
    }
    return {
        "lignes": developpe,
        "resume": {
            "n_cp": len(cps),
            "n_retenus": plan["n_retenus"],
            "n_codes": len([ligne for ligne in developpe if ligne["multiplicateur"] > 0]),
            "taux_utile": plan["taux_utile"],
            "part_plan_en_zone": plan["part_plan_en_zone"],
            "population_exposee": somme_gauche(c.pop_en_zone for c in cps if c.retenu),
            "multiplicateur": multiplicateur,
            "part_prevue": {
                "volume_attendu": VOLUME_ATTENDU,
                "unite_de_somme": "unite_cp",
                "repartition_groupe": REPARTITION_GROUPE,
                "hors_zone": prevues.hors_zone,
                "unites_sans_part": len([p for p in prevues.par_unite.values() if p is None]),
            },
        },
    }
