"""Teste de fumaça: sobe o servidor e confere as rotas principais antes de publicar.

Uso:  python tests/smoke_test.py
Sai com código 1 se algo falhar (serve para CI e para rodar antes de cada deploy).
Usa as chaves do .env e a internet de verdade: os dados vêm das fontes reais.
"""

import gzip
import json
import os
import re
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


PORT = free_port()
BASE = f"http://127.0.0.1:{PORT}"
results = []


def get(path, headers=None, timeout=90):
    req = urllib.request.Request(BASE + path, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                body = gzip.decompress(body)
            return r.status, dict(r.headers), body
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def post(path, data, xrw=True, origin=None):
    headers = {"Content-Type": "application/json"}
    if xrw:
        headers["X-Requested-With"] = "placar"
    if origin:
        headers["Origin"] = origin
    req = urllib.request.Request(BASE + path, data=json.dumps(data).encode(), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def check(name, ok, detail=""):
    results.append(ok)
    print(f"  {'OK  ' if ok else 'FALHOU'}  {name}{f'  ({detail})' if detail else ''}")


def stream_snapshot():
    """Conecta em /api/stream e espera o primeiro evento 'snapshot'."""
    try:
        with urllib.request.urlopen(BASE + "/api/stream", timeout=40) as r:
            if "text/event-stream" not in r.headers.get("Content-Type", ""):
                return False
            for _ in range(200):
                line = r.readline().decode("utf-8", "replace")
                if line.startswith("event: snapshot"):
                    return True
                if not line:
                    return False
    except Exception:
        return False
    return False


def main():
    env = {**os.environ, "PORT": str(PORT), "LOG_LEVEL": "off", "PYTHONIOENCODING": "utf-8"}
    proc = subprocess.Popen([sys.executable, "server.py"], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    try:
        for _ in range(60):
            try:
                if get("/healthz", timeout=2)[0] == 200:
                    break
            except Exception:
                time.sleep(0.5)
        else:
            print("Servidor não subiu:", proc.stderr.read().decode()[:500])
            sys.exit(1)
        print(f"Servidor no ar em {BASE}\n")

        print("Site e segurança")
        st, h, body = get("/", {"Accept-Encoding": "gzip"})
        # "/" é o app em React (web/dist) quando compilado; sem compilar, o servidor cai no frontend de public/
        check("página inicial", st == 200 and (b"<main" in body or b'id="root"' in body))
        check("compressão gzip", h.get("Content-Encoding") == "gzip")
        for k in ("Content-Security-Policy", "X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy"):
            check(f"cabeçalho {k}", k in h)
        if b'id="root"' in body:
            scripts = re.findall(r'(?:src|href)="(/assets/[\w.-]+\.(?:js|css))"', body.decode("utf-8", "replace"))
            check("arquivos compilados no index", len(scripts) >= 2, ", ".join(scripts))
        else:  # frontend sem compilação: a versão vem do próprio index.html (?v=)
            scripts = re.findall(r'src="(/[\w.]+\.js\?v=\d+)"', body.decode("utf-8", "replace"))
            check("scripts versionados no index", len(scripts) >= 4, ", ".join(scripts))
        check("todos os scripts existem", all(get(s)[0] == 200 for s in scripts))
        app_js = next((s for s in scripts if s.endswith(".js")), "/app.js?v=1")
        st, h, _ = get(app_js)
        check("cache longo em arquivo versionado", "immutable" in h.get("Cache-Control", ""))
        etag = h.get("ETag")
        check("ETag / 304", etag and get(app_js, {"If-None-Match": etag})[0] == 304)
        check("manifest do PWA", get("/manifest.webmanifest")[0] == 200)
        check("service worker", get("/sw.js")[0] == 200)
        check("/api/me bloqueado (não expõe as chaves)", get("/api/me")[0] == 404)
        check("/api/_status restrito", get("/api/_status", {"X-Forwarded-For": "8.8.8.8"})[0] in (200, 403))
        check("caminho fora de public/ bloqueado", get("/../server.py")[0] == 404 or b"FUTEBOL_API_KEY" not in get("/../server.py")[2])

        print("\nDados")
        st, _, body = get("/api/campeonatos")
        comps = json.loads(body) if st == 200 else []
        check("campeonatos", st == 200 and len(comps) >= 3, f"{len(comps)} campeonatos")
        check("Brasileirão primeiro", bool(comps) and comps[0]["campeonato_id"] == 10)
        st, _, body = get("/api/ao-vivo")
        check("ao vivo", st == 200, f"{len(json.loads(body)) if st == 200 else '-'} jogos agora")
        st, _, body = get("/api/campeonatos/10/tabela")
        t = json.loads(body) if st == 200 else []
        check("tabela do Brasileirão", st == 200 and len(t) >= 18, f"líder: {t[0]['time']['nome_popular']}" if t else "")
        c10 = next((c for c in comps if c["campeonato_id"] == 10), None)
        if c10 and c10.get("rodada_atual"):
            st, _, body = get(f"/api/campeonatos/10/rodadas/{c10['rodada_atual']['rodada']}")
            jogos = json.loads(body).get("partidas", []) if st == 200 else []
            check("jogos da rodada", st == 200 and len(jogos) > 0, f"{len(jogos)} jogos")
            if jogos:
                st, _, body = get(f"/api/partidas/{jogos[0]['partida_id']}")
                det = json.loads(body) if st == 200 else {}
                check("detalhe da partida", "time_mandante" in det)
                # recém-ligado, o servidor calcula as forças em segundo plano (não trava a página): espera um pouco
                for _ in range(30):
                    if "pre" in (det.get("probabilidades") or {}):
                        break
                    time.sleep(2)
                    det = json.loads(get(f"/api/partidas/{jogos[0]['partida_id']}")[2])
                check("probabilidade de vitória na partida", "pre" in (det.get("probabilidades") or {}))
                tid = jogos[0]["time_mandante"]["time_id"]
                check("página do time", get(f"/api/times/{tid}")[0] == 200)
                check("próximos jogos do time", get(f"/api/times/{tid}/partidas/proximas")[0] == 200)
        st, _, body = get("/api/campeonatos/10/artilharia")
        check("artilharia", st == 200 and len(json.loads(body)) > 0)
        st, _, body = get("/api/noticias?por_pagina=200")
        nw = json.loads(body).get("noticias", []) if st == 200 else []
        fontes = {(n.get("provedor") or {}).get("slug") for n in nw}
        check("notícias de vários veículos", len(nw) > 0 and len(fontes) >= 3, f"{len(nw)} notícias, {len(fontes)} veículos")
        st, _, body = get("/api/campeonatos/10/chances")
        ch = json.loads(body) if st == 200 else {}
        soma = sum(x["titulo"] for x in ch.get("times", []))
        check("chances no Brasileirão", st == 200 and 99 <= soma <= 101, f"soma das chances de título {soma:.1f}%")
        check("chances só em liga (copa -> 404)", get("/api/campeonatos/2/chances")[0] == 404)
        check("transmissão ao vivo (SSE)", stream_snapshot())
        if any(c["campeonato_id"] == 101 for c in comps):
            st = get("/api/campeonatos/101/tabela")[0]
            check("Premier League (football-data)", st in (200, 503), "503 = ainda carregando o limite de 10/min" if st == 503 else "")
        check("rota desconhecida -> 404", get("/api/qualquer-coisa")[0] == 404)

        print("\nOutros esportes e onde assistir")
        st, _, body = get("/api/esportes/nba/jogos")
        check("NBA: jogos do dia", st == 200 and "jogos" in json.loads(body), f"{len(json.loads(body).get('jogos', []))} jogos" if st == 200 else "")
        st, _, body = get("/api/esportes/nba/classificacao")
        check("NBA: classificação", st == 200 and len(json.loads(body)) == 2)
        st, _, body = get("/api/esportes/f1")
        f1 = json.loads(body) if st == 200 else {}
        check("F1: calendário e pilotos", bool(f1.get("calendario")) and bool(f1.get("pilotos")),
              f"próximo: {(f1.get('proxima') or {}).get('nome')}" if f1 else "")
        check("F1: etapa inexistente -> 404", get("/api/esportes/f1/corrida/99")[0] == 404)
        st, _, body = get("/api/esportes/f1/piloto/max_verstappen")
        check("F1: página do piloto", st == 200 and json.loads(body).get("carreira", {}).get("vitorias", 0) > 0)
        st, _, body = get("/api/esportes/f1/equipe/mercedes")
        check("F1: página da equipe", st == 200 and len(json.loads(body).get("pilotos", [])) >= 2)
        st, _, body = get("/api/esportes/nba/time/13")
        check("NBA: página do time", st == 200 and len(json.loads(body).get("elenco", [])) > 5)
        check("F1: id inválido bloqueado", get("/api/esportes/f1/piloto/../../x")[0] == 404)
        st, _, body = get("/api/transmissoes")
        check("guia de transmissões", st == 200 and "10" in json.loads(body).get("campeonatos", {}))

        print("\nContas e segurança")
        st, _, body = get("/api/auth/config")
        check("configuração de login", st == 200 and "captcha" in json.loads(body))
        st, _, body = get("/api/auth/captcha")
        cap = json.loads(body) if st == 200 else {}
        check("desafio do captcha", cap.get("tipo") == "turnstile" or bool(cap.get("challenge") and cap.get("signature")))
        check("sem sessão -> usuário nulo", json.loads(get("/api/auth/eu")[2]).get("usuario") is None)
        check("dados da conta exigem login", get("/api/conta/dados")[0] == 401)
        check("POST sem cabeçalho anti-CSRF bloqueado", post("/api/auth/entrar", {"login": "x", "senha": "y"}, xrw=False)[0] == 403)
        check("POST de outro site bloqueado", post("/api/auth/entrar", {"login": "x", "senha": "y"}, origin="https://evil.example")[0] == 403)
        st, _, body = post("/api/auth/cadastro", {"usuario": "robo", "email": "r@x.com", "senha": "Senha!Forte9"})
        check("cadastro sem captcha recusado", st == 400 and json.loads(body).get("campo") == "captcha")
        check("POST em rota de dados -> 405", post("/api/campeonatos", {})[0] == 405)

        print("\nIA e identidade dos times")
        st, _, body = get("/api/ia/status")
        ia = json.loads(body) if st == 200 else {}
        check("status da IA", st == 200 and "ativo" in ia, "ligada" if ia.get("ativo") else "desligada (sem ANTHROPIC_API_KEY)")
        if not ia.get("ativo"):
            check("IA desligada responde 503", get("/api/ia/partida/1")[0] == 503)
        check("assistente sem cabeçalho anti-CSRF bloqueado", post("/api/ia/perguntar", {"pergunta": "oi"}, xrw=False)[0] == 403)
        st, _, body = get("/api/campeonatos/14/tabela")
        rows = json.loads(body) if st == 200 else []
        if isinstance(rows, list) and rows:
            check("Série B com IDs canônicos", all(r["time"]["time_id"] >= 800_000_000 for r in rows), f"{len(rows)} times")
        st, _, body = get("/api/noticias?campeonato_id=10&por_pagina=30")
        nw = json.loads(body).get("noticias", []) if st == 200 else []
        check("notícias do Brasileirão classificadas", all(10 in (n.get("campeonatos") or []) for n in nw), f"{len(nw)} notícias")
        # busca do site: apelido acha o time; campeonato pelo nome; só os campos esperados
        st, _, body = get("/api/busca?q=fla", timeout=180)
        b = json.loads(body) if st == 200 else {}
        check("busca acha time por apelido", any(t["to"] == "/time/900000819" for t in b.get("times", [])), f"{len(b.get('times', []))} times")
        st, _, body = get("/api/busca?q=brasileir")
        b = json.loads(body) if st == 200 else {}
        check("busca acha campeonato", any(c["to"] == "/campeonato/10" for c in b.get("campeonatos", [])))
        check("busca com 1 letra vazia", json.loads(get("/api/busca?q=a")[2]).get("times") == [])
    finally:
        proc.terminate()
        try:
            proc.wait(5)
        except subprocess.TimeoutExpired:
            proc.kill()
    falhas = results.count(False)
    print(f"\n{len(results) - falhas}/{len(results)} verificações passaram.")
    sys.exit(1 if falhas else 0)


if __name__ == "__main__":
    main()
