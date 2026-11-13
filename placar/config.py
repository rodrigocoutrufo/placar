"""Configuração central: caminhos do projeto, .env e constantes compartilhadas."""

import os
import sys
from datetime import timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent   # raiz do projeto
PUBLIC = ROOT / "public"                        # frontend
DATA = ROOT / "data"                            # dados editáveis versionados (ex.: transmissoes.json)

# Dependências opcionais instaladas localmente (pip install --target .deps -r requirements.txt): evita o limite
# de 260 caracteres de caminho do Python da Microsoft Store. Vem antes dos pacotes globais (só tem o SDK da
# Anthropic e as dependências dele), para uma instalação global quebrada não atrapalhar.
_DEPS = ROOT / ".deps"
if _DEPS.is_dir() and str(_DEPS) not in sys.path:
    sys.path.insert(1, str(_DEPS))


def load_env():
    """Lê o .env da raiz sem sobrescrever variáveis já definidas no ambiente (hospedagem)."""
    env_file = ROOT / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


load_env()

DATA_DIR = Path(os.environ.get("DATA_DIR") or ROOT / ".cache")  # cache, contas e contadores (disco persistente)
DATA_DIR.mkdir(parents=True, exist_ok=True)
BRT = timezone(timedelta(hours=-3))
