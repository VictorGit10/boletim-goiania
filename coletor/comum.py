"""Utilidades compartilhadas: fuso, caminhos, HTTP e JSON."""
import functools
import json
import ssl
import tempfile
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


@functools.lru_cache(maxsize=None)
def contexto_com_aia(host: str) -> ssl.SSLContext:
    """Contexto TLS para servidores que não enviam o certificado intermediário correto.

    Faz o que navegadores e o Windows fazem: lê no certificado do servidor o endereço
    "CA Issuers" (AIA), baixa o intermediário e o acrescenta à verificação. A cadeia
    continua sendo validada até uma raiz confiável do sistema.
    """
    ctx = ssl.create_default_context()
    # O intermediário vem por HTTP simples: ele não pode virar âncora de confiança sozinho.
    # Sem PARTIAL_CHAIN (ligado por padrão no Python 3.13+), a cadeia precisa chegar a uma raiz do sistema.
    ctx.verify_flags &= ~ssl.VERIFY_X509_PARTIAL_CHAIN

    def decodificar(pem: str) -> dict:
        with tempfile.NamedTemporaryFile("w", suffix=".pem", delete=False) as f:
            f.write(pem)
        try:
            return ssl._ssl._test_decode_cert(f.name)  # API interna estável; evita dependência externa
        finally:
            Path(f.name).unlink(missing_ok=True)

    try:
        folha = ssl.get_server_certificate((host, 443), timeout=30)
        for url in decodificar(folha).get("caIssuers", ()):
            with urllib.request.urlopen(url, timeout=30) as r:
                dados = r.read()
            pem = dados.decode("ascii") if dados.startswith(b"-----BEGIN") else ssl.DER_cert_to_PEM_cert(dados)
            inter = decodificar(pem)
            if inter["issuer"] == inter["subject"]:
                raise RuntimeError("intermediário autoassinado recusado")
            ctx.load_verify_locations(cadata=pem)
    except Exception as e:  # noqa: BLE001 - se falhar, segue com o contexto padrão
        print(f"  aviso: não consegui completar a cadeia TLS de {host}: {e}")
    return ctx


def http_get(url: str, headers: dict | None = None, timeout: int = 60, tentativas: int = 3,
             contexto: ssl.SSLContext | None = None) -> bytes:
    h = {"User-Agent": UA}
    h.update(headers or {})
    erro = None
    for i in range(tentativas):
        try:
            req = urllib.request.Request(url, headers=h)
            with urllib.request.urlopen(req, timeout=timeout, context=contexto) as r:
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
