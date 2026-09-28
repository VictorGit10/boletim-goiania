"""Fontes de OBSERVAÇÃO para um dia local já encerrado.

Cada função devolve {"tmax", "tmin", "umid_min", "chuva", "n_obs", "horario": {"t", "temp"}} ou lança exceção.
"""
import math
from datetime import date, datetime, timedelta, timezone

from comum import TZ, http_json, r1


def _umidade(t, td):
    """Umidade relativa (%) a partir de temperatura e ponto de orvalho (Magnus)."""
    a, b = 17.625, 243.04
    return 100 * math.exp(a * td / (b + td)) / math.exp(a * t / (b + t))


def metar_sbgo(dia: date):
    """Aeroporto Santa Genoveva (SBGO). Temperatura horária; METAR não informa chuva acumulada."""
    obs = http_json("https://aviationweather.gov/api/data/metar?ids=SBGO&hours=72&format=json")
    ini = datetime.combine(dia, datetime.min.time(), TZ)
    fim = ini + timedelta(days=1)
    pts = {}
    for o in obs:
        quando = datetime.fromtimestamp(o["obsTime"], timezone.utc).astimezone(TZ)
        if ini <= quando < fim and o.get("temp") is not None:
            pts[quando] = o  # SPECI no mesmo minuto sobrescreve, sem duplicar
    horas = sorted(pts)
    if len({h.hour for h in horas}) < 20:
        raise RuntimeError(f"METAR incompleto para {dia}: {len(horas)} observações")
    temps = [pts[h]["temp"] for h in horas]
    umids = [_umidade(pts[h]["temp"], pts[h]["dewp"]) for h in horas if pts[h].get("dewp") is not None]
    return {
        "tmax": r1(max(temps)), "tmin": r1(min(temps)),
        "umid_min": round(min(umids)) if umids else None,
        "chuva": None, "n_obs": len(horas),
        "horario": {"t": [h.strftime("%Y-%m-%dT%H:%M") for h in horas], "temp": temps},
        "brutos": [pts[h]["rawOb"] for h in horas],
    }


def inmet_a002(dia: date, token: str):
    """Estação automática INMET Goiânia (A002). Exige token (pedir a cadastro.act@inmet.gov.br).

    Os registros horários vêm em UTC e cada um fecha a hora (HR_MEDICAO=1300 cobre 12–13 UTC).
    O dia local vai de 03 UTC do dia até 03 UTC do dia seguinte.
    """
    url = f"https://apitempo.inmet.gov.br/token/estacao/{dia}/{dia + timedelta(days=1)}/A002/{token}"
    regs = http_json(url, timeout=90)
    ini = datetime.combine(dia, datetime.min.time(), TZ)
    fim = ini + timedelta(days=1)

    def num(x):
        try:
            return float(x)
        except (TypeError, ValueError):
            return None

    sel = []
    for r in regs:
        quando = datetime.strptime(f"{r['DT_MEDICAO']} {r['HR_MEDICAO'][:4]}", "%Y-%m-%d %H%M").replace(tzinfo=timezone.utc).astimezone(TZ)
        if ini < quando <= fim:
            sel.append((quando, r))
    sel.sort(key=lambda x: x[0])
    tmax = [num(r.get("TEM_MAX")) for _, r in sel]
    tmin = [num(r.get("TEM_MIN")) for _, r in sel]
    chuva = [num(r.get("CHUVA")) for _, r in sel]
    umid = [num(r.get("UMD_MIN")) for _, r in sel]
    validos = [x for x in tmax if x is not None]
    if len(validos) < 20:
        raise RuntimeError(f"A002 incompleta para {dia}: {len(validos)} horas válidas")
    return {
        "tmax": r1(max(validos)),
        "tmin": r1(min(x for x in tmin if x is not None)),
        "umid_min": min((x for x in umid if x is not None), default=None),
        "chuva": r1(sum(x for x in chuva if x is not None)),
        "n_obs": len(validos),
        "horario": {"t": [q.strftime("%Y-%m-%dT%H:%M") for q, _ in sel], "temp": [num(r.get("TEM_INS")) for _, r in sel]},
    }
