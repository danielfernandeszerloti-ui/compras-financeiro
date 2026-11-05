// Solicitações de Compra — Grupo Zerbini
// Colaborador solicita → Financeiro aprova → quem compra registra → solicitante anexa o comprovante → Financeiro confere e finaliza.
"use strict";
const VERSAO = "1.4.0";
const sb = supabase.createClient(FC_CONFIG.supabaseUrl, FC_CONFIG.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true } });
const BUCKET = "compras", MAX_MB = 15;

const S = { eu:null, sols:[], cfg:{}, membros:[], view:"", q:"", fStatus:"", fSetor:"", fQuem:"", fForma:"", fTipo:"", fAss:"ativa", det:null, eventos:{} };
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const ICON = n => `<svg class="i"><use href="#i-${n}"/></svg>`;
const brl = v => v == null || v === "" ? "" : Number(v).toLocaleString("pt-BR", { style:"currency", currency:"BRL" });
const fDia = d => d ? String(d).slice(0,10).split("-").reverse().join("/") : "";
const fDH = t => t ? new Date(t).toLocaleString("pt-BR", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" }) : "";
const hoje = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0,10); };
const diasAte = d => Math.round((new Date(d + "T12:00:00") - new Date(hoje() + "T12:00:00")) / 864e5);
const cod = id => "#" + String(id).padStart(4, "0");
const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const linkSeguro = u => /^https?:\/\//i.test(String(u || "").trim()) ? String(u).trim() : "";
const tam = b => b == null ? "" : b < 1024 * 1024 ? Math.max(1, Math.round(b / 1024)) + " KB" : (b / 1048576).toFixed(1).replace(".", ",") + " MB";
const lista = k => Array.isArray(S.cfg[k]) ? S.cfg[k] : [];
const iniciais = n => String(n || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join("");

const ST = {
  aguardando_aprovacao: ["Aguardando aprovação", "st-sol"],
  reprovada: ["Reprovada", "st-bad"],
  aprovada: ["Aprovada · aguardando compra", "st-prep"],
  comprada: ["Comprada · aguardando comprovante", "st-res"],
  comprovante_enviado: ["Comprovante em conferência", "st-man"],
  finalizada: ["Finalizada", "st-ok"],
  cancelada: ["Cancelada", "st-desc"],
};
const ABERTAS = ["aguardando_aprovacao", "reprovada", "aprovada", "comprada", "comprovante_enviado"];
const pill = s => { const [l, c] = ST[s.status] || [s.status, "st-desc"]; return `<span class="pill ${c}">${esc(s.status === "aprovada" && s.comprado_em ? ST.comprada[0] : l)}</span>`; };
const QUEM = { financeiro: "Financeiro/Compras", solicitante: "O próprio solicitante" };
const quemTxt = s => s.quem_compra === "solicitante" ? (dono(s) ? "Você" : "O solicitante") : "Financeiro/Compras";
const isFin = () => S.eu && ["financeiro", "admin"].includes(S.eu.papel);
const isAdmin = () => S.eu && S.eu.papel === "admin";
const isComprador = () => S.eu && S.eu.papel === "comprador";
const veTudo = () => isFin() || isComprador();
const dono = s => S.eu && s.solicitante_email === S.eu.email;
const comprovantes = s => (s.fc_anexos || []).filter(a => a.tipo === "comprovante").sort((a, b) => a.id - b.id);
const orcamentos = s => (s.fc_anexos || []).filter(a => a.tipo === "orcamento").sort((a, b) => a.id - b.id);
const itensDe = s => (s.fc_itens || []).slice().sort((a, b) => a.ordem - b.ordem || a.id - b.id);
const valorRef = s => s.valor_pago ?? s.valor_estimado;
const podeRegistrarCompra = s => ["aprovada", "comprada"].includes(s.status) && (isFin() || (isComprador() && s.quem_compra === "financeiro") || (dono(s) && s.quem_compra === "solicitante"));
const podeComprovante = s => ["aprovada", "comprada"].includes(s.status) && (dono(s) || isAdmin());

function toast(msg, ms = 3200) {
  const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; t.setAttribute("role", "status");
  document.body.appendChild(t); setTimeout(() => t.remove(), ms);
}
function erro(e) {
  console.error(e);
  let m = (e && (e.message || e.error_description)) || String(e);
  if (/Database error saving new user|apenas para e-mails/i.test(m)) m = "Acesso permitido apenas para e-mails @grupozerbini.com.br.";
  else if (/JWT|session|not authenticated/i.test(m)) m = "Sua sessão expirou. Entre de novo.";
  else if (/Failed to fetch|NetworkError/i.test(m)) m = "Sem conexão. Verifique a internet e tente de novo.";
  else if (/row-level security|violates/i.test(m)) m = "Você não tem permissão para isso nesta etapa.";
  toast(m, 5000);
}
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
function aplicarTema() {
  const t = lsGet("fc_tema") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.dataset.theme = t;
}
aplicarTema();

// ---------- login: código por e-mail (mesmo login do Helpdesk) ----------
const L = { etapa: "email", email: lsGet("fc_email") || "", senha: false, msg: "" };
function gateHTML() {
  const cab = `<div style="display:flex;gap:12px;align-items:center"><div class="logo"><img src="img/logo-128.png" alt=""></div><div><b style="color:var(--heading);font-size:18px">Solicitações de Compra</b><br><small class="muted">Grupo Zerbini</small></div></div>`;
  if (L.etapa === "codigo") return `<div class="gate"><form class="card" id="fCodigo">${cab}
    <h2>Digite o código</h2><p>Enviamos um código para <b>${esc(L.email)}</b>. Ele vale por alguns minutos.</p>
    <input id="lCodigo" class="code" inputmode="numeric" autocomplete="one-time-code" maxlength="10" required aria-label="Código recebido por e-mail">
    ${L.msg ? `<div class="err">${esc(L.msg)}</div>` : ""}
    <button class="btn primary" style="justify-content:center">Entrar</button>
    <button type="button" class="linkbtn" data-act="lvoltar">Usar outro e-mail ou reenviar o código</button></form></div>`;
  return `<div class="gate"><form class="card" id="fEmail">${cab}
    <h2>Entrar</h2><p>Use seu e-mail corporativo. É o mesmo acesso do Helpdesk.</p>
    <input id="lEmail" type="email" autocomplete="email" placeholder="nome@grupozerbini.com.br" required value="${esc(L.email)}" aria-label="E-mail">
    ${L.senha ? `<input id="lSenha" type="password" autocomplete="current-password" placeholder="Senha" required aria-label="Senha">` : ""}
    ${L.msg ? `<div class="err">${esc(L.msg)}</div>` : ""}
    <button class="btn primary" style="justify-content:center">${L.senha ? "Entrar com senha" : "Receber código por e-mail"}</button>
    <button type="button" class="linkbtn" data-act="lsenha">${L.senha ? "Entrar com código por e-mail" : "Tenho senha cadastrada"}</button></form></div>`;
}
async function loginEmail(f) {
  const email = $("lEmail").value.trim().toLowerCase(), btn = f.querySelector(".btn"); L.email = email; lsSet("fc_email", email); L.msg = "";
  if (!/@grupozerbini\.com\.br$/i.test(email)) { L.msg = "Use seu e-mail @grupozerbini.com.br."; render(); return; }
  btn.disabled = true;
  if (L.senha) {
    const { error } = await sb.auth.signInWithPassword({ email, password: $("lSenha").value });
    if (error) { L.msg = /Invalid login/i.test(error.message) ? "E-mail ou senha incorretos." : error.message; btn.disabled = false; render(); }
    return;
  }
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) { L.msg = /saving new user|apenas/i.test(error.message) ? "Acesso permitido apenas para e-mails @grupozerbini.com.br." : /rate|seconds/i.test(error.message) ? "Aguarde um minuto antes de pedir outro código." : error.message; btn.disabled = false; render(); return; }
  L.etapa = "codigo"; render(); setTimeout(() => $("lCodigo") && $("lCodigo").focus(), 50);
}
async function loginCodigo(f) {
  const token = $("lCodigo").value.replace(/\D/g, ""), btn = f.querySelector(".btn"); btn.disabled = true; L.msg = "";
  const { error } = await sb.auth.verifyOtp({ email: L.email, token, type: "email" });
  if (error) { L.msg = "Código inválido ou vencido."; btn.disabled = false; render(); }
}

// ---------- dados ----------
async function pageAll(q) {
  const out = []; for (let i = 0; ; i += 1000) { const { data, error } = await q().range(i, i + 999); if (error) throw error; out.push(...data); if (data.length < 1000) break; } return out;
}
async function carregar() {
  const [eu, cfg] = await Promise.all([sb.rpc("fc_eu"), sb.from("fc_config").select("*")]);
  if (eu.error) throw eu.error; if (cfg.error) throw cfg.error;
  S.eu = eu.data; S.cfg = Object.fromEntries(cfg.data.map(r => [r.chave, r.valor]));
  await carregarSols();
  if (isAdmin()) await carregarMembros();
}
async function carregarSols() {
  S.sols = await pageAll(() => sb.from("fc_solicitacoes").select("*, fc_itens(*), fc_anexos(*)").order("id", { ascending: false }));
}
async function carregarMembros() {
  const { data, error } = await sb.from("fc_membros").select("*").order("nome"); if (error) throw error; S.membros = data;
}
async function carregarEventos(id) {
  const { data, error } = await sb.from("fc_eventos").select("*").eq("solicitacao_id", id).order("id");
  if (!error) S.eventos[id] = data;
}
let rtTimer = null, canal = null;
function ouvirMudancas() {
  if (canal) return;
  canal = sb.channel("fc").on("postgres_changes", { event: "*", schema: "public", table: "fc_solicitacoes" }, () => {
    clearTimeout(rtTimer);
    rtTimer = setTimeout(async () => {
      try { await carregarSols(); if (!document.querySelector(".ov")) render(); else if (S.det) { await carregarEventos(S.det); atualizarDetalhe(); } } catch (e) { console.error(e); }
    }, 600);
  }).subscribe();
}
async function recarregar(id) { await carregarSols(); if (id) await carregarEventos(id); render(); if (S.det) atualizarDetalhe(); }

