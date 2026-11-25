"use strict";
/* Spese di casa: PWA. Data live in Google Drive (dati.json) through a personal Apps Script; a Google Sheet copy is rebuilt after each change. */

// ---------------------------------------------------------------- config & state
const VERSION = "1.6.1";
const LS = { cfg: "spese.cfg", cache: "spese.cache" };
const TEST = window.SPESE_TEST || null;

const S = { cfg: load(LS.cfg) || { url: "", key: "" }, data: null, etag: null, pending: [], sync: "idle", sheetUrl: null, excelTimer: null, flushTimer: null };

// names, addresses and people live only in the data on Google Drive (data.config), never in this public code
const IMM_DEF = { casa1: "Casa", box1: "Box", altre: "Altre case" };
const CFG = () => (S.data && S.data.config) || {};
const caseNome = k => ((CFG().immobili || {})[k] || {}).nome || IMM_DEF[k] || k || "";
const caseAddr = k => ((CFG().immobili || {})[k] || {}).indirizzo || "";
const caseDett = k => ((CFG().immobili || {})[k] || {}).dettagli || "";
const caseLong = k => caseAddr(k) ? (k === "box1" ? caseNome(k) + " " : "") + caseAddr(k) : caseNome(k);
const hasBox = () => CFG().box !== false;
const hasVeh = () => CFG().veicoli !== false;
const caseEntries = () => Object.keys(IMM_DEF).filter(k => k !== "box1" || hasBox()).map(k => [k, caseLong(k)]);
const TIPI = { condominio: "Condominio", straordinaria: "Straordinaria", tari: "TARI", imu: "IMU", casa: "Lavori e arredi", extra: "Extra box", luce: "Luce", gas: "Gas", internet: "Internet" };
const detrList = () => [""].concat((CFG().detrazioni || []).map(d => d.label));
const detrPct = l => { const d = (CFG().detrazioni || []).find(x => x.label === l); return d && d.pct ? d.pct / 100 : 0; };
const MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
const MESI_L = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];

// ---------------------------------------------------------------- helpers
function load(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
function drop(k) { try { localStorage.removeItem(k); } catch (e) {} }
const $ = (s, r = document) => r.querySelector(s);
const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtE = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });
const eur = v => (v == null || isNaN(v)) ? "–" : fmtE.format(v);
const r2 = v => Math.round(v * 100) / 100;
const pad = n => String(n).padStart(2, "0");
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const dmy = iso => iso ? iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4) : "–";
const toDate = iso => new Date(iso + "T12:00:00");
const daysTo = iso => Math.round((toDate(iso) - toDate(todayISO())) / 86400000);
const addDays = (iso, n) => { const d = toDate(iso); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const addMonths = (iso, n) => { const d = toDate(iso); const day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + n); const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); d.setDate(Math.min(day, last)); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const sum = (a, f) => r2(a.reduce((t, x) => t + (f(x) || 0), 0));
const uid = () => "M" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function parseNum(raw) {
  let v = String(raw == null ? "" : raw).trim().replace(/[€\s]/g, "");
  if (v === "") return null;
  if (v.includes(",")) v = v.replace(/\./g, "").replace(",", ".");
  else if ((v.match(/\./g) || []).length > 1 || /^\d{1,3}\.\d{3}$/.test(v)) v = v.replace(/\./g, "");
  const n = Number(v); return isNaN(n) ? NaN : r2(n);
}
const inNum = v => v == null ? "" : String(v).replace(".", ",");
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 2600); }

// ---------------------------------------------------------------- domain
function stato(m) {
  if (m.stato === "riportata") return { t: "Riportata", c: "", open: false };
  if (m.stato === "chiusa") return { t: "Chiusa", c: "", open: false };
  if (m.pagato != null) {
    if (m.importo != null && m.pagato < m.importo - 0.009) return { t: "Pagata in parte", c: "warn", open: false };
    return { t: "Pagata", c: "ok", open: false };
  }
  if (m.importo == null) return { t: "Importo da definire", c: "", open: true, nd: true };
  if (!m.scadenza) return { t: "Senza scadenza", c: "warn", open: true, nd: true };
  const d = daysTo(m.scadenza);
  if (d < 0) return { t: `Scaduta da ${-d} ${d === -1 ? "giorno" : "giorni"}`, c: "crit", open: true, late: true };
  if (d <= 30) return { t: d === 0 ? "Scade oggi" : `Tra ${d} ${d === 1 ? "giorno" : "giorni"}`, c: "warn", open: true, soon: true };
  return { t: "Da pagare", c: "acc", open: true, later: true };
}
const M = () => S.data ? S.data.movimenti : [];
const G = () => S.data ? S.data.gestioni : [];
const openItems = (f = () => true) => M().filter(m => f(m) && stato(m).open);
function gestCalc(g) {
  const rate = M().filter(m => m.gestione === g.id).sort((a, b) => (a.ordine || 0) - (b.ordine || 0) || (a.scadenza || "").localeCompare(b.scadenza || ""));
  const voci = g.voci || [];
  const prev = sum(voci, v => v.prev);
  const hasCons = voci.some(v => v.cons != null);
  const cons = hasCons ? sum(voci, v => v.cons) : null;
  const previste = sum(rate.filter(m => m.stato !== "riportata"), m => m.importo);
  const pagato = sum(rate, m => m.pagato);
  const aperte = sum(rate.filter(m => stato(m).open), m => m.importo);
  const saldo = cons != null && g.saldoPrec != null ? r2(cons + g.saldoPrec - pagato) : null;
  const check = saldo != null && g.saldoAdmin != null ? r2(saldo - g.saldoAdmin) : null;
  const nRate = rate.filter(m => m.stato !== "riportata" && m.stato !== "chiusa").length;
  const nPag = rate.filter(m => m.pagato != null).length;
  const late = rate.filter(m => stato(m).late).length;
  return { rate, voci, prev, cons, previste, pagato, aperte, saldo, check, nRate, nPag, late, pct: previste > 0 ? Math.min(1, pagato / previste) : (nRate ? nPag / nRate : 0) };
}
function refDate(m) { return m.dataPag || m.al || m.scadenza || m.data || null; }

// ---------------------------------------------------------------- data ops (applied locally and replayed on conflicts)
function apply(data, op) {
  if (op.op === "mov") { const i = data.movimenti.findIndex(x => x.id === op.item.id); if (i >= 0) data.movimenti[i] = op.item; else data.movimenti.push(op.item); }
  if (op.op === "delmov") data.movimenti = data.movimenti.filter(x => x.id !== op.id);
  if (op.op === "delgest") data.gestioni = data.gestioni.filter(x => x.id !== op.id);
  if (op.op === "gest") { const i = data.gestioni.findIndex(x => x.id === op.item.id); if (i >= 0) data.gestioni[i] = op.item; else data.gestioni.push(op.item); }
  if (op.op === "prom") { const i = data.promemoria.findIndex(x => x.id === op.item.id); if (i >= 0) data.promemoria[i] = op.item; else data.promemoria.push(op.item); }
  if (op.op === "conto" && !data.conti.includes(op.name)) data.conti.push(op.name);
  if (/^g(veh|delveh|item|delitem|pat|patente|delpatente|km|import|flag)$/.test(op.op)) applyGarage(data, op);
  if (op.op === "rekey") rekey(data);
  if (op.op === "config") data.config = op.config;
  data.aggiornato = new Date().toISOString();
}
// 1.5: the old property codes (which spelled the street names) become neutral codes; only hashes of the old codes appear here
const fnv = s => { let h = 0x811c9dc5; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h.toString(16); };
const OLDK = {"48e5a9d5": "casa1", "6ca926e8": "box1"};
const newKey = k => (k && OLDK[fnv(k)]) || k;
const newGid = id => { if (!id) return id; const i = id.indexOf("-"); return i > 0 && OLDK[fnv(id.slice(0, i))] ? OLDK[fnv(id.slice(0, i))] + id.slice(i) : id; };
const needsRekey = data => !data.config || data.movimenti.some(m => OLDK[fnv(m.casa || "")]) || data.gestioni.some(g => OLDK[fnv(g.casa || "")]);
function rekey(data) {
  data.movimenti.forEach(m => { m.casa = newKey(m.casa); if (m.gestione) m.gestione = newGid(m.gestione); });
  data.gestioni.forEach(g => { g.casa = newKey(g.casa); g.id = newGid(g.id); });
  (data.promemoria || []).forEach(p => { p.casa = newKey(p.casa); });
  if (!data.config) {
    const used = [...new Set(data.movimenti.map(m => m.detrazione).filter(Boolean))].sort();
    data.config = { immobili: { casa1: { nome: "Casa", indirizzo: "", dettagli: "" }, box1: { nome: "Box", indirizzo: "", dettagli: "" } },
      detrazioni: used.map(l => { const m = /(\d+(?:[.,]\d+)?)\s*%/.exec(l); return { label: l, pct: m ? parseFloat(m[1].replace(",", ".")) : 0 }; }), detrazioniTitolo: "Detrazioni" };
  }
}
function commit(op, msg) {
  apply(S.data, op);
  S.pending.push(op);
  persistCache();
  render();
  if (msg) toast(msg);
  clearTimeout(S.flushTimer);
  S.flushTimer = setTimeout(flush, 500);
}
function persistCache() { save(LS.cache, { data: S.data, etag: S.etag, pending: S.pending, url: S.cfg.url, sheetUrl: S.sheetUrl }); }

// ---------------------------------------------------------------- backend: Google Apps Script "ponte" in your Google Drive
// Every call is a POST with text/plain body (no CORS preflight). The script checks the secret key.
async function api(action, payload = {}) {
  if (!S.cfg.url) throw Object.assign(new Error("App non collegata"), { setup: true });
  let r;
  try {
    r = await fetch(S.cfg.url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(Object.assign({ key: S.cfg.key, action }, payload)), redirect: "follow" });
  } catch (e) { throw Object.assign(new Error("Google Drive non raggiungibile"), { net: true }); }
  if (!r.ok) throw new Error("Google risponde con errore " + r.status);
  let j; try { j = await r.json(); } catch (e) { throw Object.assign(new Error("Risposta non valida: controlla l'indirizzo dello script e che sia pubblicato per \"Chiunque\""), { setup: true }); }
  if (j.error === "chiave") throw Object.assign(new Error("Chiave sbagliata"), { setup: true });
  if (j.error) throw new Error(j.error);
  return j;
}
async function downloadData() {
  const j = await api("load");
  if (j.notFound) throw Object.assign(new Error("dati.json non trovato"), { notFound: true });
  if (j.sheetUrl) S.sheetUrl = j.sheetUrl;
  return { data: j.data, etag: j.rev };
}
async function flush(retry = 0) {
  if (TEST) { S.pending = []; setSync("ok"); return; }
  if (!S.pending.length) return;
  if (!navigator.onLine) { setSync("offline"); return; }
  setSync("saving");
  try {
    const j = await api("save", { baseRev: S.etag, data: S.data });
    if (j.conflict && retry < 2) {             // changed on another device: take theirs and replay our edits
      S.data = j.data; S.etag = j.rev;
      S.pending.forEach(op => apply(S.data, op));
      return flush(retry + 1);
    }
    if (!j.ok) throw new Error("Salvataggio non riuscito");
    S.etag = j.rev; S.pending = []; persistCache(); setSync("ok"); render();
    scheduleSheet();
  } catch (e) {
    setSync(e.setup ? "setup" : "err");
    if (!e.setup) setTimeout(() => flush(), 20000);
  }
}
function scheduleSheet() { clearTimeout(S.excelTimer); S.excelTimer = setTimeout(() => updateSheet(false), 5000); }
async function updateSheet(manual) {
  if (TEST) { if (manual) toast("Foglio aggiornato (prova)"); return; }
  try { const j = await api("sheet"); if (j.sheetUrl) S.sheetUrl = j.sheetUrl; if (manual) toast("Foglio Google aggiornato"); }
  catch (e) { if (manual) toast("Non sono riuscito ad aggiornare il foglio"); }
}
function setSync(s) { S.sync = s; const el = $("#sync"); if (!el) return;
  const map = { ok: ["Salvato", "ok"], saving: ["Salvo…", ""], offline: ["Offline, salvo dopo", "warn"], err: ["Non salvato, riprovo", "crit"], setup: ["Controlla il collegamento", "crit"], idle: ["", ""] };
  const [t, c] = map[s] || ["", ""]; el.textContent = t; el.className = "sync " + c; el.hidden = !t; }

