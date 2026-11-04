"""Noyau PUR de l'optimisation.

Aucune entrée/sortie : ni base (psycopg), ni réseau (httpx), ni horloge (time, datetime), ni hasard
(random), ni `sum(` (sommation compensée depuis Python 3.12, différente du `reduce` JS). Une même entrée
rend toujours la même sortie — c'est ce qui permet de rejouer un cycle et de comparer des empreintes.
`tests/noyau/test_purete.py` le vérifie sur chaque fichier de ce paquet.
"""
