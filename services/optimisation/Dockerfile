# Service d'optimisation — image OCI unique (API ; l'ordonnanceur viendra à T11 sur la même image).
# Dépendances figées par uv.lock (uv sync --frozen) : l'image installe exactement ce que les tests ont vu.
FROM python:3.13-slim

COPY --from=ghcr.io/astral-sh/uv:0.13.1 /uv /usr/local/bin/uv

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH" \
    TZ=Europe/Paris

WORKDIR /app

# Couche des dépendances d'abord : elle ne se reconstruit que si le verrou change.
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-dev --no-install-project

COPY src ./src
RUN uv sync --frozen --no-dev

RUN useradd --system --uid 10001 optimisation
USER optimisation

EXPOSE 8090
# Un seul processus ; le « un calcul à la fois » est tenu dans le processus par `verrou_calcul` (api/plans.py).
CMD ["uvicorn", "optimisation.api.app:app", "--host", "0.0.0.0", "--port", "8090", "--workers", "1"]