// ---------------------------------------------------------------- Excel (ExcelJS)
async function buildWorkbook(only) {
  const X = window.ExcelJS; const wb = new X.Workbook(); wb.creator = "Spese di casa";
  const EUR = '#,##0.00 "€";-#,##0.00 "€";"-"', DATE = "dd/mm/yyyy";
  const H = { font: { bold: true, color: { argb: "FFFFFFFF" } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF2A6FDB" } }, alignment: { vertical: "middle", wrapText: true } };
  const d = iso => iso ? new Date(iso + "T00:00:00Z") : null;
  function sheet(name, title, cols) {
    const ws = wb.addWorksheet(name.replace(/[\\\/\?\*\[\]:]/g, "-").slice(0, 31));
    ws.addRow([title]).font = { bold: true, size: 14 };
    ws.addRow([]);
    return ws;
  }
  function table(ws, headers, rows, formats = {}) {
    const hr = ws.addRow(headers); hr.eachCell(c => Object.assign(c, { font: H.font, fill: H.fill, alignment: H.alignment }));
    rows.forEach(r => { const row = ws.addRow(r); Object.entries(formats).forEach(([i, f]) => { row.getCell(+i + 1).numFmt = f; }); });
    return hr.number;
  }
  function widths(ws, w) { w.forEach((x, i) => ws.getColumn(i + 1).width = x); }
  function gestSheet(g) {
    const k = gestCalc(g);
    const ws = sheet(`${caseNome(g.casa)} ${g.nome}`, `${caseLong(g.casa)}: ${g.tipo === "straordinaria" ? g.nome : "gestione " + g.nome}`);
    if (g.periodo) ws.addRow([g.periodo]).font = { italic: true, color: { argb: "FF5F6B77" } };
    ws.addRow([]);
    ws.addRow(["Voci"]).font = { bold: true, size: 12 };
    table(ws, ["Voce", "Preventivo", "Consuntivo", "Differenza", "Note"],
      k.voci.map(v => [v.voce, v.prev, v.cons, v.cons != null && v.prev != null ? r2(v.cons - v.prev) : null, v.note || ""]), { 1: EUR, 2: EUR, 3: EUR });
    const t = ws.addRow(["Totale", k.prev, k.cons, k.cons != null ? r2(k.cons - k.prev) : null]); t.font = { bold: true }; [2, 3, 4].forEach(i => t.getCell(i).numFmt = EUR);
    ws.addRow([]); ws.addRow(["Rate"]).font = { bold: true, size: 12 };
    table(ws, ["Rata", "Scadenza", "Importo", "Pagato", "Data pagamento", "Conto", "Stato", "Note"],
      k.rate.map(m => [m.voce, d(m.scadenza), m.importo, m.pagato, d(m.dataPag), m.conto || "", stato(m).t, m.note || ""]), { 1: DATE, 2: EUR, 3: EUR, 4: DATE });
    const t2 = ws.addRow(["Totale", null, k.previste, k.pagato]); t2.font = { bold: true }; [3, 4].forEach(i => t2.getCell(i).numFmt = EUR);
    ws.addRow([]); ws.addRow(["Saldo"]).font = { bold: true, size: 12 };
    [["Saldo precedente (+ debito, − credito)", g.saldoPrec], ["Saldo calcolato (consuntivo + precedente − pagato)", k.saldo], ["Saldo comunicato dall'amministratore", g.saldoAdmin], ["Controllo (0 = torna)", k.check]]
      .forEach(([a, b]) => { const r = ws.addRow([a, b]); r.getCell(2).numFmt = EUR; });
    if ((g.note || []).length) { ws.addRow([]); ws.addRow(["Note"]).font = { bold: true, size: 12 }; g.note.forEach(n => { const r = ws.addRow([n]); r.getCell(1).alignment = { wrapText: true }; }); }
    widths(ws, [46, 14, 14, 14, 16, 22, 18, 50]);
  }
  if (only) { gestSheet(only); return new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }); }

  // Scadenze
  let ws = sheet("Scadenze", `Da pagare al ${dmy(todayISO())}`);
  const open = openItems().sort((a, b) => (a.scadenza || "9999").localeCompare(b.scadenza || "9999"));
  table(ws, ["Scadenza", "Immobile", "Tipo", "Descrizione", "Importo", "Conto", "Stato"],
    open.map(m => [d(m.scadenza), caseLong(m.casa), TIPI[m.tipo], m.voce, m.importo, m.conto || "", stato(m).t]), { 0: DATE, 4: EUR });
  widths(ws, [12, 16, 14, 46, 13, 22, 22]);
  // Riepilogo
  ws = sheet("Riepilogo", "Riepilogo per immobile e tipo");
  const rows = [];
  ["casa1", "box1"].forEach(c => Object.keys(TIPI).forEach(t => { const x = M().filter(m => m.casa === c && m.tipo === t); if (x.length) rows.push([caseLong(c), TIPI[t], sum(x, m => m.pagato), sum(x.filter(m => stato(m).open), m => m.importo)]); }));
  table(ws, ["Immobile", "Tipo", "Pagato", "Da pagare"], rows, { 2: EUR, 3: EUR });
  ws.addRow([]); ws.addRow(["Speso per anno (data di pagamento; per le bollette fine del periodo)"]).font = { bold: true, size: 12 };
  const yrs = [...new Set(M().filter(m => m.casa !== "altre").map(m => (refDate(m) || "").slice(0, 4)).filter(Boolean))].sort();
  table(ws, ["Anno", ...Object.values(TIPI), "Totale"], yrs.map(y => { const x = M().filter(m => m.casa !== "altre" && (refDate(m) || "").startsWith(y)); const vals = Object.keys(TIPI).map(t => sum(x.filter(m => m.tipo === t), m => m.pagato)); return [y, ...vals, r2(vals.reduce((a, b) => a + b, 0))]; }),
    Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 1, EUR])));
  widths(ws, [18, 16, 14, 14, 14, 14, 14, 14, 14, 14, 14]);
  // gestioni
  [...G()].sort((a, b) => a.casa.localeCompare(b.casa) || b.nome.localeCompare(a.nome)).forEach(gestSheet);
  // tasse
  ws = sheet("TARI e IMU", "TARI e IMU, " + caseLong("casa1"));
  table(ws, ["Anno", "Tributo", "Descrizione", "Scadenza", "Dovuto", "di cui imposta", "Pagato", "Data pagamento", "Note"],
    M().filter(m => m.tipo === "tari" || m.tipo === "imu").sort((a, b) => (a.categoria || "").localeCompare(b.categoria || "")).map(m => [m.categoria, TIPI[m.tipo], m.voce, d(m.scadenza), m.importo, m.imposta, m.pagato, d(m.dataPag), m.note || ""]), { 3: DATE, 4: EUR, 5: EUR, 6: EUR, 7: DATE });
  widths(ws, [8, 8, 40, 12, 12, 12, 12, 14, 60]);
  // lavori
  ws = sheet("Lavori e arredi", "Lavori e arredi, " + caseLong("casa1"));
  table(ws, ["Data", "Categoria", "Descrizione", "Fornitore", "Intestatario", "Importo", "Pagato", "Detrazione", "Detrazione stimata", "Note"],
    M().filter(m => m.tipo === "casa").sort((a, b) => (a.data || "9").localeCompare(b.data || "9")).map(m => [d(m.data), m.categoria, m.voce, m.fornitore, m.intestatario, m.importo, m.pagato, m.detrazione || "", m.detrazioneImporto, m.note || ""]), { 0: DATE, 5: EUR, 6: EUR, 8: EUR });
  widths(ws, [12, 22, 46, 26, 20, 12, 12, 28, 14, 50]);
  // bollette
  ws = sheet("Bollette e internet", "Luce, gas e internet");
  table(ws, ["Utenza", "Immobile", "Dal", "Al", "Fornitore", "Fattura", "Importo", "Consumo", "Unità", "€ ogni 30 gg", "Scadenza", "Note"],
    M().filter(m => ["luce", "gas", "internet"].includes(m.tipo)).sort((a, b) => a.tipo.localeCompare(b.tipo) || a.casa.localeCompare(b.casa) || (b.dal || "").localeCompare(a.dal || "")).map(m => {
      const gg = m.dal && m.al ? daysBetween(m.dal, m.al) : null;
      return [TIPI[m.tipo], caseLong(m.casa), d(m.dal), d(m.al), m.fornitore, m.fattura, m.importo, m.consumo, m.unita, gg ? r2(m.importo / gg * 30) : null, d(m.scadenza), m.note || ""];
    }), { 2: DATE, 3: DATE, 6: EUR, 9: EUR, 10: DATE });
  widths(ws, [10, 16, 12, 12, 20, 18, 11, 10, 7, 12, 12, 40]);
  // movimenti + da chiedere
  ws = sheet("Movimenti", "Tutti i movimenti");
  table(ws, ["ID", "Immobile", "Tipo", "Gestione", "Categoria o anno", "Descrizione", "Scadenza", "Importo", "Pagato", "Data pagamento", "Conto", "Stato", "Note"],
    M().map(m => [m.id, caseLong(m.casa), TIPI[m.tipo], m.gestione || "", m.categoria || "", m.voce, d(m.scadenza), m.importo, m.pagato, d(m.dataPag), m.conto || "", stato(m).t, m.note || ""]), { 6: DATE, 7: EUR, 8: EUR, 9: DATE });
  widths(ws, [10, 16, 14, 24, 18, 46, 12, 12, 12, 14, 22, 18, 50]);
  const GG = GD();
  if (GG.vehicles.length || PATENTI().length) {
    const vn = id => (VH(id) || {}).name || id;
    ws = sheet("Veicoli", "Veicoli");
    table(ws, ["Nome", "Tipo", "Targa", "Marca", "Modello", "Carburante", "Km", "Immatricolazione", "Intestatario", "Telaio", "Stato", "Spese anno in corso", "Spese totali"],
      GG.vehicles.map(v => [v.name, v.type, v.plate, v.marca, v.modello, v.carburante, v.km, d(v.immatricolazione), v.intestatario, v.telaio, v.storico ? "storico" : (v.fascia || "in uso"), vSpent(v.id, todayISO().slice(0, 4)), vSpent(v.id)]), { 7: DATE, 11: EUR, 12: EUR });
    widths(ws, [28, 8, 11, 16, 30, 11, 10, 14, 24, 20, 10, 14, 14]);
    ws = sheet("Scadenze veicoli", "Scadenze dei veicoli e della patente");
    table(ws, ["Scadenza", "Veicolo", "Tipo", "Importo", "Stato", "Note"], vehicleDeadlines(true).map(x => [d(x.date), x.patente ? "Patente " + (x.label || "") : vn(x.vid), x.cat, x.cost, dlState(x).t, x.auto ? "dall'ultima spesa registrata" : x.note || ""]), { 0: DATE, 3: EUR });
    widths(ws, [12, 28, 16, 12, 22, 40]);
    if (PATENTI().length) { ws = sheet("Patenti", "Patenti di guida");
      table(ws, ["Titolare", "Numero", "Categorie", "Rilascio", "Scadenza", "Punti", "Note"], PATENTI().map(p => [p.titolare || "", p.numero || "", catLabel(p), d(p.rilascio), d(p.scadenza), p.punti, p.note || ""]), { 3: DATE, 4: DATE });
      widths(ws, [28, 16, 20, 12, 12, 8, 40]); }
    ws = sheet("Spese veicoli", "Spese e interventi");
    table(ws, ["Data", "Veicolo", "Categoria", "Importo", "Fornitore o compagnia", "Km", "Scadenza", "Copertura dal", "al", "Componenti", "Note"],
      GG.items.filter(i => i.kind === "expense").sort((a, b) => (a.date || "").localeCompare(b.date || "")).map(i => [d(i.date), vn(i.vid), i.cat, i.cost, i.fornitore || i.compagnia || "", i.km, d(i.scadenza), d(i.da), d(i.a), (i.componenti || []).map(c => c.n + (c.c != null ? " " + c.c + " €" : "")).join("; "), i.note || ""]), { 0: DATE, 3: EUR, 6: DATE, 7: DATE, 8: DATE });
    widths(ws, [12, 28, 18, 12, 28, 10, 12, 12, 12, 50, 50]);
    ws = sheet("Ricariche e rifornimenti", "Ricariche e rifornimenti");
    table(ws, ["Data", "Veicolo", "Km", "Importo", "kWh", "€/kWh", "Litri", "Pieno", "Corrente", "Potenza kW", "Durata min", "Fornitore", "Note"],
      GG.items.filter(i => i.kind === "fuel").sort((a, b) => (a.date || "").localeCompare(b.date || "")).map(i => [d(i.date), vn(i.vid), i.km, i.total, i.energia, i.energia ? Math.round(i.total / i.energia * 1000) / 1000 : null, i.liters, i.pieno ? "sì" : "", i.corrente || "", i.potenza, i.tempo, i.fornitore || "", i.note || ""]), { 0: DATE, 3: EUR, 5: '0.000 "€"' });
    widths(ws, [12, 28, 10, 11, 8, 9, 8, 7, 9, 10, 10, 22, 40]);
  }
  ws = sheet("Da chiedere", "Cose da chiedere");
  table(ws, ["Immobile", "Riferimento", "Priorità", "Problema", "Cosa fare", "Fatto"], S.data.promemoria.map(p => [caseLong(p.casa), p.riferimento || "", p.priorita || "", p.testo, p.azione || "", p.fatto ? "sì" : ""]));
  widths(ws, [16, 18, 10, 80, 50, 6]);
  return new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000) + 1;
async function downloadBlob(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === "AbortError") return; } }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

// ---------------------------------------------------------------- small UI pieces
const IC = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  chev: '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 5l7 7-7 7"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  cam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  dl: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>'
};
function ring(pct, label, color) {
  const r = 22, c = 2 * Math.PI * r, off = c * (1 - pct);
  return `<svg class="ring" viewBox="0 0 52 52"><circle cx="26" cy="26" r="${r}" fill="none" stroke="var(--neutral-soft)" stroke-width="6"/>
    <circle cx="26" cy="26" r="${r}" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 26 26)"/>
    <text x="26" y="30" text-anchor="middle">${esc(label)}</text></svg>`;
}
function calBox(iso) { if (!iso) return '<div class="cal"><b>?</b><span>data</span></div>'; return `<div class="cal"><b>${+iso.slice(8, 10)}</b><span>${MESI[+iso.slice(5, 7) - 1]} ${iso.slice(2, 4)}</span></div>`; }
function itemRow(m, o = {}) {
  const s = stato(m); const cls = s.late ? " late" : s.soon ? " soon" : "";
  const amount = m.pagato != null ? m.pagato : m.importo;
  const pay = o.pay !== false && s.open && m.importo != null ? `<button class="paybtn" data-pay="${esc(m.id)}">Pagata</button>` : "";
  const sub = o.sub != null ? o.sub : [caseNome(m.casa), TIPI[m.tipo], gName(m) || m.categoria].filter(Boolean).join(" · ");
  return `<div class="item${cls}" role="button" tabindex="0" data-edit="${esc(m.id)}">${calBox(o.date ? o.date(m) : (m.scadenza || refDate(m)))}
    <div><div class="t1">${esc(m.voce)}${m.stima ? ' <span class="pill">stima</span>' : ""}</div><div class="t2">${esc(sub)}</div></div>
    <div class="right"><span class="amt num">${eur(amount)}</span><span class="pill ${s.c}">${esc(s.t)}</span>${pay}</div></div>`;
}
function gName(m) { const g = m.gestione && G().find(x => x.id === m.gestione); return g ? g.nome : ""; }
function emptyBox(art, text) { return `<div class="empty">${ART[art] || ""}<div>${text}</div></div>`; }

