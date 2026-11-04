"""Le vérificateur SCRAM rejoue l'échange de la RFC 7677 (§ 3) : mot de passe « pencil », sel et itérations publiés."""

import base64
import hashlib
import hmac
import re

import pytest

from optimisation.outils.scram import cles, verificateur

SEL = base64.b64decode("W22ZaJ0SNY7soEsUEjb6gQ==")
MESSAGE = (
    "n=user,r=rOprNGfwEbeRWgbNEkqO,"
    "r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096,"
    "c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0"
).encode("ascii")
PREUVE_CLIENT = "dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ="
SIGNATURE_SERVEUR = "6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4="


def test_rfc7677_signature_serveur_et_preuve_client() -> None:
    client, stockee, serveur = cles("pencil", SEL, 4096)
    signature = hmac.new(serveur, MESSAGE, hashlib.sha256).digest()
    assert base64.b64encode(signature).decode() == SIGNATURE_SERVEUR
    signature_client = hmac.new(stockee, MESSAGE, hashlib.sha256).digest()
    preuve = bytes(a ^ b for a, b in zip(client, signature_client, strict=True))
    assert base64.b64encode(preuve).decode() == PREUVE_CLIENT


def test_format_postgres_et_sel_aleatoire() -> None:
    v = verificateur("Abc123")
    assert re.fullmatch(r"SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]{24}\$[A-Za-z0-9+/=]{44}:[A-Za-z0-9+/=]{44}", v)
    assert verificateur("Abc123") != v  # sel tiré à chaque appel
    assert "Abc123" not in v


@pytest.mark.parametrize("mdp", ["", "avec espace", "accentué", "tab\t"])
def test_refuse_ce_que_saslprep_pourrait_changer(mdp: str) -> None:
    with pytest.raises(ValueError, match="SASLprep"):
        verificateur(mdp)