// ---------- navegação ----------
const VIEWS = () => [
  ...(isFin() ? [
    ["painel", "Painel", "grid", null],
    ["aprovacoes", "Aprovações", "check", S.sols.filter(s => s.status === "aguardando_aprovacao").length],
    ["conferencia", "Conferência", "file", S.sols.filter(s => s.status === "comprovante_enviado").length],
    ["andamento", "Em andamento", "clock", S.sols.filter(s => ["aprovada", "comprada", "reprovada"].includes(s.status)).length, true],
    ["assinaturas", "Assinaturas", "undo", S.sols.filter(s => ehAss(s) && assSituacao(s) === "ativa" && proxRenovacao(s) && s.recorrencia === "anual" && diasAte(proxRenovacao(s)) <= 30).length || null],
    ["todas", "Todas", "list", null],
  ] : []),
  ...(isComprador() ? [
    ["andamento", "Para comprar", "cart", S.sols.filter(s => s.status === "aprovada" && s.quem_compra === "financeiro").length],
    ["assinaturas", "Assinaturas", "undo", null],
    ["todas", "Todas", "list", null],
  ] : []),
  ["minhas", "Minhas solicitações", "cart", S.sols.filter(s => dono(s) && (s.status === "reprovada" || s.status === "comprada" || (s.status === "aprovada" && s.quem_compra === "solicitante"))).length],
  ...(isAdmin() ? [["config", "Configurações", "gear", null]] : []),
];
function lerHash() {
  const h = location.hash.replace(/^#/, "");
  let m = h.match(/^s\/(\d+)$/); if (m) return { det: +m[1] };
  m = h.match(/^v\/(\w+)$/); if (m) return { view: m[1] };
  return {};
}
function irPara(v) { S.view = v; S.det = null; history.pushState(null, "", "#v/" + v); render(); window.scrollTo(0, 0); }

// ---------- render ----------
function render() {
  const root = $("root");
  if (!S.eu) { root.innerHTML = gateHTML(); return; }
  const vs = VIEWS(); if (!vs.some(v => v[0] === S.view)) S.view = isFin() ? "painel" : isComprador() ? "andamento" : "minhas";
  const corpo = { painel: painelHTML, aprovacoes: aprovacoesHTML, conferencia: conferenciaHTML, andamento: andamentoHTML, todas: todasHTML, assinaturas: assinaturasHTML, minhas: minhasHTML, config: configHTML }[S.view]();
  const foco = document.activeElement && document.activeElement.id === "fq" ? document.activeElement.selectionStart : null;
  root.innerHTML = `<div class="app"><aside class="side">
    <div class="brand"><div class="logo"><img src="img/logo-128.png" alt=""></div><div><b>Solicitações de Compra</b><small>Grupo Zerbini</small></div></div>
    <div class="bar3"></div>
    ${isFin() ? `<div class="navlabel">Financeiro</div>` : isComprador() ? `<div class="navlabel">Compras</div>` : `<div class="navlabel">Solicitações</div>`}
    <nav class="navs">${vs.map(([k, l, ic, n, soft]) => `${k === "minhas" && veTudo() ? `<div class="navlabel" style="padding-left:10px">Você</div>` : ""}<button class="nav ${S.view === k ? "on" : ""}" data-act="go" data-v="${k}">${ICON(ic)}${esc(l)}${n ? `<span class="n ${soft ? "soft" : ""}">${n}</span>` : ""}</button>`).join("")}</nav>
    <div class="me"><div class="av">${S.eu.foto ? `<img src="${esc(S.eu.foto)}" alt="">` : esc(iniciais(S.eu.nome))}</div><div class="who" title="${esc(S.eu.nome)}"><b>${esc(S.eu.nome)}</b><small>${esc({ admin: "Administrador", financeiro: "Financeiro", comprador: "Comprador", solicitante: "Colaborador" }[S.eu.papel] || "")}</small></div>
      <div class="tools"><button class="ib" data-act="tema" title="Tema claro/escuro" aria-label="Alternar tema">${ICON("moon")}</button>
      <button class="ib" data-act="sair" title="Sair" aria-label="Sair">${ICON("logout")}</button></div></div>
  </aside><main>${corpo}</main></div>`;
  if (foco != null && $("fq")) { $("fq").focus(); $("fq").setSelectionRange(foco, foco); }
}

function proximoPasso(s) {
  const d = dono(s), fin = isFin();
  switch (s.status) {
    case "aguardando_aprovacao": return fin ? "Aprovar ou reprovar" : "Aguardando o Financeiro aprovar";
    case "reprovada": return d ? "Ajuste e reenvie, ou cancele" : "Aguardando o solicitante ajustar";
    case "aprovada":
      if (s.quem_compra === "solicitante") return d ? "Você faz a compra e anexa o comprovante" : "O solicitante vai comprar e anexar o comprovante";
      return veTudo() ? "Financeiro/Compras: fazer a compra e registrar" : "Aguardando o Financeiro/Compras comprar";
    case "comprada": return d ? "Quando receber, anexe o comprovante" : "Aguardando o comprovante do solicitante";
    case "comprovante_enviado": return fin ? "Conferir o comprovante e finalizar" : "O Financeiro está conferindo o comprovante";
    default: return "";
  }
}
function solCard(s, opts = {}) {
  const itens = itensDe(s), v = valorRef(s);
  const prazo = s.necessario_ate && ABERTAS.includes(s.status) ? diasAte(s.necessario_ate) : null;
  const prev = s.status === "comprada" && s.previsao ? diasAte(s.previsao) : null;
  const nx = proximoPasso(s);
  return `<article class="card sc ${s.urgente && ABERTAS.includes(s.status) ? "urg" : ""}" data-act="abrir" data-id="${s.id}" tabindex="0">
    <div><div class="t"><span class="cod">${cod(s.id)}</span>${esc(s.titulo)} ${pill(s)}${s.urgente && ABERTAS.includes(s.status) ? `<span class="chip urg">Urgente</span>` : ""}${recChip(s)}${s.assinatura_encerrada_em ? `<span class="chip" style="background:var(--disc-bg);color:var(--disc-fg)">Assinatura encerrada</span>` : ""}${s.devolucoes && ["aprovada", "comprada"].includes(s.status) ? `<span class="chip urg">Comprovante devolvido</span>` : ""}</div>
      <div class="m">${opts.solicitante !== false ? `<span>${ICON("users")} ${esc(s.solicitante_nome)}${s.setor ? ` · ${esc(s.setor)}` : ""}</span>` : (s.setor ? `<span>${esc(s.setor)}</span>` : "")}
        ${s.empresa ? `<span>${esc(s.empresa)}</span>` : ""}
        <span>${itens.length} ${itens.length === 1 ? "item" : "itens"}: ${esc(itens.slice(0, 3).map(i => `${i.quantidade}× ${i.item}`).join(", "))}${itens.length > 3 ? "…" : ""}</span>
        <span>Quem compra: <b style="color:var(--heading)">${esc(quemTxt(s))}</b></span>
        <span>Aberta em ${esc(fDia(s.criado_em.slice(0, 10)))}</span></div></div>
    <div class="v">${v != null ? esc(brl(v)) + (ehAss(s) ? `<span style="font-weight:700;font-size:13px">${POR[s.recorrencia]}</span>` : "") : `<span class="muted">sem valor</span>`}<small>${s.valor_pago != null ? "pago" : "estimado"}</small></div>
    ${nx || prazo != null || prev != null ? `<div class="nx">${nx ? `${ICON("clock")}${esc(nx)}` : ""}
      ${prazo != null ? `<span class="${prazo < 0 ? "late" : ""}">· necessário até ${esc(fDia(s.necessario_ate))}${prazo < 0 ? " (vencido)" : prazo <= 2 ? ` (${prazo === 0 ? "hoje" : prazo === 1 ? "amanhã" : "em 2 dias"})` : ""}</span>` : ""}
      ${prev != null ? `<span class="${prev < 0 ? "late" : ""}">· previsão de chegada ${esc(fDia(s.previsao))}${prev < 0 ? " (atrasada)" : ""}</span>` : ""}</div>` : ""}
    ${opts.acoes ? `<div class="acts">${botoes(s, true)}</div>` : ""}
  </article>`;
}
function botoes(s, compacto) {
  const b = (act, ic, l, cls = "") => `<button class="btn ${compacto ? "sm" : ""} ${cls}" data-act="${act}" data-id="${s.id}">${ICON(ic)}${l}</button>`, x = [];
  const d = dono(s), fin = isFin();
  if (s.status === "aguardando_aprovacao" && fin) x.push(b("decidir", "check", "Aprovar ou reprovar", "primary"));
  if (s.status === "comprovante_enviado" && fin) x.push(b("conferir", "file", "Conferir comprovante", "primary"));
  if (podeComprovante(s)) x.push(b("comprovante", "clip", s.devolucoes ? "Anexar novo comprovante" : "Anexar comprovante", d && (s.quem_compra === "solicitante" || s.status === "comprada") ? "primary" : ""));
  if (podeRegistrarCompra(s)) x.push(b("compra", "cart", s.status === "comprada" ? "Atualizar compra" : "Registrar compra", veTudo() && s.quem_compra === "financeiro" && s.status === "aprovada" ? "primary" : ""));
  if (d && ["aguardando_aprovacao", "reprovada"].includes(s.status)) x.push(b("editar", "edit", s.status === "reprovada" ? "Ajustar e reenviar" : "Editar", s.status === "reprovada" ? "primary" : ""));
  if (!compacto && ((d && ["aguardando_aprovacao", "reprovada", "aprovada"].includes(s.status)) || (fin && ABERTAS.includes(s.status)))) x.push(b("cancelar", "x", "Cancelar", "ghost"));
  if (!compacto && fin && ehAss(s) && assSituacao(s) === "ativa") x.push(b("encerrarass", "x", "Encerrar assinatura"));
  if (!compacto && isAdmin()) x.push(b("excluir", "trash", "Excluir", "ghost"));
  return x.join("");
}
const vazio = (t, m) => `<div class="card empty"><b>${esc(t)}</b>${m}</div>`;
const total = arr => arr.reduce((a, s) => a + (Number(valorRef(s)) || 0), 0);
// ---------- assinaturas ----------
const REC = { unica: "Compra única", mensal: "Assinatura mensal", anual: "Assinatura anual" };
const POR = { mensal: "/mês", anual: "/ano", unica: "" };
const ehAss = s => s.recorrencia && s.recorrencia !== "unica";
const assInicio = s => s.data_compra || (s.comprado_em || "").slice(0, 10) || (s.comprovante_em || "").slice(0, 10) || null;
const somaPeriodo = (d, rec, n = 1) => { const [y, m, dd] = d.split("-").map(Number); const t = rec === "mensal" ? new Date(Date.UTC(y, m - 1 + n, dd)) : new Date(Date.UTC(y + n, m - 1, dd)); return t.toISOString().slice(0, 10); };
function proxRenovacao(s) {
  const i = assInicio(s); if (!ehAss(s) || !i) return null;
  let k = 1, d = somaPeriodo(i, s.recorrencia, k); const h = hoje();
  while (d < h && k < 1200) { k++; d = somaPeriodo(i, s.recorrencia, k); }
  return d;
}
const assContratada = s => ["comprada", "comprovante_enviado", "finalizada"].includes(s.status);
const assSituacao = s => s.assinatura_encerrada_em ? "encerrada" : assContratada(s) ? "ativa" : ["aguardando_aprovacao", "aprovada", "reprovada"].includes(s.status) ? "contratacao" : "fora";
const custoMes = s => { const v = Number(valorRef(s)) || 0; return s.recorrencia === "anual" ? v / 12 : v; };
const custoAno = s => { const v = Number(valorRef(s)) || 0; return s.recorrencia === "mensal" ? v * 12 : v; };
const recChip = s => ehAss(s) ? `<span class="chip">${esc(REC[s.recorrencia])}</span>` : "";

function minhasHTML() {
  const minhas = S.sols.filter(dono), ab = minhas.filter(s => ABERTAS.includes(s.status)), fe = minhas.filter(s => !ABERTAS.includes(s.status));
  const acao = ab.filter(s => (["aprovada", "comprada"].includes(s.status) && (s.quem_compra === "solicitante" || s.status === "comprada")) || s.status === "reprovada");
  return `<div class="head"><div><h1>Minhas solicitações</h1><div class="sub">${ab.length ? `${ab.length} em aberto${acao.length ? ` · <b style="color:var(--pink)">${acao.length} ${acao.length === 1 ? "precisa" : "precisam"} de você</b>` : ""}` : "Nenhuma solicitação em aberto"}</div></div>
    <div class="actions"><button class="btn primary" data-act="nova">${ICON("plus")}Nova solicitação</button></div></div>
    ${!minhas.length ? vazio("Nenhuma solicitação ainda", `Use <b>Nova solicitação</b> para pedir uma compra ao Financeiro. Depois da aprovação, alguém faz a compra e você anexa o comprovante para finalizar.`) : ""}
    ${ab.length ? `<div class="sols">${ab.map(s => solCard(s, { solicitante: false, acoes: true })).join("")}</div>` : ""}
    ${fe.length ? `<h2 style="color:var(--heading);font-size:17px;margin:28px 0 10px">Encerradas</h2><div class="sols">${fe.slice(0, 30).map(s => solCard(s, { solicitante: false })).join("")}</div>${fe.length > 30 ? `<p class="muted">Mostrando as 30 mais recentes de ${fe.length}.</p>` : ""}` : ""}`;
}
function aprovacoesHTML() {
  const p = S.sols.filter(s => s.status === "aguardando_aprovacao").sort((a, b) => (b.urgente - a.urgente) || String(a.necessario_ate || "9").localeCompare(String(b.necessario_ate || "9")) || a.id - b.id);
  return `<div class="head"><div><h1>Aprovações</h1><div class="sub">${p.length ? `${p.length} aguardando aprovação · ${brl(total(p))}` : "Nenhuma solicitação aguardando aprovação"}</div></div></div>
    ${p.length ? `<div class="sols">${p.map(s => solCard(s, { acoes: true })).join("")}</div>` : vazio("Tudo em dia", "Quando um colaborador pedir uma compra, ela aparece aqui para você aprovar.")}
    ${decisoesHTML()}`;
}
function decisoesHTML() {
  const d = S.sols.filter(s => s.decidido_em).sort((a, b) => String(b.decidido_em).localeCompare(String(a.decidido_em))).slice(0, 12);
  if (!d.length) return "";
  return `<section class="card" style="margin-top:22px"><div class="panel" style="margin:0;padding-bottom:6px"><h2>Decisões recentes</h2></div><div class="tablewrap"><table style="min-width:640px"><thead><tr><th>Data</th><th>Solicitação</th><th>Solicitante</th><th class="num">Valor</th><th>Decisão</th></tr></thead><tbody>
    ${d.map(s => `<tr class="click" data-act="abrir" data-id="${s.id}"><td>${esc(fDH(s.decidido_em))}</td><td><b>${cod(s.id)}</b> ${esc(s.titulo)}</td><td>${esc(s.solicitante_nome)}</td><td class="num">${esc(brl(s.valor_estimado))}</td><td>${s.status === "reprovada" ? `<span class="pill st-bad">Reprovada</span>` : s.status === "cancelada" ? `<span class="pill st-desc">Cancelada</span>` : `<span class="pill st-ok">Aprovada</span>`}${s.decisao_obs ? `<br><small class="muted">${esc(s.decisao_obs)}</small>` : ""}</td></tr>`).join("")}
  </tbody></table></div></section>`;
}
function conferenciaHTML() {
  const c = S.sols.filter(s => s.status === "comprovante_enviado").sort((a, b) => String(a.comprovante_em).localeCompare(String(b.comprovante_em)));
  return `<div class="head"><div><h1>Conferência</h1><div class="sub">${c.length ? `${c.length} ${c.length === 1 ? "comprovante" : "comprovantes"} para conferir · ${brl(total(c))}` : "Nenhum comprovante para conferir"}</div></div></div>
    ${c.length ? `<div class="sols">${c.map(s => solCard(s, { acoes: true })).join("")}</div>` : vazio("Nada para conferir", "Quando o solicitante anexar o comprovante, a solicitação aparece aqui para você conferir e finalizar.")}`;
}
function andamentoHTML() {
  const grupos = [
    ["Financeiro/Compras vai comprar", S.sols.filter(s => s.status === "aprovada" && s.quem_compra === "financeiro")],
    ["O solicitante vai comprar · só acompanhar", S.sols.filter(s => s.status === "aprovada" && s.quem_compra === "solicitante")],
    ["Compradas · aguardando comprovante", S.sols.filter(s => s.status === "comprada").sort((a, b) => String(a.previsao || "9").localeCompare(String(b.previsao || "9")))],
    ["Reprovadas · aguardando ajuste do solicitante", S.sols.filter(s => s.status === "reprovada")],
  ];
  if (isComprador()) grupos.splice(3, 1); // comprador não precisa das reprovadas
  const n = grupos.reduce((a, g) => a + g[1].length, 0);
  return `<div class="head"><div><h1>${isComprador() ? "Para comprar" : "Em andamento"}</h1><div class="sub">${isComprador() ? `${grupos[0][1].length ? `${grupos[0][1].length} para comprar · ${brl(total(grupos[0][1])) || "sem valor"}` : "Nada para comprar agora"}${grupos[1][1].length ? ` · ${grupos[1][1].length} com o solicitante` : ""}${grupos[2][1].length ? ` · ${grupos[2][1].length} já ${grupos[2][1].length === 1 ? "comprada" : "compradas"}` : ""}` : n ? `${n} ${n === 1 ? "solicitação" : "solicitações"} entre a aprovação e o comprovante` : "Nada em andamento"}</div></div></div>
    ${n ? grupos.filter(g => g[1].length).map(([t, l]) => `<h2 style="color:var(--heading);font-size:17px;margin:20px 0 10px">${esc(t)} <span class="muted" style="font-weight:600">(${l.length})</span></h2><div class="sols">${l.map(s => solCard(s, { acoes: true })).join("")}</div>`).join("") : (isComprador() ? vazio("Nada para comprar", "Quando o Financeiro aprovar uma compra para o Financeiro/Compras fazer, ela aparece aqui e você recebe um e-mail.") : vazio("Nada em andamento", "Solicitações aprovadas aparecem aqui até o comprovante ser enviado."))}`;
}
function filtrar(arr) {
  const q = norm(S.q);
  return arr.filter(s => (!S.fStatus || (S.fStatus === "abertas" ? ABERTAS.includes(s.status) : s.status === S.fStatus))
    && (!S.fSetor || s.setor === S.fSetor) && (!S.fQuem || s.quem_compra === S.fQuem) && (!S.fTipo || (s.recorrencia || "unica") === S.fTipo) && (!S.fForma || (S.fForma === "-" ? !s.forma_pagamento : s.forma_pagamento === S.fForma))
    && (!q || norm([cod(s.id), s.id, s.titulo, s.solicitante_nome, s.solicitante_email, s.setor, s.empresa, s.justificativa, s.pedido, s.nf_numero, ...itensDe(s).map(i => i.item + " " + i.fornecedor)].join(" ")).includes(q)));
}
function todasHTML() {
  const l = filtrar(S.sols), setores = [...new Set(S.sols.map(s => s.setor).filter(Boolean))].sort();
  const formas = [...new Set([...lista("formas_pagamento"), ...S.sols.map(s => s.forma_pagamento).filter(Boolean)])];
  return `<div class="head"><div><h1>Todas as solicitações</h1><div class="sub">${l.length} de ${S.sols.length} · ${brl(total(l))}</div></div>
    <div class="actions"><button class="btn" data-act="exportar">${ICON("down")}Exportar Excel (CSV)</button></div></div>
  <div class="card filters"><label class="search">${ICON("search")}<input id="fq" placeholder="Buscar por número, título, item, solicitante, fornecedor, NF…" value="${esc(S.q)}" aria-label="Buscar"></label>
    <select id="fs" aria-label="Situação"><option value="">Todas as situações</option><option value="abertas" ${S.fStatus === "abertas" ? "selected" : ""}>Em aberto</option>${Object.entries(ST).map(([k, [l]]) => `<option value="${k}" ${S.fStatus === k ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
    <select id="fse" aria-label="Setor"><option value="">Todos os setores</option>${setores.map(x => `<option ${S.fSetor === x ? "selected" : ""}>${esc(x)}</option>`).join("")}</select>
    <select id="fqm" aria-label="Quem compra"><option value="">Quem compra: todos</option><option value="financeiro" ${S.fQuem === "financeiro" ? "selected" : ""}>Financeiro/Compras</option><option value="solicitante" ${S.fQuem === "solicitante" ? "selected" : ""}>Solicitante</option></select>
    <select id="ffp" aria-label="Forma de pagamento"><option value="">Pagamento: todas as formas</option>${formas.map(x => `<option ${S.fForma === x ? "selected" : ""}>${esc(x)}</option>`).join("")}<option value="-" ${S.fForma === "-" ? "selected" : ""}>Pagamento não definido</option></select>
    <select id="ftp" aria-label="Tipo de compra"><option value="">Tipo: todos</option>${Object.entries(REC).map(([k, l]) => `<option value="${k}" ${S.fTipo === k ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div>
  ${l.length ? `<div class="card tablewrap"><table style="min-width:1000px"><thead><tr><th>Nº</th><th>Aberta</th><th>Solicitação</th><th>Solicitante</th><th>Compra</th><th>Pagamento</th><th class="num">Estimado</th><th class="num">Pago</th><th>Situação</th></tr></thead><tbody>
    ${l.map(s => `<tr class="click" data-act="abrir" data-id="${s.id}"><td><b>${cod(s.id)}</b></td><td>${esc(fDia(s.criado_em.slice(0, 10)))}</td><td><b style="color:var(--heading)">${esc(s.titulo)}</b>${s.urgente && ABERTAS.includes(s.status) ? ` <span class="chip urg">Urgente</span>` : ""}<br><small class="muted">${esc(itensDe(s).map(i => `${i.quantidade}× ${i.item}`).join(", "))}</small></td>
      <td>${esc(s.solicitante_nome)}<br><small class="muted">${esc([s.setor, s.empresa].filter(Boolean).join(" · "))}</small></td><td>${s.quem_compra === "financeiro" ? "Financeiro/Compras" : "Solicitante"}</td><td>${s.forma_pagamento ? esc(s.forma_pagamento) : `<span class="muted">—</span>`}</td>
      <td class="num">${esc(brl(s.valor_estimado))}</td><td class="num">${esc(brl(s.valor_pago))}</td><td>${pill(s)}</td></tr>`).join("")}
  </tbody></table></div>` : vazio("Nada encontrado", "Ajuste a busca ou os filtros.")}`;
}
function painelHTML() {
  const by = st => S.sols.filter(s => s.status === st);
  const pend = by("aguardando_aprovacao"), conf = by("comprovante_enviado"), compraFin = S.sols.filter(s => s.status === "aprovada" && s.quem_compra === "financeiro");
  const espComp = S.sols.filter(s => s.status === "comprada" || (s.status === "aprovada" && s.quem_compra === "solicitante"));
  const mes = hoje().slice(0, 7), finMes = S.sols.filter(s => s.status === "finalizada" && String(s.conferido_em || "").slice(0, 7) === mes);
  const alertas = [];
  S.sols.filter(s => ABERTAS.includes(s.status)).forEach(s => {
    if (s.status === "aguardando_aprovacao" && s.urgente) alertas.push({ s, late: true, t: "Urgente aguardando aprovação" });
    if (s.necessario_ate && diasAte(s.necessario_ate) < 0 && !["comprovante_enviado"].includes(s.status)) alertas.push({ s, late: true, t: `Necessário até ${fDia(s.necessario_ate)} (vencido)` });
    if (s.status === "comprada" && s.previsao && diasAte(s.previsao) < -3) alertas.push({ s, late: false, t: `Previsão ${fDia(s.previsao)} passou e o comprovante não chegou` });
    if (s.status === "aguardando_aprovacao" && Date.now() - new Date(s.criado_em) > 2 * 864e5) alertas.push({ s, late: false, t: `Aguardando aprovação há ${Math.floor((Date.now() - new Date(s.criado_em)) / 864e5)} dias` });
    if (s.status === "comprovante_enviado" && Date.now() - new Date(s.comprovante_em) > 2 * 864e5) alertas.push({ s, late: false, t: "Comprovante esperando conferência há mais de 2 dias" });
  });
  const vistos = new Set(); // uma linha por solicitação, mantendo a primeira (mais grave)
  const alertasU = alertas.filter(a => !vistos.has(a.s.id) && vistos.add(a.s.id));
  S.sols.filter(s => ehAss(s) && s.recorrencia === "anual" && assSituacao(s) === "ativa").forEach(s => { const r = proxRenovacao(s); if (r && diasAte(r) <= 30) alertas.push({ s, late: diasAte(r) <= 7, t: `Assinatura anual renova em ${fDia(r)} (${diasAte(r)} dias)` }); });
  const setores = {}; finMes.forEach(s => { const k = s.setor || "Sem setor"; setores[k] = (setores[k] || 0) + Number(s.valor_pago || 0); });
  const ss = Object.entries(setores).sort((a, b) => b[1] - a[1]), max = ss.length ? ss[0][1] : 0;
  const tile = (v, ic, t, n, mini, hot) => `<button class="card tile ${hot && n ? "hot" : ""}" data-act="go" data-v="${v}"><div class="ti">${ICON(ic)}${esc(t)}</div><div class="big">${n}</div><div class="mini">${esc(mini)}</div></button>`;
  return `<div class="head"><div><h1>Painel</h1><div class="sub">Compras solicitadas pelos colaboradores</div></div>
    <div class="actions"><button class="btn" data-act="nova">${ICON("plus")}Nova solicitação</button></div></div>
  <div class="tiles">
    ${tile("aprovacoes", "check", "Aguardando aprovação", pend.length, brl(total(pend)) || "—", true)}
    ${tile("conferencia", "file", "Comprovantes para conferir", conf.length, brl(total(conf)) || "—", true)}
    ${tile("andamento", "cart", "Para o Financeiro/Compras comprar", compraFin.length, brl(total(compraFin)) || "—")}
    ${tile("andamento", "clip", "Aguardando comprovante", espComp.length, brl(total(espComp)) || "—")}
    ${tile("assinaturas", "undo", "Assinaturas ativas", S.sols.filter(s => ehAss(s) && assSituacao(s) === "ativa").length, (brl(S.sols.filter(s => ehAss(s) && assSituacao(s) === "ativa").reduce((a, s) => a + custoMes(s), 0)) || "R$ 0,00") + " por mês")}
    ${tile("todas", "ok", "Finalizadas no mês", finMes.length, (brl(total(finMes)) || "R$ 0,00") + " pagos")}
  </div>
  <div class="grid2">
    <section class="card panel"><div class="panelhead"><h2>Precisa de atenção${alertasU.length ? ` (${alertasU.length})` : ""}</h2></div>
      ${alertasU.length ? alertasU.slice(0, 12).map(a => `<div class="al ${a.late ? "late" : ""}" data-act="abrir" data-id="${a.s.id}"><i></i><b>${cod(a.s.id)}</b><span>${esc(a.s.titulo)} · ${esc(a.t)}</span>${ICON("eye")}</div>`).join("") : `<p class="muted" style="margin:0">Nada atrasado.</p>`}</section>
    <section class="card panel"><div class="panelhead"><h2>Pago no mês por setor</h2></div>
      ${ss.length ? ss.map(([k, v]) => `<div class="bar"><span>${esc(k)}</span><div class="tr"><span style="width:${max ? Math.max(3, v / max * 100) : 0}%"></span></div><b>${esc(brl(v))}</b></div>`).join("") : `<p class="muted" style="margin:0">Nenhuma solicitação finalizada neste mês.</p>`}</section>
  </div>`;
}
function configHTML() {
  const ls = (k, t, d) => `<label class="fld"><span>${esc(t)}</span><textarea id="cfg_${k}" rows="6">${esc(lista(k).join("\n"))}</textarea><small>${esc(d)}</small></label>`;
  return `<div class="head"><div><h1>Configurações</h1><div class="sub">Equipe e listas do formulário</div></div></div>
  <section class="card panel"><div class="panelhead"><h2>Equipe</h2><button class="btn sm primary" data-act="membro" data-email="">${ICON("plus")}Adicionar</button></div>
    <p class="muted" style="margin:0 0 12px;font-size:14px"><b>Financeiro</b> aprova, registra compras e confere comprovantes. <b>Comprador</b> vê as solicitações e só registra a compra das aprovadas. Qualquer pessoa com e-mail @grupozerbini.com.br pode entrar e pedir compras.</p>
    <div class="tablewrap"><table style="min-width:600px"><thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Recebe e-mails</th><th>Situação</th><th></th></tr></thead><tbody>
    ${S.membros.map(m => `<tr><td><b>${esc(m.nome || "—")}</b></td><td>${esc(m.email)}</td><td>${({ admin: "Administrador", financeiro: "Financeiro", comprador: "Comprador" })[m.papel] || m.papel}</td><td>${m.recebe_email ? "Sim" : "Não"}</td><td>${m.ativo ? `<span class="pill st-ok">Ativo</span>` : `<span class="pill st-desc">Inativo</span>`}</td>
      <td><div class="rowacts" style="justify-content:flex-end"><button class="btn sm" data-act="membro" data-email="${esc(m.email)}">${ICON("edit")}Editar</button></div></td></tr>`).join("")}
    </tbody></table></div></section>
  <section class="card panel"><div class="panelhead"><h2>Listas do formulário</h2><button class="btn sm primary" data-act="salvarlistas">${ICON("ok")}Salvar listas</button></div>
    <div class="fgrid" style="grid-template-columns:repeat(3,minmax(0,1fr))">
      ${ls("empresas", "Empresas do grupo", "Uma por linha. Se ficar vazia, o campo não aparece.")}
      ${ls("setores", "Setores", "Uma por linha.")}
      ${ls("formas_pagamento", "Formas de pagamento", "Uma por linha.")}
    </div></section>
  <p class="muted" style="font-size:13px">Versão ${VERSAO}</p>`;
}

// ---------- modais ----------
function openModal(html, cls = "") {
  closeModal();
  const ov = document.createElement("div"); ov.className = "ov";
  ov.innerHTML = `<div class="modal ${cls}" role="dialog" aria-modal="true"><button class="ib x" data-act="close" aria-label="Fechar">${ICON("x")}</button>${html}</div>`;
  ov.addEventListener("mousedown", e => { if (e.target === ov) fecharTudo(); });
  document.body.appendChild(ov); document.body.style.overflow = "hidden";
  const f = ov.querySelector("input:not([type=hidden]):not([type=radio]):not([type=checkbox]),textarea,select"); if (f && !("ontouchstart" in window)) f.focus();
}
function closeModal() { document.querySelectorAll(".ov").forEach(o => o.remove()); document.body.style.overflow = ""; }
function fecharTudo() {
  closeModal();
  if (S.det) { S.det = null; history.replaceState(null, "", "#v/" + S.view); }
}
const sol = id => S.sols.find(s => s.id === +id);

// detalhe
function detalheHTML(s) {
  const itens = itensDe(s), ev = S.eventos[s.id];
  const passos = [["Solicitada", true], ["Aprovada", !!s.decidido_em && s.status !== "reprovada"], ["Comprada", !!s.comprado_em || ["comprovante_enviado", "finalizada"].includes(s.status)], ["Comprovante", ["comprovante_enviado", "finalizada"].includes(s.status)], ["Finalizada", s.status === "finalizada"]];
  const ci = passos.findIndex(p => !p[1]);
  const kv = (l, v) => v ? `<div><label>${esc(l)}</label><p>${v}</p></div>` : "";
  const arq = (a, rm) => `<div class="file ${a.recusado ? "rec" : ""}">${ICON(a.mime && a.mime.startsWith("image/") ? "image" : "file")}<span class="nm"><button data-act="verarq" data-path="${esc(a.caminho)}" title="${esc(a.nome)}">${esc(a.nome)}</button></span><small>${esc(tam(a.tamanho))}${a.recusado ? " · devolvido" : ""}</small>${rm ? `<button class="ib" data-act="rmarq" data-aid="${a.id}" data-id="${s.id}" title="Remover" aria-label="Remover ${esc(a.nome)}">${ICON("trash")}</button>` : ""}</div>`;
  const comps = comprovantes(s), orcs = orcamentos(s);
  return `<h2><span class="muted" style="font-weight:700">${cod(s.id)}</span> ${esc(s.titulo)}</h2>
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin:-6px 0 14px">${pill(s)}${s.urgente && ABERTAS.includes(s.status) ? `<span class="chip urg">Urgente</span>` : ""}</div>
  ${["reprovada", "cancelada"].includes(s.status) ? "" : `<div class="steps">${passos.map((p, i) => `<span class="${p[1] ? "done" : i === ci ? "cur" : ""}">${esc(p[0])}</span>`).join("")}</div>`}
  ${s.status === "reprovada" ? `<div class="badnote" style="margin-bottom:14px"><b>Reprovada</b> por ${esc(nomeEmail(s.decidido_por))} em ${esc(fDH(s.decidido_em))}: ${esc(s.decisao_obs)}${dono(s) ? "<br>Você pode ajustar e reenviar, ou cancelar." : ""}</div>` : ""}
  ${s.assinatura_encerrada_em ? `<div class="note" style="margin-bottom:14px"><b>Assinatura encerrada</b> em ${esc(fDia(s.assinatura_encerrada_em))} por ${esc(nomeEmail(s.assinatura_encerrada_por))}: ${esc(s.assinatura_encerrada_motivo)}</div>` : ""}
  ${s.status === "cancelada" ? `<div class="note" style="margin-bottom:14px"><b>Cancelada</b> por ${esc(nomeEmail(s.cancelado_por))} em ${esc(fDH(s.cancelado_em))}: ${esc(s.cancelado_motivo)}</div>` : ""}
  ${s.devolucao_obs && ["aprovada", "comprada"].includes(s.status) ? `<div class="warnnote" style="margin-bottom:14px"><b>Comprovante devolvido pelo Financeiro:</b> ${esc(s.devolucao_obs)}</div>` : ""}
  ${proximoPasso(s) ? `<div class="note" style="margin-bottom:14px;color:var(--accent-2);font-weight:700">${ICON("clock")} ${esc(proximoPasso(s))}</div>` : ""}
  <div class="kv">
    ${kv("Solicitante", esc(s.solicitante_nome) + `<br><small class="muted">${esc(s.solicitante_email)}</small>`)}
    ${kv("Setor", esc(s.setor))}${kv("Empresa", esc(s.empresa))}
    ${kv("Aberta em", esc(fDH(s.criado_em)))}
    ${kv("Necessário até", s.necessario_ate ? esc(fDia(s.necessario_ate)) : "")}
    ${kv("Quem compra", esc(quemTxt(s)))}
    ${kv("Tipo", esc(REC[s.recorrencia] || "Compra única"))}
    ${kv("Forma de pagamento", esc(s.forma_pagamento))}
    ${kv("Valor estimado", s.valor_estimado != null ? esc(brl(s.valor_estimado) + POR[s.recorrencia || "unica"]) : "")}
    ${ehAss(s) && assSituacao(s) === "ativa" && proxRenovacao(s) ? kv("Próxima renovação", esc(fDia(proxRenovacao(s))) + ` <small class="muted">(${diasAte(proxRenovacao(s))} dias)</small>`) : ""}
    ${kv("Aprovada por", s.decidido_em && s.status !== "reprovada" ? `${esc(nomeEmail(s.decidido_por))}<br><small class="muted">${esc(fDH(s.decidido_em))}</small>` : "")}
    ${kv("Pedido", esc(s.pedido))}${kv("Previsão de chegada", s.previsao ? esc(fDia(s.previsao)) : "")}
    ${kv("Valor pago", s.valor_pago != null ? `<b>${esc(brl(s.valor_pago) + POR[s.recorrencia || "unica"])}</b>${s.valor_estimado != null && Number(s.valor_pago) !== Number(s.valor_estimado) ? `<br><small class="${Number(s.valor_pago) > Number(s.valor_estimado) ? "" : "muted"}" style="${Number(s.valor_pago) > Number(s.valor_estimado) ? "color:var(--danger);font-weight:700" : ""}">${Number(s.valor_pago) > Number(s.valor_estimado) ? "+" : ""}${esc(brl(s.valor_pago - s.valor_estimado))} do estimado</small>` : ""}` : "")}
    ${kv("Data da compra", s.data_compra ? esc(fDia(s.data_compra)) : "")}${kv("Nota fiscal", esc(s.nf_numero))}
    ${kv("Finalizada", s.conferido_em ? `${esc(nomeEmail(s.conferido_por))}<br><small class="muted">${esc(fDH(s.conferido_em))}</small>` : "")}
  </div>
  ${s.decisao_obs && s.status !== "reprovada" ? `<div class="blk"><label>Observação da aprovação</label><p class="txt">${esc(s.decisao_obs)}</p></div>` : ""}
  <div class="blk"><label>Justificativa</label><p class="txt">${esc(s.justificativa)}</p></div>
  <div class="blk"><label>Itens</label><div class="tablewrap card" style="box-shadow:none"><table style="min-width:560px"><thead><tr><th>Item</th><th class="num">Qtd.</th><th class="num">Valor un.</th><th class="num">Total</th><th>Fornecedor</th></tr></thead><tbody>
    ${itens.map(i => { const u = linkSeguro(i.link); return `<tr><td><b>${esc(i.item)}</b>${u ? `<br><a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${ICON("link")} link</a>` : i.link ? `<br><small class="muted">${esc(i.link)}</small>` : ""}${i.obs ? `<br><small class="muted">${esc(i.obs)}</small>` : ""}</td><td class="num">${i.quantidade}</td><td class="num">${esc(brl(i.valor_unit))}</td><td class="num">${i.valor_unit != null ? esc(brl(i.valor_unit * i.quantidade)) : ""}</td><td>${esc(i.fornecedor)}</td></tr>`; }).join("")}
    ${s.valor_estimado != null ? `<tr><td colspan="3" class="num"><b>Total estimado</b></td><td class="num"><b>${esc(brl(s.valor_estimado))}</b></td><td></td></tr>` : ""}
  </tbody></table></div></div>
  ${orcs.length ? `<div class="blk"><label>Orçamentos</label><div class="files">${orcs.map(a => arq(a, false)).join("")}</div></div>` : ""}
  ${comps.length || ["aprovada", "comprada"].includes(s.status) ? `<div class="blk"><label>Comprovantes</label>${comps.length ? `<div class="files">${comps.map(a => arq(a, false)).join("")}</div>` : `<p class="muted" style="margin:0">Nenhum comprovante anexado ainda.</p>`}${s.comprovante_obs ? `<p class="txt muted" style="margin-top:6px">${esc(s.comprovante_obs)}</p>` : ""}</div>` : ""}
  <div class="blk"><label>Histórico</label>${ev ? `<ul class="hist">${ev.slice().reverse().map(e => `<li><time>${esc(fDH(e.em))}</time><span>${esc(e.texto)} <em>· ${esc(e.por_nome)}</em></span></li>`).join("")}</ul>` : `<p class="muted">Carregando…</p>`}</div>
  ${botoes(s, false) ? `<div class="foot">${botoes(s, false)}</div>` : ""}`;
}
const nomeEmail = e => { if (!e) return "—"; if (S.eu && e === S.eu.email) return S.eu.nome; const m = S.membros.find(x => x.email === e); if (m && m.nome) return m.nome; const s = S.sols.find(x => x.solicitante_email === e); return s ? s.solicitante_nome : e.split("@")[0].replace(/\./g, " ").replace(/\b\w/g, c => c.toUpperCase()); };
async function abrirDetalhe(id) {
  let s = sol(id);
  if (!s) { toast("Solicitação não encontrada ou sem acesso."); return; }
  S.det = s.id; history.replaceState(null, "", "#s/" + s.id);
  openModal(`<div id="detBody">${detalheHTML(s)}</div>`);
  await carregarEventos(s.id); atualizarDetalhe();
}
function atualizarDetalhe() {
  const b = $("detBody"), s = sol(S.det); if (!b || !s) return;
  const y = b.closest(".ov").scrollTop; b.innerHTML = detalheHTML(s); b.closest(".ov").scrollTop = y;
}
async function verArquivo(path) {
  const w = window.open("about:blank", "_blank");
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 600);
  if (error) { if (w) w.close(); erro(error); return; }
  if (w) w.location = data.signedUrl; else location.href = data.signedUrl;
}

// formulário de nova / edição
const REC_TXT = { unica: "Pagamento uma vez só.", mensal: "Cobrança todo mês (ex.: software, serviço). Informe nos itens o valor por mês.", anual: "Cobrança uma vez por ano (ex.: licença anual). Informe nos itens o valor por ano." };
let FORM = null;
function formHTML() {
  const s = FORM.id ? sol(FORM.id) : null, d = FORM.d;
  const op = (arr, v, vazio) => `${vazio ? `<option value="">${esc(vazio)}</option>` : ""}${[...new Set([...arr, ...(v && !arr.includes(v) ? [v] : [])])].map(x => `<option ${x === v ? "selected" : ""}>${esc(x)}</option>`).join("")}`;
  const tot = d.itens.reduce((a, i) => a + (parseFloat(i.valor_unit) || 0) * (parseInt(i.quantidade) || 1), 0);
  return `<h2>${s ? (s.status === "reprovada" ? `Ajustar e reenviar ${cod(s.id)}` : `Editar ${cod(s.id)}`) : "Nova solicitação de compra"}</h2>
  ${s && s.status === "reprovada" ? `<div class="badnote" style="margin-bottom:12px"><b>Motivo da reprovação:</b> ${esc(s.decisao_obs)}</div>` : ""}
  <form class="f" id="fSol">
    <div class="fgrid">
      <label class="fld full"><span>O que precisa ser comprado <i>*</i></span><input id="s_titulo" maxlength="140" required value="${esc(d.titulo)}" placeholder="Ex.: Cadeira ergonômica para o atendimento"></label>
      <label class="fld"><span>Setor <i>*</i></span><select id="s_setor" required>${op(lista("setores"), d.setor, "Escolha")}</select></label>
      ${lista("empresas").length ? `<label class="fld"><span>Empresa</span><select id="s_empresa">${op(lista("empresas"), d.empresa, "—")}</select></label>` : `<span></span>`}
      <label class="fld"><span>Necessário até</span><input id="s_ate" type="date" min="${hoje()}" value="${esc(d.necessario_ate || "")}"></label>
      <label class="fld"><span>Forma de pagamento sugerida</span><select id="s_forma">${op(lista("formas_pagamento"), d.forma_pagamento, "A definir pelo Financeiro")}</select></label>
      <div class="fld full"><span>Quem vai fazer a compra? <i>*</i></span><div class="seg" role="radiogroup">
        <label><input type="radio" name="s_quem" value="financeiro" ${d.quem_compra !== "solicitante" ? "checked" : ""}>Financeiro/Compras</label>
        <label><input type="radio" name="s_quem" value="solicitante" ${d.quem_compra === "solicitante" ? "checked" : ""}>Eu mesmo compro</label></div>
        <small><b>Financeiro/Compras</b>: depois da aprovação, os setores Financeiro ou Compras fazem o pedido. <b>Eu mesmo compro</b>: você compra (cartão corporativo, reembolso…). Nos dois casos, você anexa o comprovante quando receber. O Financeiro pode mudar isso na aprovação.</small></div>
      <label class="fld full"><span>Justificativa <i>*</i></span><textarea id="s_just" required maxlength="2000" placeholder="Por que a compra é necessária?">${esc(d.justificativa)}</textarea></label>
      <div class="fld full"><span>Tipo de compra <i>*</i></span><div class="seg" role="radiogroup">
        <label><input type="radio" name="s_rec" value="unica" ${!d.recorrencia || d.recorrencia === "unica" ? "checked" : ""}>Compra única</label>
        <label><input type="radio" name="s_rec" value="mensal" ${d.recorrencia === "mensal" ? "checked" : ""}>Assinatura mensal</label>
        <label><input type="radio" name="s_rec" value="anual" ${d.recorrencia === "anual" ? "checked" : ""}>Assinatura anual</label></div>
        <small id="s_rec_txt">${REC_TXT[d.recorrencia || "unica"]}</small></div>
      <label class="check full"><input type="checkbox" id="s_urg" ${d.urgente ? "checked" : ""}> É urgente</label>
    </div>
    <div><div class="panelhead" style="margin-bottom:8px"><h2 style="font-size:16px;color:var(--heading);margin:0">Itens</h2><button type="button" class="btn sm" data-act="additem">${ICON("plus")}Adicionar item</button></div>
      <div class="itens">${d.itens.map((i, k) => `<div class="itrow" data-k="${k}">
        <label class="fld"><span>Item ${k + 1} <i>*</i></span><input data-f="item" maxlength="200" value="${esc(i.item)}" required placeholder="Descrição"></label>
        <label class="fld"><span>Qtd.</span><input data-f="quantidade" type="number" min="1" max="9999" value="${esc(i.quantidade)}"></label>
        <label class="fld vu"><span>Valor unit. (R$)</span><input data-f="valor_unit" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(i.valor_unit)}" placeholder="0,00"></label>
        <label class="fld forn"><span>Fornecedor</span><input data-f="fornecedor" maxlength="120" value="${esc(i.fornecedor)}"></label>
        <button type="button" class="ib" data-act="rmitem" data-k="${k}" title="Remover item" aria-label="Remover item ${k + 1}" ${d.itens.length < 2 ? "disabled" : ""}>${ICON("trash")}</button>
        <label class="fld lk"><span>Link ou observação</span><input data-f="link" maxlength="600" value="${esc(i.link)}" placeholder="https://… (opcional)"></label>
      </div>`).join("")}</div>
      <p class="itot" id="s_tot">${tot ? "Total estimado: " + brl(tot) + POR[d.recorrencia || "unica"] : ""}</p></div>
    <div><span class="fld"><span>Orçamentos (opcional)</span></span>
      ${s && orcamentos(s).length ? `<div class="files" style="margin:6px 0">${orcamentos(s).map(a => `<div class="file">${ICON("file")}<span class="nm"><button type="button" data-act="verarq" data-path="${esc(a.caminho)}">${esc(a.nome)}</button></span><small>${esc(tam(a.tamanho))}</small><button type="button" class="ib" data-act="rmarq" data-aid="${a.id}" data-id="${s.id}" data-form="1" aria-label="Remover">${ICON("trash")}</button></div>`).join("")}</div>` : ""}
      <label class="drop" style="margin-top:6px">${ICON("clip")} <span id="s_arqs">${FORM.files.length ? esc(FORM.files.map(f => f.name).join(", ")) : "Clique para anexar orçamentos, prints ou PDFs"}</span><input type="file" id="s_files" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.xml,.doc,.docx,.xls,.xlsx"></label></div>
    <div class="foot" style="margin-top:0"><button type="button" class="btn ghost" data-act="close">Voltar</button><button class="btn primary" id="s_btn">${ICON("ok")}${s ? (s.status === "reprovada" ? "Reenviar para aprovação" : "Salvar alterações") : "Enviar para aprovação"}</button></div>
  </form>`;
}
function lerItensForm() {
  document.querySelectorAll(".itrow").forEach(r => { const k = +r.dataset.k; r.querySelectorAll("[data-f]").forEach(i => { FORM.d.itens[k][i.dataset.f] = i.value; }); });
  const g = id => $(id) ? $(id).value : "";
  Object.assign(FORM.d, { titulo: g("s_titulo"), setor: g("s_setor"), empresa: g("s_empresa"), necessario_ate: g("s_ate"), forma_pagamento: g("s_forma"), justificativa: g("s_just"),
    urgente: $("s_urg") ? $("s_urg").checked : false, recorrencia: (document.querySelector("input[name=s_rec]:checked") || {}).value || "unica", quem_compra: (document.querySelector("input[name=s_quem]:checked") || {}).value || "financeiro" });
}
function abrirForm(id) {
  const s = id ? sol(id) : null;
  const novoItem = () => ({ item: "", quantidade: 1, valor_unit: "", fornecedor: "", link: "" });
  FORM = { id: s ? s.id : null, files: [], d: s ? { titulo: s.titulo, setor: s.setor, empresa: s.empresa, necessario_ate: s.necessario_ate, forma_pagamento: s.forma_pagamento, justificativa: s.justificativa, urgente: s.urgente, recorrencia: s.recorrencia || "unica", quem_compra: s.quem_compra,
    itens: itensDe(s).map(i => ({ item: i.item, quantidade: i.quantidade, valor_unit: i.valor_unit ?? "", fornecedor: i.fornecedor, link: [i.link, i.obs].filter(Boolean).join(" · ") })) }
    : { titulo: "", setor: S.eu.setor && lista("setores").includes(S.eu.setor) ? S.eu.setor : (S.eu.setor || ""), empresa: "", necessario_ate: "", forma_pagamento: "", justificativa: "", urgente: false, recorrencia: "unica", quem_compra: "financeiro", itens: [novoItem()] } };
  FORM.novoItem = novoItem;
  openModal(formHTML());
}
function reformar() { lerItensForm(); const ov = document.querySelector(".ov"), y = ov ? ov.scrollTop : 0; document.querySelector(".modal").innerHTML = `<button class="ib x" data-act="close" aria-label="Fechar">${ICON("x")}</button>` + formHTML(); if (ov) ov.scrollTop = y; }
async function salvarForm(f) {
  lerItensForm(); const d = FORM.d;
  if (!d.setor) { toast("Escolha o setor."); return; }
  const itens = d.itens.filter(i => String(i.item).trim()).map(i => ({ item: i.item.trim(), quantidade: parseInt(i.quantidade) || 1, valor_unit: (v => isFinite(v) && v >= 0 ? String(Math.round(v * 100) / 100) : "")(parseFloat(String(i.valor_unit).replace(",", "."))), fornecedor: i.fornecedor, link: i.link }));
  if (!itens.length) { toast("Inclua ao menos um item."); return; }
  const btn = $("s_btn"); btn.disabled = true;
  const { data: id, error } = await sb.rpc("fc_salvar", { p_id: FORM.id, p: { ...d, itens } });
  if (error) { btn.disabled = false; erro(error); return; }
  if (FORM.files.length) { btn.textContent = "Enviando anexos…"; try { await enviarArquivos(id, "orcamento", FORM.files); } catch (e) { erro(e); } }
  const novo = !FORM.id; FORM = null; closeModal();
  if (novo && S.view !== "minhas" && !isFin()) S.view = "minhas";
  await recarregar(); toast(novo ? `Solicitação ${cod(id)} enviada para o Financeiro.` : "Solicitação atualizada.");
}
async function enviarArquivos(sid, tipo, files) {
  for (const f of files) {
    if (f.size > MAX_MB * 1048576) { toast(`${f.name} passa de ${MAX_MB} MB e não foi enviado.`); continue; }
    const seguro = f.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\-]+/g, "_").slice(-80) || "arquivo";
    const rid = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).slice(0, 13);
    const path = `${sid}/${tipo}/${rid}-${seguro}`;
    const up = await sb.storage.from(BUCKET).upload(path, f, { contentType: f.type || "application/octet-stream", upsert: false });
    if (up.error) throw up.error;
    const { error } = await sb.rpc("fc_anexo_registrar", { p_sol: sid, p_tipo: tipo, p_caminho: path, p_nome: f.name, p_tamanho: f.size, p_mime: f.type || "" });
    if (error) { await sb.storage.from(BUCKET).remove([path]); throw error; }
  }
}
async function removerArquivo(aid, sid, doForm) {
  if (!confirmar("Remover este anexo?")) return;
  const { data: path, error } = await sb.rpc("fc_anexo_remover", { p_id: +aid });
  if (error) { erro(error); return; }
  await sb.storage.from(BUCKET).remove([path]);
  await carregarSols(); await carregarEventos(+sid);
  if (doForm && FORM) reformar(); else if ($("cpBody")) comprovanteModal(+sid, true); else atualizarDetalhe();
  render(); toast("Anexo removido.");
}
const confirmar = m => window.confirm(m);