// ---------------------------------------------------------------- views
const ROUTES = {};
function route() { const h = (location.hash || "#home").slice(1).split("/"); return { name: h[0] || "home", arg: decodeURIComponent(h.slice(1).join("/") || "") }; }
function render() {
  const app = $("#app");
  if (!S.data) return;
  if (needsRekey(S.data) && !S.rekeying) { S.rekeying = true; setTimeout(() => { commit({ op: "rekey" }); S.rekeying = false; }, 0); }
  const r = route(); const v = ROUTES[r.name] || ROUTES.home;
  const out = v(r.arg);
  $("#title").textContent = out.title;
  $("#back").hidden = !out.back;
  $("#back").dataset.to = out.back || "";
  app.innerHTML = out.html;
  document.querySelectorAll(".tabs a").forEach(a => { if (a.dataset.tab === (out.tab || r.name)) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  const late = openItems(m => stato(m).late).length + openVehDl().filter(d => dlState(d).late).length; const dot = $("#latedot"); dot.textContent = late; dot.hidden = !late;
  setSync(S.sync);
}

ROUTES.home = () => {
  const open = openItems(); const late = open.filter(m => stato(m).late), soon = open.filter(m => stato(m).soon);
  const vd = openVehDl(), vLate = vd.filter(d => dlState(d).late), vSoon = vd.filter(d => dlState(d).soon);
  const vtxt = (vLate.length || vSoon.length) ? `<div class="small" style="color:inherit;opacity:.85">Veicoli: ${[vLate.length && vLate.length + " scadut" + (vLate.length === 1 ? "a" : "e"), vSoon.length && vSoon.length + " entro 30 giorni"].filter(Boolean).join(", ")}</div>` : "";
  let st;
  if (late.length) st = `<a class="status crit" href="#scadenze/scadute"><div class="ill">${ART.alarm}</div><div><div class="big num">${eur(sum(late, m => m.importo))}</div><div>${late.length === 1 ? "1 pagamento scaduto" : late.length + " pagamenti scaduti"}${soon.length ? ` · ${soon.length} entro 30 giorni` : ""}</div>${vtxt}</div>${IC.chev}</a>`;
  else if (soon.length) st = `<a class="status warn" href="#scadenze/presto"><div class="ill">${ART.soon}</div><div><div class="big num">${eur(sum(soon, m => m.importo))}</div><div>${soon.length === 1 ? "1 pagamento" : soon.length + " pagamenti"} entro 30 giorni</div>${vtxt}</div>${IC.chev}</a>`;
  else if (vLate.length || vSoon.length) st = `<a class="status ${vLate.length ? "crit" : "warn"}" href="#scadenze/${vLate.length ? "scadute" : "presto"}"><div class="ill">${ART[vLate.length ? "alarm" : "soon"]}</div><div><div class="big">Casa in regola</div>${vtxt}</div>${IC.chev}</a>`;
  else st = `<a class="status ok" href="#scadenze/tutte"><div class="ill">${ART.ok}</div><div><div class="big">Tutto in regola</div><div>Nessun pagamento nei prossimi 30 giorni</div></div>${IC.chev}</a>`;
  const casaOpen = open.filter(m => m.casa === "casa1"), boxOpen = open.filter(m => m.casa === "box1");
  const badge = a => { const l = a.filter(m => stato(m).late).length, s = a.filter(m => stato(m).soon).length; return l ? `<span class="pill crit badge">${l} scadut${l === 1 ? "a" : "e"}</span>` : s ? `<span class="pill warn badge">${s} in arrivo</span>` : ""; };
  const last = t => M().filter(m => m.tipo === t && m.casa !== "altre" && m.dal).sort((a, b) => b.dal.localeCompare(a.dal))[0];
  const ut = (t, cls, art, name) => { const l = last(t); return `<a class="tile ${cls}" href="#utenza/${t}"><div class="ill">${ART[art]}</div><h3>${name}</h3><div class="sub num">${l ? eur(l.importo) : "–"}</div></a>`; };
  const prom = S.data.promemoria.filter(p => !p.fatto).length;
  return { title: "Spese di casa", tab: "home", html: `
    ${st}
    <div class="grid2${hasBox() ? "" : " solo"}">
      <a class="tile t-casa${hasBox() ? "" : " wide"}" href="#casa/casa1">${badge(casaOpen)}<div class="ill">${ART.casa}</div><h3>${esc(caseNome("casa1"))}</h3><div class="sub">${caseAddr("casa1") ? esc(caseAddr("casa1")) + " · " : ""}${casaOpen.length ? eur(sum(casaOpen, m => m.importo)) + " da pagare" : "nulla da pagare"}</div></a>
      ${hasBox() ? `<a class="tile t-box" href="#casa/box1">${badge(boxOpen)}<div class="ill">${ART.box}</div><h3>${esc(caseNome("box1"))}</h3><div class="sub">${caseAddr("box1") ? esc(caseAddr("box1")) + " · " : ""}${boxOpen.length ? eur(sum(boxOpen, m => m.importo)) + " da pagare" : "nulla da pagare"}</div></a>` : ""}
    </div>
    ${vehTile()}
    <div class="sec-h"><h2>Forniture</h2><span class="small">ultima bolletta</span></div>
    <div class="grid3">${ut("luce", "t-luce", "luce", "Luce")}${ut("gas", "t-gas", "gas", "Gas")}${ut("internet", "t-net", "net", "Internet")}</div>
    <div class="grid3">
      <a class="tile t-tax" href="#tasse"><div class="ill">${ART.tasse}</div><h3>Tasse</h3><div class="sub">TARI e IMU</div></a>
      <a class="tile t-work" href="#lavori"><div class="ill">${ART.lavori}</div><h3>Lavori</h3><div class="sub">e detrazioni</div></a>
      <a class="tile t-ask" href="#chiedere">${prom ? `<span class="pill acc badge">${prom}</span>` : ""}<div class="ill">${ART.ask}</div><h3>Da chiedere</h3><div class="sub">${prom} apert${prom === 1 ? "a" : "e"}</div></a>
    </div>` };
};

ROUTES.casa = casa => {
  casa = newKey(casa); if (!IMM_DEF[casa]) casa = "casa1";
  const isBox = casa === "box1";
  const gs = G().filter(g => g.casa === casa).sort((a, b) => (b.tipo === "straordinaria") - (a.tipo === "straordinaria") || b.nome.localeCompare(a.nome));
  const open = openItems(m => m.casa === casa);
  const cards = gs.map(g => {
    const k = gestCalc(g);
    const color = k.late ? "var(--crit)" : k.aperte > 0 ? "var(--accent)" : "var(--ok)";
    const pill = k.late ? `<span class="pill crit">${k.late} scadut${k.late === 1 ? "a" : "e"}</span>` : k.aperte > 0 ? `<span class="pill acc">${eur(k.aperte)} da pagare</span>`
      : k.check != null ? (Math.abs(k.check) < 0.01 ? '<span class="pill ok">torna</span>' : `<span class="pill warn">diff. ${eur(k.check)}</span>`) : '<span class="pill">in attesa consuntivo</span>';
    return `<a class="ycard" href="#gestione/${encodeURIComponent(g.id)}"><div class="row1">${ring(k.pct, Math.round(k.pct * 100) + "%", color)}<div><h3>${esc(g.tipo === "straordinaria" ? "Straord. " + g.nome.replace("Straordinaria ", "") : g.nome)}</h3><div class="k">${k.nPag}/${k.nRate} rate pagate</div></div></div>${pill}</a>`;
  }).join("");
  const extra = isBox ? M().filter(m => m.casa === "box1" && m.tipo === "extra") : [];
  return { title: caseLong(casa), back: "home", tab: "home", html: `
    <div class="hero"><div class="ill ${isBox ? "t-box" : "t-casa"}" style="background:${isBox ? "linear-gradient(160deg,#e7e9f4,#f6f7fb)" : "linear-gradient(160deg,#dcefff,#f3f8ff)"}">${ART[isBox ? "box" : "casa"]}</div>
      <div><h2>${isBox ? "Il box" : "La casa"}</h2><div class="small">${esc([caseAddr(casa), caseDett(casa)].filter(Boolean).join(", ")) || '<a href="#impostazioni">aggiungi indirizzo e dettagli</a>'}</div>
      <div style="margin-top:8px">${open.length ? `<span class="pill ${open.some(m => stato(m).late) ? "crit" : "acc"}">${eur(sum(open, m => m.importo))} da pagare</span>` : '<span class="pill ok">nulla da pagare</span>'}</div></div></div>
    <div class="sec-h"><h2>Condominio</h2><span class="small">tocca un anno</span></div>
    <div class="cards">${cards}</div>
    ${gs.length ? "" : `<div class="small" style="margin:4px 0 8px">Nessuna gestione ancora. Crea quella dell'anno in corso con il preventivo dell'amministratore, poi aggiungi le rate.</div>`}
    <div class="actions"><button class="btn${gs.length ? "" : " primary"}" data-newgest="${esc(casa)}">${IC.plus} Nuova gestione</button></div>
    ${isBox ? `<div class="sec-h"><h2>Spese extra</h2><span class="small num">${eur(sum(extra, m => m.importo))}</span></div><div class="list">${extra.map(m => itemRow(m, { date: x => x.data || x.dataPag })).join("") || ""}</div>
      <div class="grid3"><a class="tile t-luce" href="#utenza/luce/box1"><div class="ill">${ART.luce}</div><h3>Luce box</h3><div class="sub">wallbox</div></a><a class="tile t-car" href="#veicoli" style="grid-column:span 2"><div class="ill">${vehImg(GD().vehicles.filter(v => !v.storico)[0])}</div><h3>Veicoli</h3><div class="sub">cosa c'è nel box</div></a></div>`
    : `<div class="grid3"><a class="tile t-tax" href="#tasse"><div class="ill">${ART.tasse}</div><h3>Tasse</h3><div class="sub">TARI e IMU</div></a><a class="tile t-work" href="#lavori"><div class="ill">${ART.lavori}</div><h3>Lavori</h3><div class="sub">e detrazioni</div></a><a class="tile t-luce" href="#utenza/luce"><div class="ill">${ART.luce}</div><h3>Bollette</h3><div class="sub">luce, gas, rete</div></a></div>`}` };
};

ROUTES.gestione = id => {
  const g = G().find(x => x.id === id); if (!g) return ROUTES.home();
  const k = gestCalc(g);
  const color = k.late ? "var(--crit)" : k.aperte > 0 ? "var(--accent)" : "var(--ok)";
  const chk = k.check == null ? '<span class="pill">consuntivo non ancora inserito</span>' : Math.abs(k.check) < 0.01 ? '<span class="pill ok">torna con l\'amministratore</span>' : `<span class="pill warn">differenza ${eur(k.check)}</span>`;
  const sg = v => v == null ? "–" : (v > 0 ? "+" : "") + eur(v);
  return { title: g.tipo === "straordinaria" ? g.nome : `Gestione ${g.nome}`, back: "casa/" + g.casa, tab: "home", html: `
    <div class="hero" style="grid-template-columns:auto 1fr"><div style="width:96px;display:grid;place-items:center">${ring(k.pct, Math.round(k.pct * 100) + "%", color).replace('class="ring"', 'class="ring" style="width:88px;height:88px"')}</div>
      <div><h2>${esc(caseLong(g.casa))}</h2><div class="small">${k.nPag} rate pagate su ${k.nRate}</div><div style="margin-top:8px">${chk}</div></div></div>
    <div class="kpis"><div class="kpi"><span>Preventivo</span><b class="num">${eur(k.prev)}</b></div><div class="kpi"><span>Consuntivo</span><b class="num">${eur(k.cons)}</b></div><div class="kpi"><span>Pagato</span><b class="num">${eur(k.pagato)}</b></div>
      <div class="kpi"><span>Saldo prec.</span><b class="num">${sg(g.saldoPrec)}</b></div><div class="kpi"><span>Saldo calcolato</span><b class="num">${sg(k.saldo)}</b></div><div class="kpi"><span>Amministratore</span><b class="num">${sg(g.saldoAdmin)}</b></div></div>
    <div class="sec-h"><h2>Rate</h2><span class="small num">previste ${eur(k.previste)}</span></div>
    <div class="list">${k.rate.map(m => itemRow(m, { sub: [m.conto ? "da " + m.conto : "", m.dataPag ? "pagata il " + dmy(m.dataPag) : ""].filter(Boolean).join(" · ") })).join("") || '<div class="item"><div></div><div class="t2">Nessuna rata</div><div></div></div>'}</div>
    <div class="sec-h"><h2>Preventivo e consuntivo</h2></div>
    <div class="tblwrap"><table><thead><tr><th>Voce</th><th class="n">Prev.</th><th class="n">Cons.</th><th class="n">Diff.</th></tr></thead><tbody>
      ${k.voci.map(v => `<tr><td>${esc(v.voce)}${v.note ? `<div class="small">${esc(v.note)}</div>` : ""}</td><td class="n">${eur(v.prev)}</td><td class="n">${eur(v.cons)}</td><td class="n">${v.cons != null && v.prev != null ? sg(r2(v.cons - v.prev)) : "–"}</td></tr>`).join("")}
      <tr class="tot"><td>Totale</td><td class="n">${eur(k.prev)}</td><td class="n">${eur(k.cons)}</td><td class="n">${k.cons != null ? sg(r2(k.cons - k.prev)) : "–"}</td></tr></tbody></table></div>
    ${(g.note || []).length ? `<div class="sec-h"><h2>Note</h2></div><ul class="notes">${g.note.map(n => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
    <div class="actions"><button class="btn" data-addrata="${esc(g.id)}">${IC.plus} Aggiungi rata</button><button class="btn" data-editgest="${esc(g.id)}">Aggiorna consuntivo</button><button class="btn" data-defgest="${esc(g.id)}">Modifica gestione</button><button class="btn primary" data-xlsgest="${esc(g.id)}">${IC.dl} Excel della gestione</button></div>` };
};

ROUTES.utenza = arg => {
  const [tipo, casaArg] = arg.split("/");
  const casa = tipo === "luce" ? (casaArg || "casa1") : "casa1";
  const bills = M().filter(m => m.tipo === tipo && m.casa === casa).sort((a, b) => (b.dal || b.scadenza || "").localeCompare(a.dal || a.scadenza || ""));
  const name = { luce: "Luce", gas: "Gas", internet: "Internet" }[tipo];
  const art = { luce: "luce", gas: "gas", internet: "net" }[tipo];
  const unit = tipo === "luce" ? "kWh" : tipo === "gas" ? "Smc" : null;
  const last12 = bills.filter(b => b.al && daysTo(b.al) > -365);
  const days12 = sum(last12, b => b.dal && b.al ? daysBetween(b.dal, b.al) : 0);
  const per30 = days12 ? r2(sum(last12, b => b.importo) / days12 * 30) : null;
  const cons12 = unit ? sum(last12, b => b.consumo) : null;
  const yearNow = todayISO().slice(0, 4);
  const thisYear = sum(bills.filter(b => (b.al || "").startsWith(yearNow)), b => b.importo);
  // chart: last 18 bills, cost per 30 days
  const ch = bills.filter(b => b.dal && b.al && b.importo > 0).slice(0, 18).reverse();
  let chart = "";
  if (ch.length > 1) {
    const vals = ch.map(b => b.importo / daysBetween(b.dal, b.al) * 30); const max = Math.max(...vals) * 1.15;
    const W = 340, Hh = 140, bw = W / ch.length;
    chart = `<div class="chart"><svg viewBox="0 0 ${W} ${Hh + 22}">
      ${[0.5, 1].map(f => `<line x1="0" x2="${W}" y1="${Hh - Hh * f / 1.15}" y2="${Hh - Hh * f / 1.15}" stroke="var(--line)" stroke-dasharray="3 3"/><text x="2" y="${Hh - Hh * f / 1.15 - 3}">${Math.round(max / 1.15 * f)} €</text>`).join("")}
      ${ch.map((b, i) => { const h = vals[i] / max * Hh; const lastB = i === ch.length - 1; return `<rect x="${i * bw + bw * 0.18}" y="${Hh - h}" width="${bw * 0.64}" height="${h}" rx="3" fill="${lastB ? "var(--accent)" : "color-mix(in srgb, var(--accent) 45%, transparent)"}"><title>${dmy(b.dal)}: ${eur(b.importo)}</title></rect>`; }).join("")}
      ${ch.map((b, i) => (i % 3 === 0 || i === ch.length - 1) ? `<text x="${i === 0 ? 2 : i === ch.length - 1 ? W - 2 : i * bw + bw / 2}" y="${Hh + 15}" text-anchor="${i === 0 ? "start" : i === ch.length - 1 ? "end" : "middle"}">${MESI[+b.dal.slice(5, 7) - 1]} ${b.dal.slice(2, 4)}</text>` : "").join("")}
    </svg><div class="small" style="padding:0 6px 6px">Costo ogni 30 giorni, ultime ${ch.length} bollette</div></div>`;
  }
  const seg = tipo === "luce" && hasBox() ? `<div class="seg" role="group"><button aria-pressed="${casa === "casa1"}" data-go="#utenza/luce/casa1">Casa</button><button aria-pressed="${casa === "box1"}" data-go="#utenza/luce/box1">Box (wallbox)</button></div>` : "";
  const tabsU = `<div class="seg" role="group">${["luce", "gas", "internet"].map(t => `<button aria-pressed="${t === tipo}" data-go="#utenza/${t}">${{ luce: "Luce", gas: "Gas", internet: "Internet" }[t]}</button>`).join("")}</div>`;
  return { title: name + (tipo === "luce" && casa === "box1" ? " box" : ""), back: "home", tab: "home", html: `
    ${tabsU}
    <div class="hero"><div class="ill" style="background:${{ luce: "linear-gradient(160deg,#fff3cf,#fffaf0)", gas: "linear-gradient(160deg,#ffe4dc,#fff5f1)", internet: "linear-gradient(160deg,#e1f5ef,#f3fbf8)" }[tipo]}">${ART[art]}</div>
      <div><h2>${name}${tipo === "luce" ? (casa === "box1" ? " del box" : " di casa") : ""}</h2><div class="small">${bills[0] ? (bills[0].fornitore || "") + " · ultima " + eur(bills[0].importo) : "Nessuna bolletta"}</div></div></div>
    ${seg}
    <div class="kpis"><div class="kpi"><span>Ogni 30 gg (12 mesi)</span><b class="num">${eur(per30)}</b></div><div class="kpi"><span>Nel ${yearNow}</span><b class="num">${eur(thisYear)}</b></div>
      <div class="kpi"><span>${unit ? "Consumo 12 mesi" : "Bollette"}</span><b class="num">${unit ? Math.round(cons12) + " " + unit : bills.length}</b></div></div>
    ${chart}
    <button class="btn primary block" data-newbill="${tipo}/${casa}">${IC.plus} Nuova bolletta</button>
    <div class="list">${bills.map(b => itemRow(b, { date: x => x.dal, sub: [b.dal && b.al ? dmy(b.dal) + " – " + dmy(b.al) : "", b.consumo != null && unit ? b.consumo + " " + unit : ""].filter(Boolean).join(" · ") })).join("")}</div>` };
};

ROUTES.scadenze = tab => {
  tab = tab || (openItems(m => stato(m).late).length || openVehDl().some(d => dlState(d).late) ? "scadute" : "presto");
  const all = openItems();
  const groups = { scadute: all.filter(m => stato(m).late), presto: all.filter(m => stato(m).soon), tutte: all };
  const list = (groups[tab] || all).slice().sort((a, b) => (a.scadenza || "9999").localeCompare(b.scadenza || "9999"));
  const vAll = openVehDl(), vg = { scadute: vAll.filter(d => dlState(d).late), presto: vAll.filter(d => dlState(d).soon), tutte: vAll }, vl = vg[tab] || vAll;

  const lbl = { scadute: "Scadute", presto: "Entro 30 giorni", tutte: "Tutte" };
  const art = { scadute: "ok", presto: "ok", tutte: "ok" };
  return { title: "Scadenze", tab: "scadenze", html: `
    <div class="seg" role="group">${Object.keys(lbl).map(k => `<button aria-pressed="${k === tab}" data-go="#scadenze/${k}">${lbl[k]} (${groups[k].length + vg[k].length})</button>`).join("")}</div>
    <div class="sec-h"><h2>${lbl[tab]}</h2><span class="small num">${eur(sum(list, m => m.importo))}</span></div>
    ${list.length ? `<div class="list">${list.map(m => itemRow(m)).join("")}</div>` : emptyBox(art[tab], tab === "scadute" ? "Niente di scaduto per la casa. Bravo." : "Niente per la casa in questo periodo.")}
    ${vl.length ? `<div class="sec-h"><h2>Veicoli</h2><a class="small" href="#veicoli">apri</a></div><div class="list">${vl.map(dlRow).join("")}</div>` : ""}` };
};

ROUTES.tasse = () => {
  const x = M().filter(m => m.tipo === "tari" || m.tipo === "imu").sort((a, b) => (b.categoria || "").localeCompare(a.categoria || "") || (b.scadenza || "").localeCompare(a.scadenza || ""));
  const yrs = [...new Set(x.map(m => m.categoria))];
  return { title: "TARI e IMU", back: "casa/casa1", tab: "home", html: `
    <div class="hero"><div class="ill" style="background:linear-gradient(160deg,#e6f0e2,#f5f9f3)">${ART.tasse}</div><div><h2>Tasse sulla casa</h2><div class="small">Pagato in tutto ${eur(sum(x, m => m.pagato))}</div></div></div>
    <button class="btn primary block" data-newmov="casa1/tari">${IC.plus} Nuova TARI o IMU</button>
    ${yrs.map(y => `<div class="sec-h"><h2>${esc(y)}</h2><span class="small num">${eur(sum(x.filter(m => m.categoria === y), m => m.importo))}</span></div><div class="list">${x.filter(m => m.categoria === y).map(m => itemRow(m, { sub: [TIPI[m.tipo], m.imposta != null && m.imposta !== m.importo ? "imposta " + eur(m.imposta) : ""].filter(Boolean).join(" · ") })).join("")}</div>`).join("")}` };
};

ROUTES.lavori = () => {
  const x = M().filter(m => m.tipo === "casa");
  const cats = [...new Set(x.map(m => m.categoria || "Altro"))];
  const det = {}; x.forEach(m => { if (detrPct(m.detrazione)) { det[m.detrazione] = det[m.detrazione] || { s: 0, d: 0 }; det[m.detrazione].s += m.importo || 0; det[m.detrazione].d += m.detrazioneImporto || 0; } });
  const dk = Object.keys(det); const dtot = r2(dk.reduce((t, k) => t + det[k].d, 0));
  return { title: "Lavori e arredi", back: "casa/casa1", tab: "home", html: `
    <div class="hero"><div class="ill" style="background:linear-gradient(160deg,#fdebd3,#fff8ef)">${ART.lavori}</div><div><h2>${eur(sum(x, m => m.importo))}</h2><div class="small">spesi in lavori e arredi dal 2020</div></div></div>
    ${dk.length ? `<div class="sec-h"><h2>${esc(CFG().detrazioniTitolo || "Detrazioni")}</h2><span class="small num">${eur(r2(dtot / 10))} all'anno</span></div>
      <div class="tblwrap"><table><thead><tr><th>Bonus</th><th class="n">Spesa</th><th class="n">Detrazione</th></tr></thead><tbody>
      ${dk.map(k => `<tr><td>${esc(k.replace(/\s*\([^)]*\)\s*$/, ""))}</td><td class="n">${eur(r2(det[k].s))}</td><td class="n">${eur(r2(det[k].d))}</td></tr>`).join("")}
      <tr class="tot"><td>Totale in 10 anni</td><td></td><td class="n">${eur(dtot)}</td></tr></tbody></table></div>
      <div class="small">Bonus mobili: massimo 5.000 € di spesa, cioè 2.500 € di detrazione.</div>` : ""}
    <button class="btn primary block" data-newmov="casa1/casa">${IC.plus} Nuova spesa</button>
    ${cats.map(c => { const y = x.filter(m => (m.categoria || "Altro") === c).sort((a, b) => (b.data || "").localeCompare(a.data || "")); return `<div class="sec-h"><h2>${esc(c)}</h2><span class="small num">${eur(sum(y, m => m.importo))}</span></div><div class="list">${y.map(m => itemRow(m, { date: z => z.data || z.scadenza, sub: [m.fornitore, m.detrazione].filter(Boolean).join(" · ") })).join("")}</div>`; }).join("")}` };
};

ROUTES.chiedere = () => {
  const p = S.data.promemoria; const ord = { Alta: 0, Media: 1, Bassa: 2 };
  const open = p.filter(x => !x.fatto).sort((a, b) => (ord[a.priorita] ?? 3) - (ord[b.priorita] ?? 3));
  const done = p.filter(x => x.fatto);
  const row = x => `<label class="prom${x.fatto ? " done" : ""}"><input type="checkbox" data-prom="${esc(x.id)}"${x.fatto ? " checked" : ""}><div><div class="t1">${esc(x.testo)}</div>
    <div class="t2">${x.priorita && !x.fatto ? `<span class="pill ${x.priorita === "Alta" ? "crit" : x.priorita === "Media" ? "warn" : ""}">${esc(x.priorita)}</span> ` : ""}${esc(caseNome(x.casa) || "")}${x.riferimento ? " · " + esc(x.riferimento) : ""}</div>
    ${x.azione && x.azione !== "Nessuna azione." ? `<div class="t2"><b>Cosa fare:</b> ${esc(x.azione)}</div>` : ""}</div></label>`;
  return { title: "Da chiedere", back: "home", tab: "home", html: `
    <button class="btn primary block" data-newprom>${IC.plus} Aggiungi</button>
    ${open.length ? `<div class="list">${open.map(row).join("")}</div>` : emptyBox("ok", "Nessuna domanda aperta.")}
    ${done.length ? `<div class="sec-h"><h2>Risolte</h2><span class="small">${done.length}</span></div><div class="list">${done.map(row).join("")}</div>` : ""}` };
};

let Q = { q: "", tipo: "" };
ROUTES.movimenti = () => {
  let x = M().filter(m => (!Q.tipo || m.tipo === Q.tipo));
  if (Q.q) { const q = Q.q.toLowerCase(); x = x.filter(m => [m.voce, m.fornitore, m.note, m.conto, m.categoria, gName(m), caseLong(m.casa)].join(" ").toLowerCase().includes(q)); }
  x.sort((a, b) => (refDate(b) || "0").localeCompare(refDate(a) || "0"));
  return { title: "Movimenti", tab: "movimenti", html: `
    <input class="search" id="q" type="search" placeholder="Cerca: rata, TARI, fornitore…" value="${esc(Q.q)}">
    <div class="seg" role="group"><button aria-pressed="${!Q.tipo}" data-tipo="">Tutti</button>${Object.entries(TIPI).map(([k, v]) => `<button aria-pressed="${Q.tipo === k}" data-tipo="${k}">${v}</button>`).join("")}</div>
    <div class="sec-h"><span class="small">${x.length} movimenti</span><span class="small num">pagati ${eur(sum(x, m => m.pagato))}</span></div>
    <button class="btn primary block" data-newmov="">${IC.plus} Nuovo movimento</button>
    <div class="list">${x.slice(0, 150).map(m => itemRow(m, { date: refDate })).join("")}</div>
    ${x.length > 150 ? '<div class="small">Mostro i 150 più recenti: usa la ricerca per gli altri.</div>' : ""}` };
};

ROUTES.impostazioni = () => ({ title: "Impostazioni", tab: "impostazioni", html: `
  <div class="hero" style="grid-template-columns:64px 1fr"><div style="width:64px;height:64px">${ART.logo}</div><div><h2>Spese di casa</h2><div class="small">versione ${VERSION}</div><button class="btn" data-act="versioni" style="margin-top:8px;min-height:36px;padding:6px 12px">Novità e versioni</button> <button class="btn" data-act="guida" style="margin-top:8px;min-height:36px;padding:6px 12px">Guida</button></div></div>
  ${installBox()}
  <div class="sec-h"><h2>Immobili e detrazioni</h2><span class="small">salvati solo su Drive</span></div>
  <button class="ycard" data-act="config" style="width:100%"><div><h3>${esc(caseLong("casa1"))}${hasBox() ? " · " + esc(caseLong("box1")) : ""}</h3>
    <div class="k">${(CFG().detrazioni || []).length} tipi di detrazione · tocca per cambiare nomi, indirizzi e dettagli</div></div></button>
  <div class="list">
    <div class="item" style="grid-template-columns:1fr auto"><div><div class="t1">Dove stanno i dati</div><div class="t2">Google Drive, cartella "Spese di casa": dati.json e il foglio Google</div></div><span></span></div>
    <div class="item" style="grid-template-columns:1fr auto"><div><div class="t1">Ultimo salvataggio</div><div class="t2">${S.data.aggiornato ? new Date(S.data.aggiornato).toLocaleString("it-IT") : "–"}</div></div><span></span></div>
  </div>
  <div class="actions">
    ${S.sheetUrl ? `<a class="btn primary" href="${esc(S.sheetUrl)}" target="_blank" rel="noopener">Apri il foglio Google</a>` : ""}
    <button class="btn" data-act="sheet">Aggiorna il foglio Google</button>
    <button class="btn" data-act="xlsall">${IC.dl} Scarica Excel completo</button>
    <button class="btn" data-act="backup">${IC.dl} Scarica dati.json</button>
    <button class="btn" data-act="gimport">Importa da Il mio garage</button><input type="file" id="gimport" accept=".json,application/json" hidden>
    <button class="btn" data-act="setup">Cambia collegamento</button>
    <button class="btn danger" data-act="logout">Scollega questo dispositivo</button>
  </div>
  <div class="sec-h"><h2>Backup</h2><span class="small">uno a settimana, per un anno</span></div>
  <div class="list" id="backups"><div class="item" style="grid-template-columns:1fr"><div class="t2">Tocca "Mostra i backup" per vedere le copie salvate su Google Drive.</div></div></div>
  <div class="actions"><button class="btn" data-act="listbk">Mostra i backup</button><button class="btn" data-act="restorefile">Ripristina da un file</button></div>
  <input type="file" id="restorefile" accept=".json,application/json" hidden>
  <div class="small">L'app non salva i dati altrove: sul dispositivo tiene solo una copia per aprirsi subito e funzionare offline. Prima di ogni ripristino lo script salva comunque una copia dei dati attuali.</div>` });

// ---------------------------------------------------------------- sheets (forms)
function openSheet(html) { $("#sheet").innerHTML = '<div class="grab"></div>' + html; $("#sheet").classList.add("open"); $("#scrim").classList.add("open"); }
function closeSheet() { $("#sheet").classList.remove("open"); $("#scrim").classList.remove("open"); }
const opt = (vals, sel) => vals.map(v => { const [k, l] = Array.isArray(v) ? v : [v, v]; return `<option value="${esc(k)}"${k === (sel ?? "") ? " selected" : ""}>${esc(l || "Nessuna")}</option>`; }).join("");
const contiSel = (id, val) => { const l = S.data.conti.slice(); if (val && !l.includes(val)) l.push(val); return `<select id="${id}"><option value="">Non indicato</option>${opt(l, val)}<option value="__new">Altro conto…</option></select><input id="${id}-new" placeholder="Nome del nuovo conto" hidden>`; };
function readConto(id) { let v = $("#" + id).value; if (v === "__new") { v = $("#" + id + "-new").value.trim(); if (v && !S.data.conti.includes(v)) commit({ op: "conto", name: v }); } return v || null; }
const val = id => { const e = $("#" + id); return e ? e.value.trim() : ""; };
const num = id => parseNum(val(id));

function payForm(id) {
  const m = M().find(x => x.id === id); if (!m) return;
  openSheet(`<h2>Segna pagata</h2><div class="small">${esc(m.voce)}</div><form class="form" id="f">
    <label>Importo pagato<input id="p-imp" inputmode="decimal" value="${inNum(m.importo)}"></label>
    <label>Data<input id="p-data" type="date" value="${todayISO()}"></label>
    <label class="full">Da quale conto${contiSel("p-conto", m.conto)}</label>
    <div class="actions full"><button type="button" class="btn" data-close>Annulla</button><button class="btn primary">Pagata</button></div></form>`);
  $("#f").onsubmit = e => { e.preventDefault(); const imp = num("p-imp"); if (imp == null || isNaN(imp)) return toast("Scrivi un importo, per esempio 72,74");
    closeSheet(); commit({ op: "mov", item: Object.assign({}, m, { pagato: imp, dataPag: val("p-data") || todayISO(), conto: readConto("p-conto") }) }, "Pagamento registrato"); confetti(); };
}

function movForm(id, preset) {
  const m = id ? M().find(x => x.id === id) : Object.assign({ id: uid(), casa: "casa1", tipo: "casa", voce: "" }, preset || {});
  if (!m) return;
  const isBill = ["luce", "gas", "internet"].includes(m.tipo);
  const gopts = [["", "Nessuna"], ...G().filter(g => g.casa === m.casa).map(g => [g.id, g.nome])];
  openSheet(`<h2>${id ? "Modifica" : "Nuovo movimento"}</h2><form class="form" id="f">
    <label>Immobile<select id="m-casa">${opt(caseEntries(), m.casa)}</select></label>
    <label>Tipo<select id="m-tipo">${opt(Object.entries(TIPI), m.tipo)}</select></label>
    <label class="full">Descrizione<input id="m-voce" value="${esc(m.voce)}" required></label>
    <label>Gestione<select id="m-gest">${opt(gopts, m.gestione || "")}</select></label>
    <label>Categoria o anno<input id="m-cat" value="${esc(m.categoria || "")}" placeholder="es. Cucina, 2026"></label>
    <label>Importo dovuto<input id="m-imp" inputmode="decimal" value="${inNum(m.importo)}" placeholder="0,00"></label>
    <label>Scadenza<input id="m-scad" type="date" value="${esc(m.scadenza || "")}"></label>
    <label>Importo pagato<input id="m-pag" inputmode="decimal" value="${inNum(m.pagato)}" placeholder="vuoto se da pagare"></label>
    <label>Data pagamento<input id="m-dpag" type="date" value="${esc(m.dataPag || "")}"></label>
    <label class="full">Conto${contiSel("m-conto", m.conto)}</label>
    <div class="full form" id="bill" ${isBill ? "" : "hidden"} style="grid-template-columns:1fr 1fr;gap:12px">
      <label>Periodo dal<input id="m-dal" type="date" value="${esc(m.dal || "")}"></label>
      <label>Periodo al<input id="m-al" type="date" value="${esc(m.al || "")}"></label>
      <label>Consumo<input id="m-cons" inputmode="decimal" value="${inNum(m.consumo)}"></label>
      <label>Unità<select id="m-un">${opt([["", "–"], "kWh", "Smc"], m.unita || "")}</select></label>
      <label class="full">Numero fattura<input id="m-fatt" value="${esc(m.fattura || "")}"></label>
    </div>
    <label>Fornitore<input id="m-forn" value="${esc(m.fornitore || "")}"></label>
    <label>Intestatario<input id="m-int" value="${esc(m.intestatario || "")}"></label>
    <label>Data fattura<input id="m-data" type="date" value="${esc(m.data || "")}"></label>
    <label>Stato particolare<select id="m-stato">${opt([["", "Normale"], ["riportata", "Riportata all'anno dopo"], ["chiusa", "Chiusa senza pagare"]], m.stato || "")}</select></label>
    <label>Detrazione<select id="m-detr">${opt(detrList().includes(m.detrazione || "") ? detrList() : detrList().concat([m.detrazione]), m.detrazione || "")}</select></label>
    <label>Detrazione stimata<input id="m-detimp" inputmode="decimal" value="${inNum(m.detrazioneImporto)}"></label>
    <label class="full check"><input type="checkbox" id="m-stima"${m.stima ? " checked" : ""}> Importo stimato</label>
    <label class="full">Note<textarea id="m-note">${esc(m.note || "")}</textarea></label>
    <div class="actions full">${id ? '<button type="button" class="btn danger" id="m-del">Elimina</button>' : ""}<button type="button" class="btn" data-close>Annulla</button><button class="btn primary">Salva</button></div></form>`);
  $("#m-tipo").onchange = () => { $("#bill").hidden = !["luce", "gas", "internet"].includes($("#m-tipo").value); };
  $("#m-casa").onchange = () => { $("#m-gest").innerHTML = opt([["", "Nessuna"], ...G().filter(g => g.casa === $("#m-casa").value).map(g => [g.id, g.nome])], ""); };
  $("#f").onsubmit = e => {
    e.preventDefault();
    const nums = { importo: num("m-imp"), pagato: num("m-pag"), consumo: num("m-cons"), detrazioneImporto: num("m-detimp") };
    if (Object.values(nums).some(v => v !== null && isNaN(v))) return toast("Controlla gli importi: usa la virgola per i decimali");
    if (!val("m-voce")) return toast("Scrivi una descrizione");
    const detr = val("m-detr");
    if (nums.detrazioneImporto == null && detrPct(detr) && nums.importo != null) nums.detrazioneImporto = r2(nums.importo * detrPct(detr));
    const item = Object.assign({}, m, nums, { casa: val("m-casa"), tipo: val("m-tipo"), voce: val("m-voce"), gestione: val("m-gest") || null, categoria: val("m-cat") || null,
      scadenza: val("m-scad") || null, dataPag: val("m-dpag") || null, conto: readConto("m-conto"), dal: val("m-dal") || null, al: val("m-al") || null, unita: val("m-un") || null,
      fattura: val("m-fatt") || null, fornitore: val("m-forn") || null, intestatario: val("m-int") || null, data: val("m-data") || null, stato: val("m-stato") || null,
      detrazione: detr || null, stima: $("#m-stima").checked, note: val("m-note") || null });
    if (item.pagato != null && !item.dataPag) item.dataPag = todayISO();
    if (!item.ordine) item.ordine = Date.now();
    Object.keys(item).forEach(k => { if (item[k] === null || item[k] === "" || item[k] === false) delete item[k]; });
    closeSheet(); commit({ op: "mov", item }, id ? "Salvato" : "Aggiunto");
  };
  const del = $("#m-del");
  if (del) del.onclick = () => { if (del.dataset.armed) { closeSheet(); commit({ op: "delmov", id }, "Eliminato"); } else { del.dataset.armed = 1; del.textContent = "Tocca ancora per eliminare"; } };
}

function newBill(tipo, casa) {
  const last = M().filter(m => m.tipo === tipo && m.casa === casa && m.dal).sort((a, b) => b.dal.localeCompare(a.dal))[0];
  const p = { tipo, casa, unita: tipo === "luce" ? "kWh" : tipo === "gas" ? "Smc" : null, fornitore: last && last.fornitore };
  if (last && last.al) {
    p.dal = addDays(last.al, 1);
    const monthly = last.dal.slice(8) === "01" || daysBetween(last.dal, last.al) <= 31;
    p.al = monthly ? addDays(addMonths(p.dal, 1), -1) : null;
    const lab = p.dal.slice(8) === "01" ? `${MESI_L[+p.dal.slice(5, 7) - 1]} ${p.dal.slice(0, 4)}` : `${dmy(p.dal)} - ${p.al ? dmy(p.al) : ""}`;
    p.voce = `${{ luce: casa === "box1" ? "Luce box" : "Luce casa", gas: "Gas casa", internet: "Internet" }[tipo]}, ${lab}`;
    if (tipo === "internet") p.importo = last.importo;
  }
  p.categoria = (p.al || todayISO()).slice(0, 4);
  movForm(null, p);
}

// new condominium year (or extraordinary works): name, period and the budget lines of the administrator's preventivo
function gestDefForm(casa, g) {
  const isNew = !g; g = g || { casa, tipo: "ordinaria", voci: [], note: [] };
  const y = new Date().getFullYear(), sugg = casa === "box1" ? String(y) : `${y}-${String(y + 1).slice(2)}`;
  const nome0 = (g.nome || "").replace(/^Straordinaria /, "");
  openSheet(`<h2>${isNew ? "Nuova gestione" : "Modifica gestione"} · ${esc(caseNome(casa))}</h2><div class="small">Una gestione è un anno del condominio (o un lavoro straordinario). Le cifre sono quelle del preventivo; il consuntivo si aggiunge dopo.</div><form class="form" id="gd">
    <label>Nome<input id="gd-nome" value="${esc(nome0 || sugg)}" placeholder="es. ${sugg}"></label>
    <label>Tipo<select id="gd-tipo">${opt([["ordinaria", "Ordinaria"], ["straordinaria", "Straordinaria (lavori)"]], g.tipo)}</select></label>
    <label class="full">Periodo e note brevi<textarea id="gd-per" placeholder="es. Periodo 01/07/${y} – 30/06/${y + 1}">${esc(g.periodo || "")}</textarea></label>
    <label class="full">Voci del preventivo, una per riga: voce | importo<textarea id="gd-voci" rows="6" placeholder="Spese di proprietà | 1200
Riscaldamento | 800">${esc((g.voci || []).map(v => v.voce + (v.prev != null ? " | " + inNum(v.prev) : "")).join("\n"))}</textarea></label>
    <div class="actions full">${!isNew && !M().some(m => m.gestione === g.id) ? '<button type="button" class="btn danger" id="gd-del">Elimina</button>' : ""}<button type="button" class="btn" data-close>Annulla</button><button class="btn primary">Salva</button></div></form>`);
  $("#gd").onsubmit = e => {
    e.preventDefault();
    const nome = val("gd-nome"), tipo = val("gd-tipo"); if (!nome) return toast("Scrivi il nome, per esempio " + sugg);
    let bad = false;
    const voci = val("gd-voci").split("\n").map(l => l.trim()).filter(Boolean).map(l => {
      const [a, b] = l.split("|").map(x => x.trim()); const n = b ? parseNum(b) : null; if (n !== null && isNaN(n)) bad = true;
      const old = (g.voci || []).find(v => v.voce === a) || {}; return Object.assign({}, old, { voce: a, prev: n });
    });
    if (bad) return toast("Controlla gli importi: usa la virgola per i decimali");
    const full = tipo === "straordinaria" ? "Straordinaria " + nome : nome;
    let id = g.id;
    if (isNew) { const slug = full.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); id = casa + "-" + slug; let k = 2; while (G().some(x => x.id === id)) id = casa + "-" + slug + "-" + k++; }
    closeSheet(); commit({ op: "gest", item: Object.assign({}, g, { id, casa, nome: full, tipo, periodo: val("gd-per"), voci }) }, isNew ? "Gestione creata" : "Gestione salvata");
    if (isNew) location.hash = "#gestione/" + encodeURIComponent(id);
  };
  const d = $("#gd-del"); if (d) d.onclick = () => { if (d.dataset.armed) { closeSheet(); commit({ op: "delgest", id: g.id }, "Gestione eliminata"); location.hash = "#casa/" + casa; } else { d.dataset.armed = 1; d.textContent = "Tocca ancora per eliminare"; } };
}
function gestForm(id) {
  const g = G().find(x => x.id === id); if (!g) return;
  openSheet(`<h2>Consuntivo ${esc(g.nome)}</h2><div class="small">Scrivi le cifre del riparto consuntivo e il saldo che ti comunica l'amministratore (+ da pagare, − a credito).</div><form class="form" id="f">
    ${(g.voci || []).map((v, i) => `<label class="full">${esc(v.voce)} <span class="small">prev. ${eur(v.prev)}</span><input id="g-${i}" inputmode="decimal" value="${inNum(v.cons)}"></label>`).join("")}
    <label>Saldo precedente<input id="g-prec" inputmode="decimal" value="${inNum(g.saldoPrec)}"></label>
    <label>Saldo amministratore<input id="g-adm" inputmode="decimal" value="${inNum(g.saldoAdmin)}"></label>
    <label class="full">Aggiungi una nota<textarea id="g-nota"></textarea></label>
    <div class="actions full"><button type="button" class="btn" data-close>Annulla</button><button class="btn primary">Salva</button></div></form>`);
  $("#f").onsubmit = e => {
    e.preventDefault();
    const voci = (g.voci || []).map((v, i) => Object.assign({}, v, { cons: num("g-" + i) }));
    const prec = num("g-prec"), adm = num("g-adm");
    if (voci.some(v => v.cons !== null && isNaN(v.cons)) || [prec, adm].some(v => v !== null && isNaN(v))) return toast("Controlla gli importi");
    const nota = val("g-nota");
    closeSheet(); commit({ op: "gest", item: Object.assign({}, g, { voci, saldoPrec: prec, saldoAdmin: adm, note: nota ? (g.note || []).concat([nota]) : (g.note || []) }) }, "Gestione aggiornata");
  };
}
function promForm() {
  openSheet(`<h2>Cosa devi chiedere</h2><form class="form" id="f">
    <label>Immobile<select id="q-casa">${opt([["casa1", caseNome("casa1")]].concat(hasBox() ? [["box1", caseNome("box1")]] : []), "casa1")}</select></label>
    <label>Priorità<select id="q-pr">${opt(["Alta", "Media", "Bassa"], "Media")}</select></label>
    <label class="full">Domanda o problema<textarea id="q-t"></textarea></label>
    <label class="full">A chi, o cosa fare<input id="q-a"></label>
    <div class="actions full"><button type="button" class="btn" data-close>Annulla</button><button class="btn primary">Aggiungi</button></div></form>`);
  $("#f").onsubmit = e => { e.preventDefault(); if (!val("q-t")) return toast("Scrivi la domanda");
    closeSheet(); commit({ op: "prom", item: { id: uid(), casa: val("q-casa"), priorita: val("q-pr"), testo: val("q-t"), azione: val("q-a"), fatto: false } }, "Aggiunta"); };
}

// ---------------------------------------------------------------- backup e ripristino
const bkLabel = n => { const m = n.match(/dati-(\d{4})-(\d{2})-(\d{2})(?:_(\d{2})-(\d{2}))?/); return m ? `${m[3]}/${m[2]}/${m[1]}${m[4] ? " " + m[4] + ":" + m[5] + " (prima di un ripristino)" : ""}` : n; };
async function listBackups() {
  const box = $("#backups"); if (!box) return;
  if (TEST) { box.innerHTML = '<div class="item" style="grid-template-columns:1fr"><div class="t2">In prova non ci sono backup.</div></div>'; return; }
  box.innerHTML = '<div class="item" style="grid-template-columns:1fr"><div class="t2">Carico…</div></div>';
  try {
    const j = await api("backups");
    box.innerHTML = (j.backups || []).slice(0, 30).map(b => `<div class="item" style="grid-template-columns:1fr auto"><div><div class="t1">${esc(bkLabel(b.name))}</div><div class="t2">dati com'erano all'inizio di quel giorno</div></div><button class="btn" data-act="restore" data-name="${esc(b.name)}">Ripristina</button></div>`).join("")
      || '<div class="item" style="grid-template-columns:1fr"><div class="t2">Ancora nessun backup: il primo si crea alla prima modifica di oggi.</div></div>';
  } catch (e) { box.innerHTML = `<div class="item" style="grid-template-columns:1fr"><div class="t2">${esc(e.message)}</div></div>`; }
}
async function doRestore(payload, label) {
  if (TEST) return toast("In prova non si ripristina");
  if (S.pending.length) return toast("Aspetta che l'ultima modifica sia salvata");
  try {
    toast("Ripristino…");
    const j = await api("restore", payload);
    S.data = j.data; S.etag = j.rev; S.pending = []; persistCache(); render(); scheduleSheet();
    toast("Ripristinato " + (label ? bkLabel(label) : "dal file"));
  } catch (e) { toast(e.message); }
}
document.addEventListener("change", async e => {
  if (e.target.id !== "restorefile") return;
  const f = e.target.files[0]; if (!f) return;
  try { const data = JSON.parse(await f.text()); if (!Array.isArray(data.movimenti)) throw new Error("Il file non contiene dati validi"); await doRestore({ data }, null); }
  catch (err) { toast(err.message); }
});

// ---------------------------------------------------------------- garage (vehicles, from "Il mio garage")
const CD = ["Bollo", "Assicurazione", "Revisione", "Tagliando", "Cambio gomme", "Altra scadenza"];
const CI = ["Manutenzione", "Tagliando", "Gomme"];
const CS = ["Assicurazione", "Bollo", "Revisione", "Lavaggio", "Multe", "Parcheggi e pedaggi", "Altro"];
const SUP = ["Tagliando", "Gomme", "Manutenzione", "Lavaggio", "Revisione"];
const FORME = ["Crossover", "SUV compatto", "Utilitaria", "Berlina", "Moto naked"];
const GD = () => (S.data && S.data.garage) || { vehicles: [], items: [], kmMensili: [], patente: null };
const VH = id => GD().vehicles.find(v => v.id === id);
const GI = (vid, k) => GD().items.filter(i => i.vid === vid && i.kind === k);
const nf = (n, d = 0) => new Intl.NumberFormat("it-IT", { maximumFractionDigits: d }).format(n || 0);
const eur3 = n => new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(n || 0);
const gid7 = () => Math.random().toString(36).slice(2, 9);
const tmin = m => m ? Math.floor(m / 60) + " h " + String(m % 60).padStart(2, "0") + " min" : "";

function ensureGarage(data) { if (!data.garage) data.garage = { vehicles: [], items: [], kmMensili: [], patente: null }; return data.garage; }
function applyGarage(data, op) {
  const g = ensureGarage(data);
  const up = (arr, it, key = "id") => { const i = arr.findIndex(x => x[key] === it[key]); if (i >= 0) arr[i] = it; else arr.push(it); };
  if (op.op === "gveh") up(g.vehicles, op.item);
  if (op.op === "gdelveh") { g.vehicles = g.vehicles.filter(v => v.id !== op.id); g.items = g.items.filter(i => i.vid !== op.id); g.kmMensili = g.kmMensili.filter(r => r.vid !== op.id); }
  if (op.op === "gitem") up(g.items, op.item);
  if (op.op === "gdelitem") g.items = g.items.filter(i => i.id !== op.id);
  if (op.op === "gpat") g.patente = op.item;
  if (op.op === "gpatente" || op.op === "gdelpatente") {
    if (!g.patenti) { g.patenti = g.patente ? [Object.assign({ id: "p1" }, g.patente)] : []; delete g.patente; }
    if (op.op === "gpatente") up(g.patenti, op.item); else g.patenti = g.patenti.filter(x => x.id !== op.id);
  }
  if (op.op === "gkm") { const i = g.kmMensili.findIndex(r => r.vid === op.row.vid && r.anno === op.row.anno); if (i >= 0) g.kmMensili[i] = op.row; else g.kmMensili.push(op.row); }
  if (op.op === "gimport") data.garage = op.garage;
  if (op.op === "gflag") { g.flags = g.flags || {}; g.flags[op.name] = true; }
}

// expenses that carry their own expiry become automatic deadlines (as in Il mio garage)
function autoDeadlines() {
  const out = [], dk = i => i.cat === "Assicurazione" ? i.a : i.scadenza;
  GD().vehicles.filter(v => !v.storico).forEach(v => ["Bollo", "Revisione", "Assicurazione"].forEach(c => {
    const b = GI(v.id, "expense").filter(i => i.cat === c && dk(i)).sort((x, y) => dk(y).localeCompare(dk(x)))[0];
    if (b && !GI(v.id, "deadline").some(d => d.cat === c && d.date === dk(b))) out.push({ id: "auto-" + b.id, src: b.id, vid: v.id, kind: "deadline", auto: true, cat: c, date: dk(b), cost: b.cost, done: false });
  }));
  return out;
}
function vehicleDeadlines(includeDone) {
  const g = GD();
  const list = [...g.items.filter(i => i.kind === "deadline" && (includeDone || !i.done)), ...autoDeadlines()];
  PATENTI().forEach(p => { if (p.scadenza) list.push({ id: "pat-" + p.id, patId: p.id, kind: "deadline", cat: "Patente", label: p.titolare || "", date: p.scadenza, patente: true, done: false }); });
  return list.filter(d => d.date).sort((a, b) => a.date.localeCompare(b.date));
}
function dlState(d) {
  if (d.done) return { t: "Fatta", c: "ok", open: false };
  const n = daysTo(d.date);
  if (n < 0) return { t: `Scaduta da ${-n} ${n === -1 ? "giorno" : "giorni"}`, c: "crit", open: true, late: true };
  if (n <= 30) return { t: n === 0 ? "Scade oggi" : `Tra ${n} ${n === 1 ? "giorno" : "giorni"}`, c: "warn", open: true, soon: true };
  return { t: `Tra ${n} giorni`, c: "acc", open: true, later: true };
}
function dlRow(d) {
  const s = dlState(d), v = VH(d.vid);
  const pct = s.late ? 100 : Math.max(4, Math.min(100, Math.round((1 - daysTo(d.date) / 90) * 100)));
  const btn = d.done ? "" : d.patente ? `<button class="paybtn" data-pat="${esc(d.patId)}">Aggiorna</button>` : d.auto ? `<button class="paybtn" data-renew="${esc(d.vid)}/${esc(d.cat)}">Rinnova</button>` : `<button class="paybtn" data-dldone="${esc(d.id)}">Fatta</button>`;
  return `<div class="item${s.late ? " late" : s.soon ? " soon" : ""}" role="button" tabindex="0" data-dl="${esc(d.id)}">${calBox(d.date)}
    <div><div class="t1">${esc(d.cat)}${v ? " · " + esc(v.name) : ""}${d.patente && d.label ? " · " + esc(d.label) : ""}</div><div class="t2">${d.patente ? "Patente " + esc(catLabel(PATENTI().find(x => x.id === d.patId) || {})) : d.auto ? "dall'ultima spesa registrata" : esc(d.note || "promemoria")}</div>
    ${s.open ? `<div class="bar"><i style="width:${pct}%;background:var(--${s.late ? "crit" : s.soon ? "warn" : "accent"})"></i></div>` : ""}</div>
    <div class="right">${d.cost ? `<span class="amt num">${eur(d.cost)}</span>` : ""}<span class="pill ${s.c}">${esc(s.t)}</span>${btn}</div></div>`;
}
const PATENTI = () => { const g = GD(); return g.patenti || (g.patente ? [Object.assign({ id: "p1" }, g.patente)] : []); };
const catLabel = p => { const c = (p.categorie || []).slice(); const t = c.length === 2 ? "A e B" : c.join(""); return [t, p.altre].filter(Boolean).join(", ") || "categorie non indicate"; };
const openVehDl = () => vehicleDeadlines(false).filter(d => dlState(d).open);

// spending and consumption
const vSpent = (vid, y) => GD().items.filter(i => i.vid === vid && (!y || (i.date || "").startsWith(y))).reduce((s, i) => s + (i.kind === "fuel" ? i.total || 0 : i.kind === "expense" ? i.cost || 0 : 0), 0);
function fuelRows(vid) {
  const a = GI(vid, "fuel").sort((x, y) => (x.date || "").localeCompare(y.date || "") || (x.km || 0) - (y.km || 0));
  return a.map((f, i) => { const p = a[i - 1], dkm = p && p.pieno && f.pieno && f.km > 0 && p.km > 0 && f.km > p.km && f.liters > 0 ? f.km - p.km : 0; return Object.assign({}, f, { kml: dkm ? dkm / f.liters : null, dkm }); });
}
function elecRows(vid) {
  const a = GI(vid, "fuel").sort((x, y) => (x.km || 0) - (y.km || 0) || (x.date || "").localeCompare(y.date || ""));
  return a.map((f, i) => { const p = a[i - 1], d = p && f.km && p.km && f.km > p.km ? f.km - p.km : 0; return Object.assign({}, f, { dkm: d, k100: d && f.energia > 0 ? f.energia / d * 100 : null }); });
}
function consumo(v) {
  if (v.carburante === "Elettrico") { const r = elecRows(v.id).filter(x => x.k100); const e = r.reduce((s, x) => s + x.energia, 0), k = r.reduce((s, x) => s + x.dkm, 0); return k ? nf(e / k * 100, 1) + " kWh/100 km" : "n.d."; }
  const r = fuelRows(v.id).filter(x => x.kml); const l = r.reduce((s, x) => s + x.liters, 0); return l ? nf(r.reduce((s, x) => s + x.dkm, 0) / l, 1) + " km/l" : "n.d.";
}
const kmMap = vid => { const R = {}; GD().kmMensili.filter(r => r.vid === vid).forEach(r => r.mesi.forEach((x, i) => { if (x) R[r.anno * 12 + i] = x; })); return R; };

// vehicle illustration, drawn from shape and colours (replaces the photos)
function vehArt(v) {
  const c1 = (v && v.col1) || "#8a96a3", c2 = (v && v.col2) || "#16181b", f = (v && v.forma) || (v && v.type === "Moto" ? "Moto naked" : "Crossover");
  const wheel = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#1d2025"/><circle cx="${x}" cy="${y}" r="${r * 0.48}" fill="#b8bec6"/><circle cx="${x}" cy="${y}" r="${r * 0.16}" fill="#5d646d"/>`;
  const out = 'stroke="#0003" stroke-width="1.2"';
  if (f === "Moto naked") return `<svg viewBox="0 0 160 96" aria-hidden="true"><ellipse cx="82" cy="86" rx="66" ry="4" fill="#0002"/>
    ${wheel(38, 66, 19)}${wheel(124, 66, 19)}
    <path d="M38 66 L66 44 L96 46 L124 66" fill="none" stroke="${c2}" stroke-width="5" stroke-linejoin="round"/>
    <path d="M66 44 L80 66 L96 46" fill="none" stroke="${c2}" stroke-width="4"/>
    <rect x="70" y="52" width="22" height="13" rx="4" fill="#4b5058"/>
    <path d="M58 40 Q60 30 78 30 L98 31 Q106 32 106 40 L100 46 L64 46 Z" fill="${c1}" ${out}/>
    <path d="M36 42 Q44 36 60 38 L62 44 L40 46 Z" fill="#202328"/>
    <path d="M106 36 L116 26 L124 26" fill="none" stroke="#2a2d33" stroke-width="3" stroke-linecap="round"/>
    <path d="M112 40 L124 66" stroke="#9aa1aa" stroke-width="4"/>
    <circle cx="117" cy="36" r="5" fill="#f3d36b" stroke="#2a2d33" stroke-width="2"/></svg>`;
  const shapes = {
    "Crossover": { body: "M10 62 Q10 48 22 46 L44 42 Q56 26 74 24 L110 24 Q124 25 134 40 L148 44 Q154 46 154 56 L154 64 Q154 68 150 68 L14 68 Q10 68 10 62 Z",
      roof: "M74 24 L110 24 Q124 25 134 40 L128 42 Q120 30 110 29 L76 29 Q66 30 58 42 L44 42 Q56 26 74 24 Z",
      win: ["M60 42 Q67 31 77 30 L96 30 L96 42 Z", "M100 30 L110 30 Q120 31 127 42 L100 42 Z"], w: [[40, 68, 13], [124, 68, 13]], light: "M146 48 L154 50 L154 54 L146 53 Z" },
    "SUV compatto": { body: "M10 64 L10 50 Q12 44 20 43 L40 40 L52 22 Q54 20 58 20 L116 20 Q122 20 126 26 L138 40 L148 42 Q154 44 154 52 L154 64 Q154 68 150 68 L14 68 Q10 68 10 64 Z",
      roof: "M52 22 Q54 20 58 20 L116 20 Q122 20 126 26 L138 40 L132 40 L120 26 L62 25 L54 40 L40 40 Z",
      win: ["M56 40 L64 26 L92 26 L92 40 Z", "M96 26 L118 26 L130 40 L96 40 Z"], w: [[40, 68, 14], [124, 68, 14]], light: "M146 46 L154 48 L154 53 L146 52 Z" },
    "Berlina": { body: "M8 64 L8 53 Q8 48 14 47 L46 44 L58 29 Q60 27 64 27 L100 27 Q104 27 106 29 L120 44 L148 46 Q154 47 154 53 L154 64 Q154 68 150 68 L12 68 Q8 68 8 64 Z",
      roof: "M58 29 Q60 27 64 27 L100 27 Q104 27 106 29 L120 44 L115 44 L102 31 L66 31 L53 44 L46 44 Z",
      win: ["M56 43 L66 32 L82 32 L82 43 Z", "M86 32 L101 32 L112 43 L86 43 Z"], w: [[38, 68, 12], [124, 68, 12]], light: "M148 49 L154 50 L154 55 L148 54 Z" },
    "Utilitaria": { body: "M18 64 L18 48 Q20 42 28 41 L42 38 L56 21 Q58 19 62 19 L102 19 Q110 19 114 27 L124 40 L134 42 Q140 44 140 52 L140 64 Q140 68 136 68 L22 68 Q18 68 18 64 Z",
      roof: "M56 21 Q58 19 62 19 L102 19 Q110 19 114 27 L124 40 L118 40 L108 26 L64 25 L56 38 L42 38 Z",
      win: ["M58 38 L66 25 L84 25 L84 38 Z", "M88 25 L106 25 L116 38 L88 38 Z"], w: [[42, 68, 12], [116, 68, 12]], light: "M132 46 L140 48 L140 53 L132 52 Z" }
  };
  const s = shapes[f] || shapes.Crossover;
  return `<svg viewBox="0 0 160 96" aria-hidden="true"><ellipse cx="82" cy="84" rx="70" ry="4" fill="#0002"/>
    <path d="${s.body}" fill="${c1}" ${out}/><path d="${s.roof}" fill="${c2}"/>
    ${s.win.map(w => `<path d="${w}" fill="#bcd7f2" opacity=".9"/>`).join("")}
    <path d="${s.light}" fill="#f3d36b"/><rect x="${f === "Utilitaria" ? 18 : 10}" y="50" width="5" height="5" rx="1" fill="#e2574c"/>
    ${s.w.map(([x, y, r]) => wheel(x, y, r)).join("")}</svg>`;
}

// photo if present and chosen, otherwise the drawing
const hasFoto = v => v && v.foto && v.vista !== "Disegno";
function vehImg(v) { return hasFoto(v) ? `<img class="vfoto ${v.fotoTipo === "scontornata" ? "cut" : "full"}" alt="" src="${v.foto}">` : vehArt(v); }
// shrink a picture (data URL or File) to max 560 px; keeps transparency when the browser can write WebP
async function shrinkImg(src, keepAlpha) {
  const url = typeof src === "string" ? src : URL.createObjectURL(src);
  const im = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error("Immagine non leggibile")); i.src = url; });
  const k = Math.min(1, 560 / Math.max(im.naturalWidth, im.naturalHeight));
  const c = document.createElement("canvas"); c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
  const x = c.getContext("2d"); if (!keepAlpha) { x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); } x.drawImage(im, 0, 0, c.width, c.height);
  if (typeof src !== "string") URL.revokeObjectURL(url);
  const w = c.toDataURL("image/webp", 0.8);
  if (w.startsWith("data:image/webp")) return w;
  if (keepAlpha) return typeof src === "string" ? src : c.toDataURL("image/png");
  return c.toDataURL("image/jpeg", 0.8);
}
function fotoSheet(id) {
  const v = VH(id); if (!v) return;
  openSheet(`<h2>Immagine · ${esc(v.name)}</h2><div class="vart">${vehImg(v)}</div>
    <input type="file" id="vfoto" accept="image/*" hidden data-vid="${esc(v.id)}">
    <div class="stack">
      <button class="btn primary" data-fotopick>${v.foto ? "Cambia foto" : "Scegli una foto"}</button>
      ${v.foto ? `<button class="btn" data-vista="${esc(v.id)}|${v.vista === "Disegno" ? "Foto" : "Disegno"}">${v.vista === "Disegno" ? "Usa la foto" : "Usa il disegno"}</button>` : ""}
      <button class="btn" data-editveh="${esc(v.id)}">Cambia forma e colori del disegno</button>
      ${v.foto ? `<button class="btn danger" data-fotodel="${esc(v.id)}">Togli la foto</button>` : ""}
      <button class="btn" data-close>Chiudi</button></div>
    <div class="small">Una foto con lo sfondo trasparente (PNG o WebP) si vede meglio. Il disegno resta sempre disponibile.</div>`);
}

