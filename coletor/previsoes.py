"""Fontes de PREVISÃO.

Cada função recebe a data de emissão (dia local da coleta) e devolve:
    bruto   -> o que foi baixado (para arquivar, sem mexer)
    series  -> {id: {"rotulo", "grupo", "dias": [{dia, tmax, tmin, chuva, prob, umid_min, resumo}]}}
    horario -> {id: {"rotulo", "t": [iso local], "temp": [...], "chuva": [...]}}
    extra   -> metadados (ex.: rodada do modelo)
"""
import re
import struct
from datetime import date, datetime, timedelta, timezone

from comum import LAT, LON, TZ, contexto_com_aia, http_get, http_json, r1

HORAS_HORARIO = 72  # quantas horas guardar no arquivo horário (a partir de 00h do dia de emissão)


def _dia_vazio(dia):
    return {"dia": dia, "tmax": None, "tmin": None, "chuva": None, "prob": None, "umid_min": None, "resumo": None}


# --------------------------------------------------------------------------- Open-Meteo

OM_MODELOS = {
    "best_match": "Open-Meteo (melhor combinação)",
    "ecmwf_ifs025": "ECMWF IFS",
    "ecmwf_aifs025_single": "ECMWF AIFS (IA)",
    "gfs_seamless": "GFS · NOAA",
    "icon_seamless": "ICON · DWD",
    "gem_seamless": "GEM · Canadá",
    "jma_seamless": "JMA · Japão",
    "meteofrance_seamless": "Météo-France",
    "ukmo_seamless": "UKMO · Reino Unido",
    "cma_grapes_global": "CMA · China",
}
OM_DIARIO = ["temperature_2m_max", "temperature_2m_min", "precipitation_sum",
             "precipitation_probability_max", "relative_humidity_2m_min"]
OM_HORARIO = ["temperature_2m", "precipitation"]


def openmeteo(emissao: date):
    modelos = ",".join(OM_MODELOS)
    base = (f"https://api.open-meteo.com/v1/forecast?latitude={LAT}&longitude={LON}"
            f"&models={modelos}&timezone=America%2FSao_Paulo")
    diario = http_json(base + "&daily=" + ",".join(OM_DIARIO) + "&forecast_days=10")
    ini_h = f"{emissao.isoformat()}T00:00"
    fim_h = (datetime.combine(emissao, datetime.min.time()) + timedelta(hours=HORAS_HORARIO - 1)).strftime("%Y-%m-%dT%H:%M")
    horario_raw = http_json(base + "&hourly=" + ",".join(OM_HORARIO) + f"&start_hour={ini_h}&end_hour={fim_h}")

    d = diario["daily"]
    series, horario = {}, {}
    for m, rotulo in OM_MODELOS.items():
        sid = f"om_{m}"
        dias = []
        for i, dia in enumerate(d["time"]):
            reg = _dia_vazio(dia)
            reg["tmax"] = r1(d.get(f"temperature_2m_max_{m}", [None] * 99)[i])
            reg["tmin"] = r1(d.get(f"temperature_2m_min_{m}", [None] * 99)[i])
            reg["chuva"] = r1(d.get(f"precipitation_sum_{m}", [None] * 99)[i])
            reg["prob"] = d.get(f"precipitation_probability_max_{m}", [None] * 99)[i]
            reg["umid_min"] = d.get(f"relative_humidity_2m_min_{m}", [None] * 99)[i]
            if reg["tmax"] is not None:
                dias.append(reg)
        if not dias:
            continue
        series[sid] = {"rotulo": rotulo, "grupo": "Global · via Open-Meteo", "dias": dias}

        h = horario_raw["hourly"]
        temps = h.get(f"temperature_2m_{m}")
        if temps and any(t is not None for t in temps):
            horario[sid] = {"rotulo": rotulo, "t": h["time"],
                            "temp": [r1(x) for x in temps],
                            "chuva": [r1(x) for x in h.get(f"precipitation_{m}", [])]}

    bruto = {"diario": diario, "horario": horario_raw}
    return bruto, series, horario, {}