// aprovar / reprovar
const QDEC = { financeiro: "Vai para a tela Para comprar e os compradores recebem e-mail.", solicitante: "O solicitante recebe e-mail para comprar; não vai para a tela Para comprar." };
function decidirModal(id) {
  const s = sol(id); if (!s) return;
  openModal(`<h2>Aprovar ${cod(s.id)}?</h2>
  <div class="note" style="margin-bottom:14px"><b style="color:var(--heading)">${esc(s.titulo)}</b> · ${esc(s.solicitante_nome)}${s.setor ? ` (${esc(s.setor)})` : ""}<br>
    ${itensDe(s).map(i => `${i.quantidade}× ${esc(i.item)}${i.valor_unit != null ? ` — ${esc(brl(i.valor_unit * i.quantidade))}` : ""}`).join("<br>")}
    ${s.valor_estimado != null ? `<br><b>Total estimado: ${esc(brl(s.valor_estimado))}</b>` : ""}<br><span class="muted">${esc(s.justificativa)}</span>
    ${orcamentos(s).length ? `<br>${orcamentos(s).map(a => `<button class="linkbtn" data-act="verarq" data-path="${esc(a.caminho)}">${ICON("file")} ${esc(a.nome)}</button>`).join(" ")}` : ""}</div>
  <form class="f" id="fDec" data-id="${s.id}">
    <div class="fld"><span>Quem vai fazer a compra? <small>(o solicitante pediu: ${esc(s.quem_compra === "solicitante" ? "ele mesmo" : "Financeiro/Compras")})</small></span><div class="seg">
      <label><input type="radio" name="d_quem" value="financeiro" ${s.quem_compra === "financeiro" ? "checked" : ""}>Financeiro/Compras</label>
      <label><input type="radio" name="d_quem" value="solicitante" ${s.quem_compra === "solicitante" ? "checked" : ""}>O solicitante</label></div>
      <small id="d_quem_txt">${s.quem_compra === "solicitante" ? QDEC.solicitante : QDEC.financeiro}</small></div>
    <label class="fld"><span>Forma de pagamento</span><select id="d_forma"><option value="">${s.forma_pagamento ? esc(s.forma_pagamento) : "A definir"}</option>${lista("formas_pagamento").filter(x => x !== s.forma_pagamento).map(x => `<option>${esc(x)}</option>`).join("")}</select></label>
    <label class="fld"><span>Observação <small>(obrigatória para reprovar; vai para o solicitante)</small></span><textarea id="d_obs" maxlength="1000" placeholder="Ex.: comprar no fornecedor X / reprovado porque…"></textarea></label>
    <div class="foot"><button type="button" class="btn ghost" data-act="close">Voltar</button><button type="button" class="btn danger" data-act="reprovar" data-id="${s.id}">${ICON("x")}Reprovar</button><button class="btn ok">${ICON("ok")}Aprovar</button></div>
  </form>`, "sm");
}
async function decidir(id, aprovar) {
  const obs = $("d_obs").value.trim();
  if (!aprovar && !obs) { toast("Escreva o motivo da reprovação."); $("d_obs").focus(); return; }
  document.querySelectorAll(".modal .btn").forEach(b => b.disabled = true);
  const { error } = await sb.rpc("fc_decidir", { p_id: +id, p_aprovar: aprovar, p_obs: obs, p_quem_compra: (document.querySelector("input[name=d_quem]:checked") || {}).value || null, p_forma: $("d_forma").value || null });
  if (error) { document.querySelectorAll(".modal .btn").forEach(b => b.disabled = false); erro(error); return; }
  closeModal(); S.det = null; await recarregar(); toast(aprovar ? `${cod(id)} aprovada.` : `${cod(id)} reprovada.`);
}