// ---------------------------------------------------------------- garage views
ROUTES.veicoli = () => {
  const g = GD(); const y = todayISO().slice(0, 4);
  const act = g.vehicles.filter(v => !v.storico), old = g.vehicles.filter(v => v.storico);
  const dl = openVehDl();
  const card = v => { const nd = dl.filter(d => d.vid === v.id); const late = nd.filter(d => dlState(d).late).length;
    return `<a class="ycard vcard" href="#veicolo/${encodeURIComponent(v.id)}"><div class="vart">${vehImg(v)}</div>
      <div><h3>${esc(v.name)}</h3><div class="k">${esc([v.plate, v.carburante].filter(Boolean).join(" · "))}</div>${v.fascia ? `<span class="pill warn" style="margin-top:4px">${esc(v.fascia.toLowerCase())}</span>` : ""}</div>
      <div class="vstats"><span>Km<b class="num">${v.km ? nf(v.km) : "–"}</b></span><span>Spese ${y}<b class="num">${eur(vSpent(v.id, y))}</b></span>${statTerza(v)}</div>
      ${late ? `<span class="pill crit">${late} scadut${late === 1 ? "a" : "e"}</span>` : nd.length ? `<span class="pill warn">${nd.filter(d => dlState(d).soon).length || nd.length} in arrivo</span>` : '<span class="pill ok">in regola</span>'}</a>`; };
  return { title: "Veicoli", back: "home", tab: "home", html: `
    ${!g.vehicles.length ? `<div class="empty">${vehArt({ forma: "Crossover", col1: "#2a6fdb", col2: "#17212b" })}<div>Nessun veicolo ancora. Importa i dati da Il mio garage, oppure aggiungi un veicolo.</div>
      <input type="file" id="gimport" accept=".json,application/json" hidden><button class="btn primary" data-act="gimport">Importa da Il mio garage</button></div>` : ""}
    ${dl.length ? `<div class="sec-h"><h2>Scadenze</h2><span class="small">${dl.length}</span></div><div class="list">${dl.slice(0, 6).map(dlRow).join("")}</div>` : ""}
    ${act.length ? `<div class="sec-h"><h2>I veicoli</h2><span class="small">spese ${y}: ${eur(act.reduce((s, v) => s + vSpent(v.id, y), 0))}</span></div><div class="cards vcards">${act.map(card).join("")}</div>` : ""}
    <div class="sec-h"><h2>Patenti</h2><span class="small">${PATENTI().length || ""}</span></div>
    ${PATENTI().map(p => `<button class="ycard" data-pat="${esc(p.id)}" style="width:100%;margin-bottom:10px"><div class="row1"><div class="cal" style="width:52px"><b>${p.punti != null ? esc(p.punti) : "–"}</b><span>punti</span></div>
      <div><h3>${esc(p.titolare || "Patente di guida")}</h3><div class="k">Patente ${esc(catLabel(p))}${p.numero ? " · N. " + esc(p.numero) : ""}${p.scadenza ? " · scade il " + dmy(p.scadenza) : ""}</div></div></div>
      ${p.scadenza ? `<span class="pill ${dlState({ date: p.scadenza }).c}">${esc(dlState({ date: p.scadenza }).t)}</span>` : ""}</button>`).join("")}
    <div class="actions"><button class="btn" data-pat="">${IC.plus} Aggiungi patente</button></div>
    ${old.length ? `<div class="sec-h"><h2>Storico</h2><span class="small">non più in uso</span></div><div class="cards vcards">${old.map(card).join("")}</div>` : ""}
    <div class="actions"><button class="btn primary" data-addveh>${IC.plus} Nuovo veicolo</button>${g.vehicles.length ? '<input type="file" id="gimport" accept=".json,application/json" hidden><button class="btn" data-act="gimport">Reimporta da Il mio garage</button>' : ""}</div>` };
};

