"""Utilidades compartilhadas: fuso, caminhos, HTTP e JSON."""
import json
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

# Goiânia: centro aproximado da cidade
LAT, LON = -16.68, -49.25
# Brasília não tem horário de verão desde 2019: UTC-3 fixo
TZ = timezone(timedelta(hours=-3), "BRT")

RAIZ = Path(__file__).resolve().parent.parent
DADOS = RAIZ / "data"

UA = "Mozilla/5.0 (compatible; boletim-goiania/1.0; +https://github.com/)"


def agora_local() -> datetime:
    return datetime.now(TZ)


def hoje_local() -> date:
    return agora_local().date()


def http_get(url: str, headers: dict | None = None, timeout: int = 60, tentativas: int = 3) -> bytes:
    h = {"User-Agent": UA}
    h.update(headers or {})
    erro = None
    for i in range(tentativas):
        try:
            req = urllib.request.Request(url, headers=h)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                if r.status == 204:
                    raise RuntimeError(f"204 (sem conteúdo) em {url}")
                return r.read()
        except urllib.error.HTTPError as e:
            # 4xx não melhora com nova tentativa (exceto 429)
            if 400 <= e.code < 500 and e.code != 429:
                raise
            erro = e
        except Exception as e:  # noqa: BLE001 - rede instável, tenta de novo
            erro = e
        time.sleep(3 * (i + 1))
    raise RuntimeError(f"falhou após {tentativas} tentativas: {url} ({erro})")


def http_json(url: str, **kw):
    return json.loads(http_get(url, **kw).decode("utf-8"))


def ler_json(caminho: Path, padrao=None):
    if not caminho.exists():
        return padrao
    return json.loads(caminho.read_text(encoding="utf-8"))


def salvar_json(caminho: Path, obj, compacto: bool = False) -> None:
    caminho.parent.mkdir(parents=True, exist_ok=True)
    if compacto:
        txt = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    else:
        txt = json.dumps(obj, ensure_ascii=False, indent=1)
    caminho.write_text(txt + "\n", encoding="utf-8")


def r1(x):
    """Arredonda para 1 casa, preservando None."""
    return None if x is None else round(float(x), 1)