// registrar compra
function compraModal(id) {
  const s = sol(id); if (!s) return;
  openModal(`<h2>${s.status === "comprada" ? "Atualizar compra" : "Registrar compra"} ${cod(s.id)}</h2>
  <p class="muted" style="margin:-4px 0 14px">${esc(s.titulo)}. ${dono(s) ? "Registre quando fizer o pedido; o comprovante você anexa em seguida." : "O solicitante recebe um aviso para anexar o comprovante quando receber."}</p>
  <form class="f" id="fCompra" data-id="${s.id}"><div class="fgrid">
    <label class="fld"><span>Nº do pedido</span><input id="c_ped" maxlength="80" value="${esc(s.pedido)}"></label>
    <label class="fld"><span>Previsão de chegada</span><input id="c_prev" type="date" value="${esc(s.previsao || "")}"></label>
    <label class="fld full"><span>Observação</span><input id="c_obs" maxlength="300" placeholder="Opcional"></label></div>
    <div class="foot"><button type="button" class="btn ghost" data-act="close">Voltar</button><button class="btn primary">${ICON("cart")}Salvar</button></div></form>`, "sm");
}
async function salvarCompra(f) {
  const btn = f.querySelector(".btn.primary"); btn.disabled = true;
  const { error } = await sb.rpc("fc_registrar_compra", { p_id: +f.dataset.id, p_pedido: $("c_ped").value, p_previsao: $("c_prev").value || null, p_obs: $("c_obs").value });
  if (error) { btn.disabled = false; erro(error); return; }
  closeModal(); S.det = null; await recarregar(); toast("Compra registrada.");
}

