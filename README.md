# Boletim do tempo · Goiânia

Boletim diário que junta várias previsões para Goiânia numa página só, **guarda o que cada fonte disse a cada dia** e, depois que o dia passa, compara com o que foi observado.

Tudo roda de graça no GitHub: um robô do Actions coleta os dados todo dia às 06h30 (Brasília), faz commit em `data/` e publica a página no GitHub Pages. Não precisa de servidor, banco de dados nem biblioteca Python além da padrão.

## Fontes

| Fonte | O quê | Como |
|---|---|---|
| **CEMPA-Cerrado** (UFG) | JULES-BRAMS 5 km, rodada 00Z, 10 dias a cada 30 min | Meteograma do município de Goiânia (`c0230`, média de 61 pontos da grade) em `tatu.cempa.ufg.br/HST_Meteogramas/`. O script baixa **só os bytes de Goiânia** do binário GrADS via HTTP Range (~90 KB em vez de 66 MB). |
| **INMET** | Previsão oficial por turno (máx., mín., umidade, resumo) | `apiprevmet3.inmet.gov.br/previsao/5208707` |
| **Open-Meteo** | 10 modelos globais: ECMWF IFS, ECMWF AIFS (IA), GFS, ICON, GEM, JMA, Météo-France, UKMO, CMA e a "melhor combinação" | `api.open-meteo.com`, sem chave |
| **Observado** | METAR do aeroporto Santa Genoveva (SBGO): temperatura e umidade horárias | `aviationweather.gov` |
| **Observado (opcional)** | Estação automática INMET A002: inclui **chuva** | Precisa de token (ver abaixo) |

> ⚠️ O servidor do CEMPA guarda só ~8 dias de rodadas. O histórico do CEMPA existe apenas porque este robô arquiva todo dia.

## Estrutura

```
coletor/
  coletar.py      orquestra: coleta → observado → verificação → índice
  previsoes.py    uma função por fonte de previsão (CEMPA, INMET, Open-Meteo)
  observado.py    METAR SBGO e estação INMET A002
  comum.py        fuso (UTC-3), HTTP com novas tentativas, JSON
site/             página estática (HTML/CSS/JS puro, sem dependências)
data/
  bruto/DIA/      resposta de cada fonte, arquivada sem alteração
  previsoes/DIA   previsões diárias normalizadas emitidas naquele dia
  horario/DIA     séries horárias (72 h) emitidas naquele dia
  observado/DIA   o que aconteceu naquele dia
  verificacao.json  previsto × observado (série, dia, antecedência)
  index.json      datas disponíveis
```

Regras que valem para todas as fontes:
- **Dia = 00h–24h de Brasília.** Nunca o dia UTC, que acaba às 21h e jogaria a chuva da noite no dia errado.
- **Arquivo bruto nunca é reescrito.** Se o robô rodar de novo no mesmo dia, as fontes que já deram certo são mantidas, e só as que falharam são tentadas outra vez. Use `--forcar` para refazer.
- **Uma fonte fora do ar não derruba as outras.** A falha fica registrada no JSON e aparece na página.

Detalhes do CEMPA: a chuva vem **acumulada** desde o início da rodada, e o script subtrai para obter a chuva de cada dia. A máxima diária é o maior valor da *média do município* ao longo do dia (o `T2Mmax` do arquivo é a máxima *entre pontos*, não no tempo).

## Rodar localmente

```bash
python coletor/coletar.py
```

```bash
python coletor/coletar.py --so-verificar
```

Para ver a página, monte a mesma pasta que o Actions publica e sirva:

```bash
mkdir -p _site && cp -r site/* _site/ && cp -r data _site/data && python -m http.server -d _site 8000
```

## Token do INMET (estação A002)

A API de observações do INMET exige token. Peça por e-mail a **cadastro.act@inmet.gov.br**, depois salve em *Settings → Secrets and variables → Actions → New repository secret* com o nome `INMET_TOKEN`. A partir daí, a estação A002 (com chuva) vira a referência do observado no lugar do METAR. O código dessa parte (`observado.inmet_a002`) segue o formato documentado da API, mas **ainda não foi testado com um token real**.

## Limitações conhecidas

- Sem o token do INMET não há chuva observada: o METAR não informa milímetros.
- O METAR mede de hora em hora, então a máxima observada pode ficar ~0,5 °C abaixo do pico real.
- Estação e aeroporto medem um ponto; o CEMPA dá a média do município; o Open-Meteo usa o ponto de grade mais próximo.
- O ranking de acerto só fica significativo depois de algumas semanas de dados.
