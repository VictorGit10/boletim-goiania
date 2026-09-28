"""Coleta diária do boletim de Goiânia.

    python coletor/coletar.py                 # coleta de hoje (horário de Brasília)
    python coletor/coletar.py --forcar        # refaz fontes que já deram certo hoje
    python coletor/coletar.py --so-verificar  # só recalcula verificacao.json e index.json

Arquivos gerados em data/:
    bruto/AAAA-MM-DD/<fonte>.json   o que cada fonte devolveu (nunca reescrito sem --forcar)
    previsoes/AAAA-MM-DD.json       previsões diárias normalizadas emitidas nesse dia
    horario/AAAA-MM-DD.json         séries horárias (72 h) emitidas nesse dia
    observado/AAAA-MM-DD.json       o que aconteceu nesse dia
    verificacao.json                previsto × observado, uma linha por série/dia/antecedência
    index.json                      datas disponíveis
"""
import argparse
import os
import sys
import traceback
from datetime import date, timedelta

from comum import DADOS, agora_local, hoje_local, ler_json, salvar_json
from observado import inmet_a002, metar_sbgo
from previsoes import FONTES

DIAS_OBSERVADO = 3  # tenta completar o observado dos últimos N dias


def coletar_previsoes(emissao: date, forcar: bool) -> list[str]:
    arq_prev = DADOS / "previsoes" / f"{emissao}.json"
    arq_hor = DADOS / "horario" / f"{emissao}.json"
    prev = ler_json(arq_prev, {"emissao": str(emissao), "fontes": {}})
    hor = ler_json(arq_hor, {"emissao": str(emissao), "series": {}})
    falhas = []

    for nome, func in FONTES.items():
        ja_ok = prev["fontes"].get(nome, {}).get("status") == "ok"
        if ja_ok and not forcar:
            print(f"  {nome}: já coletado hoje, mantendo")
            continue
        try:
            bruto, series, horario, extra = func(emissao)
            salvar_json(DADOS / "bruto" / str(emissao) / f"{nome}.json", bruto, compacto=True)
            prev["fontes"][nome] = {"status": "ok", "coletado_em": agora_local().isoformat(timespec="seconds"),
                                    **extra, "series": series}
            hor["series"].update(horario)
            print(f"  {nome}: ok ({len(series)} série(s))")
        except Exception as e:  # noqa: BLE001 - uma fonte fora do ar não derruba as outras
            traceback.print_exc()
            falhas.append(nome)
            if not ja_ok:
                prev["fontes"][nome] = {"status": "erro", "erro": str(e)[:300],
                                        "coletado_em": agora_local().isoformat(timespec="seconds"), "series": {}}
            print(f"  {nome}: FALHOU ({e})")

    salvar_json(arq_prev, prev)
    salvar_json(arq_hor, hor, compacto=True)
    return falhas


def coletar_observado(hoje: date) -> None:
    token = os.environ.get("INMET_TOKEN", "").strip()
    for delta in range(1, DIAS_OBSERVADO + 1):
        dia = hoje - timedelta(days=delta)
        arq = DADOS / "observado" / f"{dia}.json"
        obs = ler_json(arq, {"dia": str(dia), "fontes": {}})
        fontes = {"metar_sbgo": lambda d: metar_sbgo(d)}
        if token:
            fontes["inmet_a002"] = lambda d: inmet_a002(d, token)
        mudou = False
        for nome, func in fontes.items():
            if nome in obs["fontes"]:
                continue
            try:
                obs["fontes"][nome] = func(dia)
                mudou = True
                print(f"  observado {dia} {nome}: ok")
            except Exception as e:  # noqa: BLE001
                print(f"  observado {dia} {nome}: indisponível ({e})")
        if mudou:
            # Referência: estação do INMET quando houver (tem chuva); senão, METAR do aeroporto
            obs["referencia"] = "inmet_a002" if "inmet_a002" in obs["fontes"] else "metar_sbgo"
            salvar_json(arq, obs)


def verificar() -> None:
    """Cruza cada dia observado com todas as previsões feitas para ele."""
    linhas = []
    for arq_obs in sorted((DADOS / "observado").glob("*.json")):
        obs = ler_json(arq_obs)
        ref = obs.get("referencia")
        if not ref or ref not in obs["fontes"]:
            continue
        o = obs["fontes"][ref]
        dia = date.fromisoformat(obs["dia"])
        for ant in range(0, 10):
            prev = ler_json(DADOS / "previsoes" / f"{dia - timedelta(days=ant)}.json")
            if not prev:
                continue
            for fonte in prev["fontes"].values():
                for sid, s in fonte.get("series", {}).items():
                    p = next((x for x in s["dias"] if x["dia"] == obs["dia"]), None)
                    if not p:
                        continue
                    linhas.append({"dia": obs["dia"], "serie": sid, "rotulo": s["rotulo"], "antecedencia": ant,
                                   "tmax": p["tmax"], "tmin": p["tmin"], "chuva": p["chuva"],
                                   "obs_tmax": o["tmax"], "obs_tmin": o["tmin"], "obs_chuva": o.get("chuva"),
                                   "obs_fonte": ref})
    salvar_json(DADOS / "verificacao.json", {"linhas": linhas}, compacto=True)
    print(f"  verificação: {len(linhas)} linhas")


def indexar() -> None:
    def datas(pasta):
        return sorted(p.stem for p in (DADOS / pasta).glob("*.json"))
    salvar_json(DADOS / "index.json", {"atualizado_em": agora_local().isoformat(timespec="seconds"),
                                       "emissoes": datas("previsoes"), "observados": datas("observado")})


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--forcar", action="store_true")
    ap.add_argument("--so-verificar", action="store_true")
    args = ap.parse_args()

    hoje = hoje_local()
    falhas = []
    if not args.so_verificar:
        print(f"Previsões emitidas em {hoje}:")
        falhas = coletar_previsoes(hoje, args.forcar)
        print("Observado:")
        coletar_observado(hoje)
    print("Verificação:")
    verificar()
    indexar()
    if len(falhas) == len(FONTES):
        print("Todas as fontes de previsão falharam.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