// comprovante (solicitante)
let CP = null;
function comprovanteModal(id, manter) {
  const s = sol(id); if (!s) return;
  if (!manter || !CP) CP = { valor: s.valor_pago ?? s.valor_estimado ?? "", data: s.data_compra || hoje(), nf: s.nf_numero || "", obs: "" };
  else lerCP();
  const comps = comprovantes(s).filter(a => !a.recusado), rec = comprovantes(s).filter(a => a.recusado);
  const html = `<div id="cpBody"><h2>Comprovante de compra ${cod(s.id)}</h2>
  <p class="muted" style="margin:-4px 0 14px">${esc(s.titulo)}${s.valor_estimado != null ? ` · estimado ${esc(brl(s.valor_estimado))}` : ""}</p>
  ${s.devolucao_obs ? `<div class="warnnote" style="margin-bottom:12px"><b>O Financeiro devolveu o comprovante anterior:</b> ${esc(s.devolucao_obs)}</div>` : ""}
  <form class="f" id="fComp" data-id="${s.id}">
    <div><label class="drop" id="cp_drop">${ICON("clip")} Clique ou arraste aqui a nota fiscal, cupom ou comprovante de pagamento (PDF ou foto, até ${MAX_MB} MB)<input type="file" id="cp_files" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.xml"></label>
      ${comps.length ? `<div class="files" style="margin-top:8px">${comps.map(a => `<div class="file">${ICON(a.mime && a.mime.startsWith("image/") ? "image" : "file")}<span class="nm"><button type="button" data-act="verarq" data-path="${esc(a.caminho)}">${esc(a.nome)}</button></span><small>${esc(tam(a.tamanho))}</small><button type="button" class="ib" data-act="rmarq" data-aid="${a.id}" data-id="${s.id}" aria-label="Remover ${esc(a.nome)}">${ICON("trash")}</button></div>`).join("")}</div>` : `<p class="muted" style="margin:8px 0 0;font-size:14px">Nenhum comprovante anexado.</p>`}
      ${rec.length ? `<p class="muted" style="margin:8px 0 0;font-size:13px">Devolvidos: ${esc(rec.map(a => a.nome).join(", "))}</p>` : ""}</div>
    <div class="fgrid">
      <label class="fld"><span>Valor pago (R$) <i>*</i></span><input id="cp_valor" type="number" min="0.01" step="0.01" inputmode="decimal" required value="${esc(CP.valor)}"></label>
      <label class="fld"><span>Data da compra <i>*</i></span><input id="cp_data" type="date" max="${hoje()}" required value="${esc(CP.data)}"></label>
      <label class="fld"><span>Nº da nota fiscal</span><input id="cp_nf" maxlength="60" value="${esc(CP.nf)}"></label>
      <label class="fld"><span>Observação</span><input id="cp_obs" maxlength="500" value="${esc(CP.obs)}" placeholder="Ex.: pago no cartão corporativo final 1234"></label>
    </div>
    <div class="foot"><button type="button" class="btn ghost" data-act="close">Voltar</button><button class="btn primary" id="cp_btn" ${comps.length ? "" : "disabled title=\"Anexe o comprovante primeiro\""}>${ICON("ok")}Enviar para o Financeiro conferir</button></div>
  </form></div>`;
  if (manter && $("cpBody")) { $("cpBody").outerHTML = html; ligarDrop(); return; }
  openModal(html, "sm"); ligarDrop();
}
function lerCP() { if (!$("cp_valor")) return; CP = { valor: $("cp_valor").value, data: $("cp_data").value, nf: $("cp_nf").value, obs: $("cp_obs").value }; }
function ligarDrop() {
  const d = $("cp_drop"); if (!d) return;
  ["dragenter", "dragover"].forEach(e => d.addEventListener(e, ev => { ev.preventDefault(); d.classList.add("on"); }));
  ["dragleave", "drop"].forEach(e => d.addEventListener(e, ev => { ev.preventDefault(); d.classList.remove("on"); }));
  d.addEventListener("drop", ev => { if (ev.dataTransfer.files.length) anexarComprovantes([...ev.dataTransfer.files]); });
}
async function anexarComprovantes(files) {
  const f = $("fComp"); if (!f) return; const id = +f.dataset.id; lerCP();
  const d = $("cp_drop"); d.firstChild && (d.innerHTML = `${ICON("clip")} Enviando ${files.length} arquivo(s)…`);
  try { await enviarArquivos(id, "comprovante", files); } catch (e) { erro(e); }
  await carregarSols(); comprovanteModal(id, true); render();
}
async function enviarComprovante(f) {
  lerCP(); const v = parseFloat(String(CP.valor).replace(",", "."));
  if (!(v > 0)) { toast("Informe o valor pago."); return; }
  const btn = $("cp_btn"); btn.disabled = true;
  const { error } = await sb.rpc("fc_enviar_comprovante", { p_id: +f.dataset.id, p_valor_pago: v, p_data_compra: CP.data, p_nf: CP.nf, p_obs: CP.obs });
  if (error) { btn.disabled = false; erro(error); return; }
  CP = null; closeModal(); S.det = null; await recarregar(); toast("Comprovante enviado. O Financeiro vai conferir e finalizar.");
}