const VTABS = [["scadenze", "Scadenze"], ["rifornimenti", "Ricariche e rifornimenti"], ["interventi", "Interventi"], ["spese", "Spese"], ["km", "Km"], ["note", "Note"], ["dati", "Dati"]];
ROUTES.veicolo = arg => {
  const [id, tabArg] = arg.split("/"); const v = VH(id); if (!v) return ROUTES.veicoli();
  const tab = tabArg || "scadenze"; const y = todayISO().slice(0, 4);
  const el = v.carburante === "Elettrico";
  const seg = `<div class="seg" role="group">${VTABS.map(([k, l]) => `<button aria-pressed="${k === tab}" data-go="#veicolo/${encodeURIComponent(v.id)}/${k}">${k === "rifornimenti" ? (el ? "Ricariche" : "Rifornimenti") : l}</button>`).join("")}</div>`;
  let body = "";
  if (tab === "scadenze") {
    const all = [...GI(v.id, "deadline"), ...autoDeadlines().filter(d => d.vid === v.id)].sort((a, b) => a.done - b.done || a.date.localeCompare(b.date));
    body = `<button class="btn primary block" data-gadd="deadline">${IC.plus} Nuova scadenza</button>${all.length ? `<div class="list">${all.map(dlRow).join("")}</div>` : emptyBox("ok", "Nessuna scadenza per questo veicolo.")}`;
  } else if (tab === "rifornimenti") {
    if (el) {
      const r = elecRows(v.id); const tot = sum(r, x => x.total), kw = r.reduce((s, x) => s + (x.energia || 0), 0); const cs = r.filter(x => x.k100);
      const ce = cs.reduce((s, x) => s + x.energia, 0), cd = cs.reduce((s, x) => s + x.dkm, 0);
      body = `<div class="kpis"><div class="kpi"><span>Prezzo medio</span><b class="num">${kw ? eur3(tot / kw) : "–"}</b></div><div class="kpi"><span>Spesa totale</span><b class="num">${eur(tot)}</b></div><div class="kpi"><span>Energia</span><b class="num">${nf(kw, 0)} kWh</b></div></div>
        ${(() => { const pr = r.filter(x => x.energia > 0 && x.total > 0).map(x => x.total / x.energia); return pr.length > 1 ? `<div class="small">Prezzo più basso ${eur3(Math.min(...pr))}/kWh, più alto ${eur3(Math.max(...pr))}/kWh.</div>` : ""; })()}
        <div class="small">Consumo medio: ${cd ? nf(ce / cd * 100, 1) + " kWh/100 km" : "servono i km alle ricariche"}. Il prezzo medio è per kWh.</div>
        ${costChart(r.filter(x => x.date && x.total), x => x.total)}
        <button class="btn primary block" data-gadd="fuel">${IC.plus} Nuova ricarica</button>
        <div class="list">${r.slice().sort((a, b) => (b.date || "").localeCompare(a.date || "")).map(x => grow(x, [x.corrente, x.energia ? nf(x.energia, 1) + " kWh" : "", x.tempo ? tmin(x.tempo) : "", x.energia ? eur3(x.total / x.energia) + "/kWh" : "", x.fornitore].filter(Boolean).join(" · "), x.total)).join("")}</div>`;
    } else {
      const r = fuelRows(v.id); const tot = sum(r, x => x.total), l = r.reduce((s, x) => s + (x.liters || 0), 0);
      body = `<div class="kpis"><div class="kpi"><span>Consumo medio</span><b class="num">${esc(consumo(v))}</b></div><div class="kpi"><span>Prezzo medio</span><b class="num">${l ? eur3(tot / l) + "/l" : "–"}</b></div><div class="kpi"><span>Spesa totale</span><b class="num">${eur(tot)}</b></div></div>
        ${costChart(r.filter(x => x.date && x.total), x => x.total)}
        <button class="btn primary block" data-gadd="fuel">${IC.plus} Nuovo rifornimento</button>
        <div class="list">${r.slice().sort((a, b) => (b.date || "").localeCompare(a.date || "")).map(x => grow(x, [x.liters ? nf(x.liters, 2) + " l" : "", x.km ? nf(x.km) + " km" : "", x.kml ? nf(x.kml, 1) + " km/l" : "", x.pieno ? "pieno" : ""].filter(Boolean).join(" · "), x.total)).join("")}</div>`;
    }
  } else if (tab === "interventi" || tab === "spese") {
    const CC = tab === "spese" ? CS : CI; const a = GI(v.id, "expense").filter(i => CC.includes(i.cat)).sort((x, z) => (z.date || "").localeCompare(x.date || ""));
    const cats = [...new Set(a.map(i => i.cat))];
    body = `<div class="kpis"><div class="kpi"><span>Totale</span><b class="num">${eur(sum(a, i => i.cost))}</b></div><div class="kpi"><span>Nel ${y}</span><b class="num">${eur(sum(a.filter(i => (i.date || "").startsWith(y)), i => i.cost))}</b></div><div class="kpi"><span>Voci</span><b class="num">${a.length}</b></div></div>
      <button class="btn primary block" data-gadd="${tab === "spese" ? "spese" : "interv"}">${IC.plus} ${tab === "spese" ? "Nuova spesa" : "Nuovo intervento"}</button>
      ${cats.length ? cats.map(c => `<div class="sec-h"><h2>${esc(c)}</h2><span class="small num">${eur(sum(a.filter(i => i.cat === c), i => i.cost))}</span></div><div class="list">${a.filter(i => i.cat === c).map(i => grow(i, [i.fornitore || i.compagnia, i.cat === "Assicurazione" && (i.da || i.a) ? `copertura ${dmy(i.da)} → ${dmy(i.a)}` : "", i.scadenza ? "scadenza " + dmy(i.scadenza) : "", i.km ? nf(i.km) + " km" : "", i.stagione ? i.stagione + (i.condizione ? ", " + i.condizione : "") : "", (i.componenti || []).length ? i.componenti.length + " component" + (i.componenti.length === 1 ? "e" : "i") : ""].filter(Boolean).join(" · ") || i.note || "", i.cost)).join("")}</div>`).join("") : emptyBox("lavori", "Nessuna voce.")}`;
  } else if (tab === "km") {
    const R = kmMap(v.id), K2 = Object.keys(R).map(Number), Y = [...new Set(K2.map(k => Math.floor(k / 12)))].sort((a, b) => b - a);
    const perYear = Y.map(yy => { const ks = K2.filter(k => Math.floor(k / 12) === yy).sort((a, b) => a - b), pk = K2.filter(k => Math.floor(k / 12) === yy - 1); const s0 = pk.length ? Math.max(...pk) : ks.length > 1 ? ks[0] : null, e = ks[ks.length - 1]; return [yy, s0 == null ? null : R[e] - R[s0]]; });
    body = `<div class="kpis"><div class="kpi"><span>Km attuali</span><b class="num">${v.km ? nf(v.km) : "–"}</b></div>${perYear.slice(0, 2).map(([yy, k]) => `<div class="kpi"><span>Percorsi ${yy}</span><b class="num">${k == null ? "–" : nf(k)}</b></div>`).join("")}</div>
      <button class="btn primary block" data-kmadd>${IC.plus} Lettura dei km di questo mese</button>
      <div class="tblwrap"><table><thead><tr><th>Anno</th>${MESI.map(m => `<th class="n">${m}</th>`).join("")}</tr></thead><tbody>${Y.map(yy => `<tr><td><b>${yy}</b></td>${MESI.map((_, i) => `<td class="n">${R[yy * 12 + i] ? nf(R[yy * 12 + i]) : ""}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="13" class="small">Nessuna lettura.</td></tr>`}</tbody></table></div>
      <div class="small">Km percorsi per anno: dall'ultima lettura dell'anno precedente all'ultima dell'anno.</div>`;
  } else if (tab === "note") {
    const a = GI(v.id, "note").sort((x, z) => (z.date || "").localeCompare(x.date || ""));
    body = `<button class="btn primary block" data-gadd="note">${IC.plus} Nuova nota</button>${a.length ? `<div class="list">${a.map(i => `<div class="item" role="button" tabindex="0" data-gedit="${esc(i.id)}" style="grid-template-columns:auto 1fr">${calBox(i.date)}<div class="t2" style="color:var(--ink);white-space:pre-wrap">${esc(i.text)}</div></div>`).join("")}</div>` : emptyBox("ask", "Nessuna nota.")}`;
  } else {
    const rows = [["Tipo", v.type], ["Targa", v.plate], ["Intestatario", v.intestatario], ["Marca e modello", [v.marca, v.modello].filter(Boolean).join(" ")], ["Immatricolazione", v.immatricolazione && dmy(v.immatricolazione)], ["Acquisto", v.acquisto && dmy(v.acquisto)], ["Carburante", v.carburante], ["Km attuali", v.km && nf(v.km)], ["Telaio", v.telaio], ["ASI", v.asi ? ["Sì", v.crs && "CRS " + v.crs, v.asiData && "dal " + dmy(v.asiData)].filter(Boolean).join(" · ") : "No"], ["Gomme anteriori", [v.antStd, v.antAlt && "alt. " + v.antAlt].filter(Boolean).join(" · ")], ["Gomme posteriori", [v.postStd, v.postAlt && "alt. " + v.postAlt].filter(Boolean).join(" · ")], ["Dismissione", v.dismissione && dmy(v.dismissione)]];
    body = `<div class="tblwrap"><table><tbody>${rows.map(([k, x]) => `<tr><th style="width:42%">${k}</th><td>${x ? esc(x) : "–"}</td></tr>`).join("")}</tbody></table></div><button class="btn primary block" data-editveh="${esc(v.id)}">Modifica veicolo</button>`;
  }
  return { title: v.name, back: "veicoli", tab: "home", html: `
    <div class="hero vhero"><button class="vart big" data-foto="${esc(v.id)}" aria-label="Cambia immagine">${vehImg(v)}<span class="vedit">${IC.cam}</span></button><div><h2>${esc(v.name)}</h2><div class="small">${esc([v.plate, v.carburante, v.km ? nf(v.km) + " km" : ""].filter(Boolean).join(" · "))}</div>
      <div style="margin-top:8px"><span class="pill acc">${eur(vSpent(v.id, y))} nel ${y}</span></div></div></div>
    ${seg}${body}` };
};
function statTerza(v) {
  const c = consumo(v);
  if (c === "n.d." && v.carburante === "Elettrico") { const r = GI(v.id, "fuel"), kw = r.reduce((s, x) => s + (x.energia || 0), 0); if (kw) return `<span>Medio<b class="num">${eur3(sum(r, x => x.total) / kw)}/kWh</b></span>`; }
  return `<span>Consumo<b class="num">${esc(c)}</b></span>`;
}
function autoSheet(d) {
  const v = VH(d.vid);
  openSheet(`<h2>${esc(d.cat)} · ${esc(v ? v.name : "")}</h2><div class="small">Scadenza del ${dmy(d.date)}, presa dall'ultima spesa registrata.</div>
    <div class="stack">
      <button class="btn primary" data-renew="${esc(d.vid)}/${esc(d.cat)}">Rinnova: registra la nuova spesa</button>
      <button class="btn" data-autook="${esc(d.vid)}|${esc(d.cat)}|${esc(d.date)}">Fatta, oppure non serve più</button>
      <button class="btn" data-gedit="${esc(d.src)}">Apri la spesa</button>
      <button class="btn" data-close>Chiudi</button></div>`);
}
function grow(i, sub, amount) {
  return `<div class="item" role="button" tabindex="0" data-gedit="${esc(i.id)}">${calBox(i.date)}<div><div class="t1">${esc(i.cat || (i.kind === "fuel" ? (i.fuel === "Elettrico" ? "Ricarica" : "Rifornimento") : ""))}</div><div class="t2">${esc(sub)}</div></div><div class="right"><span class="amt num">${eur(amount)}</span></div></div>`;
}
function costChart(rows, f) {
  // spending per month, last 12 months
  const now = new Date(); const months = [];
  for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`); }
  const vals = months.map(m => rows.filter(x => (x.date || "").startsWith(m)).reduce((s, x) => s + (f(x) || 0), 0));
  if (!vals.some(Boolean)) return "";
  const max = Math.max(...vals) * 1.15, W = 340, Hh = 120, bw = W / 12;
  return `<div class="chart"><svg viewBox="0 0 ${W} ${Hh + 22}">
    <line x1="0" x2="${W}" y1="${Hh - Hh / 1.15}" y2="${Hh - Hh / 1.15}" stroke="var(--line)" stroke-dasharray="3 3"/><text x="2" y="${Hh - Hh / 1.15 - 3}">${Math.round(max / 1.15)} €</text>
    ${vals.map((v, i) => { const h = v / max * Hh; return `<rect x="${i * bw + bw * 0.18}" y="${Hh - h}" width="${bw * 0.64}" height="${h}" rx="3" fill="${i === 11 ? "var(--accent)" : "color-mix(in srgb, var(--accent) 45%, transparent)"}"><title>${months[i]}: ${eur(v)}</title></rect>`; }).join("")}
    ${months.map((m, i) => (i % 3 === 0 || i === 11) ? `<text x="${i === 0 ? 2 : i === 11 ? W - 2 : i * bw + bw / 2}" y="${Hh + 15}" text-anchor="${i === 0 ? "start" : i === 11 ? "end" : "middle"}">${MESI[+m.slice(5) - 1]} ${m.slice(2, 4)}</text>` : "").join("")}
  </svg><div class="small" style="padding:0 6px 6px">Spesa per mese, ultimi 12 mesi</div></div>`;
}

