"""Simulateur d'ad server de la démo, porté bit à bit (phase 1.5, plan § 4.1 et § 12).

OUTIL DE VALIDATION, pas un module du service : la phase 3 s'en sert pour comparer les formules de correction sur une
délivrance reproductible. Il vit sous `tests/` à dessein — le cahier des charges interdit toute donnée ou mode de
démonstration dans les connecteurs, et rien sous `src/` ne doit pouvoir l'importer.
"""