// conferência (Financeiro)
function conferirModal(id) {
  const s = sol(id); if (!s) return;
  const comps = comprovantes(s).filter(a => !a.recusado), dif = s.valor_estimado != null ? s.valor_pago - s.valor_estimado : null;
  openModal(`<h2>Conferir comprovante ${cod(s.id)}</h2>
  <div class="note" style="margin-bottom:14px"><b style="color:var(--heading)">${esc(s.titulo)}</b> · ${esc(s.solicitante_nome)}<br>
    Valor pago: <b>${esc(brl(s.valor_pago))}</b>${dif ? ` <span style="${dif > 0 ? "color:var(--danger);font-weight:700" : ""}">(${dif > 0 ? "+" : ""}${esc(brl(dif))} do estimado de ${esc(brl(s.valor_estimado))})</span>` : s.valor_estimado != null ? " (igual ao estimado)" : ""}<br>
    Data da compra: ${esc(fDia(s.data_compra))}${s.nf_numero ? ` · NF ${esc(s.nf_numero)}` : ""}${s.forma_pagamento ? ` · ${esc(s.forma_pagamento)}` : ""}${s.pedido ? ` · pedido ${esc(s.pedido)}` : ""}
    ${s.comprovante_obs ? `<br><span class="muted">${esc(s.comprovante_obs)}</span>` : ""}</div>
  <div class="files" style="margin-bottom:14px">${comps.map(a => `<div class="file">${ICON(a.mime && a.mime.startsWith("image/") ? "image" : "file")}<span class="nm"><button data-act="verarq" data-path="${esc(a.caminho)}">${esc(a.nome)}</button></span><small>${esc(tam(a.tamanho))}</small><button class="btn sm" data-act="verarq" data-path="${esc(a.caminho)}">${ICON("eye")}Abrir</button></div>`).join("")}</div>
  <form class="f" id="fConf" data-id="${s.id}">
    <label class="fld"><span>Observação <small>(obrigatória para devolver; vai para o solicitante)</small></span><textarea id="cf_obs" maxlength="1000" placeholder="Ex.: a nota está ilegível / falta o comprovante de pagamento"></textarea></label>
    <div class="foot"><button type="button" class="btn ghost" data-act="close">Voltar</button><button type="button" class="btn danger" data-act="devolver" data-id="${s.id}">${ICON("undo")}Devolver ao solicitante</button><button class="btn ok">${ICON("ok")}Conferido · finalizar</button></div>
  </form>`, "sm");
}
async function conferir(id, ok) {
  const obs = $("cf_obs").value.trim();
  if (!ok && !obs) { toast("Explique o que precisa ser corrigido."); $("cf_obs").focus(); return; }
  document.querySelectorAll(".modal .btn").forEach(b => b.disabled = true);
  const { error } = await sb.rpc("fc_conferir", { p_id: +id, p_ok: ok, p_obs: obs });
  if (error) { document.querySelectorAll(".modal .btn").forEach(b => b.disabled = false); erro(error); return; }
  closeModal(); S.det = null; await recarregar(); toast(ok ? `${cod(id)} finalizada.` : "Comprovante devolvido ao solicitante.");
}