// ---------------------------------------------------------------- garage forms
// field: [key, label, type, options, showIfCats]; types: x text, n number, date, s select, t textarea, b checkbox, c componenti, d durata, q litri calcolati
const EF = cats => [["cat", "Categoria", "s", cats], ["date", "Data", "date"], ["cost", "Importo €", "n"], ["scadenza", "Scadenza", "date", 0, ["Bollo", "Revisione"]],
  ["km", "Chilometri", "n", 0, cats === CS ? ["Revisione", "Lavaggio", "Altro"] : 0], ["stagione", "Gomme montate", "s", ["", "Estive", "Invernali"], ["Gomme"]], ["condizione", "Condizione", "s", ["", "Nuove", "Usate"], ["Gomme"]],
  ["fornitore", "Fornitore", "xf", 0, SUP], ["componenti", "Componenti", "c", 0, ["Tagliando", "Manutenzione"]], ["compagnia", "Compagnia", "xf", 0, ["Assicurazione"]],
  ["da", "Inizio copertura", "date", 0, ["Assicurazione"]], ["a", "Fine copertura", "date", 0, ["Assicurazione"]], ["np", "Numero polizza", "x", 0, ["Assicurazione"]], ["note", "Descrizione", "t"]];
const GK = {
  fuelE: { s: "Ricarica", f: [["date", "Data", "date"], ["km", "Chilometri", "n"], ["corrente", "Corrente", "s", ["", "AC", "DC"]], ["potenza", "Potenza (kW)", "n"], ["tempo", "Durata", "d"], ["energia", "Energia (kWh)", "n"], ["fornitore", "Fornitore", "x"], ["total", "Importo €", "n"], ["note", "Note", "t"]] },
  fuel: { s: "Rifornimento", f: [["date", "Data", "date"], ["km", "Chilometri", "n"], ["total", "Importo €", "n"], ["prezzo", "Prezzo al litro €", "n"], ["liters", "Litri (calcolati)", "q"], ["pieno", "Pieno", "b"], ["note", "Note", "t"]] },
  deadline: { s: "Scadenza", f: [["cat", "Tipo", "s", CD], ["date", "Scadenza", "date"], ["cost", "Importo €", "n"], ["note", "Note", "t"]] },
  interv: { s: "Intervento", f: EF(CI) }, spese: { s: "Spesa", f: EF(CS) },
  note: { s: "Nota", f: [["date", "Data", "date"], ["text", "Testo", "t"]] }
};
const VF = [["name", "Nome", "x"], ["type", "Tipo", "s", ["Auto", "Moto"]], ["plate", "Targa", "x"], ["intestatario", "Intestatario", "x"], ["marca", "Marca", "x"], ["modello", "Modello", "x"],
  ["vista", "Nella scheda mostra", "s", ["Foto", "Disegno"]], ["forma", "Forma del disegno", "s", FORME], ["col1", "Colore principale", "col"], ["col2", "Colore secondario (tetto o telaio)", "col"],
  ["immatricolazione", "Immatricolazione", "date"], ["acquisto", "Acquisto", "date"], ["carburante", "Carburante", "s", ["Benzina", "Diesel", "Elettrico"]], ["km", "Km attuali", "n"], ["telaio", "Numero di telaio", "x"],
  ["antStd", "Gomme anteriori (standard)", "x"], ["antAlt", "Gomme anteriori (alternativa)", "x"], ["postStd", "Gomme posteriori (standard)", "x"], ["postAlt", "Gomme posteriori (alternativa)", "x"],
  ["asi", "Iscritto ASI", "b"], ["crs", "CRS n°", "x"], ["asiData", "Data iscrizione ASI", "date"], ["storico", "Non più in uso (storico)", "b"], ["dismissione", "Data di dismissione", "date"]];
