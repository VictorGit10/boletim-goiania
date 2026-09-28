"use strict";

// Séries com cor própria no gráfico horário (ordem = ordem da paleta categórica)
const DESTAQUE = { cempa: "var(--s1)", om_best_match: "var(--s2)", om_ecmwf_ifs025: "var(--s3)" };
// Ordem de exibição nas tabelas
const ORDEM = ["cempa", "inmet", "om_best_match", "om_ecmwf_ifs025", "om_ecmwf_aifs025_single", "om_gfs_seamless",
  "om_icon_seamless", "om_ukmo_seamless", "om_meteofrance_seamless", "om_gem_seamless", "om_jma_seamless", "om_cma_grapes_global"];
const SVG = "http://www.w3.org/2000/svg";

const $ = (s) => document.querySelector(s);
const fmt1 = (x) => (x == null ? "–" : x.toLocaleString("pt-BR", { maximumFractionDigits: 1 }));
const fmt0 = (x) => (x == null ? "–" : Math.round(x).toLocaleString("pt-BR"));
const grau = (x) => (x == null ? "–" : `${fmt0(x)}°`);
const mediana = (xs) => {
  const v = xs.filter((x) => x != null).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const addDias = (iso, n) => {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const diaLongo = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
const diaCurto = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit" }).replace(".", "");
const ordemSerie = (id) => { const i = ORDEM.indexOf(id); return i < 0 ? 99 : i; };

function el(tag, attrs = {}, ...filhos) {
  const e = tag.startsWith("svg:") ? document.createElementNS(SVG, tag.slice(4)) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.setAttribute("class", v);
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const f of filhos.flat()) if (f != null) e.append(f instanceof Node ? f : document.createTextNode(f));
  return e;
}

async function carregar(caminho, opcional = false) {
  try {
    const r = await fetch(caminho, { cache: "no-cache" });
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } catch (e) {
    if (opcional) return null;
    throw e;
  }
}

// ------------------------------------------------------------------ tooltip
const tip = $("#tooltip");
function mostrarTip(ev, cabecalho, linhas) {
  tip.replaceChildren(el("div", { class: "tt-h", text: cabecalho }),
    ...linhas.map((l) => el("div", { class: "tt-l" },
      el("i", { style: `border-color:${l.cor || "transparent"}${l.pont ? ";border-top-style:dotted" : ""}` }),
      el("b", { text: l.valor }), el("span", { text: l.nome }))));
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  let x = ev.clientX + 14, y = ev.clientY + 14;
  if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - 14;
  if (y + r.height > innerHeight - 8) y = Math.max(8, innerHeight - r.height - 8);
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${y}px`;
}
const esconderTip = () => { tip.hidden = true; };

// ------------------------------------------------------------------ estado
let INDEX, VERIF;
const redesenhos = [];

async function iniciar() {
  try {
    INDEX = await carregar("data/index.json");
  } catch {
    $("#conteudo").replaceChildren(el("p", { class: "vazio", text: "Ainda não há dados coletados." }));
    return;
  }
  VERIF = (await carregar("data/verificacao.json", true)) || { linhas: [] };
  $("#atualizado").textContent = `Dados atualizados em ${new Date(INDEX.atualizado_em).toLocaleString("pt-BR")}.`;

  const sel = $("#data");
  for (const d of [...INDEX.emissoes].reverse()) sel.append(el("option", { value: d, text: diaLongo(d) }));
  sel.addEventListener("change", () => { location.hash = sel.value; });
  $("#ant").addEventListener("click", () => mover(-1));
  $("#prox").addEventListener("click", () => mover(1));
  addEventListener("hashchange", abrir);
  let t;
  addEventListener("resize", () => { clearTimeout(t); t = setTimeout(() => redesenhos.forEach((f) => f()), 120); });
  abrir();
}

function dataAtual() {
  const h = location.hash.slice(1);
  return INDEX.emissoes.includes(h) ? h : INDEX.emissoes[INDEX.emissoes.length - 1];
}
function mover(n) {
  const i = INDEX.emissoes.indexOf(dataAtual()) + n;
  if (i >= 0 && i < INDEX.emissoes.length) location.hash = INDEX.emissoes[i];
}

async function abrir() {
  const D = dataAtual();
  const i = INDEX.emissoes.indexOf(D);
  $("#data").value = D;
  $("#ant").disabled = i <= 0;
  $("#prox").disabled = i >= INDEX.emissoes.length - 1;

  const observado = (dia) => (INDEX.observados.includes(dia) ? carregar(`data/observado/${dia}.json`, true) : null);
  const [prev, hor, obsD, obsD1, obsOntem] = await Promise.all([
    carregar(`data/previsoes/${D}.json`),
    carregar(`data/horario/${D}.json`, true),
    observado(D),
    observado(addDias(D, 1)),
    observado(addDias(D, -1)),
  ]);

  const series = [];
  for (const [fonte, f] of Object.entries(prev.fontes)) {
    for (const [id, s] of Object.entries(f.series || {})) series.push({ id, fonte, ...s });
  }
  series.sort((a, b) => ordemSerie(a.id) - ordemSerie(b.id));
  const falhas = Object.entries(prev.fontes).filter(([, f]) => f.status !== "ok").map(([n]) => n);

  redesenhos.length = 0;
  const main = $("#conteudo");
  main.replaceChildren(
    secaoDestaque(D, series, obsD, falhas),
    secaoFaixas(D, series, obsD),
    secaoHoraria(D, hor, [obsD, obsD1]),
    secaoProximos(D, series),
    secaoOntem(addDias(D, -1), obsOntem),
    secaoRanking(),
  );
  redesenhos.forEach((f) => f());
}

function obsRef(obs) {
  if (!obs || !obs.referencia) return null;
  return { ...obs.fontes[obs.referencia], fonte: obs.referencia === "inmet_a002" ? "estação INMET A002" : "METAR aeroporto SBGO" };
}

// ------------------------------------------------------------------ 1. destaque
function icone(nome) {
  const caminhos = {
    gota: "M9 2.5C9 2.5 3.5 8.6 3.5 12a5.5 5.5 0 0 0 11 0C14.5 8.6 9 2.5 9 2.5z",
    alerta: "M9 2 1.5 15.5h15L9 2zm0 5v4m0 2.2v.3",
    umid: "M3 11h12M3 7h12M3 15h8",
    texto: "M3 4h12M3 8h12M3 12h8",
  };
  return el("svg:svg", { class: `ic${nome === "alerta" ? " ic-alerta" : ""}`, viewBox: "0 0 18 18", "aria-hidden": "true" },
    el("svg:path", { d: caminhos[nome], fill: nome === "gota" ? "currentColor" : "none", stroke: "currentColor", "stroke-width": "1.6", "stroke-linecap": "round", "stroke-linejoin": "round", opacity: nome === "gota" ? ".55" : "1" }));
}

function secaoDestaque(D, series, obsD, falhas) {
  const doDia = series.map((s) => ({ s, p: s.dias.find((x) => x.dia === D) })).filter((x) => x.p);
  const tmax = doDia.map((x) => x.p.tmax).filter((x) => x != null);
  const tmin = doDia.map((x) => x.p.tmin).filter((x) => x != null);
  const comChuva = doDia.filter((x) => x.p.chuva != null);
  const chovem = comChuva.filter((x) => x.p.chuva >= 1);
  const probs = doDia.map((x) => x.p.prob).filter((x) => x != null);
  const umid = mediana(doDia.map((x) => x.p.umid_min));
  const inmet = doDia.find((x) => x.s.id === "inmet");

  const fatos = [];
  let txtChuva;
  if (!comChuva.length) txtChuva = "Sem dados de chuva";
  else if (!chovem.length) txtChuva = `Nenhuma das ${comChuva.length} fontes prevê chuva de 1 mm ou mais`;
  else txtChuva = `${chovem.length} de ${comChuva.length} fontes preveem chuva (até ${fmt1(Math.max(...chovem.map((x) => x.p.chuva)))} mm)`;
  if (probs.length) txtChuva += ` · probabilidade máx. ${Math.max(...probs)}%`;
  fatos.push(el("li", {}, icone("gota"), el("div", {}, el("span", { class: "rot", text: "Chuva" }), txtChuva)));

  if (umid != null) {
    let nivel = null;
    if (umid < 12) nivel = "emergência (abaixo de 12%)";
    else if (umid < 20) nivel = "alerta (abaixo de 20%)";
    else if (umid < 30) nivel = "atenção (abaixo de 30%)";
    fatos.push(el("li", {}, icone(nivel ? "alerta" : "umid"),
      el("div", {}, el("span", { class: "rot", text: "Umidade mínima (mediana)" }),
        `${fmt0(umid)}%`, nivel ? ` · estado de ${nivel}` : "")));
  }
  if (inmet && inmet.p.resumo) {
    fatos.push(el("li", {}, icone("texto"), el("div", {}, el("span", { class: "rot", text: "INMET" }),
      el("span", { class: "resumo-inmet", text: inmet.p.resumo }))));
  }
  if (falhas.length) {
    fatos.push(el("li", {}, icone("alerta"), el("div", {}, el("span", { class: "rot", text: "Coleta" }),
      `Sem dados hoje de: ${falhas.join(", ")}`)));
  }

  const o = obsRef(obsD);
  return el("section", { style: "margin-top:0" },
    el("div", { class: "cartao destaque" },
      el("div", {},
        el("p", { class: "quando", text: `Previsão para ${diaLongo(D)}` }),
        el("div", { class: "numeros" },
          el("div", { class: "num" }, el("div", { class: "v" }, grau(mediana(tmax)), el("small", { text: "C" })), el("div", { class: "r", text: "máxima" })),
          el("div", { class: "num min" }, el("div", { class: "v" }, grau(mediana(tmin))), el("div", { class: "r", text: "mínima" }))),
        el("p", { class: "faixa", text: tmax.length
          ? `Mediana de ${doDia.length} fontes. Máxima entre ${grau(Math.min(...tmax))} e ${grau(Math.max(...tmax))}; mínima entre ${grau(Math.min(...tmin))} e ${grau(Math.max(...tmin))}.`
          : "Nenhuma fonte com previsão para este dia." }),
        o ? el("p", { class: "faixa" }, el("strong", { text: `Observado: ${grau(o.tmax)} / ${grau(o.tmin)}` }), ` (${o.fonte})`) : null),
      el("ul", { class: "fatos" }, fatos)));
}

// ------------------------------------------------------------------ 2. faixa mín–máx por fonte
function secaoFaixas(D, series, obsD) {
  const linhas = series.map((s) => ({ s, p: s.dias.find((x) => x.dia === D) })).filter((x) => x.p && x.p.tmax != null);
  const o = obsRef(obsD);
  const alvo = el("div");
  const sec = el("section", {},
    el("h2", { text: "Mínima e máxima por fonte" }),
    el("p", { class: "sub", text: o ? "Linhas tracejadas: o que foi observado." : "Cada barra vai da mínima à máxima prevista para o dia." }),
    el("div", { class: "cartao" }, alvo));

  redesenhos.push(() => {
    const W = alvo.clientWidth || 600;
    const estreito = W < 520;
    const esq = estreito ? 128 : 230, dir = 36, lh = 28, topo = 22;
    const H = topo + linhas.length * lh + 8;
    const vals = linhas.flatMap((x) => [x.p.tmin, x.p.tmax]).concat(o ? [o.tmin, o.tmax] : []).filter((x) => x != null);
    const lo = Math.floor((Math.min(...vals) - 1) / 2) * 2, hi = Math.ceil((Math.max(...vals) + 1) / 2) * 2;
    const x = (v) => esq + ((v - lo) / (hi - lo)) * (W - esq - dir);
    const svg = el("svg:svg", { class: "grafico", viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img",
      "aria-label": "Faixa de temperatura prevista por fonte" });
    const passo = (hi - lo) > 16 || estreito ? 4 : 2;
    for (let v = lo; v <= hi; v += passo) {
      svg.append(el("svg:line", { class: "gl", x1: x(v), x2: x(v), y1: topo - 6, y2: H - 4 }),
        el("svg:text", { x: x(v), y: 12, "text-anchor": "middle", text: `${v}°` }));
    }
    if (o) {
      for (const v of [o.tmin, o.tmax]) {
        svg.append(el("svg:line", { x1: x(v), x2: x(v), y1: topo - 6, y2: H - 4, stroke: "var(--tinta)", "stroke-dasharray": "3 3", "stroke-width": 1.5 }));
      }
    }
    linhas.forEach(({ s, p }, i) => {
      const y = topo + i * lh + lh / 2;
      const forte = s.id === "cempa" || s.id === "inmet";
      const nome = estreito && s.rotulo.length > 17 ? s.rotulo.slice(0, 16) + "…" : s.rotulo;
      svg.append(el("svg:text", { class: `nome${forte ? "" : " fraco"}`, x: 0, y: y + 4, "font-weight": forte ? 600 : 400, text: nome }));
      const x1 = x(p.tmin ?? p.tmax), x2 = x(p.tmax);
      svg.append(el("svg:line", { x1, x2, y1: y, y2: y, stroke: "var(--tinta-2)", "stroke-width": 4, "stroke-linecap": "round", opacity: .35 }));
      if (p.tmin != null) svg.append(el("svg:circle", { cx: x1, cy: y, r: 4.5, fill: "var(--superficie)", stroke: "var(--tinta-2)", "stroke-width": 2 }));
      svg.append(el("svg:circle", { cx: x2, cy: y, r: 4.5, fill: "var(--tinta-2)" }));
      svg.append(el("svg:text", { class: "valor", x: x2 + 9, y: y + 4, text: `${fmt0(p.tmax)}°` }));
      // rótulo da mínima só quando cabe sem encostar no nome (o valor sempre está no tooltip)
      if (p.tmin != null && x1 - esq > 30) svg.append(el("svg:text", { class: "valor", x: x1 - 9, y: y + 4, "text-anchor": "end", text: `${fmt0(p.tmin)}°` }));
      const hit = el("svg:rect", { class: "alvo", x: 0, y: y - lh / 2, width: W, height: lh });
      hit.addEventListener("pointermove", (ev) => mostrarTip(ev, s.rotulo, [
        { valor: `${fmt1(p.tmax)} °C`, nome: "máxima" }, { valor: `${fmt1(p.tmin)} °C`, nome: "mínima" },
        ...(p.chuva != null ? [{ valor: `${fmt1(p.chuva)} mm`, nome: "chuva" }] : []),
        ...(p.umid_min != null ? [{ valor: `${fmt0(p.umid_min)}%`, nome: "umidade mínima" }] : []),
      ]));
      hit.addEventListener("pointerleave", esconderTip);
      svg.append(hit);
    });
    alvo.replaceChildren(svg);
  });
  return sec;
}

// ------------------------------------------------------------------ 3. hora a hora
function secaoHoraria(D, hor, obsArqs) {
  const alvo = el("div");
  const sec = el("section", {}, el("h2", { text: "Temperatura hora a hora" }),
    el("p", { class: "sub", text: `${diaLongo(D)} e o dia seguinte, previsto em ${new Date(D + "T12:00:00").toLocaleDateString("pt-BR")}.` }));
  if (!hor || !Object.keys(hor.series).length) {
    sec.append(el("p", { class: "vazio", text: "Sem série horária para esta data." }));
    return sec;
  }
  const horas = Array.from({ length: 48 }, (_, h) => {
    const d = addDias(D, Math.floor(h / 24));
    return `${d}T${String(h % 24).padStart(2, "0")}:00`;
  });
  const pos = new Map(horas.map((h, i) => [h, i]));
  const linhas = Object.entries(hor.series).map(([id, s]) => {
    const v = new Array(48).fill(null);
    s.t.forEach((t, i) => { if (pos.has(t)) v[pos.get(t)] = s.temp[i]; });
    return { id, rotulo: s.rotulo, v, cor: DESTAQUE[id] };
  }).sort((a, b) => ordemSerie(a.id) - ordemSerie(b.id));
  const obs = new Array(48).fill(null);
  let temObs = false;
  for (const arq of obsArqs) {
    const o = obsRef(arq);
    if (!o || !o.horario) continue;
    o.horario.t.forEach((t, i) => {
      const hh = t.slice(0, 13) + ":00";
      if (pos.has(hh) && o.horario.temp[i] != null) { obs[pos.get(hh)] = o.horario.temp[i]; temObs = true; }
    });
  }

  const destacadas = linhas.filter((l) => l.cor);
  const outras = linhas.filter((l) => !l.cor);
  sec.append(el("ul", { class: "legenda" },
    destacadas.map((l) => el("li", {}, el("i", { style: `border-color:${l.cor}` }), l.rotulo)),
    outras.length ? el("li", {}, el("i", { style: "border-color:var(--outros)" }), `outros ${outras.length} modelos globais`) : null,
    temObs ? el("li", {}, el("i", { class: "pont", style: "border-color:var(--tinta)" }), "observado") : null));
  sec.append(el("div", { class: "cartao" }, alvo));

  redesenhos.push(() => {
    const W = alvo.clientWidth || 600, H = 280;
    const rotulosDiretos = W >= 620;
    const m = { e: 34, d: rotulosDiretos ? 128 : 8, t: 10, b: 38 };
    const todos = linhas.flatMap((l) => l.v).concat(obs).filter((x) => x != null);
    const lo = Math.floor(Math.min(...todos) / 2) * 2 - 1, hi = Math.ceil(Math.max(...todos) / 2) * 2 + 1;
    const x = (i) => m.e + (i / 47) * (W - m.e - m.d);
    const y = (v) => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);
    const svg = el("svg:svg", { class: "grafico", viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img",
      "aria-label": "Temperatura prevista hora a hora por fonte" });

    const passo = hi - lo > 14 ? 4 : 2;
    for (let v = Math.ceil(lo / passo) * passo; v <= hi; v += passo) {
      svg.append(el("svg:line", { class: "gl", x1: m.e, x2: W - m.d, y1: y(v), y2: y(v) }),
        el("svg:text", { x: m.e - 6, y: y(v) + 4, "text-anchor": "end", text: `${v}°` }));
    }
    for (let i = 0; i < 48; i += 6) {
      svg.append(el("svg:text", { x: x(i), y: H - m.b + 16, "text-anchor": "middle", text: `${String(i % 24).padStart(2, "0")}h` }));
      if (i % 24 === 0) {
        svg.append(el("svg:line", { class: "base", x1: x(i), x2: x(i), y1: m.t, y2: H - m.b }),
          el("svg:text", { x: x(i) + 4, y: H - 4, text: diaCurto(addDias(D, i / 24)) }));
      }
    }
    svg.append(el("svg:line", { class: "base", x1: m.e, x2: W - m.d, y1: H - m.b, y2: H - m.b }));

    const caminho = (v) => {
      let d = "", caneta = false;
      v.forEach((val, i) => {
        if (val == null) { caneta = false; return; }
        d += `${caneta ? "L" : "M"}${x(i).toFixed(1)},${y(val).toFixed(1)}`;
        caneta = true;
      });
      return d;
    };
    for (const l of outras) svg.append(el("svg:path", { class: "linha outra", d: caminho(l.v) }));
    for (const l of destacadas) svg.append(el("svg:path", { class: "linha", d: caminho(l.v), stroke: l.cor }));
    if (temObs) svg.append(el("svg:path", { class: "linha obs", d: caminho(obs) }));

    if (rotulosDiretos) {
      const rot = destacadas.map((l) => {
        const i = l.v.map((v, k) => (v != null ? k : -1)).filter((k) => k >= 0).pop();
        return i == null ? null : { l, i, yy: y(l.v[i]) };
      }).filter(Boolean).sort((a, b) => a.yy - b.yy);
      for (let k = 1; k < rot.length; k++) rot[k].yy = Math.max(rot[k].yy, rot[k - 1].yy + 15);
      for (const r of rot) {
        const nome = r.l.rotulo.replace(" · BRAMS 5 km", "").replace("Open-Meteo (melhor combinação)", "Open-Meteo");
        svg.append(el("svg:text", { class: "rotulo-serie", x: x(r.i) + 8, y: r.yy + 4, text: nome }));
      }
    }

    const cruz = el("svg:line", { class: "cruz", y1: m.t, y2: H - m.b, visibility: "hidden" });
    svg.append(cruz);
    const hit = el("svg:rect", { class: "alvo", x: m.e, y: 0, width: W - m.e - m.d, height: H });
    const mover = (ev) => {
      const b = svg.getBoundingClientRect();
      const px = ((ev.clientX - b.left) / b.width) * W;
      const i = Math.max(0, Math.min(47, Math.round(((px - m.e) / (W - m.e - m.d)) * 47)));
      cruz.setAttribute("x1", x(i)); cruz.setAttribute("x2", x(i)); cruz.setAttribute("visibility", "visible");
      const itens = linhas.filter((l) => l.v[i] != null).map((l) => ({ valor: `${fmt1(l.v[i])}°`, nome: l.rotulo, cor: l.cor || "var(--outros)", n: l.v[i] }));
      if (obs[i] != null) itens.unshift({ valor: `${fmt1(obs[i])}°`, nome: "observado", cor: "var(--tinta)", pont: true, n: 1e9 });
      itens.sort((a, b) => b.n - a.n);
      mostrarTip(ev, `${diaCurto(horas[i].slice(0, 10))}, ${horas[i].slice(11, 13)}h`, itens);
    };
    hit.addEventListener("pointermove", mover);
    hit.addEventListener("pointerleave", () => { cruz.setAttribute("visibility", "hidden"); esconderTip(); });
    svg.append(hit);
    alvo.replaceChildren(svg);
  });
  return sec;
}

// ------------------------------------------------------------------ 4. próximos dias
function secaoProximos(D, series) {
  const dias = Array.from({ length: 7 }, (_, i) => addDias(D, i));
  const grupos = [];
  for (const s of series) {
    let g = grupos.find((x) => x.nome === s.grupo);
    if (!g) grupos.push((g = { nome: s.grupo, series: [] }));
    g.series.push(s);
  }
  const corpo = el("tbody");
  for (const g of grupos) {
    corpo.append(el("tr", { class: "grupo" }, el("td", { colspan: dias.length + 1, text: g.nome })));
    for (const s of g.series) {
      const tr = el("tr", {}, el("td", {},
        DESTAQUE[s.id] ? el("span", { class: "marca", style: `background:${DESTAQUE[s.id]}` }) : null, s.rotulo));
      for (const d of dias) {
        const p = s.dias.find((x) => x.dia === d);
        if (!p || p.tmax == null) { tr.append(el("td", { class: "sem", text: "–" })); continue; }
        let chuva = null;
        if (p.chuva != null && p.chuva >= 0.5) chuva = `${fmt1(p.chuva)} mm`;
        else if (p.chuva == null && p.resumo && /chuva/i.test(p.resumo)) chuva = "chuva";
        tr.append(el("td", {}, el("span", { class: "mx", text: grau(p.tmax) }), " ",
          el("span", { class: "mn", text: grau(p.tmin) }), chuva ? el("span", { class: "ch", text: chuva }) : null));
      }
      corpo.append(tr);
    }
  }
  return el("section", {}, el("h2", { text: "Próximos 7 dias" }),
    el("p", { class: "sub", text: "Máxima, mínima e chuva do dia (quando ≥ 0,5 mm). “–” = fora do horizonte do modelo." }),
    el("div", { class: "cartao" }, el("div", { class: "rolagem" }, el("table", {},
      el("thead", {}, el("tr", {}, el("th", { text: "Fonte" }), dias.map((d) => el("th", { text: diaCurto(d) })))), corpo))));
}

// ------------------------------------------------------------------ 5. como foi ontem
function chipErro(prev, obs) {
  if (prev == null || obs == null) return el("span", { class: "sem", text: "–" });
  const e = prev - obs;
  const pct = Math.round(Math.min(Math.abs(e) / 4, 1) * 70);
  const cor = e > 0 ? "var(--quente)" : "var(--frio)";
  const sinal = e > 0 ? "+" : e < 0 ? "−" : "±";
  return el("span", { class: "erro", style: `background:color-mix(in oklab, ${cor} ${pct}%, var(--meio))`,
    title: `previu ${fmt1(prev)}°, observado ${fmt1(obs)}°` },
    `${fmt0(prev)}°`, el("small", { text: `${sinal}${fmt1(Math.abs(e))}` }));
}

function secaoOntem(dia, obsOntem) {
  const sec = el("section", {}, el("h2", { text: `Como foi ${diaLongo(dia)}` }));
  const o = obsRef(obsOntem);
  if (!o) {
    sec.append(el("p", { class: "vazio", text: "Ainda sem observação para este dia." }));
    return sec;
  }
  sec.append(el("div", { class: "obs-resumo" },
    el("span", {}, "Máxima ", el("b", { text: `${fmt1(o.tmax)}°` })),
    el("span", {}, "Mínima ", el("b", { text: `${fmt1(o.tmin)}°` })),
    o.umid_min != null ? el("span", {}, "Umidade mín. ", el("b", { text: `${fmt0(o.umid_min)}%` })) : null,
    el("span", {}, "Chuva ", el("b", { text: o.chuva != null ? `${fmt1(o.chuva)} mm` : "não medida" })),
    el("span", { text: `Fonte: ${o.fonte}` })));

  const linhas = VERIF.linhas.filter((l) => l.dia === dia);
  if (!linhas.length) {
    sec.append(el("p", { class: "vazio", text: `Ainda não há previsões arquivadas para este dia. A comparação começa pelos dias a partir de ${diaLongo(INDEX.emissoes[0])}.` }));
    return sec;
  }
  const ants = [0, 1, 3];
  const ids = [...new Set(linhas.map((l) => l.serie))].sort((a, b) => ordemSerie(a) - ordemSerie(b));
  const corpo = el("tbody");
  for (const id of ids) {
    const ls = linhas.filter((l) => l.serie === id);
    corpo.append(el("tr", {}, el("td", { text: ls[0].rotulo }),
      ants.map((a) => { const l = ls.find((x) => x.antecedencia === a); return el("td", {}, l ? chipErro(l.tmax, l.obs_tmax) : el("span", { class: "sem", text: "–" })); }),
      ants.map((a) => { const l = ls.find((x) => x.antecedencia === a); return el("td", {}, l ? chipErro(l.tmin, l.obs_tmin) : el("span", { class: "sem", text: "–" })); })));
  }
  const rotAnt = (a) => (a === 0 ? "no dia" : a === 1 ? "1 dia antes" : `${a} dias antes`);
  sec.append(el("p", { class: "sub", text: "Valor previsto e o erro em relação ao observado: vermelho = previu mais quente, azul = previu mais frio." }),
    el("div", { class: "cartao" }, el("div", { class: "rolagem" }, el("table", {},
      el("thead", {},
        el("tr", {}, el("th", {}), el("th", { colspan: 3, style: "text-align:center", text: "Máxima prevista" }), el("th", { colspan: 3, style: "text-align:center", text: "Mínima prevista" })),
        el("tr", {}, el("th", { text: "Fonte" }), ants.map((a) => el("th", { text: rotAnt(a) })), ants.map((a) => el("th", { text: rotAnt(a) })))),
      corpo))));
  return sec;
}

// ------------------------------------------------------------------ 6. quem acerta mais
function secaoRanking() {
  const sec = el("section", {}, el("h2", { text: "Quem acerta mais em Goiânia" }),
    el("p", { class: "sub", text: "Erro médio absoluto (°C) de todos os dias já verificados. Quanto menor, melhor." }));
  const L = VERIF.linhas.filter((l) => l.obs_tmax != null);
  if (!L.length) {
    sec.append(el("div", { class: "cartao" }, el("p", { class: "vazio", style: "margin:0",
      text: "Ainda sem dados. O ranking aparece depois que houver previsão arquivada e observação para o mesmo dia, e fica confiável depois de algumas semanas." })));
    return sec;
  }
  const antsDisp = [...new Set(L.map((l) => l.antecedencia))].sort((a, b) => a - b).filter((a) => a <= 5);
  let ant = antsDisp.includes(1) ? 1 : antsDisp[0];
  let medida = "tmax";
  const segAnt = el("div", { class: "seg", role: "group", "aria-label": "Antecedência" });
  const segMed = el("div", { class: "seg", role: "group", "aria-label": "Medida" });
  const alvo = el("div");
  const nota = el("p", { class: "nota" });

  const botoes = (seg, opcoes, atual, aoEscolher) => {
    seg.replaceChildren(...opcoes.map(([v, r]) => el("button", { type: "button", "aria-pressed": String(v === atual), text: r,
      onclick: () => aoEscolher(v) })));
  };
  const desenhar = () => {
    botoes(segAnt, antsDisp.map((a) => [a, a === 0 ? "No dia" : a === 1 ? "1 dia antes" : `${a} dias antes`]), ant, (v) => { ant = v; desenhar(); });
    botoes(segMed, [["tmax", "Máxima"], ["tmin", "Mínima"]], medida, (v) => { medida = v; desenhar(); });
    const porSerie = new Map();
    for (const l of L.filter((x) => x.antecedencia === ant && x[medida] != null && x["obs_" + medida] != null)) {
      if (!porSerie.has(l.serie)) porSerie.set(l.serie, { rotulo: l.rotulo, erros: [] });
      porSerie.get(l.serie).erros.push(l[medida] - l["obs_" + medida]);
    }
    const res = [...porSerie.entries()].map(([id, s]) => ({
      id, rotulo: s.rotulo, n: s.erros.length,
      mae: s.erros.reduce((a, e) => a + Math.abs(e), 0) / s.erros.length,
      vies: s.erros.reduce((a, e) => a + e, 0) / s.erros.length,
    })).sort((a, b) => a.mae - b.mae);

    const W = alvo.clientWidth || 600;
    const estreito = W < 520;
    const esq = estreito ? 150 : 230, dir = 48, lh = 28;
    const H = res.length * lh + 4;
    const maxV = Math.max(1, ...res.map((r) => r.mae));
    const x = (v) => (v / maxV) * (W - esq - dir);
    const svg = el("svg:svg", { class: "grafico", viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": "Erro médio por fonte" });
    res.forEach((r, i) => {
      const y = i * lh + 4, hb = lh - 10, w = Math.max(2, x(r.mae)), raio = Math.min(4, w / 2);
      const nome = estreito && r.rotulo.length > 20 ? r.rotulo.slice(0, 19) + "…" : r.rotulo;
      svg.append(el("svg:text", { class: "nome", x: 0, y: y + hb / 2 + 4, text: nome }));
      svg.append(el("svg:path", { fill: "var(--barra)",
        d: `M${esq},${y}h${w - raio}a${raio},${raio} 0 0 1 ${raio},${raio}v${hb - 2 * raio}a${raio},${raio} 0 0 1 -${raio},${raio}h-${w - raio}z` }));
      svg.append(el("svg:text", { class: "valor", x: esq + w + 6, y: y + hb / 2 + 4, text: fmt1(r.mae) }));
      const hit = el("svg:rect", { class: "alvo", x: 0, y: y - 4, width: W, height: lh });
      hit.addEventListener("pointermove", (ev) => mostrarTip(ev, r.rotulo, [
        { valor: `${fmt1(r.mae)} °C`, nome: "erro médio absoluto" },
        { valor: `${r.vies > 0 ? "+" : ""}${fmt1(r.vies)} °C`, nome: r.vies > 0 ? "viés (tende a esquentar)" : "viés (tende a esfriar)" },
        { valor: String(r.n), nome: r.n === 1 ? "dia verificado" : "dias verificados" },
      ]));
      hit.addEventListener("pointerleave", esconderTip);
      svg.append(hit);
    });
    alvo.replaceChildren(svg);
    const nMax = Math.max(0, ...res.map((r) => r.n));
    nota.textContent = nMax < 14
      ? `Só ${nMax} dia(s) verificados até agora: com tão pouco, o ranking ainda muda muito de um dia para o outro.`
      : `Até ${nMax} dias verificados por fonte.`;
  };
  redesenhos.push(desenhar);
  sec.append(el("div", { class: "cartao" }, segAnt, segMed, alvo, nota));
  return sec;
}

iniciar();
