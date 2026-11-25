/**
 * Spese di casa: ponte tra l'app e il tuo Google Drive. Versione dello script: 1.6.
 * Salva i dati in "Spese di casa/dati.json" e tiene aggiornato il foglio "Spese di casa (riepilogo)".
 *
 * 1. Scrivi qui sotto una chiave segreta a tua scelta (una frase lunga, senza spazi).
 *    La stessa chiave la inserirai nell'app.
 */
const CHIAVE = 'SCRIVI-QUI-LA-TUA-CHIAVE';

const CARTELLA = 'Spese di casa';
const FILE_DATI = 'dati.json';
const NOME_FOGLIO = 'Spese di casa (riepilogo)';

// ------------------------------------------------------------------ ingresso
function doGet() {
  return out_({ ok: true, messaggio: 'Il ponte Spese di casa è attivo.' });
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return out_({ error: 'Richiesta non valida' }); }
  if (CHIAVE === 'SCRIVI-QUI-LA-TUA-CHIAVE') return out_({ error: 'Nello script manca la chiave: cambiala nella prima riga e ripubblica' });
  if (!req.key || req.key !== CHIAVE) return out_({ error: 'chiave' });
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    if (req.action === 'load') return load_();
    if (req.action === 'save') return save_(req);
    if (req.action === 'sheet') return out_({ ok: true, sheetUrl: buildSheet_() });
    if (req.action === 'backups') return out_({ ok: true, backups: listBackups_() });
    if (req.action === 'restore') return restore_(req);
    return out_({ error: 'Azione sconosciuta' });
  } catch (err) {
    return out_({ error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// ------------------------------------------------------------------ dati
function folder_() {
  const root = DriveApp.getRootFolder();
  const it = root.getFoldersByName(CARTELLA);
  return it.hasNext() ? it.next() : root.createFolder(CARTELLA);
}
function dataFile_() {
  const it = folder_().getFilesByName(FILE_DATI);
  return it.hasNext() ? it.next() : null;
}
function props_() { return PropertiesService.getScriptProperties(); }
function rev_() { return Number(props_().getProperty('rev') || 1); }
function readData_(f) { return JSON.parse(f.getBlob().getDataAsString('UTF-8')); }

function load_() {
  const f = dataFile_();
  if (!f) return out_({ notFound: true });
  return out_({ data: readData_(f), rev: rev_(), sheetUrl: sheetUrl_() });
}

function save_(req) {
  if (!req.data || !Array.isArray(req.data.movimenti)) return out_({ error: 'Dati non validi' });
  let f = dataFile_();
  const cur = rev_();
  if (f && !req.create && Number(req.baseRev) !== cur) {
    return out_({ conflict: true, data: readData_(f), rev: cur });
  }
  const text = JSON.stringify(req.data, null, 1);
  if (f) backup_(f, false);
  if (f) f.setContent(text); else f = folder_().createFile(FILE_DATI, text, 'application/json');
  const nr = cur + 1;
  props_().setProperty('rev', String(nr));
  return out_({ ok: true, rev: nr });
}

// ------------------------------------------------------------------ backup automatici
// Prima della prima modifica di ogni settimana salva una copia in "Spese di casa/backup".
// Tiene le ultime 90 copie giornaliere.
const MAX_BACKUP = 52; // un anno di backup settimanali
function backupFolder_() {
  const it = folder_().getFoldersByName('backup');
  return it.hasNext() ? it.next() : folder_().createFolder('backup');
}
function backup_(f, force) {
  const bf = backupFolder_();
  // il nome usa il lunedì della settimana, così c'è un solo backup a settimana
  const now = new Date(), dow = (Number(Utilities.formatDate(now, 'Europe/Rome', 'u')) + 6) % 7;
  const monday = Utilities.formatDate(new Date(now.getTime() - dow * 86400000), 'Europe/Rome', 'yyyy-MM-dd');
  let name = 'dati-' + monday + '-settimana.json';
  if (force) name = 'dati-' + Utilities.formatDate(new Date(), 'Europe/Rome', 'yyyy-MM-dd_HH-mm-ss') + '-prima-del-ripristino.json';
  else if (bf.getFilesByName(name).hasNext()) return;
  bf.createFile(name, f.getBlob().getDataAsString('UTF-8'), 'application/json');
  const all = [];
  const it = bf.getFiles();
  while (it.hasNext()) all.push(it.next());
  all.sort(function (a, b) { return b.getName().localeCompare(a.getName()); });
  all.slice(MAX_BACKUP).forEach(function (x) { x.setTrashed(true); });
}
function listBackups_() {
  const out = [];
  const it = backupFolder_().getFiles();
  while (it.hasNext()) { const x = it.next(); out.push({ name: x.getName(), size: x.getSize() }); }
  return out.sort(function (a, b) { return b.name.localeCompare(a.name); });
}
function restore_(req) {
  let text;
  if (req.data) text = JSON.stringify(req.data, null, 1);
  else {
    const it = backupFolder_().getFilesByName(String(req.name || ''));
    if (!it.hasNext()) return out_({ error: 'Backup non trovato' });
    text = it.next().getBlob().getDataAsString('UTF-8');
  }
  const data = JSON.parse(text);
  if (!Array.isArray(data.movimenti)) return out_({ error: 'Il file non contiene dati validi' });
  let f = dataFile_();
  if (f) { backup_(f, true); f.setContent(text); } else f = folder_().createFile(FILE_DATI, text, 'application/json');
  const nr = rev_() + 1;
  props_().setProperty('rev', String(nr));
  return out_({ ok: true, rev: nr, data: data });
}

// ------------------------------------------------------------------ foglio Google di riepilogo
// nomi degli immobili: li prende dai dati (Impostazioni dell'app, "Immobili e detrazioni")
var CASE = { casa1: 'Casa', box1: 'Box', altre: 'Altre case' };
function setCase_(data) {
  const im = (data.config && data.config.immobili) || {};
  ['casa1', 'box1'].forEach(function (k) { const x = im[k] || {}; CASE[k] = x.indirizzo ? (k === 'box1' ? (x.nome || 'Box') + ' ' : '') + x.indirizzo : (x.nome || CASE[k]); });
}
const TIPI = { condominio: 'Condominio', straordinaria: 'Straordinaria', tari: 'TARI', imu: 'IMU', casa: 'Lavori e arredi', extra: 'Extra box', luce: 'Luce', gas: 'Gas', internet: 'Internet' };
const EUR = '#,##0.00 "€";-#,##0.00 "€";"-"';
const DATA = 'dd/mm/yyyy';

function sheetUrl_() {
  const id = props_().getProperty('sheetId');
  if (!id) return null;
  try { return SpreadsheetApp.openById(id).getUrl(); } catch (e) { return null; }
}
function spreadsheet_() {
  const id = props_().getProperty('sheetId');
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) {} }
  const ss = SpreadsheetApp.create(NOME_FOGLIO);
  DriveApp.getFileById(ss.getId()).moveTo(folder_());
  props_().setProperty('sheetId', ss.getId());
  return ss;
}
function d_(iso) { return iso ? new Date(iso + 'T12:00:00') : ''; }
function n_(v) { return v == null ? '' : v; }
function r2_(v) { return Math.round(v * 100) / 100; }
function today_() { const t = new Date(); t.setHours(12, 0, 0, 0); return t; }
function stato_(m) {
  if (m.stato === 'riportata') return { t: 'Riportata', open: false };
  if (m.stato === 'chiusa') return { t: 'Chiusa', open: false };
  if (m.pagato != null) return { t: (m.importo != null && m.pagato < m.importo - 0.009) ? 'Pagata in parte' : 'Pagata', open: false };
  if (m.importo == null) return { t: 'Importo da definire', open: true };
  if (!m.scadenza) return { t: 'Senza scadenza', open: true };
  const days = Math.round((d_(m.scadenza) - today_()) / 86400000);
  if (days < 0) return { t: 'Scaduta da ' + (-days) + ' giorni', open: true };
  if (days <= 30) return { t: 'Entro 30 giorni', open: true };
  return { t: 'Da pagare', open: true };
}
function tab_(ss, name, title, headers, rows, fmt) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  sh.clear();
  sh.getRange(1, 1).setValue(title).setFontWeight('bold').setFontSize(13);
  sh.getRange(3, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#2a6fdb').setFontColor('#ffffff').setWrap(true);
  if (rows.length) sh.getRange(4, 1, rows.length, headers.length).setValues(rows);
  Object.keys(fmt || {}).forEach(function (c) {
    if (rows.length) sh.getRange(4, Number(c) + 1, rows.length, 1).setNumberFormat(fmt[c]);
  });
  sh.setFrozenRows(3);
  return sh;
}

function buildSheet_() {
  const f = dataFile_();
  if (!f) throw new Error('dati.json non trovato');
  const data = readData_(f);
  setCase_(data);
  const M = data.movimenti, G = data.gestioni;
  const ss = spreadsheet_();
  const ora = Utilities.formatDate(new Date(), 'Europe/Rome', 'dd/MM/yyyy HH:mm');

  // Scadenze
  const open = M.filter(function (m) { return stato_(m).open; }).sort(function (a, b) { return (a.scadenza || '9999').localeCompare(b.scadenza || '9999'); });
  tab_(ss, 'Scadenze', 'Da pagare (aggiornato il ' + ora + ')', ['Scadenza', 'Immobile', 'Tipo', 'Descrizione', 'Importo', 'Conto', 'Stato'],
    open.map(function (m) { return [d_(m.scadenza), CASE[m.casa] || m.casa, TIPI[m.tipo] || m.tipo, m.voce, n_(m.importo), m.conto || '', stato_(m).t]; }), { 0: DATA, 4: EUR });

  // Gestioni
  const grows = [], vrows = [];
  G.slice().sort(function (a, b) { return a.casa.localeCompare(b.casa) || b.nome.localeCompare(a.nome); }).forEach(function (g) {
    const rate = M.filter(function (m) { return m.gestione === g.id; });
    const voci = g.voci || [];
    const prev = r2_(voci.reduce(function (t, v) { return t + (v.prev || 0); }, 0));
    const hasCons = voci.some(function (v) { return v.cons != null; });
    const cons = hasCons ? r2_(voci.reduce(function (t, v) { return t + (v.cons || 0); }, 0)) : '';
    const previste = r2_(rate.filter(function (m) { return m.stato !== 'riportata'; }).reduce(function (t, m) { return t + (m.importo || 0); }, 0));
    const pagato = r2_(rate.reduce(function (t, m) { return t + (m.pagato || 0); }, 0));
    const aperte = r2_(rate.filter(function (m) { return stato_(m).open; }).reduce(function (t, m) { return t + (m.importo || 0); }, 0));
    const saldo = (cons !== '' && g.saldoPrec != null) ? r2_(cons + g.saldoPrec - pagato) : '';
    const check = (saldo !== '' && g.saldoAdmin != null) ? r2_(saldo - g.saldoAdmin) : '';
    grows.push([(CASE[g.casa] || g.casa), g.nome, prev, cons, previste, pagato, aperte, n_(g.saldoPrec), saldo, n_(g.saldoAdmin), check, check === '' ? 'da verificare' : (Math.abs(check) < 0.01 ? 'torna' : 'differenza')]);
    voci.forEach(function (v) { vrows.push([(CASE[g.casa] || g.casa), g.nome, v.voce, n_(v.prev), n_(v.cons), (v.cons != null && v.prev != null) ? r2_(v.cons - v.prev) : '', v.note || '']); });
  });
  tab_(ss, 'Gestioni', 'Gestioni del condominio. Saldo: + da pagare, − a credito', ['Immobile', 'Gestione', 'Preventivo', 'Consuntivo', 'Rate previste', 'Pagato', 'Da pagare', 'Saldo precedente', 'Saldo calcolato', 'Saldo amministratore', 'Controllo', 'Esito'],
    grows, { 2: EUR, 3: EUR, 4: EUR, 5: EUR, 6: EUR, 7: EUR, 8: EUR, 9: EUR, 10: EUR });
  tab_(ss, 'Voci', 'Preventivo e consuntivo per voce', ['Immobile', 'Gestione', 'Voce', 'Preventivo', 'Consuntivo', 'Differenza', 'Note'], vrows, { 3: EUR, 4: EUR, 5: EUR });

  // Rate del condominio
  const rr = M.filter(function (m) { return m.gestione; }).sort(function (a, b) { return a.casa.localeCompare(b.casa) || (b.gestione || '').localeCompare(a.gestione || '') || (a.ordine || 0) - (b.ordine || 0); });
  const gname = {}; G.forEach(function (g) { gname[g.id] = g.nome; });
  tab_(ss, 'Rate', 'Rate del condominio', ['Immobile', 'Gestione', 'Rata', 'Scadenza', 'Importo', 'Pagato', 'Data pagamento', 'Conto', 'Stato', 'Note'],
    rr.map(function (m) { return [(CASE[m.casa] || m.casa), gname[m.gestione] || m.gestione, m.voce, d_(m.scadenza), n_(m.importo), n_(m.pagato), d_(m.dataPag), m.conto || '', stato_(m).t, m.note || '']; }), { 3: DATA, 4: EUR, 5: EUR, 6: DATA });

  // Bollette
  const bb = M.filter(function (m) { return ['luce', 'gas', 'internet'].indexOf(m.tipo) >= 0 && m.casa !== 'altre'; })
    .sort(function (a, b) { return a.tipo.localeCompare(b.tipo) || a.casa.localeCompare(b.casa) || (b.dal || '').localeCompare(a.dal || ''); });
  tab_(ss, 'Bollette', 'Luce, gas e internet', ['Utenza', 'Immobile', 'Dal', 'Al', 'Fornitore', 'Fattura', 'Importo', 'Consumo', 'Unità', '€ ogni 30 gg', 'Scadenza', 'Note'],
    bb.map(function (m) {
      const gg = (m.dal && m.al) ? Math.round((d_(m.al) - d_(m.dal)) / 86400000) + 1 : 0;
      return [TIPI[m.tipo], (CASE[m.casa] || m.casa), d_(m.dal), d_(m.al), m.fornitore || '', m.fattura || '', n_(m.importo), n_(m.consumo), m.unita || '', gg ? r2_(m.importo / gg * 30) : '', d_(m.scadenza), m.note || ''];
    }), { 2: DATA, 3: DATA, 6: EUR, 9: EUR, 10: DATA });

  // TARI e IMU, lavori, tutto, da chiedere
  tab_(ss, 'TARI e IMU', 'TARI e IMU', ['Anno', 'Tributo', 'Descrizione', 'Scadenza', 'Dovuto', 'di cui imposta', 'Pagato', 'Data pagamento', 'Note'],
    M.filter(function (m) { return m.tipo === 'tari' || m.tipo === 'imu'; }).map(function (m) { return [m.categoria || '', TIPI[m.tipo], m.voce, d_(m.scadenza), n_(m.importo), n_(m.imposta), n_(m.pagato), d_(m.dataPag), m.note || '']; }),
    { 3: DATA, 4: EUR, 5: EUR, 6: EUR, 7: DATA });
  tab_(ss, 'Lavori e arredi', 'Lavori e arredi, ' + CASE.casa1, ['Data', 'Categoria', 'Descrizione', 'Fornitore', 'Intestatario', 'Importo', 'Pagato', 'Detrazione', 'Detrazione stimata', 'Note'],
    M.filter(function (m) { return m.tipo === 'casa'; }).sort(function (a, b) { return (a.data || '9').localeCompare(b.data || '9'); })
      .map(function (m) { return [d_(m.data), m.categoria || '', m.voce, m.fornitore || '', m.intestatario || '', n_(m.importo), n_(m.pagato), m.detrazione || '', n_(m.detrazioneImporto), m.note || '']; }),
    { 0: DATA, 5: EUR, 6: EUR, 8: EUR });
  tab_(ss, 'Movimenti', 'Tutti i movimenti', ['ID', 'Immobile', 'Tipo', 'Gestione', 'Categoria o anno', 'Descrizione', 'Scadenza', 'Importo', 'Pagato', 'Data pagamento', 'Conto', 'Stato', 'Note'],
    M.map(function (m) { return [m.id, CASE[m.casa] || m.casa, TIPI[m.tipo] || m.tipo, gname[m.gestione] || '', m.categoria || '', m.voce, d_(m.scadenza), n_(m.importo), n_(m.pagato), d_(m.dataPag), m.conto || '', stato_(m).t, m.note || '']; }),
    { 6: DATA, 7: EUR, 8: EUR, 9: DATA });
  tab_(ss, 'Da chiedere', 'Cose da chiedere', ['Immobile', 'Riferimento', 'Priorità', 'Problema', 'Cosa fare', 'Fatto'],
    (data.promemoria || []).map(function (p) { return [CASE[p.casa] || p.casa, p.riferimento || '', p.priorita || '', p.testo, p.azione || '', p.fatto ? 'sì' : '']; }), {});

  // Veicoli (da "Il mio garage")
  const GA = data.garage;
  const PAT = GA ? (GA.patenti || (GA.patente ? [GA.patente] : [])) : [];
  if (PAT.length) {
    tab_(ss, 'Patenti', 'Patenti di guida', ['Titolare', 'Numero', 'Categorie', 'Altre categorie', 'Rilascio', 'Scadenza', 'Punti', 'Note'],
      PAT.map(function (p) { return [p.titolare || '', p.numero || '', (p.categorie || []).join(' e '), p.altre || '', d_(p.rilascio), d_(p.scadenza), n_(p.punti), p.note || '']; }), { 4: DATA, 5: DATA });
  }
  if (GA && (GA.vehicles || []).length) {
    const vn = {}; GA.vehicles.forEach(function (v) { vn[v.id] = v.name; });
    const items = GA.items || [];
    const spent = function (vid) { return r2_(items.filter(function (i) { return i.vid === vid; }).reduce(function (t, i) { return t + (i.kind === 'fuel' ? (i.total || 0) : i.kind === 'expense' ? (i.cost || 0) : 0); }, 0)); };
    tab_(ss, 'Veicoli', 'Veicoli', ['Nome', 'Tipo', 'Targa', 'Marca', 'Modello', 'Carburante', 'Km', 'Intestatario', 'Stato', 'Spese totali'],
      GA.vehicles.map(function (v) { return [v.name, v.type || '', v.plate || '', v.marca || '', v.modello || '', v.carburante || '', n_(v.km), v.intestatario || '', v.storico ? 'storico' : (v.fascia || 'in uso'), spent(v.id)]; }), { 9: EUR });
    const dl = items.filter(function (i) { return i.kind === 'deadline'; }).sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); });
    tab_(ss, 'Scadenze veicoli', 'Scadenze inserite a mano (le altre sono le scadenze di bollo, revisione e assicurazione nelle spese)', ['Scadenza', 'Veicolo', 'Tipo', 'Importo', 'Fatta', 'Note'],
      dl.map(function (i) { return [d_(i.date), vn[i.vid] || i.vid, i.cat || '', n_(i.cost), i.done ? 'sì' : '', i.note || '']; }), { 0: DATA, 3: EUR });
    tab_(ss, 'Spese veicoli', 'Spese e interventi dei veicoli', ['Data', 'Veicolo', 'Categoria', 'Importo', 'Fornitore o compagnia', 'Km', 'Scadenza', 'Copertura dal', 'al', 'Note'],
      items.filter(function (i) { return i.kind === 'expense'; }).sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); })
        .map(function (i) { return [d_(i.date), vn[i.vid] || i.vid, i.cat || '', n_(i.cost), i.fornitore || i.compagnia || '', n_(i.km), d_(i.scadenza), d_(i.da), d_(i.a), i.note || '']; }),
      { 0: DATA, 3: EUR, 6: DATA, 7: DATA, 8: DATA });
    tab_(ss, 'Ricariche e rifornimenti', 'Ricariche e rifornimenti', ['Data', 'Veicolo', 'Km', 'Importo', 'kWh', '€/kWh', 'Litri', 'Corrente', 'Fornitore', 'Note'],
      items.filter(function (i) { return i.kind === 'fuel'; }).sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); })
        .map(function (i) { return [d_(i.date), vn[i.vid] || i.vid, n_(i.km), n_(i.total), n_(i.energia), i.energia ? Math.round(i.total / i.energia * 1000) / 1000 : '', n_(i.liters), i.corrente || '', i.fornitore || '', i.note || '']; }),
      { 0: DATA, 3: EUR });
  }

  // remove the empty default sheet, keep tab order
  ['Sheet1', 'Foglio1', 'Foglio 1'].forEach(function (n) { const sh = ss.getSheetByName(n); if (sh && ss.getSheets().length > 1) ss.deleteSheet(sh); });
  return ss.getUrl();
}

/** Prova manuale: esegui questa funzione dall'editor per dare i permessi e creare il foglio. */
function prova() {
  const f = dataFile_();
  Logger.log(f ? 'Trovato dati.json, creo il foglio: ' + buildSheet_() : 'Tutto pronto. Cartella "' + CARTELLA + '" creata su Google Drive. Ora apri l\'app, collegala e scegli "Inizia da zero".');
}