const PF = [["titolare", "Titolare", "xf"], ["numero", "Numero patente", "x"], ["catA", "Categoria A (moto)", "b"], ["catB", "Categoria B (auto)", "b"],
  ["altre", "Altre categorie (es. AM, A2, BE, C)", "xf"], ["rilascio", "Rilasciata il", "date"], ["scadenza", "Scadenza", "date"], ["punti", "Punti", "n"], ["note", "Note", "t"]];

function gForm(title, F, v, ok, del) {
  const cr = c => `<div class="cr"><input placeholder="Componente" value="${esc(c.n || "")}"><input inputmode="decimal" placeholder="Qtà" value="${inNum(c.q)}"><input inputmode="decimal" placeholder="€" value="${inNum(c.c)}"><button type="button" class="btn" data-rmc>×</button></div>`;
  const fld = ([k, l, t, o, w]) => {
    const x = v[k] ?? ""; const wa = w ? ` data-w="${w.join("|")}"` : "";
    if (t === "b") return `<label class="full check"${wa}><input type="checkbox" name="${k}"${x ? " checked" : ""}> ${l}</label>`;
    if (t === "t") return `<label class="full"${wa}>${l}<textarea name="${k}">${esc(x)}</textarea></label>`;
    if (t === "s") return `<label${wa}>${l}<select name="${k}">${o.map(c => `<option${c === x ? " selected" : ""} value="${esc(c)}">${esc(c || "–")}</option>`).join("")}</select></label>`;
    if (t === "col") return `<label${wa}>${l}<input type="color" name="${k}" value="${esc(x || "#8a96a3")}" style="height:44px;padding:4px"></label>`;
    if (t === "d") return `<label class="full"${wa}>${l}<span style="display:flex;gap:8px"><input inputmode="numeric" data-h placeholder="ore" value="${x === "" ? "" : Math.floor(x / 60)}"><input inputmode="numeric" data-m placeholder="minuti" value="${x === "" ? "" : x % 60}"></span></label>`;
    if (t === "c") return `<div class="full" data-c${wa}><div class="small" style="font-weight:600;margin-bottom:6px">${l}</div><div class="cl">${(x && x.length ? x : [{}]).map(cr).join("")}</div><button type="button" class="btn" data-addc>${IC.plus} Componente</button></div>`;
    if (t === "xf") return `<label class="full"${wa}>${l}<input name="${k}" type="text" value="${esc(x)}"></label>`;
    return `<label${wa}>${l}<input name="${k}" ${t === "date" ? 'type="date"' : t === "n" || t === "q" ? 'inputmode="decimal"' : 'type="text"'}${t === "q" ? " readonly" : ""} value="${esc(t === "n" || t === "q" ? inNum(x === "" ? null : x) : x)}"></label>`;
  };
  openSheet(`<h2>${esc(title)}</h2><form class="form" id="gf">${F.map(fld).join("")}
    <div class="actions full">${del ? '<button type="button" class="btn danger" id="gdel">Elimina</button>' : ""}<button type="button" class="btn" data-close>Annulla</button><button class="btn primary">Salva</button></div></form>`);
  const f = $("#gf");
  const up = () => { const c = f.elements.cat; f.querySelectorAll("[data-w]").forEach(l => { l.hidden = !!c && !l.dataset.w.split("|").includes(c.value); }); };
  f.addEventListener("change", up); up();
  f.addEventListener("click", e => { if (e.target.closest("[data-addc]")) f.querySelector(".cl").insertAdjacentHTML("beforeend", cr({})); const rm = e.target.closest("[data-rmc]"); if (rm) rm.closest(".cr").remove(); });
  const T = f.elements.total, P = f.elements.prezzo, Lt = f.elements.liters;
  if (T && P && Lt) { const cl = () => { const t = parseNum(T.value), p = parseNum(P.value); if (t > 0 && p > 0) Lt.value = inNum(r2(t / p)); }; T.addEventListener("input", cl); P.addEventListener("input", cl); }
  f.onsubmit = e => {
    e.preventDefault(); const o = {}; let bad = false;
    F.forEach(([k, , t]) => {
      const box = f.querySelector(`[name="${k}"]`) || (t === "c" ? f.querySelector("[data-c]") : null) || (t === "d" ? f.querySelector("[data-h]") : null);
      const hid = box && box.closest("[hidden]");
      if (t === "c") { o[k] = hid ? [] : [...f.querySelectorAll(".cr")].map(r => { const [a, b, c] = r.querySelectorAll("input"); return { n: a.value.trim(), q: parseNum(b.value), c: parseNum(c.value) }; }).filter(x => x.n || x.c != null); return; }
      if (t === "d") { const h = f.querySelector("[data-h]").value, m = f.querySelector("[data-m]").value; o[k] = h === "" && m === "" ? null : (+h || 0) * 60 + (+m || 0); return; }
      if (t === "b") { o[k] = f.elements[k].checked; return; }
      const val2 = hid ? "" : f.elements[k].value.trim();
      if (t === "n" || t === "q") { const n = parseNum(val2); if (n !== null && isNaN(n)) bad = true; o[k] = n; } else o[k] = val2;
    });
    if (bad) return toast("Controlla i numeri: usa la virgola per i decimali");
    closeSheet(); ok(o);
  };
  const d = $("#gdel"); if (d) d.onclick = () => { if (d.dataset.armed) { closeSheet(); del(); } else { d.dataset.armed = 1; d.textContent = "Tocca ancora per eliminare"; } };
}
function gItemForm(vid, kind, item, pre) {
  const v = VH(vid); const isNew = !item;
  const key = kind === "fuel" && v && v.carburante === "Elettrico" ? "fuelE" : kind === "expense" ? (CI.includes(item.cat) ? "interv" : "spese") : kind;
  const def = GK[key];
  const base = item || { id: gid7(), vid, kind: kind === "interv" || kind === "spese" ? "expense" : kind, date: todayISO(), ...(kind === "fuel" ? (v && v.carburante === "Elettrico" ? { fuel: "Elettrico" } : { pieno: true, fuel: v && v.carburante }) : {}), ...(kind === "deadline" ? { done: false } : {}), ...(pre || {}) };
  if (base.kind === "fuel" && base.prezzo == null && base.liters > 0 && base.total > 0) base.prezzo = Math.round(base.total / base.liters * 1000) / 1000;
  gForm((isNew ? (def.s === "Ricarica" || def.s === "Spesa" || def.s === "Scadenza" || def.s === "Nota" ? "Nuova " : "Nuovo ") + def.s.toLowerCase() : def.s) + (v ? " · " + v.name : ""), def.f, base,
    o => { const it = Object.assign({}, base, o); if (key === "fuel" && it.total > 0 && it.prezzo > 0) it.liters = r2(it.total / it.prezzo);
      Object.keys(it).forEach(k => { if (it[k] === "" || it[k] === null) delete it[k]; });
      commit({ op: "gitem", item: it }, isNew ? "Aggiunto" : "Salvato");
      if (v && it.km > (v.km || 0)) commit({ op: "gveh", item: Object.assign({}, v, { km: it.km }) });
      if (isNew && it.kind === "expense") confetti(); },
    isNew ? null : () => commit({ op: "gdelitem", id: base.id }, "Eliminato"));
}
function gVehForm(id) {
  const v = id ? VH(id) : { id: gid7(), type: "Auto", forma: "Crossover", col1: "#8a96a3", col2: "#16181b", carburante: "Benzina" };
  gForm(id ? "Modifica veicolo" : "Nuovo veicolo", VF, v, o => {
    const it = Object.assign({}, v, o); it.plate = (it.plate || "").toUpperCase(); if (!it.colore) it.colore = it.col1;
    if (!it.name) return toast("Scrivi il nome del veicolo");
    commit({ op: "gveh", item: it }, id ? "Salvato" : "Veicolo aggiunto"); if (!id) location.hash = "#veicolo/" + encodeURIComponent(it.id);
  }, id ? () => { commit({ op: "gdelveh", id }, "Veicolo eliminato"); location.hash = "#veicoli"; } : null);
}
function kmForm(vid) {
  const now = todayISO(); const anno = +now.slice(0, 4), mese = +now.slice(5, 7) - 1;
  const row = GD().kmMensili.find(r => r.vid === vid && r.anno === anno) || { vid, anno, mesi: Array(12).fill(null) };
  openSheet(`<h2>Lettura dei km</h2><form class="form" id="kf"><label>Mese<select id="k-m">${MESI_L.map((m, i) => `<option value="${i}"${i === mese ? " selected" : ""}>${m}</option>`).join("")}</select></label>
    <label>Anno<input id="k-y" inputmode="numeric" value="${anno}"></label><label class="full">Km sul contachilometri<input id="k-v" inputmode="numeric" value="${row.mesi[mese] ?? ""}"></label>
    <div class="actions full"><button type="button" class="btn" data-close>Annulla</button><button class="btn primary">Salva</button></div></form>`);
  $("#kf").onsubmit = e => { e.preventDefault(); const y = +val("k-y"), m = +val("k-m"), km = parseNum(val("k-v").replace(/\./g, "")); if (!y || km == null || isNaN(km)) return toast("Scrivi i km");
    const r = GD().kmMensili.find(x => x.vid === vid && x.anno === y) || { vid, anno: y, mesi: Array(12).fill(null) }; const nr = Object.assign({}, r, { mesi: r.mesi.slice() }); nr.mesi[m] = km;
    closeSheet(); commit({ op: "gkm", row: nr }, "Lettura salvata"); const v = VH(vid); if (v && km > (v.km || 0)) commit({ op: "gveh", item: Object.assign({}, v, { km }) }); };
}
function patForm(id) {
  const cur = id ? PATENTI().find(x => x.id === id) : null;
  const base = Object.assign({ id: gid7(), categorie: [] }, cur || {});
  const v = Object.assign({}, base, { catA: (base.categorie || []).includes("A"), catB: (base.categorie || []).includes("B") });
  gForm(cur ? "Patente" + (cur.titolare ? " · " + cur.titolare : "") : "Nuova patente", PF, v, o => {
    const it = Object.assign({}, base, o, { categorie: [o.catA && "A", o.catB && "B"].filter(Boolean) }); delete it.catA; delete it.catB;
    Object.keys(it).forEach(k => { if (it[k] === "" || it[k] === null) delete it[k]; });
    commit({ op: "gpatente", item: it }, "Patente salvata");
  }, cur ? () => commit({ op: "gdelpatente", id: cur.id }, "Patente eliminata") : null);
}
const addYear = iso => { const d = new Date(iso + "T12:00:00"); d.setFullYear(d.getFullYear() + 1); return d.toISOString().slice(0, 10); };
function garageClick(t, e) {
  const st = x => { e.stopPropagation(); return x; };
  const cur = () => decodeURIComponent((location.hash.split("/")[1] || ""));
  const ga = t.closest("[data-gadd]"); if (ga) return st(gItemForm(cur(), ga.dataset.gadd)) || null;
  const dd = t.closest("[data-dldone]"); if (dd) { st();
    const it = GD().items.find(i => i.id === dd.dataset.dldone); if (!it) return null;
    commit({ op: "gitem", item: Object.assign({}, it, { done: true }) }, "Fatta"); confetti();
    gItemForm(it.vid, "deadline", null, { cat: it.cat, date: addYear(it.date), cost: it.cost }); return null; }
  const rn = t.closest("[data-renew]"); if (rn) { st(); closeSheet(); const [vid, cat] = rn.dataset.renew.split("/");
    const last = GI(vid, "expense").filter(i => i.cat === cat).sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0] || {};
    const pre = { cat, cost: last.cost, fornitore: last.fornitore, compagnia: last.compagnia, np: last.np };
    if (cat === "Assicurazione" && last.a) Object.assign(pre, { da: last.a, a: addYear(last.a) }); else if (last.scadenza) pre.scadenza = addYear(last.scadenza);
    Object.keys(pre).forEach(k => pre[k] == null && delete pre[k]); gItemForm(vid, "spese", null, pre); return null; }
  const ao = t.closest("[data-autook]"); if (ao) { const [vid, cat, date] = ao.dataset.autook.split("|"); closeSheet(); commit({ op: "gitem", item: { id: gid7(), vid, kind: "deadline", cat, date, done: true, note: "segnata come fatta" } }, "Fatta"); return null; }
  const pt = t.closest("[data-pat]"); if (pt) return st(patForm(pt.dataset.pat)) || null;
  const dl = t.closest("[data-dl]"); if (dl) { const id = dl.dataset.dl;
    if (id.startsWith("pat-")) return patForm(id.slice(4)) || null;
    if (id.startsWith("auto-")) { const ad = autoDeadlines().find(x => x.id === id); if (ad) autoSheet(ad); return null; }
    const src = id; const it = GD().items.find(i => i.id === src); if (it) gItemForm(it.vid, it.kind, it); return null; }
  const ge = t.closest("[data-gedit]"); if (ge) { const it = GD().items.find(i => i.id === ge.dataset.gedit); if (it) gItemForm(it.vid, it.kind, it); return null; }
  if (t.closest("[data-addveh]")) return gVehForm() || null;
  const fo = t.closest("[data-foto]"); if (fo) return fotoSheet(fo.dataset.foto) || null;
  if (t.closest("[data-fotopick]")) { $("#vfoto").click(); return null; }
  const vi = t.closest("[data-vista]"); if (vi) { const [id, vs] = vi.dataset.vista.split("|"); closeSheet(); commit({ op: "gveh", item: Object.assign({}, VH(id), { vista: vs }) }, vs === "Foto" ? "Mostro la foto" : "Mostro il disegno"); return null; }
  const fd = t.closest("[data-fotodel]"); if (fd) { if (fd.dataset.armed) { const o = Object.assign({}, VH(fd.dataset.fotodel)); ["foto", "fotoTipo", "fotoDir"].forEach(k => delete o[k]); o.vista = "Disegno"; closeSheet(); commit({ op: "gveh", item: o }, "Foto tolta"); } else { fd.dataset.armed = 1; fd.textContent = "Tocca ancora per togliere la foto"; } return null; }
  if (t.closest("[data-gimpfoto]")) { closeSheet(); doImportGarage(S.gimp, true); return null; }
  if (t.closest("[data-gimpall]")) { closeSheet(); doImportGarage(S.gimp, false); return null; }
  const ev = t.closest("[data-editveh]"); if (ev) return gVehForm(ev.dataset.editveh) || null;
  if (t.closest("[data-kmadd]")) return kmForm(cur()) || null;
  return undefined;
}
async function importGarage(file) {
  let p; try { p = JSON.parse(await file.text()); } catch (e) { return toast("File non valido"); }
  if (!Array.isArray(p.vehicles) || !Array.isArray(p.items)) return toast("Non è un file di Il mio garage");
  S.gimp = p;
  if (!GD().vehicles.length) return doImportGarage(p, false);
  openSheet(`<h2>Il garage c'è già</h2><div class="small">Nell'app ci sono già ${GD().vehicles.length} veicoli e ${GD().items.length} voci. Cosa prendo da questo file?</div>
    <div class="stack">
      <button class="btn primary" data-gimpfoto>Solo le foto dei veicoli</button>
      <button class="btn danger" data-gimpall>Tutto: sostituisce veicoli, spese e scadenze</button>
      <button class="btn" data-close>Annulla</button></div>`);
}
async function doImportGarage(p, onlyPhotos) {
  if (!p) return;
  toast("Preparo le foto…");
  const fotos = {};
  for (const v of p.vehicles) if (v.foto) { try { fotos[v.id] = await shrinkImg(v.foto, v.fotoTipo === "scontornata"); } catch (e) { fotos[v.id] = v.foto; } }
  const pick = v => ({ foto: fotos[v.id], fotoTipo: v.fotoTipo || "intera", vista: v.vista === "Modellino 3D" ? "Disegno" : "Foto" });
  if (onlyPhotos) {
    let n = 0;
    GD().vehicles.forEach(cur => { const src = p.vehicles.find(x => x.id === cur.id); if (src && fotos[src.id]) { commit({ op: "gveh", item: Object.assign({}, cur, pick(src)) }); n++; } });
    return toast(n ? `Foto aggiunte a ${n} veicol${n === 1 ? "o" : "i"}` : "Nessuna foto da aggiungere");
  }
  const drop = ["foto", "fotoSfondo", "fotoTipo", "fotoDir", "vista", "_m"];
  const vehicles = p.vehicles.map(v => { const o = Object.assign({}, v); drop.forEach(k => delete o[k]); return fotos[v.id] ? Object.assign(o, pick(v)) : o; });
  const items = p.items.map(i => { const o = Object.assign({}, i); delete o._m; return o; });
  const garage = { vehicles, items, kmMensili: ((p.extra || {}).kmMensili) || [], patenti: p.patenti || (p.patente ? [Object.assign({ id: gid7() }, p.patente)] : PATENTI()) };
  commit({ op: "gimport", garage }, `Importati ${vehicles.length} veicoli e ${items.length} voci`);
}

