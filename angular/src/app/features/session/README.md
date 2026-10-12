# session — organisations de l'utilisateur

**Rôle** : pas un écran, un service d'API partagé par la coquille et la carte. `OrganisationsApi`
(`data/organisations.api.ts`) lit les organisations accessibles (`GET /api/user/organizations`) et change
l'organisation active (`POST /api/user/switch-org`).

**Route** : aucune. Fourni par `FOURNISSEURS_DISTANTS` (`app.routes.ts`), consommé par `mg-badge-session`
(`layout/badge-session.component.ts`), monté dans le chrome de la coquille et dans la barre de la carte.

**Particularité** : après un changement d'organisation, React recharge la fenêtre ; dans un hôte, cela
rechargerait le SHELL. La coquille recrée à la place la page courante, sans toucher à l'URL.