function cancelarModal(id) {
  const s = sol(id); if (!s) return;
  openModal(`<h2>Cancelar ${cod(s.id)}?</h2><form class="f" id="fCanc" data-id="${s.id}">
    <p style="margin:0">${esc(s.titulo)} deixa de ser comprada. ${["comprada"].includes(s.status) ? "Se o pedido já foi feito na loja, cancele lá também. " : ""}O registro continua no histórico.</p>
    <label class="fld"><span>Motivo <i>*</i></span><input id="cc_mot" maxlength="300" required></label>
    <div class="foot"><button type="button" class="btn ghost" data-act="close">Voltar</button><button class="btn danger">${ICON("x")}Cancelar solicitação</button></div></form>`, "sm");
}
async function cancelar(f) {
  const btn = f.querySelector(".btn.danger"); btn.disabled = true;
  const { error } = await sb.rpc("fc_cancelar", { p_id: +f.dataset.id, p_motivo: $("cc_mot").value });
  if (error) { btn.disabled = false; erro(error); return; }
  closeModal(); S.det = null; await recarregar(); toast("Solicitação cancelada.");
}

// assinaturas
function assinaturasHTML() {
  const q = norm(S.q), todas = S.sols.filter(ehAss);
  const ativas = todas.filter(s => assSituacao(s) === "ativa");
  const l = todas.filter(s => (S.fAss === "todas" || assSituacao(s) === S.fAss) && (!q || norm([cod(s.id), s.titulo, s.solicitante_nome, s.setor, s.empresa, ...itensDe(s).map(i => i.item + " " + i.fornecedor)].join(" ")).includes(q)))
    .sort((a, b) => { const o = { ativa: 0, contratacao: 1, encerrada: 2, fora: 3 }, ra = assSituacao(a) === "ativa" ? proxRenovacao(a) : null, rb = assSituacao(b) === "ativa" ? proxRenovacao(b) : null;
      return o[assSituacao(a)] - o[assSituacao(b)] || String(ra || "9").localeCompare(String(rb || "9")) || a.id - b.id; });
  const mes = ativas.reduce((a, s) => a + custoMes(s), 0), ano = ativas.reduce((a, s) => a + custoAno(s), 0);
  const ren30 = ativas.filter(s => { const r = proxRenovacao(s); return s.recorrencia === "anual" && r && diasAte(r) <= 30; });
  const porSetor = {}; ativas.forEach(s => { const k = s.setor || "Sem setor"; porSetor[k] = (porSetor[k] || 0) + custoMes(s); });
  const ss = Object.entries(porSetor).sort((a, b) => b[1] - a[1]), max = ss.length ? ss[0][1] : 0;
  const sit = s => ({ ativa: `<span class="pill st-ok">Ativa</span>`, encerrada: `<span class="pill st-desc">Encerrada ${esc(fDia(s.assinatura_encerrada_em))}</span>`, contratacao: `<span class="pill st-sol">Em contratação</span>`, fora: pill(s) })[assSituacao(s)];
  const tile = (ic, t, n, mini, hot) => `<div class="card tile ${hot ? "hot" : ""}" style="cursor:default"><div class="ti">${ICON(ic)}${esc(t)}</div><div class="big">${n}</div><div class="mini">${esc(mini)}</div></div>`;
  return `<div class="head"><div><h1>Assinaturas</h1><div class="sub">Compras recorrentes: mensais e anuais</div></div></div>
  <div class="tiles">
    ${tile("undo", "Ativas", ativas.length, `${ativas.filter(s => s.recorrencia === "mensal").length} mensais · ${ativas.filter(s => s.recorrencia === "anual").length} anuais`)}
    ${tile("cart", "Custo por mês", brl(mes) || "R$ 0,00", "anuais divididas por 12")}
    ${tile("list", "Custo por ano", brl(ano) || "R$ 0,00", "mensais × 12 + anuais")}
    ${tile("clock", "Anuais renovando em 30 dias", ren30.length, ren30.length ? brl(total(ren30)) : "nenhuma", ren30.length > 0)}
  </div>
  ${ss.length ? `<section class="card panel"><div class="panelhead"><h2>Custo mensal por setor</h2></div>${ss.map(([k, v]) => `<div class="bar"><span>${esc(k)}</span><div class="tr"><span style="width:${max ? Math.max(3, v / max * 100) : 0}%"></span></div><b>${esc(brl(v))}</b></div>`).join("")}</section>` : ""}
  <div class="card filters"><label class="search">${ICON("search")}<input id="fq" placeholder="Buscar por número, título, item, fornecedor, setor…" value="${esc(S.q)}" aria-label="Buscar"></label>
    <select id="fas" aria-label="Situação da assinatura"><option value="ativa" ${S.fAss === "ativa" ? "selected" : ""}>Ativas</option><option value="contratacao" ${S.fAss === "contratacao" ? "selected" : ""}>Em contratação</option><option value="encerrada" ${S.fAss === "encerrada" ? "selected" : ""}>Encerradas</option><option value="todas" ${S.fAss === "todas" ? "selected" : ""}>Todas</option></select></div>
  ${l.length ? `<div class="card tablewrap"><table style="min-width:980px"><thead><tr><th>Nº</th><th>Assinatura</th><th>Solicitante</th><th>Tipo</th><th class="num">Valor</th><th class="num">Por mês</th><th>Início</th><th>Próxima renovação</th><th>Situação</th></tr></thead><tbody>
    ${l.map(s => { const r = assSituacao(s) === "ativa" ? proxRenovacao(s) : null, d = r ? diasAte(r) : null;
      return `<tr class="click" data-act="abrir" data-id="${s.id}"><td><b>${cod(s.id)}</b></td><td><b style="color:var(--heading)">${esc(s.titulo)}</b><br><small class="muted">${esc(itensDe(s).map(i => i.item + (i.fornecedor ? ` (${i.fornecedor})` : "")).join(", "))}</small></td>
        <td>${esc(s.solicitante_nome)}<br><small class="muted">${esc([s.setor, s.empresa].filter(Boolean).join(" · "))}</small></td><td>${s.recorrencia === "mensal" ? "Mensal" : "Anual"}</td>
        <td class="num">${valorRef(s) != null ? esc(brl(valorRef(s)) + POR[s.recorrencia]) : `<span class="muted">—</span>`}</td><td class="num">${valorRef(s) != null ? esc(brl(custoMes(s))) : ""}</td>
        <td>${esc(fDia(assInicio(s)) || "—")}</td><td>${r ? `<span style="${s.recorrencia === "anual" && d <= 30 ? "color:var(--danger);font-weight:800" : ""}">${esc(fDia(r))}</span><br><small class="muted">em ${d} ${d === 1 ? "dia" : "dias"}</small>` : `<span class="muted">—</span>`}</td><td>${sit(s)}</td></tr>`; }).join("")}
  </tbody></table></div>` : vazio(S.fAss === "ativa" ? "Nenhuma assinatura ativa" : "Nada encontrado", "Quando alguém pedir uma assinatura mensal ou anual e a compra for feita, ela aparece aqui com o custo e a próxima renovação.")}
  <p class="muted" style="font-size:13px;margin-top:10px">A assinatura fica ativa a partir da compra e até o Financeiro encerrar. O valor é o pago no comprovante (ou o estimado, enquanto não houver). Anuais avisam o Financeiro por e-mail 30 e 7 dias antes da renovação.</p>`;
}
function encerrarAssModal(id) {
  const s = sol(id); if (!s) return;
  openModal(`<h2>Encerrar assinatura ${cod(s.id)}?</h2><form class="f" id="fEncAss" data-id="${s.id}">
    <p style="margin:0"><b>${esc(s.titulo)}</b> (${esc(REC[s.recorrencia].toLowerCase())}) deixa de contar como ativa a partir da data abaixo. Cancele também no fornecedor, se ainda não cancelou. O solicitante recebe um aviso.</p>
    <div class="fgrid"><label class="fld"><span>Encerrada em <i>*</i></span><input id="ea_data" type="date" required value="${hoje()}"></label></div>
    <label class="fld"><span>Motivo <i>*</i></span><input id="ea_mot" required maxlength="300" placeholder="Ex.: não é mais usada / trocamos de ferramenta"></label>
    <div class="foot"><button type="button" class="btn ghost" data-act="close">Voltar</button><button class="btn danger" id="eaBtn">${ICON("x")}Encerrar assinatura</button></div></form>`, "sm");
}
async function encerrarAss(f) {
  const btn = $("eaBtn"); btn.disabled = true;
  const { error } = await sb.rpc("fc_encerrar_assinatura", { p_id: +f.dataset.id, p_data: $("ea_data").value || null, p_motivo: $("ea_mot").value });
  if (error) { btn.disabled = false; erro(error); return; }
  closeModal(); S.det = null; await recarregar(); toast("Assinatura encerrada.");
}