# --------------------------------------------------------------------------- CEMPA-Cerrado

CEMPA_HOST = "tatu.cempa.ufg.br"
CEMPA_BASE = f"https://{CEMPA_HOST}/HST_Meteogramas/"
CEMPA_POLIGONO = "c0230"  # município de Goiânia (61 pontos da grade BRAMS 5 km)
# Ordem das 18 variáveis por passo de tempo, conforme o .ctl
CEMPA_VARS = ["u_max", "u_min", "u_ave", "v_max", "v_min", "v_ave",
              "t_max", "t_min", "t_ave", "q_max", "q_min", "q_ave",
              "slp_max", "slp_min", "slp_ave", "prec_max", "prec_min", "prec_ave"]


def _cempa_serie(rodada: str):
    """Baixa só os bytes de Goiânia do binário .gra (≈90 KB em vez de 66 MB)."""
    # O servidor do CEMPA envia o intermediário errado; completa a cadeia via AIA
    tls = contexto_com_aia(CEMPA_HOST)
    ctl = http_get(CEMPA_BASE + f"HST{rodada}.ctl", timeout=60, contexto=tls).decode("latin-1")
    nomes = [l.split()[0] for l in ctl.splitlines() if re.match(r"^c\d{4} ", l)]
    nv = len(nomes)
    nx = int(re.search(r"xdef\s+(\d+)", ctl).group(1))
    nt = int(re.search(r"tdef\s+(\d+)", ctl).group(1))
    assert nx == len(CEMPA_VARS), f"CEMPA mudou o formato: xdef={nx}"
    idx = nomes.index(CEMPA_POLIGONO)
    rec = nx * 4
    bloco = nv * rec

    partes = {}
    for a in range(0, nt, 40):  # o servidor recusa cabeçalhos Range muito longos
        faixas = ",".join(f"{t * bloco + idx * rec}-{t * bloco + idx * rec + rec - 1}" for t in range(a, min(a + 40, nt)))
        corpo = http_get(CEMPA_BASE + f"HST{rodada}.gra", headers={"Range": "bytes=" + faixas}, timeout=120, contexto=tls)
        for ini, dados in re.findall(rb"Content-Range: bytes (\d+)-\d+/\d+\r\n\r\n(.{%d})" % rec, corpo, re.S):
            partes[int(ini) // bloco] = struct.unpack(f"<{nx}f", dados)
    if len(partes) != nt:
        raise RuntimeError(f"CEMPA: esperava {nt} passos, vieram {len(partes)}")

    # O arquivo ASCII equivalente marca o 1º passo em +1800 s: passo t = rodada + (t+1)·30 min
    t0 = datetime.strptime(rodada, "%Y%m%d%H").replace(tzinfo=timezone.utc)
    serie = []
    for t in range(nt):
        v = dict(zip(CEMPA_VARS, partes[t]))
        quando = (t0 + timedelta(minutes=30 * (t + 1))).astimezone(TZ)
        serie.append({"t": quando, "temp": v["t_ave"] - 273.15, "tmax_pol": v["t_max"] - 273.15,
                      "tmin_pol": v["t_min"] - 273.15, "prec_acum": max(v["prec_ave"], 0.0),
                      "u": v["u_ave"], "v": v["v_ave"], "q": v["q_ave"], "slp": v["slp_ave"]})
    return serie


def cempa(emissao: date):
    # Rodada 00Z do dia; se ainda não saiu, a do dia anterior
    serie, rodada, erro = None, None, None
    for delta in (0, 1):
        rodada = (emissao - timedelta(days=delta)).strftime("%Y%m%d") + "00"
        try:
            serie = _cempa_serie(rodada)
            break
        except Exception as e:  # noqa: BLE001
            erro = e
    if serie is None:
        raise RuntimeError(f"CEMPA indisponível: {erro}")

    por_t = {p["t"]: p for p in serie}
    dias = []
    d, ultimo = serie[0]["t"].date(), serie[-1]["t"].date()
    while d <= ultimo:
        ini = datetime.combine(d, datetime.min.time(), TZ)
        fim = ini + timedelta(days=1)
        pts = [p for p in serie if ini < p["t"] <= fim]
        if len(pts) == 48:  # só dias locais completos (48 passos de 30 min)
            reg = _dia_vazio(d.isoformat())
            temps = [p["temp"] for p in pts]
            reg["tmax"], reg["tmin"] = r1(max(temps)), r1(min(temps))
            # chuva vem acumulada desde o início da rodada
            acum_ini = por_t[ini]["prec_acum"] if ini in por_t else 0.0
            reg["chuva"] = r1(por_t[fim]["prec_acum"] - acum_ini)
            dias.append(reg)
        d += timedelta(days=1)

    # Série horária a partir de 00h do dia de emissão
    ini = datetime.combine(emissao, datetime.min.time(), TZ)
    t_h, temp_h, chuva_h = [], [], []
    for h in range(HORAS_HORARIO):
        quando = ini + timedelta(hours=h)
        antes = quando - timedelta(hours=1)
        if quando in por_t:
            t_h.append(quando.strftime("%Y-%m-%dT%H:%M"))
            temp_h.append(r1(por_t[quando]["temp"]))
            chuva_h.append(r1(por_t[quando]["prec_acum"] - por_t[antes]["prec_acum"]) if antes in por_t else None)

    rotulo = "CEMPA-Cerrado · BRAMS 5 km"
    series = {"cempa": {"rotulo": rotulo, "grupo": "Regional · UFG", "dias": dias}}
    horario = {"cempa": {"rotulo": rotulo, "t": t_h, "temp": temp_h, "chuva": chuva_h}} if t_h else {}
    bruto = {"rodada": rodada, "poligono": CEMPA_POLIGONO,
             "serie": [{"t": p["t"].isoformat(), **{k: round(v, 3) for k, v in p.items() if k != "t"}} for p in serie]}
    return bruto, series, horario, {"rodada": rodada}


# --------------------------------------------------------------------------- INMET (previsão oficial)

INMET_GEOCODE = "5208707"  # Goiânia (IBGE)


def _sem_icones(obj):
    if isinstance(obj, dict):
        return {k: _sem_icones(v) for k, v in obj.items() if "icone" not in k}
    return obj


def _num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def inmet(emissao: date):
    dados = http_json(f"https://apiprevmet3.inmet.gov.br/previsao/{INMET_GEOCODE}", timeout=60)
    dados = _sem_icones(dados[INMET_GEOCODE])
    dias = []
    for dia_br, v in dados.items():
        dia = datetime.strptime(dia_br, "%d/%m/%Y").date().isoformat()
        turnos = [v[t] for t in ("manha", "tarde", "noite") if t in v] or [v]
        reg = _dia_vazio(dia)
        tmax = [_num(t.get("temp_max")) for t in turnos]
        tmin = [_num(t.get("temp_min")) for t in turnos]
        umid = [_num(t.get("umidade_min")) for t in turnos]
        reg["tmax"] = max((x for x in tmax if x is not None), default=None)
        reg["tmin"] = min((x for x in tmin if x is not None), default=None)
        reg["umid_min"] = min((x for x in umid if x is not None), default=None)
        if len(turnos) == 3:
            reg["resumo"] = " · ".join(f"{n}: {t.get('resumo', '').strip()}" for n, t in zip(("manhã", "tarde", "noite"), turnos))
        else:
            reg["resumo"] = turnos[0].get("resumo", "").strip()
        dias.append(reg)
    dias.sort(key=lambda r: r["dia"])
    series = {"inmet": {"rotulo": "INMET · previsão oficial", "grupo": "Oficial", "dias": dias}}
    return dados, series, {}, {}


FONTES = {"openmeteo": openmeteo, "cempa": cempa, "inmet": inmet}
