# Placar — imagem de produção
# 1) compila o site (React + Vite)
FROM node:22-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web ./
RUN npm run build

# 2) servidor Python (biblioteca padrão)
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080 \
    DATA_DIR=/data

WORKDIR /app
RUN useradd --create-home --uid 10001 placar && mkdir -p /data && chown placar:placar /data
# dependência opcional (camada de IA); o resto do Placar usa só a biblioteca padrão
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY --chown=placar:placar server.py ./
COPY --chown=placar:placar placar ./placar
COPY --chown=placar:placar data ./data
COPY --chown=placar:placar public ./public
COPY --from=web --chown=placar:placar /web/dist ./web/dist

USER placar
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\", \"8080\")}/healthz', timeout=4)"

CMD ["python", "server.py"]