// excluir (administrador): testes ou lançadas por engano
function excluirModal(id) {
  const s = sol(id); if (!s) return;
  const n = (s.fc_anexos || []).length;
  openModal(`<h2>Excluir ${cod(s.id)}?</h2><form class="f" id="fExc" data-id="${s.id}">
    <p style="margin:0">Use para testes ou solicitações lançadas por engano. <b>${esc(s.titulo)}</b> some de todas as telas, com itens${n ? `, histórico e ${n} ${n === 1 ? "anexo" : "anexos"}` : " e histórico"}. Não dá para desfazer. Fica registrado quem excluiu, quando e o motivo.</p>
    ${ABERTAS.includes(s.status) && s.status !== "aguardando_aprovacao" ? `<div class="warnnote">Esta solicitação está em andamento. Se for uma compra real, prefira <b>Cancelar</b>, que mantém o histórico.</div>` : ""}
    <label class="fld"><span>Motivo <i>*</i></span><input id="ex_mot" required maxlength="200" placeholder="Ex.: solicitação de teste"></label>
    <label class="fld"><span>Para confirmar, digite o número <b>${s.id}</b></span><input id="ex_conf" inputmode="numeric" autocomplete="off"></label>
    <div class="foot"><button type="button" class="btn ghost" data-act="close">Voltar</button><button class="btn danger" id="exBtn">${ICON("trash")}Excluir</button></div></form>`, "sm");
}
async function excluir(f) {
  const id = +f.dataset.id, mot = $("ex_mot").value.trim();
  if (!mot) { toast("Informe o motivo."); return; }
  if ($("ex_conf").value.trim().replace(/^#?0*/, "") !== String(id)) { toast(`Digite ${id} para confirmar.`); return; }
  const btn = $("exBtn"); btn.disabled = true;
  const { data: arqs, error } = await sb.rpc("fc_excluir", { p_id: id, p_motivo: mot });
  if (error) { btn.disabled = false; erro(error); return; }
  if (arqs && arqs.length) await sb.storage.from(BUCKET).remove(arqs);
  closeModal(); S.det = null; history.replaceState(null, "", "#v/" + S.view); await recarregar(); toast(`Solicitação ${cod(id)} excluída.`);
}

// administração
function membroModal(email) {
  const m = S.membros.find(x => x.email === email) || { email: "", nome: "", papel: "financeiro", ativo: true, recebe_email: true };
  openModal(`<h2>${email ? "Editar pessoa" : "Adicionar à equipe"}</h2><form class="f" id="fMembro" data-orig="${esc(email)}">
    <label class="fld"><span>E-mail <i>*</i></span><input id="m_email" type="email" required value="${esc(m.email)}" ${email ? "readonly" : ""} placeholder="nome@grupozerbini.com.br"></label>
    <label class="fld"><span>Nome</span><input id="m_nome" maxlength="80" value="${esc(m.nome)}"></label>
    <label class="fld"><span>Perfil</span><select id="m_papel"><option value="comprador" ${m.papel === "comprador" ? "selected" : ""}>Comprador: só registra as compras aprovadas</option><option value="financeiro" ${m.papel === "financeiro" ? "selected" : ""}>Financeiro: aprova, compra e confere</option><option value="admin" ${m.papel === "admin" ? "selected" : ""}>Administrador: Financeiro + configurações</option></select></label>
    <label class="check"><input type="checkbox" id="m_mail" ${m.recebe_email ? "checked" : ""}> Recebe e-mails (Financeiro: novas solicitações e comprovantes · Comprador: compras aprovadas)</label>
    <label class="check"><input type="checkbox" id="m_ativo" ${m.ativo ? "checked" : ""}> Ativo</label>
    <div class="foot">${email ? `<button type="button" class="btn ghost" data-act="rmmembro" data-email="${esc(email)}" style="margin-right:auto">${ICON("trash")}Remover</button>` : ""}<button type="button" class="btn ghost" data-act="close">Voltar</button><button class="btn primary">${ICON("ok")}Salvar</button></div></form>`, "sm");
}
async function salvarMembro(f) {
  const { error } = await sb.rpc("fc_membro_salvar", { p_email: $("m_email").value, p_nome: $("m_nome").value, p_papel: $("m_papel").value, p_ativo: $("m_ativo").checked, p_recebe_email: $("m_mail").checked });
  if (error) { erro(error); return; }
  closeModal(); await carregarMembros(); render(); toast("Equipe atualizada.");
}
async function removerMembro(email) {
  if (!confirmar(`Remover ${email} da equipe? A pessoa continua podendo pedir compras.`)) return;
  const { error } = await sb.rpc("fc_membro_remover", { p_email: email }); if (error) { erro(error); return; }
  closeModal(); await carregarMembros(); render(); toast("Removido da equipe.");
}
async function salvarListas() {
  for (const k of ["empresas", "setores", "formas_pagamento"]) {
    const v = [...new Set($("cfg_" + k).value.split("\n").map(x => x.trim()).filter(Boolean))];
    const { error } = await sb.rpc("fc_config_salvar", { p_chave: k, p_valor: v }); if (error) { erro(error); return; }
    S.cfg[k] = v;
  }
  render(); toast("Listas salvas.");
}
function exportar() {
  const l = filtrar(S.sols), sep = ";";
  const cab = ["Nº", "Aberta em", "Solicitante", "E-mail", "Setor", "Empresa", "Título", "Itens", "Justificativa", "Urgente", "Necessário até", "Quem compra", "Tipo", "Forma de pagamento", "Valor estimado", "Situação", "Decidido por", "Decidido em", "Obs. decisão", "Pedido", "Previsão", "Valor pago", "Data da compra", "NF", "Finalizada em", "Conferido por"];
  const n = v => v == null || v === "" ? "" : String(Number(v).toFixed(2)).replace(".", ",");
  const linhas = l.map(s => [cod(s.id), fDH(s.criado_em), s.solicitante_nome, s.solicitante_email, s.setor, s.empresa, s.titulo, itensDe(s).map(i => `${i.quantidade}x ${i.item}${i.fornecedor ? ` (${i.fornecedor})` : ""}`).join(" | "), s.justificativa, s.urgente ? "Sim" : "Não", fDia(s.necessario_ate),
    s.quem_compra === "financeiro" ? "Financeiro/Compras" : "Solicitante", REC[s.recorrencia || "unica"] + (s.assinatura_encerrada_em ? ` (encerrada ${fDia(s.assinatura_encerrada_em)})` : ""), s.forma_pagamento, n(s.valor_estimado), (ST[s.status] || [s.status])[0], s.decidido_por ? nomeEmail(s.decidido_por) : "", fDH(s.decidido_em), s.decisao_obs, s.pedido, fDia(s.previsao), n(s.valor_pago), fDia(s.data_compra), s.nf_numero, fDH(s.conferido_em), s.conferido_por ? nomeEmail(s.conferido_por) : ""]);
  const csv = "﻿" + [cab, ...linhas].map(r => r.map(c => { const t = String(c ?? "").replace(/\r?\n/g, " "); return /[";]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; }).join(sep)).join("\r\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); a.download = `compras-financeiro-${hoje()}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------- eventos ----------
document.addEventListener("click", async e => {
  const el = e.target.closest("[data-act]"); if (!el) return;
  const a = el.dataset.act, id = el.dataset.id;
  if (el.tagName === "BUTTON" || el.tagName === "A") e.stopPropagation();
  switch (a) {
    case "go": irPara(el.dataset.v); break;
    case "close": if (FORM) FORM = null; CP = null; fecharTudo(); break;
    case "abrir": abrirDetalhe(id); break;
    case "nova": abrirForm(null); break;
    case "editar": abrirForm(id); break;
    case "decidir": decidirModal(id); break;
    case "reprovar": decidir(id, false); break;
    case "compra": compraModal(id); break;
    case "comprovante": comprovanteModal(id); break;
    case "conferir": conferirModal(id); break;
    case "devolver": conferir(id, false); break;
    case "cancelar": cancelarModal(id); break;
    case "excluir": excluirModal(id); break;
    case "encerrarass": encerrarAssModal(id); break;
    case "verarq": verArquivo(el.dataset.path); break;
    case "rmarq": removerArquivo(el.dataset.aid, id, !!el.dataset.form); break;
    case "additem": lerItensForm(); FORM.d.itens.push(FORM.novoItem()); reformar(); { const r = document.querySelectorAll(".itrow"); r[r.length - 1].querySelector("input").focus(); } break;
    case "rmitem": lerItensForm(); FORM.d.itens.splice(+el.dataset.k, 1); reformar(); break;
    case "membro": membroModal(el.dataset.email); break;
    case "rmmembro": removerMembro(el.dataset.email); break;
    case "salvarlistas": salvarListas(); break;
    case "exportar": exportar(); break;
    case "tema": { const t = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; lsSet("fc_tema", t); aplicarTema(); break; }
    case "sair": if (canal) { sb.removeChannel(canal); canal = null; } await sb.auth.signOut(); S.eu = null; S.sols = []; L.etapa = "email"; L.msg = ""; location.hash = ""; render(); break;
    case "lsenha": L.senha = !L.senha; L.msg = ""; render(); break;
    case "lvoltar": L.etapa = "email"; L.msg = ""; render(); break;
  }
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && document.querySelector(".ov")) { FORM = null; CP = null; fecharTudo(); }
  if ((e.key === "Enter" || e.key === " ") && e.target.matches("article.sc")) { e.preventDefault(); abrirDetalhe(e.target.dataset.id); }
});
document.addEventListener("submit", e => {
  e.preventDefault(); const f = e.target;
  ({ fEmail: loginEmail, fCodigo: loginCodigo, fSol: salvarForm, fCompra: salvarCompra, fComp: enviarComprovante, fCanc: cancelar, fExc: excluir, fEncAss: encerrarAss, fMembro: salvarMembro,
     fDec: () => decidir(f.dataset.id, true), fConf: () => conferir(f.dataset.id, true) }[f.id] || (() => {}))(f);
});
document.addEventListener("input", e => {
  if (e.target.id === "fq") { S.q = e.target.value; render(); }
  if (e.target.closest && e.target.closest(".itrow") && FORM) { lerItensForm(); const t = FORM.d.itens.reduce((a, i) => a + (parseFloat(i.valor_unit) || 0) * (parseInt(i.quantidade) || 1), 0); $("s_tot").textContent = t ? "Total estimado: " + brl(t) + POR[FORM.d.recorrencia || "unica"] : ""; }
});
document.addEventListener("change", e => {
  const t = e.target;
  if (t.id === "fs") { S.fStatus = t.value; render(); }
  if (t.id === "fse") { S.fSetor = t.value; render(); }
  if (t.id === "fqm") { S.fQuem = t.value; render(); }
  if (t.id === "ffp") { S.fForma = t.value; render(); }
  if (t.id === "ftp") { S.fTipo = t.value; render(); }
  if (t.id === "fas") { S.fAss = t.value; render(); }
  if (t.name === "s_rec" && FORM) { lerItensForm(); $("s_rec_txt").textContent = REC_TXT[t.value]; const tt = FORM.d.itens.reduce((a, i) => a + (parseFloat(i.valor_unit) || 0) * (parseInt(i.quantidade) || 1), 0); $("s_tot").textContent = tt ? "Total estimado: " + brl(tt) + POR[t.value] : ""; }
  if (t.name === "d_quem" && $("d_quem_txt")) $("d_quem_txt").textContent = QDEC[t.value];
  if (t.id === "s_files" && FORM) { lerItensForm(); FORM.files = [...FORM.files, ...t.files]; $("s_arqs").textContent = FORM.files.map(f => f.name).join(", "); }
  if (t.id === "cp_files" && t.files.length) anexarComprovantes([...t.files]);
});
window.addEventListener("hashchange", () => {
  const h = lerHash(); if (!S.eu) return;
  if (h.det && h.det !== S.det) abrirDetalhe(h.det);
  else if (h.view && (h.view !== S.view || S.det)) { closeModal(); S.det = null; S.view = h.view; render(); }
});

// ---------- início ----------
let iniciado = false;
async function iniciar(session) {
  if (!session) { S.eu = null; render(); return; }
  if (iniciado) return; iniciado = true;
  try {
    await carregar(); const h = lerHash();
    if (h.view) S.view = h.view;
    render(); ouvirMudancas();
    if (h.det) abrirDetalhe(h.det);
  } catch (e) { iniciado = false; erro(e); S.eu = null; render(); }
}
sb.auth.onAuthStateChange((ev, session) => {
  if (ev === "SIGNED_OUT") { iniciado = false; S.eu = null; render(); return; }
  if (["INITIAL_SESSION", "SIGNED_IN"].includes(ev)) setTimeout(() => iniciar(session), 0);
});