// 1.4 added some vehicle details once (flag "mig14"); that data lives only in dati.json.
// in-app guide: GUIDA.md is shipped with the app and rendered with a tiny markdown subset
function mdLite(md) {
  const inl = t => esc(t).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const out = []; let list = null, code = null, sub = false;
  const closeSub = () => { if (sub) { out.push("</ul>"); sub = false; } };
  const close = () => { closeSub(); if (list) { out.push(`</${list}>`); list = null; } };
  md.split("\n").forEach(l => {
    if (code !== null) { if (/^```/.test(l)) { out.push(`<pre class="changelog">${esc(code.join("\n"))}</pre>`); code = null; } else code.push(l); return; }
    if (/^```/.test(l)) { close(); code = []; return; }
    let m;
    if ((m = /^(#{1,4})\s+(.*)/.exec(l))) { close(); const n = Math.min(4, m[1].length + 1); out.push(`<h${n}>${inl(m[2])}</h${n}>`); return; }
    if (list && (m = /^\s{2,}[-*]\s+(.*)/.exec(l))) { if (!sub) { out.push("<ul>"); sub = true; } out.push(`<li>${inl(m[1])}</li>`); return; }
    closeSub();
    if ((m = /^\s*[-*]\s+(.*)/.exec(l))) { if (list !== "ul") { close(); out.push("<ul>"); list = "ul"; } out.push(`<li>${inl(m[1])}</li>`); return; }
    if ((m = /^\s*\d+[.)]\s+(.*)/.exec(l))) { if (list !== "ol") { close(); out.push("<ol>"); list = "ol"; } out.push(`<li>${inl(m[1])}`); return; }
    if (/^\s*\|/.test(l)) { close(); if (!/^\s*\|[\s:|-]+\|\s*$/.test(l)) out.push(`<div class="mdrow">${l.split("|").slice(1, -1).map(c => `<span>${inl(c.trim())}</span>`).join("")}</div>`); return; }
    if (!l.trim()) { close(); return; }
    close(); out.push(`<p>${inl(l)}</p>`);
  });
  close(); return out.join("");
}
async function showGuide() {
  let txt = "";
  try { const r = await fetch("guida.txt", { cache: "no-cache" }); if (!r.ok) throw 0; txt = await r.text(); } catch (e) { return toast("Non riesco a leggere la guida"); }
  openSheet(`<div class="guide">${mdLite(txt)}</div><div class="actions"><button class="btn" data-close>Chiudi</button></div>`);
}
async function showVersions() {
  let txt = "";
  try { const r = await fetch("Versioni.txt", { cache: "no-cache" }); if (!r.ok) throw 0; txt = await r.text(); } catch (e) { return toast("Non riesco a leggere lo storico delle versioni"); }
  openSheet(`<h2>Novità e versioni</h2><div class="small">Versione installata: ${VERSION}</div><pre class="changelog">${esc(txt.replace(/^.*\n+/, ""))}</pre><div class="actions"><button class="btn" data-close>Chiudi</button></div>`);
}
function configForm() {
  const c = JSON.parse(JSON.stringify(CFG())); const im = c.immobili || {};
  const row = (k, lab) => { const x = im[k] || {}; return `<div class="full sec-h" style="margin:4px 0 0"><h2 style="font-size:16px">${lab}</h2></div>
    <label>Nome breve<input id="c-${k}-nome" value="${esc(x.nome || IMM_DEF[k])}"></label><label>Indirizzo<input id="c-${k}-ind" value="${esc(x.indirizzo || "")}"></label>
    <label class="full">Dettagli (unità, piano, millesimi…)<input id="c-${k}-det" value="${esc(x.dettagli || "")}"></label>`; };
  openSheet(`<h2>Immobili e detrazioni</h2><div class="small">Questi dati stanno solo nel file su Google Drive, non nel codice dell'app.</div><form class="form" id="cf">
    ${row("casa1", "Casa")}
    <label class="full check"><input type="checkbox" id="c-hasbox"${c.box !== false ? " checked" : ""}> Ho anche un box o un posto auto</label>
    <div id="c-boxrow" class="full form" style="padding:0;${c.box === false ? "display:none" : ""}">${row("box1", "Box")}</div>
    <label class="full check"><input type="checkbox" id="c-hasveh"${c.veicoli !== false ? " checked" : ""}> Mostra la sezione Veicoli (auto, moto, patenti)</label>
    <div class="full sec-h" style="margin:4px 0 0"><h2 style="font-size:16px">Detrazioni</h2></div>
    <label class="full">Titolo della sezione<input id="c-dtit" value="${esc(c.detrazioniTitolo || "Detrazioni")}"></label>
    <label class="full">Tipi di detrazione, uno per riga: nome e percentuale separati da "|"<textarea id="c-det" rows="5">${esc((c.detrazioni || []).map(d => d.label + (d.pct ? " | " + String(d.pct).replace(".", ",") : "")).join("\n"))}</textarea></label>
    <div class="actions full"><button type="button" class="btn" data-close>Annulla</button><button class="btn primary">Salva</button></div></form>`);
  $("#c-hasbox").onchange = ev => { $("#c-boxrow").style.display = ev.target.checked ? "" : "none"; };
  $("#cf").onsubmit = e => {
    e.preventDefault();
    const imm = {}; ["casa1", "box1"].forEach(k => { imm[k] = { nome: val(`c-${k}-nome`) || IMM_DEF[k], indirizzo: val(`c-${k}-ind`), dettagli: val(`c-${k}-det`) }; });
    const det = val("c-det").split("\n").map(l => l.trim()).filter(Boolean).map(l => { const [a, b] = l.split("|").map(x => x.trim()); const n = parseFloat((b || "").replace(",", ".")); return { label: a, pct: isNaN(n) ? 0 : n }; });
    closeSheet(); commit({ op: "config", config: Object.assign({}, c, { immobili: imm, detrazioni: det, detrazioniTitolo: val("c-dtit") || "Detrazioni", box: $("#c-hasbox").checked, veicoli: $("#c-hasveh").checked }) }, "Salvato su Drive");
  };
}
function installBox() {
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if (standalone) return "";
  const ios = /iPhone|iPad|Macintosh/.test(navigator.userAgent) && !/Chrome|CriOS|Android/.test(navigator.userAgent);
  if (S.installEvt) return `<div class="sec-h"><h2>Installa</h2></div><button class="btn primary block" data-act="install">Installa l'app su questo dispositivo</button>`;
  if (ios) return "";
  return `<div class="sec-h"><h2>Installa</h2></div><div class="small">Chrome non ha ancora proposto l'installazione su questo dispositivo. Se il tasto "Installa" non compare qui dopo qualche secondo, dal menu ⋮ usa "Aggiungi a schermata Home".</div>`;
}
function vehTile() {
  if (!hasVeh()) return "";
  const g = GD(), act = g.vehicles.filter(v => !v.storico), dl = openVehDl(), l = dl.filter(d => dlState(d).late).length, so = dl.filter(d => dlState(d).soon).length;
  const y = todayISO().slice(0, 4);
  return `<a class="tile t-car wide" href="#veicoli">${l ? `<span class="pill crit badge">${l} scadut${l === 1 ? "a" : "e"}</span>` : so ? `<span class="pill warn badge">${so} in arrivo</span>` : ""}
    <div class="ill">${act.length ? act.slice(0, 3).map(vehImg).join("") : vehArt({ forma: "Crossover", col1: "#9aa8b6", col2: "#3b4652" })}</div>
    <div><h3>Veicoli</h3><div class="sub">${act.length ? `${act.length} in uso · ${eur(act.reduce((s, v) => s + vSpent(v.id, y), 0))} spesi nel ${y}` : "auto e moto: scadenze, ricariche, spese"}</div></div></a>`;
}

// ---------------------------------------------------------------- confetti
function confetti() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const c = document.createElement("canvas"); c.className = "confetti"; document.body.appendChild(c);
  const ctx = c.getContext("2d"); const W = c.width = innerWidth * devicePixelRatio, Hh = c.height = innerHeight * devicePixelRatio;
  const cols = ["#2a6fdb", "#f5b82e", "#2fbf71", "#e5483d", "#7b5cd6"];
  const ps = Array.from({ length: 90 }, () => ({ x: W / 2, y: Hh * 0.55, vx: (Math.random() - 0.5) * 18 * devicePixelRatio, vy: (-Math.random() * 16 - 6) * devicePixelRatio, s: (4 + Math.random() * 5) * devicePixelRatio, c: cols[Math.floor(Math.random() * cols.length)], r: Math.random() * 6 }));
  let t = 0; (function step() { ctx.clearRect(0, 0, W, Hh); ps.forEach(p => { p.x += p.vx; p.y += p.vy; p.vy += 0.6 * devicePixelRatio; p.r += 0.2; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore(); });
    if (++t < 90) requestAnimationFrame(step); else c.remove(); })();
}

// ---------------------------------------------------------------- events
document.addEventListener("click", async e => {
  const t = e.target;
  const pay = t.closest("[data-pay]"); if (pay) { e.stopPropagation(); return payForm(pay.dataset.pay); }
  const ed = t.closest("[data-edit]"); if (ed) return movForm(ed.dataset.edit);
  const go = t.closest("[data-go]"); if (go) { location.hash = go.dataset.go; return; }
  if (t.closest("[data-close]") || t.id === "scrim") return closeSheet();
  if (t.closest("#back")) { location.hash = "#" + ($("#back").dataset.to || "home"); return; }
  const ag = t.closest("[data-addrata]"); if (ag) { const g = G().find(x => x.id === ag.dataset.addrata); return movForm(null, { casa: g.casa, tipo: g.tipo === "straordinaria" ? "straordinaria" : "condominio", gestione: g.id, voce: "Rata " }); }
  const eg = t.closest("[data-editgest]"); if (eg) return gestForm(eg.dataset.editgest);
  const ng = t.closest("[data-newgest]"); if (ng) return gestDefForm(ng.dataset.newgest);
  const dg = t.closest("[data-defgest]"); if (dg) { const g = G().find(x => x.id === dg.dataset.defgest); return g && gestDefForm(g.casa, g); }
  const xg = t.closest("[data-xlsgest]"); if (xg) { const g = G().find(x => x.id === xg.dataset.xlsgest); toast("Preparo l'Excel…"); return downloadBlob(await buildWorkbook(g), `${caseNome(g.casa)} ${g.nome}.xlsx`); }
  const nb = t.closest("[data-newbill]"); if (nb) { const [tp, cs] = nb.dataset.newbill.split("/"); return newBill(tp, cs); }
  const nm = t.closest("[data-newmov]"); if (nm) { const [cs, tp] = nm.dataset.newmov.split("/"); return movForm(null, { casa: cs || "casa1", tipo: tp || "casa", categoria: tp === "tari" ? todayISO().slice(0, 4) : undefined }); }
  if (t.closest("[data-newprom]")) return promForm();
  const vg = garageClick(t, e); if (vg !== undefined) return vg;
  const tp = t.closest("[data-tipo]"); if (tp) { Q.tipo = tp.dataset.tipo; return render(); }
  const act = t.closest("[data-act]");
  if (act) {
    const a = act.dataset.act;
    if (a === "sheet") { toast("Aggiorno il foglio…"); return updateSheet(true); }
    if (a === "xlsall") { toast("Preparo l'Excel…"); return downloadBlob(await buildWorkbook(), "Spese_Casa.xlsx"); }
    if (a === "backup") return downloadBlob(new Blob([JSON.stringify(S.data, null, 1)], { type: "application/json" }), "dati.json");
    if (a === "setup") return showSetup();
    if (a === "logout") { drop(LS.cfg); drop(LS.cache); location.reload(); return; }
    if (a === "import") return $("#importfile").click();
    if (a === "listbk") return listBackups();
    if (a === "versioni") return showVersions();
    if (a === "guida") return showGuide();
    if (a === "zero") return startFromZero();
    if (a === "config") return configForm();
    if (a === "install" && S.installEvt) { const ev = S.installEvt; S.installEvt = null; ev.prompt(); ev.userChoice.then(c => { if (c.outcome !== "accepted") toast("Installazione annullata"); render(); }); return; }
    if (a === "gimport") return $("#gimport").click();
    if (a === "restorefile") return $("#restorefile").click();
    if (a === "restore") {
      if (act.dataset.armed !== "1") { act.dataset.armed = "1"; act.textContent = "Tocca ancora per ripristinare"; return; }
      return doRestore({ name: act.dataset.name }, act.dataset.name);
    }
  }
});
document.addEventListener("keydown", e => { if (e.key === "Escape") closeSheet(); if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-edit],[data-gedit],[data-dl]")) { e.preventDefault(); e.target.click(); } });
document.addEventListener("change", e => {
  const t = e.target;
  if (t.dataset.prom) { const p = S.data.promemoria.find(x => x.id === t.dataset.prom); if (p) commit({ op: "prom", item: Object.assign({}, p, { fatto: t.checked }) }, t.checked ? "Risolta" : "Riaperta"); }
  if (t.id === "vfoto" && t.files[0]) { const vid = t.dataset.vid, f = t.files[0]; closeSheet(); toast("Preparo la foto…");
    const alpha = /png|webp/.test(f.type);
    shrinkImg(f, alpha).then(u => commit({ op: "gveh", item: Object.assign({}, VH(vid), { foto: u, fotoTipo: alpha ? "scontornata" : "intera", vista: "Foto" }) }, "Foto salvata")).catch(e => toast(e.message)); }
  if (t.id === "gimport" && t.files[0]) { importGarage(t.files[0]); t.value = ""; }
  if (t.matches("select[id$='conto']")) { const n = $("#" + t.id + "-new"); if (n) n.hidden = t.value !== "__new"; }
});
let qT; document.addEventListener("input", e => { if (e.target.id === "q") { Q.q = e.target.value; clearTimeout(qT); qT = setTimeout(() => { const p = e.target.selectionStart; render(); const q = $("#q"); if (q) { q.focus(); q.setSelectionRange(p, p); } }, 250); } });
window.addEventListener("hashchange", () => { closeSheet(); render(); window.scrollTo(0, 0); });
window.addEventListener("online", () => flush());
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S.data && !TEST && !S.pending.length) refresh(); });

// ---------------------------------------------------------------- start
function screen(html) { $("#title").textContent = "Spese di casa"; $("#back").hidden = true; $("#app").innerHTML = `<div class="center"><div class="box">${html}</div></div>`; }
const logoSvg = () => `<svg class="logo" viewBox="0 0 120 120">${ART.logo.replace(/<\/?svg[^>]*>/g, "")}</svg>`;
function showSetup(msg) {
  screen(`${logoSvg()}<h2>Collega Google Drive</h2>
    ${msg ? `<div class="pill crit">${esc(msg)}</div>` : ""}
    <div class="muted">Incolla l'indirizzo dell'app web che ti ha dato Google Apps Script (finisce con <b>/exec</b>) e la chiave segreta che hai scritto nello script.</div>
    <form class="form" id="setup" style="width:100%">
      <label class="full">Indirizzo dello script<input id="s-url" value="${esc(S.cfg.url)}" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off" autocapitalize="off"></label>
      <label class="full">Chiave segreta<input id="s-key" type="password" value="${esc(S.cfg.key)}" autocomplete="off" autocapitalize="off"></label>
      <button class="btn primary full">Collega</button></form>
    <button class="btn" data-act="guida">Prima volta? Leggi la guida</button>`);
  $("#setup").onsubmit = e => { e.preventDefault(); const url = val("s-url"), key = val("s-key");
    if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(url)) return toast("L'indirizzo deve iniziare con https://script.google.com/macros/s/ e finire con /exec");
    if (key.length < 8) return toast("La chiave deve avere almeno 8 caratteri");
    S.cfg = { url, key }; save(LS.cfg, S.cfg); drop(LS.cache); S.data = null; start(); };
}
function emptyData() {
  return { versione: 1, aggiornato: new Date().toISOString(), movimenti: [], gestioni: [], promemoria: [], conti: [],
    config: { immobili: { casa1: { nome: "Casa", indirizzo: "", dettagli: "" }, box1: { nome: "Box", indirizzo: "", dettagli: "" } }, detrazioni: [], detrazioniTitolo: "Detrazioni", box: true, veicoli: true },
    garage: { vehicles: [], items: [], kmMensili: [], patenti: [], flags: { mig14: true } } };
}
async function startFromZero() {
  try { toast("Creo dati.json su Drive…"); const data = emptyData(); const j = await api("save", { baseRev: 0, data, create: true }); if (!j.ok) throw new Error("Creazione non riuscita");
    S.data = data; S.etag = j.rev; persistCache(); location.hash = "#impostazioni"; render(); updateSheet(false); toast("Pronto! Ora scrivi nomi e indirizzi"); setTimeout(configForm, 400);
  } catch (e) { toast(e.message); }
}
function showImport() {
  screen(`${ART.ask}<h2>Collegato! Ora i dati</h2><div class="muted">Nella cartella <b>Spese di casa</b> del tuo Google Drive non c'è ancora dati.json. Se inizi adesso, scegli <b>Inizia da zero</b>. Se hai già un file dati.json (per esempio un backup), caricalo.</div>
    <input type="file" id="importfile" accept=".json,application/json" hidden>
    <button class="btn primary" data-act="zero">Inizia da zero</button><button class="btn" data-act="import">Carica un dati.json</button><button class="btn" onclick="location.reload()">Riprova</button>`);
  $("#importfile").onchange = async ev => {
    const f = ev.target.files[0]; if (!f) return;
    try { const data = JSON.parse(await f.text()); if (!data.movimenti) throw new Error("File non valido");
      toast("Carico…"); const j = await api("save", { baseRev: 0, data, create: true }); if (!j.ok) throw new Error("Caricamento non riuscito");
      S.data = data; S.etag = j.rev; persistCache(); render(); updateSheet(false); toast("Dati caricati");
    } catch (e) { toast(e.message); }
  };
}
async function refresh() {
  try {
    const remote = await downloadData();
    if (remote.etag !== S.etag || !S.data) { S.data = remote.data; S.etag = remote.etag; S.pending.forEach(op => apply(S.data, op)); persistCache(); render(); }
    if (S.pending.length) flush(); else setSync("ok");
  } catch (e) {
    if (e.notFound) return showImport();
    if (e.setup) { if (!S.data) return showSetup(e.message); setSync("setup"); return; }
    setSync(navigator.onLine ? "err" : "offline");
    if (!S.data) screen(`<h2>Google Drive non risponde</h2><div class="muted">${esc(e.message)}</div><button class="btn primary" onclick="location.reload()">Riprova</button><button class="btn" data-act="setup">Controlla il collegamento</button>`);
  }
}
async function start() {
  if (TEST) { S.data = TEST.data; S.etag = 1; render(); setSync("ok"); return; }
  if (!S.cfg.url || !S.cfg.key) return showSetup();
  const cache = load(LS.cache);
  if (cache && cache.data && cache.url === S.cfg.url) { S.data = cache.data; S.etag = cache.etag; S.pending = cache.pending || []; S.sheetUrl = cache.sheetUrl || null; render(); }
  else screen(`${logoSvg()}<div class="muted">Carico i dati da Google Drive…</div>`);
  await refresh();
}
if ("serviceWorker" in navigator && !TEST) navigator.serviceWorker.register("sw.js").catch(() => {});
// Some hosts (Netlify's free plan) overlay a small badge in the bottom-right corner, in its own iframe.
// The app does not hide it: it measures it and lifts the tab bar above it, and drops the space when the badge goes away.
function fitBadge() {
  let h = 0;
  document.querySelectorAll("iframe").forEach(f => {
    if (f.closest("#app, #sheet")) return;
    const r = f.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && r.height < 160 && r.bottom > innerHeight - 140 && r.right > innerWidth - 40) h = Math.max(h, Math.ceil(innerHeight - r.top) + 4);
  });
  if (h !== S.badgeH) { S.badgeH = h; document.documentElement.style.setProperty("--badge-space", h + "px"); }
}
new MutationObserver(() => requestAnimationFrame(fitBadge)).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class", "hidden"] });
addEventListener("resize", fitBadge); setTimeout(fitBadge, 800); setTimeout(fitBadge, 3000);
// install button: Chrome fires beforeinstallprompt only when it considers the app installable
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); S.installEvt = e; if (route().name === "impostazioni") render(); });
window.addEventListener("appinstalled", () => { S.installEvt = null; toast("App installata"); if (route().name === "impostazioni") render(); });
start();
