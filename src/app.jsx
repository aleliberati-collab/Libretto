
const { useState, useEffect } = React;

// ---------- constants ----------
const DEFAULT_CATEGORIES_OUT = ["Casa", "Cibo", "Trasporti", "Viaggi", "Svago", "Salute", "Altro", "Utenze", "Spesa", "Shopping", "Abbonamento"];
const DEFAULT_CATEGORIES_IN = ["Stipendio", "RSU/Bonus", "Rimborso", "Altro", "Interessi"];
const CAT_COLORS = {
  Casa: "#2A5C8A",
  Cibo: "#C7752F",
  Trasporti: "#7A5CB8",
  Viaggi: "#1E9AA8",
  Svago: "#C23A9E",
  Salute: "#1E7A3D",
  Altro: "#8A6D4F",
  Stipendio: "#1E7A3D",
  "RSU/Bonus": "#1E7A3D",
  Rimborso: "#1E7A3D",
  Trasferimento: "#6B7086",
  "Quota casa": "#4A6FA5",
};
// tavolozza per categorie personalizzate, assegnata in modo stabile via hash del nome
const CUSTOM_PALETTE = ["#2A5C8A", "#C7752F", "#7A5CB8", "#1E9AA8", "#C23A9E", "#1E7A3D", "#8A6D4F", "#B8862F", "#4A6FA5", "#9A4A6B"];
function catColor(cat) {
  if (CAT_COLORS[cat]) return CAT_COLORS[cat];
  let hash = 0;
  for (let i = 0; i < cat.length; i++) hash = (hash * 31 + cat.charCodeAt(i)) >>> 0;
  return CUSTOM_PALETTE[hash % CUSTOM_PALETTE.length];
}
const INVEST_BUCKETS = [
  { key: "saxo", label: "Saxo" },
  { key: "revolut_pac", label: "Revolut PAC (solo ETF)" },
  { key: "satellite", label: "Satellite azioni" },
  { key: "company_stock", label: "Azioni aziendali (ESPP/RSU)" },
  { key: "crypto", label: "Crypto satellite" },
];
// solo questi bucket contano per l'obiettivo: satelliti, azioni aziendali e crypto restano sempre esclusi
const GOAL_BUCKETS = ["saxo", "revolut_pac"];
// destinazioni esterne dei trasferimenti: il valore del bucket collegato cresce subito dell'importo versato
const EXTERNAL_TARGETS = { "Saxo (broker)": "saxo", "Revolut (broker)": "revolut_pac" };
// conti di casa (cointestato): le loro spese sono della coppia e non entrano nelle tue statistiche;
// conta come tua spesa solo la quota che versi (trasferimento verso il conto di casa → "Quota casa")
const SHARED_RE = /cointestat|fælles|faelles|joint/i;
// glide-path a soglie di capitale: azionario / difensivo (bond + oro).
// Valori di esempio: quelli reali stanno nelle Impostazioni (e nel backup), mai nel codice.
// Ogni fase: { to: soglia superiore in DKK (null = ultima fase), eq: % azionario }
const DEFAULT_PHASES = [
  { to: 200000, eq: 70 },
  { to: 350000, eq: 55 },
  { to: null, eq: 40 },
];
const DEFAULT_SETTINGS = {
  goalName: "Obiettivo",
  goal: 500000,
  phases: DEFAULT_PHASES,
  salaryKeyword: "",
  pacPct: 20,
  extraPct: 10,
  trading: 0,
  buffer: 20000,
  saxoPct: 50,
  eurDkk: 7.46,
  mainAccount: "Conto principale",
  investAccount: "Conto principale · Investimenti",
  extraAccount: "Conto principale · Extra",
  tradingAccount: "Conto principale · Trading",
};
// trasforma le fasi salvate nelle impostazioni in intervalli { n, from, to, eq }
function phasesOf(settings) {
  const raw = Array.isArray(settings && settings.phases) && settings.phases.length ? settings.phases : DEFAULT_PHASES;
  let from = 0;
  return raw.map((p, i) => {
    const last = i === raw.length - 1;
    const to = last || p.to == null ? Infinity : Number(p.to) || 0;
    const out = { n: i + 1, from, to, eq: Number(p.eq) || 0 };
    from = to;
    return out;
  });
}
const DEFAULT_RULES = [
  ["rema", "Spesa"], ["bilka", "Spesa"], ["lidl", "Spesa"], ["netto", "Spesa"], ["føtex", "Spesa"], ["fotex", "Spesa"],
  ["meny", "Spesa"], ["coop", "Spesa"], ["365discount", "Spesa"], ["torvehallerne", "Spesa"],
  ["dsb", "Trasporti"], ["rejsekort", "Trasporti"], ["taxi", "Trasporti"], ["uber", "Trasporti"],
  ["netflix", "Abbonamento"], ["amazon", "Abbonamento"], ["prime", "Abbonamento"], ["discovery", "Abbonamento"], ["spotify", "Abbonamento"],
  ["iliad", "Utenze"], ["lunar plus", "Utenze"],
  ["decathlon", "Shopping"],
  ["telia", "Abbonamento"], ["gym", "Abbonamento"], ["affitto", "Casa"], ["husleje", "Casa"],
].map(([match, category]) => ({ match, category }));

const fmt = (n) => new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 }).format(Math.round(n || 0));
const todayISO = () => new Date().toISOString().slice(0, 10);
const uid = () => Math.random().toString(36).slice(2, 10);
const r2c = (n) => Math.round(n * 100) / 100;

// ---------- storage (localStorage: dati salvati solo su questo telefono/browser) ----------
const STORE_KEY = "libretto-finance-tracker-v2";

// porta qualsiasi stato (salvato o importato da backup) alla versione corrente senza perdere dati
function migrate(parsed) {
  if (!parsed.categoriesOut) parsed.categoriesOut = DEFAULT_CATEGORIES_OUT;
  if (!parsed.categoriesIn) parsed.categoriesIn = DEFAULT_CATEGORIES_IN;
  if (parsed.lastBackupDate === undefined) parsed.lastBackupDate = null;
  parsed.settings = { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) };
  if (!parsed.rules) parsed.rules = DEFAULT_RULES;
  if (!parsed.rulesV2) {
    const have = new Set(parsed.rules.map((r) => r.match.toLowerCase()));
    parsed.rules = [...parsed.rules, ...DEFAULT_RULES.filter((r) => !have.has(r.match))];
    parsed.rulesV2 = true;
  }
  parsed.transactions = parsed.transactions || [];
  parsed.investments = parsed.investments || [];
  // il vecchio nome interno del bucket azioni aziendali diventa neutro
  parsed.investments = parsed.investments.map((i) => (i.bucket === "tesla" + "_espp" ? { ...i, bucket: "company_stock" } : i));
  parsed.accounts = parsed.accounts || [];
  parsed.deposits = parsed.deposits || [];
  if (!parsed.investments.some((i) => i.bucket === "company_stock")) {
    parsed.investments.push({ id: uid(), bucket: "company_stock", label: "Azioni aziendali", value: 0, date: todayISO() });
  }
  if (!parsed.investments.some((i) => i.bucket === "satellite")) {
    parsed.investments.push({ id: uid(), bucket: "satellite", label: "Satellite azioni", value: 0, date: todayISO() });
  }
  // flag "conta per l'obiettivo": i depositi partono esclusi, si attiva con 🏠
  parsed.deposits = parsed.deposits.map((d) => (d.goal === undefined ? { ...d, goal: false } : d));
  parsed.accounts = parsed.accounts.map((a) => ({
    ...a,
    goal: a.goal === undefined ? false : a.goal,
    shared: a.shared === undefined ? SHARED_RE.test(a.name) : a.shared,
    subaccounts: (a.subaccounts || []).map((s) => {
      let x = s.goal === undefined ? { ...s, goal: s.name === "Investimenti" } : s;
      if (x.shared === undefined) x = { ...x, shared: SHARED_RE.test(x.name) };
      return x;
    }),
  }));
  // sottoconto Trading sotto Lunar per l'accantonamento mensile del capitale di trading
  if (!parsed.tradingSubCreated) {
    parsed.accounts = parsed.accounts.map((a) =>
      a.name === "Lunar" && !(a.subaccounts || []).some((s) => s.name === "Trading")
        ? { ...a, subaccounts: [...(a.subaccounts || []), { id: uid(), name: "Trading", balance: 0, goal: false }] }
        : a
    );
    parsed.tradingSubCreated = true;
  }
  // migrazione una tantum: applica retroattivamente ai saldi i movimenti inseriti prima dell'aggiornamento automatico
  if (!parsed.balancesReconciled && parsed.transactions.length > 0) {
    let st = { accounts: parsed.accounts, investments: parsed.investments };
    parsed.transactions.forEach((t) => { st = applyTx(st, t, 1); });
    parsed.accounts = st.accounts;
    parsed.investments = st.investments;
  }
  parsed.balancesReconciled = true;
  // pulizia una tantum dei picchi errati nello storico
  if (!parsed.historyCleaned && parsed.netWorthHistory) {
    const h = parsed.netWorthHistory;
    parsed.netWorthHistory = h.filter((p, i) => {
      if (i === 0 || i === h.length - 1) return true;
      const prev = h[i - 1].value, next = h[i + 1].value;
      const spike = p.value > prev * 1.2 && p.value > next * 1.2;
      const dip = p.value < prev * 0.8 && p.value < next * 0.8;
      return !(spike || dip);
    });
    parsed.historyCleaned = true;
  }
  return parsed;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return migrate(JSON.parse(raw));
  } catch (e) {}
  return null;
}
function saveState(state) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error("Storage error", e);
  }
}

const seedState = migrate({
  accounts: [
    { id: uid(), name: "Revolut", balance: 0, subaccounts: [] },
    { id: uid(), name: "Lunar", balance: 0, subaccounts: [] },
  ],
  deposits: [],
  transactions: [],
  investments: [
    { id: uid(), bucket: "saxo", label: "Saxo (ETF)", value: 0, date: todayISO() },
    { id: uid(), bucket: "revolut_pac", label: "Revolut PAC (ETF)", value: 0, date: todayISO() },
    { id: uid(), bucket: "crypto", label: "Crypto satellite", value: 0, date: todayISO() },
  ],
  netWorthHistory: [],
});

function accountNames(accounts) {
  const names = [];
  accounts.forEach((a) => {
    names.push(a.name);
    (a.subaccounts || []).forEach((s) => names.push(`${a.name} · ${s.name}`));
  });
  return names;
}
function totalAccountBalance(accounts) {
  return accounts.reduce((sum, a) => {
    const subTotal = (a.subaccounts || []).reduce((s, sub) => s + (sub.balance || 0), 0);
    return sum + (a.balance || 0) + subTotal;
  }, 0);
}
function totalDeposits(deposits) {
  return deposits.reduce((s, d) => s + (d.balance || 0), 0);
}
function getBalance(accounts, accountName) {
  const sepIdx = accountName.indexOf(" · ");
  if (sepIdx === -1) {
    const a = accounts.find((x) => x.name === accountName);
    return a ? a.balance || 0 : 0;
  }
  const a = accounts.find((x) => x.name === accountName.slice(0, sepIdx));
  const s = a && (a.subaccounts || []).find((x) => x.name === accountName.slice(sepIdx + 3));
  return s ? s.balance || 0 : 0;
}
// applica una variazione (positiva o negativa) al saldo del conto/sottoconto identificato per nome
// il nome può essere "Revolut" (conto principale) o "Revolut · Risparmio viaggi" (sottoconto)
function applyBalanceDelta(accounts, accountName, delta) {
  const sepIdx = accountName.indexOf(" · ");
  if (sepIdx === -1) {
    return accounts.map((a) => (a.name === accountName ? { ...a, balance: r2c((a.balance || 0) + delta) } : a));
  }
  const parentName = accountName.slice(0, sepIdx);
  const subName = accountName.slice(sepIdx + 3);
  return accounts.map((a) => {
    if (a.name !== parentName) return a;
    return {
      ...a,
      subaccounts: (a.subaccounts || []).map((sub) =>
        sub.name === subName ? { ...sub, balance: r2c((sub.balance || 0) + delta) } : sub
      ),
    };
  });
}
// effetto di un movimento su conti e investimenti; sign = 1 applica, sign = -1 annulla
function applyTx(st, tx, sign) {
  const amt = tx.amount * sign;
  if (tx.type === "transfer") {
    let accounts = applyBalanceDelta(st.accounts, tx.account, -amt);
    let investments = st.investments;
    const bucket = EXTERNAL_TARGETS[tx.toAccount];
    if (bucket) {
      let done = false;
      investments = investments.map((i) => {
        if (!done && i.bucket === bucket) { done = true; return { ...i, value: r2c((i.value || 0) + amt) }; }
        return i;
      });
    } else if (tx.toAccount) {
      accounts = applyBalanceDelta(accounts, tx.toAccount, amt);
    }
    return { accounts, investments };
  }
  const delta = tx.type === "in" ? amt : -amt;
  return { accounts: applyBalanceDelta(st.accounts, tx.account, delta), investments: st.investments };
}
function sharedAccountNames(accounts) {
  const names = new Set();
  accounts.forEach((a) => {
    if (a.shared) names.add(a.name);
    (a.subaccounts || []).forEach((s) => { if (s.shared) names.add(`${a.name} · ${s.name}`); });
  });
  return names;
}
// converte i movimenti in flussi personali: uscite/entrate sui tuoi conti + quota versata al conto di casa
function personalFlows(transactions, shared) {
  const out = [];
  transactions.forEach((t) => {
    if (t.type === "in" && !shared.has(t.account)) out.push({ date: t.date, kind: "in", category: t.category, amount: t.amount });
    else if (t.type === "out" && !shared.has(t.account)) out.push({ date: t.date, kind: "out", category: t.category, amount: t.amount });
    else if (t.type === "transfer" && !shared.has(t.account) && shared.has(t.toAccount)) out.push({ date: t.date, kind: "out", category: "Quota casa", amount: t.amount });
  });
  return out;
}
function houseFlows(transactions, shared) {
  return transactions.filter((t) => t.type === "out" && shared.has(t.account)).map((t) => ({ date: t.date, kind: "out", category: t.category, amount: t.amount }));
}

function goalAccountNames(accounts) {
  const names = [];
  accounts.forEach((a) => {
    if (a.goal) names.push(a.name);
    (a.subaccounts || []).forEach((s) => { if (s.goal) names.push(`${a.name} · ${s.name}`); });
  });
  return names;
}
function goalCapitalOf(state) {
  const inv = state.investments.filter((i) => GOAL_BUCKETS.includes(i.bucket)).reduce((a, i) => a + (i.value || 0), 0);
  const dep = state.deposits.filter((d) => d.goal).reduce((a, d) => a + (d.balance || 0), 0);
  let cash = 0;
  state.accounts.forEach((a) => {
    if (a.goal) cash += a.balance || 0;
    (a.subaccounts || []).forEach((s) => { if (s.goal) cash += s.balance || 0; });
  });
  return { inv, dep, cash, total: inv + dep + cash };
}
function totalNetWorth(state) {
  const cash = totalAccountBalance(state.accounts);
  const dep = totalDeposits(state.deposits);
  const invest = (state.investments || []).reduce((a, i) => a + (i.value || 0), 0);
  return cash + dep + invest;
}
function phaseOf(capital, phases) {
  return phases.find((p) => capital >= p.from && capital < p.to) || phases[phases.length - 1];
}

// ---------- CSV (estratti conto Revolut / Lunar) ----------
function detectDelimiter(line) {
  const counts = { ";": 0, ",": 0, "\t": 0 };
  let inQ = false;
  for (const ch of line) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && counts[ch] !== undefined) counts[ch]++;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}
function parseCSV(text) {
  text = text.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) || "";
  const delim = detectDelimiter(firstLine);
  const rows = [];
  let row = [], cell = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}
function parseNum(s) {
  if (s === undefined || s === null) return NaN;
  let t = String(s).replace(/[\s ]/g, "").replace(/[−–]/g, "-").replace(/[^0-9,.\-]/g, "");
  if (!t) return NaN;
  const lastC = t.lastIndexOf(","), lastD = t.lastIndexOf(".");
  if (lastC > -1 && lastD > -1) {
    if (lastC > lastD) t = t.replace(/\./g, "").replace(",", ".");
    else t = t.replace(/,/g, "");
  } else if (lastC > -1) {
    t = t.replace(/\./g, "").replace(",", ".");
  } else if (lastD > -1 && /^-?\d{1,3}(\.\d{3})+$/.test(t)) {
    t = t.replace(/\./g, "");
  }
  return parseFloat(t);
}
function parseDate(s) {
  if (!s) return null;
  const t = String(s).trim();
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}
const COLUMN_HINTS = {
  date: ["completed date", "data di completamento", "bogføringsdato", "dato", "date", "data", "started date", "data di inizio", "rentedato"],
  desc: ["titel", "title", "description", "descrizione", "tekst", "text", "beskrivelse", "modtager", "merchant"],
  note: ["note", "notat"],
  extId: ["transaktions-id", "transaction id", "transaktionsid"],
  amount: ["amount", "importo", "beløb", "belob"],
  fee: ["fee", "costo", "commissione", "gebyr"],
  currency: ["currency", "valuta"],
  state: ["state", "stato", "status"],
  kind: ["type", "tipo"],
};
function guessColumns(header) {
  const h = header.map((x) => x.trim().toLowerCase());
  const pick = (hints) => {
    for (const hint of hints) {
      const idx = h.findIndex((x) => x === hint);
      if (idx > -1) return idx;
    }
    for (const hint of hints) {
      const idx = h.findIndex((x) => x.includes(hint));
      if (idx > -1) return idx;
    }
    return -1;
  };
  const out = {};
  Object.entries(COLUMN_HINTS).forEach(([k, hints]) => { out[k] = pick(hints); });
  return out;
}
function suggestCategory(desc, type, rules, categoriesOut, categoriesIn, salaryKeyword) {
  const d = (desc || "").toLowerCase();
  if (type === "in") {
    const kw = (salaryKeyword || "").trim().toLowerCase();
    if (/løn|salary|stipendio/.test(d) || (kw && d.includes(kw))) return "Stipendio";
    if (/mobilepay/.test(d) && categoriesIn.includes("Rimborso")) return "Rimborso";
    if (/rente|interest|interessi/.test(d)) return categoriesIn.includes("Interessi") ? "Interessi" : "Altro";
    return categoriesIn.includes("Altro") ? "Altro" : categoriesIn[0];
  }
  const r = rules.find((x) => d.includes(x.match.toLowerCase()));
  if (r && categoriesOut.includes(r.category)) return r.category;
  return categoriesOut.includes("Altro") ? "Altro" : categoriesOut[0];
}
const RULE_STOP = new Set(["casa", "comune", "della", "delle", "dello", "degli", "food", "shop", "store", "www", "sas", "srl", "spa", "asd", "aps", "the", "and", "via", "piazza", "societa", "società", "mobilepay", "betaling", "card", "payment", "pagamento", "revolut", "lunar", "italia", "italy", "danmark"]);
function ruleKeyFor(desc) {
  const words = (desc || "").toLowerCase().replace(/[^a-zà-ÿæøå0-9 ]/gi, " ").split(/\s+/).filter((w) => w.length >= 4 && !/^\d+$/.test(w) && !RULE_STOP.has(w));
  return words[0] || null;
}
function looksLikeTransfer(kindRaw, desc) {
  if (/løn|rente|renter|interest|interessi/i.test(desc)) return false;
  if (/TRANSFER|TOPUP|TOP-UP|EXCHANGE|TRASFERIMENTO|RICARICA|CAMBIO|OVERFØRSEL|OVERFORSEL/.test(kindRaw)) return true;
  return /overførsel|overforsel|transfer to|transfer from|top-up|\brevolut\b|investimenti|savings|extra cash|trading/i.test(desc);
}
function guessOther(desc, account, options) {
  const d = (desc || "").toLowerCase();
  const pick = (re) => options.find((o) => o !== account && re.test(o));
  return (/revolut/.test(d) && (options.includes("Revolut") && account !== "Revolut" ? "Revolut" : pick(/revolut/i)))
    || (/investimenti|savings/.test(d) && pick(/investimenti/i))
    || (/extra/.test(d) && pick(/extra/i))
    || (/trading/.test(d) && pick(/trading/i))
    || (/saxo/.test(d) && pick(/saxo/i))
    || (/lunar/.test(d) && pick(/^lunar$/i))
    || options.find((o) => o !== account);
}

// ---------- icons (inline SVG, no external icon lib needed) ----------
const Icon = ({ path, size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{path}</svg>
);
const IconPlus = (p) => <Icon {...p} path={<><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>} />;
const IconTrash = (p) => <Icon {...p} path={<><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></>} />;
const IconTrend = (p) => <Icon {...p} path={<><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></>} />;
const IconWallet = (p) => <Icon {...p} path={<><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></>} />;
const IconPiggy = (p) => <Icon {...p} path={<><path d="M19 5c-1.5 0-2.8 1.4-3 2-3.5-1.5-11-.3-11 5 0 1.8 0 3 2 4.5V20h4v-2h3v2h4v-4c1-.5 1.7-1 2-2h2v-4h-2c0-1-.5-1.7-1-2V5z"/><path d="M2 9v1"/></>} />;
const IconHome = (p) => <Icon {...p} path={<><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/></>} />;
const IconLandmark = (p) => <Icon {...p} path={<><line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/></>} />;
const IconChart = (p) => <Icon {...p} path={<><path d="M3 3v18h18"/><path d="M7 15l4-6 3 3 5-8"/></>} />;
const IconX = (p) => <Icon {...p} path={<><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>} />;
const IconTarget = (p) => <Icon {...p} path={<><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></>} />;
const IconSwap = (p) => <Icon {...p} path={<><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></>} />;
const IconUpload = (p) => <Icon {...p} path={<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></>} />;

// ---------- app ----------
function App() {
  const [state, setState] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("panoramica");
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  useEffect(() => {
    const s = loadState();
    setState(s || seedState);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded && state) saveState(state);
  }, [state, loaded]);

  // snapshot del patrimonio: un punto al giorno, aggiornato a ogni modifica di quel giorno
  useEffect(() => {
    if (!loaded || !state) return;
    const today = todayISO();
    const value = Math.round(totalNetWorth(state) * 100) / 100;
    const history = state.netWorthHistory || [];
    const last = history[history.length - 1];
    if (last && last.date === today && Math.abs(last.value - value) < 0.5) return;
    setState((s) => {
      const h = s.netWorthHistory || [];
      const l = h[h.length - 1];
      const nh = l && l.date === today ? [...h.slice(0, -1), { date: today, value }] : [...h, { date: today, value }];
      return { ...s, netWorthHistory: nh };
    });
    // eslint-disable-next-line
  }, [state, loaded]);

  if (!loaded || !state) {
    return <div className="app-shell"><div className="loading">Caricamento…</div></div>;
  }

  const addTransaction = (tx) => setState((s) => {
    const full = { ...tx, id: uid() };
    const st = applyTx(s, full, 1);
    return { ...s, ...st, transactions: [full, ...s.transactions] };
  });
  const addTransactions = (txs, updateBalances = true) => setState((s) => {
    let st = { accounts: s.accounts, investments: s.investments };
    const full = txs.map((t) => ({ ...t, id: uid() }));
    if (updateBalances) full.forEach((t) => { st = applyTx(st, t, 1); });
    const all = [...full, ...s.transactions].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return { ...s, ...st, transactions: all };
  });
  const deleteTransaction = (id) => setState((s) => {
    const tx = s.transactions.find((t) => t.id === id);
    if (!tx) return s;
    const st = tx.noBalance ? { accounts: s.accounts, investments: s.investments } : applyTx(s, tx, -1);
    return { ...s, ...st, transactions: s.transactions.filter((t) => t.id !== id) };
  });
  const updateTransaction = (id, patch) => setState((s) => {
    const oldTx = s.transactions.find((t) => t.id === id);
    if (!oldTx) return s;
    const newTx = { ...oldTx, ...patch };
    // annulla l'effetto del movimento originale, poi applica il nuovo
    let st = { accounts: s.accounts, investments: s.investments };
    if (!oldTx.noBalance) { st = applyTx(st, oldTx, -1); st = applyTx(st, newTx, 1); }
    return { ...s, ...st, transactions: s.transactions.map((t) => (t.id === id ? newTx : t)) };
  });
  const addCategory = (kind, name) => setState((s) => {
    const key = kind === "in" ? "categoriesIn" : "categoriesOut";
    if (s[key].includes(name)) return s;
    return { ...s, [key]: [...s[key], name] };
  });
  const deleteCategory = (kind, name) => setState((s) => {
    const key = kind === "in" ? "categoriesIn" : "categoriesOut";
    if (s[key].length <= 1) return s;
    return { ...s, [key]: s[key].filter((c) => c !== name) };
  });
  const addRules = (newRules) => setState((s) => {
    const existing = new Set(s.rules.map((r) => r.match.toLowerCase()));
    const fresh = newRules.filter((r) => !existing.has(r.match.toLowerCase()));
    return fresh.length ? { ...s, rules: [...fresh, ...s.rules] } : s;
  });
  const deleteRule = (match) => setState((s) => ({ ...s, rules: s.rules.filter((r) => r.match !== match) }));
  const updateSettings = (patch) => setState((s) => ({ ...s, settings: { ...s.settings, ...patch } }));

  const updateInvestment = (id, value) => setState((s) => ({ ...s, investments: s.investments.map((i) => (i.id === id ? { ...i, value, date: todayISO() } : i)) }));
  const addInvestment = (inv) => setState((s) => ({ ...s, investments: [...s.investments, { ...inv, id: uid(), date: todayISO() }] }));
  const deleteInvestment = (id) => setState((s) => ({ ...s, investments: s.investments.filter((i) => i.id !== id) }));

  const updateAccountBalance = (id, balance) => setState((s) => ({ ...s, accounts: s.accounts.map((a) => (a.id === id ? { ...a, balance } : a)) }));
  const toggleAccountGoal = (id) => setState((s) => ({ ...s, accounts: s.accounts.map((a) => (a.id === id ? { ...a, goal: !a.goal } : a)) }));
  const addAccount = (name) => setState((s) => ({ ...s, accounts: [...s.accounts, { id: uid(), name, balance: 0, goal: false, subaccounts: [] }] }));
  const deleteAccount = (id) => setState((s) => ({ ...s, accounts: s.accounts.filter((a) => a.id !== id) }));
  const addSubaccount = (parentId, name) => setState((s) => ({
    ...s,
    accounts: s.accounts.map((a) => a.id === parentId ? { ...a, subaccounts: [...(a.subaccounts || []), { id: uid(), name, balance: 0, goal: false }] } : a),
  }));
  const updateSubaccountBalance = (parentId, subId, balance) => setState((s) => ({
    ...s,
    accounts: s.accounts.map((a) => a.id === parentId ? { ...a, subaccounts: a.subaccounts.map((sub) => sub.id === subId ? { ...sub, balance } : sub) } : a),
  }));
  const toggleAccountShared = (id) => setState((s) => ({ ...s, accounts: s.accounts.map((a) => (a.id === id ? { ...a, shared: !a.shared } : a)) }));
  const toggleSubShared = (parentId, subId) => setState((s) => ({
    ...s,
    accounts: s.accounts.map((a) => a.id === parentId ? { ...a, subaccounts: a.subaccounts.map((sub) => sub.id === subId ? { ...sub, shared: !sub.shared } : sub) } : a),
  }));
  const toggleSubGoal = (parentId, subId) => setState((s) => ({
    ...s,
    accounts: s.accounts.map((a) => a.id === parentId ? { ...a, subaccounts: a.subaccounts.map((sub) => sub.id === subId ? { ...sub, goal: !sub.goal } : sub) } : a),
  }));
  const deleteSubaccount = (parentId, subId) => setState((s) => ({
    ...s,
    accounts: s.accounts.map((a) => a.id === parentId ? { ...a, subaccounts: a.subaccounts.filter((sub) => sub.id !== subId) } : a),
  }));

  const addDeposit = (dep) => setState((s) => ({ ...s, deposits: [...s.deposits, { ...dep, id: uid() }] }));
  const updateDeposit = (id, patch) => setState((s) => ({ ...s, deposits: s.deposits.map((d) => (d.id === id ? { ...d, ...patch } : d)) }));
  const deleteDeposit = (id) => setState((s) => ({ ...s, deposits: s.deposits.filter((d) => d.id !== id) }));

  const exportData = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `libretto-backup-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setState((s) => ({ ...s, lastBackupDate: todayISO() }));
  };

  const importData = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const parsed = migrate(JSON.parse(evt.target.result));
        setState(parsed);
        alert("Backup importato correttamente.");
      } catch (err) {
        alert("File non valido.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const names = accountNames(state.accounts);

  return (
    <div className="app-shell">
      <Header />
      <nav className="tabs">
        {[["panoramica", "Panoramica"], ["piano", "Piano mensile"], ["conti", "Conti"], ["movimenti", "Movimenti"], ["categorie", "Categorie"], ["investimenti", "Investimenti"]].map(([key, label]) => (
          <button key={key} className={"tab" + (tab === key ? " active" : "")} onClick={() => setTab(key)}>{label}</button>
        ))}
      </nav>
      <main className="content">
        <BackupReminder lastBackupDate={state.lastBackupDate} hasData={state.transactions.length > 0} onExport={exportData} />
        {tab === "panoramica" && <Overview state={state} />}
        {tab === "piano" && (
          <MonthlyPlan state={state} accountNames={names} onUpdateSettings={updateSettings} onRegister={(txs) => addTransactions(txs, true)} />
        )}
        {tab === "conti" && (
          <Accounts
            accounts={state.accounts}
            deposits={state.deposits}
            onUpdateBalance={updateAccountBalance}
            onToggleAccountGoal={toggleAccountGoal}
            onAddAccount={addAccount}
            onDeleteAccount={deleteAccount}
            onAddSubaccount={addSubaccount}
            onUpdateSubBalance={updateSubaccountBalance}
            onToggleSubGoal={toggleSubGoal}
            onToggleAccountShared={toggleAccountShared}
            onToggleSubShared={toggleSubShared}
            onDeleteSubaccount={deleteSubaccount}
            onAddDeposit={addDeposit}
            onUpdateDeposit={updateDeposit}
            onDeleteDeposit={deleteDeposit}
          />
        )}
        {tab === "movimenti" && (
          <Movements
            state={state}
            transactions={state.transactions}
            accountNames={names}
            categoriesOut={state.categoriesOut}
            categoriesIn={state.categoriesIn}
            onAdd={addTransaction}
            onImport={addTransactions}
            onAddRules={addRules}
            onDeleteRule={deleteRule}
            onDelete={deleteTransaction}
            onUpdate={updateTransaction}
            onAddCategory={addCategory}
            onDeleteCategory={deleteCategory}
          />
        )}
        {tab === "categorie" && (
          <CategoryAnalysis transactions={state.transactions} accounts={state.accounts} />
        )}
        {tab === "investimenti" && (
          <Investments investments={state.investments} onUpdate={updateInvestment} onAdd={addInvestment} onDelete={deleteInvestment} />
        )}
        <div className="backup-row">
          <button className="backup-btn" onClick={exportData}>⇩ Esporta backup (.json)</button>
          <label className="backup-btn" style={{cursor: "pointer"}}>
            ⇧ Importa backup
            <input type="file" accept="application/json" style={{display: "none"}} onChange={importData} />
          </label>
        </div>
      </main>

      <button className="fab" onClick={() => setQuickAddOpen(true)} aria-label="Aggiungi movimento rapido">
        <IconPlus size={26} />
      </button>

      {quickAddOpen && (
        <QuickAdd
          accountNames={names}
          categoriesOut={state.categoriesOut}
          categoriesIn={state.categoriesIn}
          onAdd={(tx) => { addTransaction(tx); setQuickAddOpen(false); }}
          onClose={() => setQuickAddOpen(false)}
        />
      )}
    </div>
  );
}

function BackupReminder({ lastBackupDate, hasData, onExport }) {
  if (!hasData) return null;
  const daysSince = lastBackupDate
    ? Math.floor((new Date(todayISO()) - new Date(lastBackupDate)) / 86400000)
    : null;
  const shouldRemind = daysSince === null || daysSince >= 14;
  if (!shouldRemind) return null;

  return (
    <div className="backup-reminder">
      <span>
        {lastBackupDate
          ? `Ultimo backup ${daysSince} giorni fa. Consigliato esportarlo e salvarlo su Google Drive.`
          : "Non hai ancora esportato un backup. Consigliato salvarne uno su Google Drive."}
      </span>
      <button onClick={onExport}>Esporta ora</button>
    </div>
  );
}

function Header() {
  return (
    <header className="header">
      <div className="header-inner">
        <div className="stamp">L</div>
        <div>
          <div className="header-title">Libretto</div>
          <div className="header-sub">Registro finanziario personale</div>
        </div>
      </div>
    </header>
  );
}

function Overview({ state }) {
  const { transactions, investments, accounts, deposits } = state;
  const now = new Date();
  const monthKey = now.toISOString().slice(0, 7);
  const thisMonthTx = transactions.filter((t) => t.date.slice(0, 7) === monthKey);
  const shared = sharedAccountNames(accounts);
  const flows = personalFlows(transactions, shared);
  const monthFlows = flows.filter((f) => f.date.slice(0, 7) === monthKey);
  const income = monthFlows.filter((f) => f.kind === "in").reduce((a, f) => a + f.amount, 0);
  const expense = monthFlows.filter((f) => f.kind === "out").reduce((a, f) => a + f.amount, 0);
  const net = income - expense;
  const houseMonth = houseFlows(transactions, shared).filter((f) => f.date.slice(0, 7) === monthKey);
  const houseSpent = houseMonth.reduce((a, f) => a + f.amount, 0);
  const quotaMonth = monthFlows.filter((f) => f.category === "Quota casa").reduce((a, f) => a + f.amount, 0);

  // accantonato verso il Fondo Casa questo mese: trasferimenti verso conti obiettivo o broker
  const goalNames = new Set([...goalAccountNames(accounts), ...Object.keys(EXTERNAL_TARGETS)]);
  const isGoalTransfer = (t) => t.type === "transfer" && goalNames.has(t.toAccount) && !goalNames.has(t.account);
  const savedToGoal = thisMonthTx.filter(isGoalTransfer).reduce((a, t) => a + t.amount, 0);

  // medie mensili: raggruppa per mese, esclude il mese corrente (incompleto) dal calcolo
  const byMonth = {};
  flows.forEach((f) => {
    const mk = f.date.slice(0, 7);
    if (mk === monthKey) return;
    if (!byMonth[mk]) byMonth[mk] = { income: 0, expense: 0 };
    if (f.kind === "in") byMonth[mk].income += f.amount;
    else byMonth[mk].expense += f.amount;
  });
  const pastMonths = Object.values(byMonth);
  const avgIncome = pastMonths.length ? pastMonths.reduce((a, m) => a + m.income, 0) / pastMonths.length : null;
  const avgExpense = pastMonths.length ? pastMonths.reduce((a, m) => a + m.expense, 0) / pastMonths.length : null;
  const monthsCounted = pastMonths.length;

  const cashTotal = totalAccountBalance(accounts);
  const depositsTotal = totalDeposits(deposits);
  const totalInvested = investments.reduce((a, i) => a + (i.value || 0), 0);
  const goal = goalCapitalOf(state);
  const goalCapital = goal.total;
  const GOAL_DKK = Number(state.settings.goal) || 0;
  const PHASES = phasesOf(state.settings);
  const lastN = PHASES.length;
  const goalProgress = GOAL_DKK > 0 ? Math.min(100, (goalCapital / GOAL_DKK) * 100) : 0;
  const phase = phaseOf(goalCapital, PHASES);
  const nextThreshold = phase.to === Infinity ? GOAL_DKK : phase.to;
  const toNext = Math.max(0, nextThreshold - goalCapital);
  const bandSpan = (phase.to === Infinity ? GOAL_DKK : phase.to) - phase.from;
  const nearNext = phase.n < lastN && toNext <= bandSpan * 0.1;
  const nextPhase = PHASES.find((p) => p.n === phase.n + 1);

  const companyStock = investments.filter((i) => i.bucket === "company_stock").reduce((a, i) => a + (i.value || 0), 0);
  const netWorthTotal = cashTotal + depositsTotal + totalInvested;
  const companyShare = netWorthTotal > 0 ? (companyStock / netWorthTotal) * 100 : 0;

  // tasso di risparmio del mese corrente: quota di entrate non spesa (i trasferimenti non sono spese)
  const savingsRate = income > 0 ? ((income - expense) / income) * 100 : null;

  const byCat = {};
  monthFlows.filter((f) => f.kind === "out").forEach((f) => { byCat[f.category] = (byCat[f.category] || 0) + f.amount; });
  const catEntries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const maxCat = catEntries.length ? catEntries[0][1] : 1;

  return (
    <div className="overview">
      <section className="goal-card">
        <div className="goal-top">
          <div>
            <div className="eyebrow">{state.settings.goalName || "Obiettivo"}</div>
            <div className="goal-value">{fmt(goalCapital)} <span className="unit">DKK</span></div>
            <div className="goal-target">su {fmt(GOAL_DKK)} DKK obiettivo</div>
          </div>
          <div className="goal-plane">
            <IconHome size={28} />
            <div className="goal-countdown">Fase {phase.n}</div>
          </div>
        </div>
        <div className="runway">
          <div className="runway-fill" style={{ width: `${goalProgress}%` }} />
          <div className="runway-marker" style={{ left: `${goalProgress}%` }} />
        </div>
        <div className="runway-caption">
          {goalProgress.toFixed(1)}% · {phase.n < lastN ? `mancano ${fmt(toNext)} DKK alla soglia ${fmt(nextThreshold / 1000)}k` : goalCapital >= GOAL_DKK ? "obiettivo raggiunto" : `mancano ${fmt(toNext)} DKK all'obiettivo`}
        </div>
        <div className="goal-breakdown">
          Investito {fmt(goal.inv)} · Depositi {fmt(goal.dep)} · Liquidità dedicata {fmt(goal.cash)}
        </div>
      </section>

      {nearNext && nextPhase && (
        <div className="alert-card">
          <strong>Soglia vicina.</strong> Mancano {fmt(toNext)} DKK alla fase {nextPhase.n}: prepara il ribilanciamento verso azionario {nextPhase.eq}% / difensivo {100 - nextPhase.eq}%.
        </div>
      )}

      <section className="panel">
        <div className="panel-title"><IconTarget size={16} /> Glide-path</div>
        <div className="phase-list">
          {PHASES.map((p) => (
            <div key={p.n} className={"phase-row" + (p.n === phase.n ? " current" : "")}>
              <span className="phase-n">Fase {p.n}</span>
              <span className="phase-range">{fmt(p.from / 1000)}k – {p.to === Infinity ? "oltre" : `${fmt(p.to / 1000)}k`}</span>
              <span className="phase-target">{p.eq} / {100 - p.eq}</span>
            </div>
          ))}
        </div>
        <div className="kpi-note" style={{ marginTop: 8 }}>Azionario / difensivo (bond + oro). Il de-risking è a senso unico: non si torna indietro se il capitale scende sotto una soglia già superata.</div>
      </section>

      <section className="panel">
        <div className="panel-title"><IconTrend size={16} /> Indicatori chiave</div>
        <div className="kpi-grid">
          <div className="kpi-cell">
            <div className="kpi-icon-wrap kpi-blue"><IconWallet size={16} /></div>
            <div className="kpi-label">Patrimonio netto totale</div>
            <div className="kpi-value">{fmt(netWorthTotal)} <span className="unit-sm">DKK</span></div>
            <div className="kpi-note">Conti + depositi + tutti gli investimenti</div>
          </div>
          <div className="kpi-cell">
            <div className="kpi-icon-wrap kpi-green"><IconTrend size={16} /></div>
            <div className="kpi-label">Tasso di risparmio (mese)</div>
            <div className={"kpi-value" + (savingsRate !== null && savingsRate < 0 ? " kpi-negative" : "")}>
              {savingsRate !== null ? `${savingsRate.toFixed(1)}%` : "—"}
            </div>
            <div className="kpi-note">{savingsRate !== null ? "Entrate non spese: conta solo la tua quota di casa, non le spese del cointestato" : "Nessuna entrata registrata questo mese"}</div>
          </div>
          <div className="kpi-cell">
            <div className="kpi-icon-wrap kpi-amber"><IconHome size={16} /></div>
            <div className="kpi-label">Versato al Fondo Casa (mese)</div>
            <div className="kpi-value">{fmt(savedToGoal)} <span className="unit-sm">DKK</span></div>
            <div className="kpi-note">{income > 0 ? `${((savedToGoal / income) * 100).toFixed(1)}% delle entrate del mese` : "PAC + sweep registrati come trasferimenti"}</div>
          </div>
          <div className="kpi-cell">
            <div className="kpi-icon-wrap kpi-coral"><IconTarget size={16} /></div>
            <div className="kpi-label">Peso azioni aziendali</div>
            <div className="kpi-value">{companyShare.toFixed(1)}%</div>
            <div className="kpi-note">ESPP + RSU sul patrimonio, esclusi dall'obiettivo</div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-title"><IconChart size={16} /> Andamento patrimonio</div>
        <NetWorthChart history={state.netWorthHistory || []} />
      </section>

      <section className="grid-3">
        <StatCard label="Entrate (mese)" value={income} tone="in" />
        <StatCard label="Uscite (mese)" value={expense} tone="out" />
        <StatCard label="Saldo netto (mese)" value={net} tone={net >= 0 ? "in" : "out"} />
      </section>

      {monthsCounted > 0 && (
        <section className="panel">
          <div className="panel-title"><IconChart size={16} /> Medie mensili <span className="panel-title-sub">({monthsCounted} {monthsCounted === 1 ? "mese" : "mesi"} completi)</span></div>
          <div className="grid-3 no-margin">
            <StatCard label="Media entrate" value={avgIncome} tone="in" />
            <StatCard label="Media uscite" value={avgExpense} tone="out" />
            <StatCard label="Media saldo" value={avgIncome - avgExpense} tone={avgIncome - avgExpense >= 0 ? "in" : "out"} />
          </div>
          {avgIncome > 0 && (
            <div className="kpi-cell" style={{ marginTop: "10px", borderBottom: "none", paddingBottom: 0 }}>
              <div className="kpi-label">Tasso di risparmio medio</div>
              <div className="kpi-value">{(((avgIncome - avgExpense) / avgIncome) * 100).toFixed(1)}%</div>
            </div>
          )}
        </section>
      )}

      <section className="grid-2">
        <div className="panel">
          <div className="panel-title"><IconWallet size={16} /> Conti correnti</div>
          {accounts.map((a) => (
            <div key={a.id}>
              <div className="account-row">
                <span className="account-name">{a.name}{a.goal ? " 🏠" : ""}</span>
                <span className={"account-bal" + (a.balance < 0 ? " negative" : "")}>{fmt(a.balance)} DKK</span>
              </div>
              {(a.subaccounts || []).map((sub) => (
                <div className="account-row sub" key={sub.id}>
                  <span className="account-name">↳ {sub.name}{sub.goal ? " 🏠" : ""}</span>
                  <span className={"account-bal" + (sub.balance < 0 ? " negative" : "")}>{fmt(sub.balance)} DKK</span>
                </div>
              ))}
            </div>
          ))}
          <div className="account-row total"><span className="account-name">Totale liquidità</span><span className="account-bal">{fmt(cashTotal)} DKK</span></div>
        </div>

        <div className="panel">
          <div className="panel-title"><IconLandmark size={16} /> Conti deposito</div>
          {deposits.length === 0 && <div className="empty-note">Nessun conto deposito.</div>}
          {deposits.map((d) => (
            <div className="account-row" key={d.id}>
              <span className="account-name">{d.name}{d.goal ? " 🏠" : ""}{d.rate ? <span className="rate-tag">{d.rate}%</span> : null}</span>
              <span className="account-bal">{fmt(d.balance)} DKK</span>
            </div>
          ))}
          <div className="account-row total"><span className="account-name">Totale depositi</span><span className="account-bal">{fmt(depositsTotal)} DKK</span></div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-title"><IconPiggy size={16} /> Investimenti</div>
        {investments.map((i) => (
          <div className="account-row" key={i.id}><span className="account-name">{i.label}{GOAL_BUCKETS.includes(i.bucket) ? " 🏠" : ""}</span><span className="account-bal">{fmt(i.value)} DKK</span></div>
        ))}
        <div className="account-row total"><span className="account-name">Totale investito</span><span className="account-bal">{fmt(totalInvested)} DKK</span></div>
        <div className="kpi-note" style={{ marginTop: 6 }}>🏠 = conta per il Fondo Casa</div>
      </section>

      {shared.size > 0 && (
        <section className="panel">
          <div className="panel-title"><IconHome size={16} /> Conto di casa (mese corrente)</div>
          <div className="account-row"><span className="account-name">Spese di casa</span><span className="account-bal">{fmt(houseSpent)} DKK</span></div>
          <div className="account-row"><span className="account-name">Tua quota versata</span><span className="account-bal">{fmt(quotaMonth)} DKK</span></div>
          <div className="kpi-note" style={{ marginTop: 6 }}>Le spese del cointestato sono della coppia: nelle tue statistiche entra solo la quota che versi.</div>
        </section>
      )}

      <section className="panel">
        <div className="panel-title"><IconTrend size={16} /> Le tue uscite per categoria (mese corrente)</div>
        {catEntries.length === 0 && <div className="empty-note">Nessuna uscita registrata questo mese.</div>}
        {catEntries.map(([cat, val]) => (
          <div className="cat-row" key={cat}>
            <div className="cat-label"><span className="cat-dot" style={{ background: catColor(cat) }} />{cat}</div>
            <div className="cat-bar-track"><div className="cat-bar-fill" style={{ width: `${(val / maxCat) * 100}%`, background: catColor(cat) }} /></div>
            <div className="cat-val">{fmt(val)}</div>
          </div>
        ))}
      </section>
    </div>
  );
}

// ---------- obiettivo e glide-path (valori personali: vivono nelle impostazioni, non nel codice) ----------
function GoalSettings({ settings, onUpdateSettings }) {
  const phases = Array.isArray(settings.phases) && settings.phases.length ? settings.phases : DEFAULT_PHASES;
  const setPhases = (next) => onUpdateSettings({ phases: next });
  const edit = (i, key, value) => {
    const v = value === "" ? 0 : parseFloat(value) || 0;
    setPhases(phases.map((p, j) => (j === i ? { ...p, [key]: key === "to" ? v * 1000 : v } : p)));
  };
  const addPhase = () => {
    const prevTo = phases.length > 1 ? phases[phases.length - 2].to || 0 : 0;
    const body = phases.slice(0, -1);
    const last = phases[phases.length - 1];
    setPhases([...body, { to: prevTo + 100000, eq: last.eq }, { to: null, eq: last.eq }]);
  };
  const removePhase = (i) => {
    if (phases.length <= 1) return;
    const next = phases.filter((_, j) => j !== i);
    next[next.length - 1] = { ...next[next.length - 1], to: null };
    setPhases(next);
  };
  let from = 0;
  return (
    <div className="goal-settings">
      <div className="panel-subtitle">Obiettivo e glide-path</div>
      <div className="detail-field-row"><label>Nome obiettivo</label><input type="text" id="set-goal-name" value={settings.goalName || ""} onChange={(e) => onUpdateSettings({ goalName: e.target.value })} /></div>
      <div className="detail-field-row"><label>Obiettivo DKK</label><input type="number" id="set-goal" value={settings.goal} onChange={(e) => onUpdateSettings({ goal: parseFloat(e.target.value) || 0 })} /></div>
      <div className="phase-editor">
        {phases.map((p, i) => {
          const last = i === phases.length - 1;
          const row = (
            <div className="phase-edit-row" key={i}>
              <span className="phase-n">Fase {i + 1}</span>
              <span className="cell">{fmt(from / 1000)}k →{" "}
                {last ? <span>oltre</span> : (
                  <><input type="number" aria-label={`Soglia fase ${i + 1} in migliaia`} value={Math.round((p.to || 0) / 1000)} onChange={(e) => edit(i, "to", e.target.value)} />k</>
                )}
              </span>
              <span className="cell">az.</span>
              <span className="cell"><input type="number" aria-label={`Azionario fase ${i + 1} in percentuale`} value={p.eq} onChange={(e) => edit(i, "eq", e.target.value)} />%</span>
              {phases.length > 1 ? <button type="button" className="phase-del" aria-label={`Elimina fase ${i + 1}`} onClick={() => removePhase(i)}>×</button> : <span />}
            </div>
          );
          if (!last) from = p.to || 0;
          return row;
        })}
        <button type="button" className="manage-cat-link" onClick={addPhase}>+ Aggiungi fase</button>
      </div>
      <div className="detail-field-row"><label>Stipendio nel CSV</label><input type="text" id="set-salary-kw" placeholder="parola chiave" value={settings.salaryKeyword || ""} onChange={(e) => onUpdateSettings({ salaryKeyword: e.target.value })} /></div>
      <div className="panel-subtitle">Piano mensile</div>
    </div>
  );
}

// ---------- piano mensile: PAC %, Extra %, trading, sweep oltre il buffer, ripartizione Saxo/Revolut ----------
function MonthlyPlan({ state, accountNames, onUpdateSettings, onRegister }) {
  const st = state.settings;
  const lastSalary = state.transactions.find((t) => t.type === "in" && t.category === "Stipendio");
  const [salary, setSalary] = useState(lastSalary ? String(lastSalary.amount) : "");
  const [mainBal, setMainBal] = useState(String(Math.round(getBalance(state.accounts, st.mainAccount) * 100) / 100));
  const [showSettings, setShowSettings] = useState(false);
  const [done, setDone] = useState(false);

  const net = parseFloat(String(salary).replace(",", ".")) || 0;
  const bal = parseFloat(String(mainBal).replace(",", ".")) || 0;
  const pac = (net * st.pacPct) / 100;
  const extra = (net * st.extraPct) / 100;
  const trading = net > 0 ? st.trading : 0;
  const sweep = Math.max(0, bal - pac - extra - trading - st.buffer);
  const toInvest = pac + sweep;
  const saxo = (toInvest * st.saxoPct) / 100;
  const revolut = toInvest - saxo;
  const leftover = bal - pac - extra - trading - sweep;
  const shortfall = leftover < st.buffer - 0.5;

  const r2 = (n) => Math.round(n * 100) / 100;
  const register = () => {
    const date = todayISO();
    const mk = date.slice(0, 7);
    const txs = [];
    const add = (from, to, amount, note) => { if (amount > 0.004) txs.push({ date, type: "transfer", account: from, toAccount: to, category: "Trasferimento", amount: r2(amount), note }); };
    add(st.mainAccount, st.extraAccount, extra, `Extra ${st.extraPct}% ${mk}`);
    add(st.mainAccount, st.tradingAccount, trading, `Trading ${mk}`);
    add(st.mainAccount, st.investAccount, toInvest, `PAC ${st.pacPct}% + sweep ${mk}`);
    add(st.investAccount, "Saxo (broker)", saxo, `Acquisto Saxo ${mk}`);
    add(st.investAccount, "Revolut (broker)", revolut, `Acquisto Revolut ${mk}`);
    onRegister(txs);
    setDone(true);
  };

  const num = (key) => (e) => onUpdateSettings({ [key]: parseFloat(e.target.value) || 0 });
  const acc = (key) => (e) => onUpdateSettings({ [key]: e.target.value });

  return (
    <div className="plan">
      <div className="panel">
        <div className="panel-title"><IconSwap size={16} /> Piano del 25 del mese</div>
        <div className="detail-field-row">
          <label>Netto in busta</label>
          <input type="number" inputMode="decimal" value={salary} onChange={(e) => { setSalary(e.target.value); setDone(false); }} placeholder="0" />
        </div>
        <div className="detail-field-row">
          <label>Saldo {st.mainAccount}</label>
          <input type="number" inputMode="decimal" value={mainBal} onChange={(e) => { setMainBal(e.target.value); setDone(false); }} />
        </div>
        <div className="kpi-note">Saldo dopo l'accredito dello stipendio. Precompilato con il saldo attuale in Libretto.</div>

        <div className="plan-table">
          <PlanRow label={`PAC ${st.pacPct}%`} value={pac} to={st.investAccount} />
          <PlanRow label={`Extra ${st.extraPct}% (viaggi)`} value={extra} to={st.extraAccount} />
          <PlanRow label="Trading" value={trading} to={st.tradingAccount} />
          <PlanRow label={`Sweep oltre ${fmt(st.buffer)}`} value={sweep} to={st.investAccount} />
          <div className="plan-sep" />
          <PlanRow label="Da investire" value={toInvest} strong />
          <PlanRow label={`Saxo ${st.saxoPct}%`} value={saxo} to="Saxo (broker)" />
          <PlanRow label={`Revolut ${100 - st.saxoPct}%`} value={revolut} to="Revolut (broker)" sub={`≈ ${fmt(revolut / st.eurDkk)} EUR`} />
          <div className="plan-sep" />
          <PlanRow label={`Resta su ${st.mainAccount}`} value={leftover} strong />
        </div>

        {shortfall && net > 0 && (
          <div className="alert-card warn">Dopo PAC, Extra e trading il conto scende sotto il buffer di {fmt(st.buffer)} DKK: nessuno sweep questo mese.</div>
        )}

        <button className="btn-add" disabled={net <= 0 || done} onClick={register}>
          <IconSwap size={16} /> {done ? "Trasferimenti registrati" : "Registra i trasferimenti"}
        </button>
        <div className="kpi-note" style={{ marginTop: 8 }}>
          Crea i trasferimenti in Movimenti e aggiorna i saldi. I versamenti verso Saxo e Revolut aumentano subito il valore dei rispettivi investimenti; dopo l'acquisto sostituiscilo con il valore reale dal broker.
        </div>
      </div>

      <div className="panel">
        <button className="manage-cat-link" onClick={() => setShowSettings((v) => !v)}>{showSettings ? "Nascondi impostazioni" : "Impostazioni del piano"}</button>
        {showSettings && (
          <div>
            <GoalSettings settings={st} onUpdateSettings={onUpdateSettings} />
            <div className="detail-field-row"><label>PAC % del netto</label><input type="number" value={st.pacPct} onChange={num("pacPct")} /></div>
            <div className="detail-field-row"><label>Extra % del netto</label><input type="number" value={st.extraPct} onChange={num("extraPct")} /></div>
            <div className="detail-field-row"><label>Trading DKK/mese</label><input type="number" value={st.trading} onChange={num("trading")} /></div>
            <div className="detail-field-row"><label>Buffer conto</label><input type="number" value={st.buffer} onChange={num("buffer")} /></div>
            <div className="detail-field-row"><label>Quota Saxo %</label><input type="number" value={st.saxoPct} onChange={num("saxoPct")} /></div>
            <div className="detail-field-row"><label>Cambio EUR/DKK</label><input type="number" step="0.01" value={st.eurDkk} onChange={num("eurDkk")} /></div>
            {[["mainAccount", "Conto stipendio"], ["investAccount", "Conto investimenti"], ["extraAccount", "Conto Extra"], ["tradingAccount", "Conto trading"]].map(([k, l]) => (
              <div className="detail-field-row" key={k}>
                <label>{l}</label>
                <select value={st[k]} onChange={acc(k)}>
                  {(accountNames.includes(st[k]) ? accountNames : [st[k], ...accountNames]).map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PlanRow({ label, value, to, strong, sub }) {
  return (
    <div className={"plan-row" + (strong ? " strong" : "")}>
      <div>
        <div className="plan-label">{label}</div>
        {(to || sub) && <div className="plan-to">{to ? `→ ${to}` : ""}{to && sub ? " · " : ""}{sub || ""}</div>}
      </div>
      <div className="plan-val">{fmt(value)} DKK</div>
    </div>
  );
}

function StatCard({ label, value, tone }) {
  return (
    <div className={"stat-card " + tone}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{fmt(value)} <span className="unit-sm">DKK</span></div>
    </div>
  );
}

function NetWorthChart({ history }) {
  const [range, setRange] = useState("6m");
  const [hoverIdx, setHoverIdx] = useState(null);

  const now = new Date();
  const cutoffDays = range === "3m" ? 90 : range === "6m" ? 180 : range === "1a" ? 365 : 100000;
  const cutoff = new Date(now.getTime() - cutoffDays * 86400000);
  const filtered = history.filter((h) => new Date(h.date) >= cutoff);
  const points = filtered.length >= 2 ? filtered : history;

  if (points.length < 2) {
    return (
      <div>
        <div className="chart-empty">Servono almeno due rilevazioni per mostrare l'andamento. Torna a controllare tra qualche giorno — nel frattempo ogni apertura registra un punto.</div>
      </div>
    );
  }

  const W = 600, H = 180, PAD = 8;
  const values = points.map((p) => p.value);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const spread = maxV - minV || 1;

  const xAt = (i) => PAD + (i / (points.length - 1)) * (W - PAD * 2);
  const yAt = (v) => H - PAD - ((v - minV) / spread) * (H - PAD * 2);

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yAt(p.value).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L ${xAt(points.length - 1).toFixed(1)} ${H - PAD} L ${xAt(0).toFixed(1)} ${H - PAD} Z`;

  const handleMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX ?? (e.touches && e.touches[0].clientX)) - rect.left) / rect.width;
    const idx = Math.round(relX * (points.length - 1));
    setHoverIdx(Math.max(0, Math.min(points.length - 1, idx)));
  };

  const hp = hoverIdx !== null ? points[hoverIdx] : points[points.length - 1];
  const hx = hoverIdx !== null ? xAt(hoverIdx) : xAt(points.length - 1);

  return (
    <div className="chart-wrap">
      <div className="chart-range-row">
        {[["3m", "3 mesi"], ["6m", "6 mesi"], ["1a", "1 anno"], ["tutto", "Tutto"]].map(([key, label]) => (
          <button key={key} className={"chip" + (range === key ? " active" : "")} onClick={() => setRange(key)}>{label}</button>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "auto", display: "block" }}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIdx(null)}
        onTouchMove={handleMove}
        onTouchEnd={() => setHoverIdx(null)}
      >
        <defs>
          <linearGradient id="nwFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#12213A" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#12213A" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#nwFill)" />
        <path d={linePath} fill="none" stroke="#12213A" strokeWidth="2" />
        {hp && <line x1={hx} y1="0" x2={hx} y2={H} stroke="#C7752F" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />}
        {hp && <circle cx={hx} cy={yAt(hp.value)} r="4" fill="#C7752F" />}
      </svg>
      {hp && (
        <div className="chart-tooltip" style={{ left: `${(hx / W) * 100}%`, top: 0 }}>
          {hp.date}: {fmt(hp.value)} DKK
        </div>
      )}
    </div>
  );
}

function QuickAdd({ accountNames, categoriesOut, categoriesIn, onAdd, onClose }) {
  const accounts = accountNames.length ? accountNames : ["Revolut", "Lunar"];
  const [type, setType] = useState("out");
  const [amount, setAmount] = useState("");
  const [account, setAccount] = useState(accounts[0]);
  const [toAccount, setToAccount] = useState(accounts[1] || accounts[0]);
  const [category, setCategory] = useState(categoriesOut[0]);

  const cats = type === "in" ? categoriesIn : categoriesOut;
  const targets = [...accounts, ...Object.keys(EXTERNAL_TARGETS)].filter((a) => a !== account);

  const submit = () => {
    const amt = parseFloat(String(amount).replace(",", "."));
    if (!amt || amt <= 0) return;
    if (type === "transfer") {
      if (!toAccount || toAccount === account) return;
      onAdd({ date: todayISO(), account, toAccount, type, category: "Trasferimento", amount: amt, note: "" });
    } else {
      onAdd({ date: todayISO(), account, type, category, amount: amt, note: "" });
    }
  };

  return (
    <div className="quick-add-overlay" onClick={onClose}>
      <div className="quick-add-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="quick-add-title">
          Movimento rapido
          <button className="quick-add-close" onClick={onClose}><IconX size={20} /></button>
        </div>

        <div className="quick-add-typerow">
          <button className={"quick-add-typebtn out" + (type === "out" ? " active" : "")} onClick={() => { setType("out"); setCategory(categoriesOut[0]); }}>Uscita</button>
          <button className={"quick-add-typebtn in" + (type === "in" ? " active" : "")} onClick={() => { setType("in"); setCategory(categoriesIn[0]); }}>Entrata</button>
          <button className={"quick-add-typebtn transfer" + (type === "transfer" ? " active" : "")} onClick={() => setType("transfer")}>Trasferimento</button>
        </div>

        <input
          className="quick-add-amount"
          type="number"
          inputMode="decimal"
          placeholder="0"
          autoFocus
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />

        {type !== "transfer" && (
          <div className="quick-add-chiprow">
            {cats.map((c) => (
              <button
                key={c}
                className={"chip" + (category === c ? " active" : "")}
                style={category === c ? { background: catColor(c), borderColor: catColor(c) } : undefined}
                onClick={() => setCategory(c)}
              >{c}</button>
            ))}
          </div>
        )}
        {type === "transfer" && <div className="chip-caption">Da</div>}
        <div className="quick-add-chiprow">
          {accounts.map((a) => (
            <button key={a} className={"chip" + (account === a ? " active" : "")} onClick={() => setAccount(a)}>{a}</button>
          ))}
        </div>
        {type === "transfer" && (
          <>
            <div className="chip-caption">A</div>
            <div className="quick-add-chiprow">
              {targets.map((a) => (
                <button key={a} className={"chip" + (toAccount === a ? " active" : "")} onClick={() => setToAccount(a)}>{a}</button>
              ))}
            </div>
          </>
        )}

        <button className="btn-add" onClick={submit}><IconPlus size={16} /> Salva movimento</button>
      </div>
    </div>
  );
}

function SharedToggle({ on, onClick }) {
  return (
    <button className={"goal-toggle" + (on ? " on shared" : "")} onClick={onClick} title="Conto di casa (condiviso)" aria-label="Conto di casa (condiviso)">👥</button>
  );
}

function GoalToggle({ on, onClick }) {
  return (
    <button className={"goal-toggle" + (on ? " on" : "")} onClick={onClick} title="Conta per il Fondo Casa" aria-label="Conta per il Fondo Casa">🏠</button>
  );
}

function Accounts({ accounts, deposits, onToggleAccountShared, onToggleSubShared, onUpdateBalance, onToggleAccountGoal, onAddAccount, onDeleteAccount, onAddSubaccount, onUpdateSubBalance, onToggleSubGoal, onDeleteSubaccount, onAddDeposit, onUpdateDeposit, onDeleteDeposit }) {
  const [newAccountName, setNewAccountName] = useState("");
  const [subInputs, setSubInputs] = useState({});
  const [newDeposit, setNewDeposit] = useState({ name: "", balance: "", rate: "", note: "" });

  const submitAccount = (e) => { e.preventDefault(); if (!newAccountName.trim()) return; onAddAccount(newAccountName.trim()); setNewAccountName(""); };
  const submitSub = (accountId) => {
    const name = (subInputs[accountId] || "").trim();
    if (!name) return;
    onAddSubaccount(accountId, name);
    setSubInputs((s) => ({ ...s, [accountId]: "" }));
  };
  const submitDeposit = (e) => {
    e.preventDefault();
    const bal = parseFloat(newDeposit.balance);
    if (!newDeposit.name.trim() || isNaN(bal)) return;
    onAddDeposit({ name: newDeposit.name.trim(), balance: bal, rate: parseFloat(newDeposit.rate) || 0, note: newDeposit.note.trim(), goal: false });
    setNewDeposit({ name: "", balance: "", rate: "", note: "" });
  };

  return (
    <div className="accounts-page">
      <div className="kpi-note" style={{ marginBottom: 10 }}>🏠 attivo = il saldo conta per il Fondo Casa (attivalo sui conti e depositi dedicati). 👥 attivo = conto di casa condiviso: le sue spese restano fuori dalle tue statistiche e conta solo la quota che versi.</div>
      <div className="panel">
        <div className="panel-title"><IconWallet size={16} /> Conti correnti</div>
        {accounts.map((a) => (
          <div className="account-block" key={a.id}>
            <div className="account-block-header">
              <input type="number" className="balance-input main" value={a.balance} onChange={(e) => onUpdateBalance(a.id, parseFloat(e.target.value) || 0)} />
              <span className="account-block-name">{a.name}</span>
              <span className="dkk-tag">DKK</span>
              <GoalToggle on={a.goal} onClick={() => onToggleAccountGoal(a.id)} />
              <SharedToggle on={a.shared} onClick={() => onToggleAccountShared(a.id)} />
              <button className="tx-delete" onClick={() => onDeleteAccount(a.id)} aria-label="Elimina conto"><IconTrash size={14} /></button>
            </div>
            {(a.subaccounts || []).map((sub) => (
              <div className="account-block-header sub" key={sub.id}>
                <input type="number" className="balance-input" value={sub.balance} onChange={(e) => onUpdateSubBalance(a.id, sub.id, parseFloat(e.target.value) || 0)} />
                <span className="account-block-name">↳ {sub.name}</span>
                <span className="dkk-tag">DKK</span>
                <GoalToggle on={sub.goal} onClick={() => onToggleSubGoal(a.id, sub.id)} />
                <SharedToggle on={sub.shared} onClick={() => onToggleSubShared(a.id, sub.id)} />
                <button className="tx-delete" onClick={() => onDeleteSubaccount(a.id, sub.id)} aria-label="Elimina sottoconto"><IconTrash size={14} /></button>
              </div>
            ))}
            <div className="sub-add-row">
              <input type="text" placeholder={`Nuovo sottoconto di ${a.name}`} value={subInputs[a.id] || ""} onChange={(e) => setSubInputs((s) => ({ ...s, [a.id]: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && submitSub(a.id)} />
              <button type="button" className="btn-mini" onClick={() => submitSub(a.id)}><IconPlus size={13} /></button>
            </div>
          </div>
        ))}
        <form className="inline-add-form" onSubmit={submitAccount}>
          <input type="text" placeholder="Nome nuovo conto (es. Wise)" value={newAccountName} onChange={(e) => setNewAccountName(e.target.value)} />
          <button type="submit" className="btn-add"><IconPlus size={16} /> Aggiungi conto</button>
        </form>
      </div>

      <div className="panel">
        <div className="panel-title"><IconLandmark size={16} /> Conti deposito</div>
        {deposits.length === 0 && <div className="empty-note">Nessun conto deposito registrato.</div>}
        {deposits.map((d) => (
          <div className="deposit-block" key={d.id}>
            <div className="deposit-row-1">
              <input type="text" className="deposit-name-input" value={d.name} onChange={(e) => onUpdateDeposit(d.id, { name: e.target.value })} />
              <GoalToggle on={d.goal} onClick={() => onUpdateDeposit(d.id, { goal: !d.goal })} />
              <button className="tx-delete" onClick={() => onDeleteDeposit(d.id)} aria-label="Elimina deposito"><IconTrash size={14} /></button>
            </div>
            <div className="deposit-row-2">
              <div className="deposit-field"><label>Saldo</label><input type="number" value={d.balance} onChange={(e) => onUpdateDeposit(d.id, { balance: parseFloat(e.target.value) || 0 })} /></div>
              <div className="deposit-field"><label>Tasso %</label><input type="number" step="0.01" value={d.rate} onChange={(e) => onUpdateDeposit(d.id, { rate: parseFloat(e.target.value) || 0 })} /></div>
            </div>
          </div>
        ))}
        <form className="tx-form" onSubmit={submitDeposit}>
          <div className="tx-form-row">
            <input type="text" placeholder="Nome (es. Deposito 6 mesi)" value={newDeposit.name} onChange={(e) => setNewDeposit((s) => ({ ...s, name: e.target.value }))} />
            <input type="number" placeholder="Saldo DKK" value={newDeposit.balance} onChange={(e) => setNewDeposit((s) => ({ ...s, balance: e.target.value }))} />
            <input type="number" step="0.01" placeholder="Tasso %" value={newDeposit.rate} onChange={(e) => setNewDeposit((s) => ({ ...s, rate: e.target.value }))} />
          </div>
          <button type="submit" className="btn-add"><IconPlus size={16} /> Aggiungi conto deposito</button>
        </form>
      </div>
    </div>
  );
}

function Movements({ state, transactions, accountNames, categoriesOut, categoriesIn, onAdd, onImport, onAddRules, onDeleteRule, onDelete, onUpdate, onAddCategory, onDeleteCategory }) {
  const accounts = accountNames.length ? accountNames : ["Revolut", "Lunar"];
  const [form, setForm] = useState({ date: todayISO(), account: accounts[0], toAccount: accounts[1] || accounts[0], type: "out", category: categoriesOut[0], amount: "", note: "" });
  const [filterAccount, setFilterAccount] = useState("Tutti");
  const [filterCategory, setFilterCategory] = useState("Tutte");
  const [filterMonth, setFilterMonth] = useState("Tutti");
  const [selectedId, setSelectedId] = useState(null);
  const [manageCatOpen, setManageCatOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const submit = (e) => {
    e.preventDefault();
    const amt = parseFloat(form.amount);
    if (!amt || amt <= 0) return;
    if (form.type === "transfer") {
      if (form.toAccount === form.account) return;
      onAdd({ date: form.date, account: form.account, toAccount: form.toAccount, type: "transfer", category: "Trasferimento", amount: amt, note: form.note });
    } else {
      const { toAccount, ...rest } = form;
      onAdd({ ...rest, amount: amt });
    }
    setForm((f) => ({ ...f, amount: "", note: "" }));
  };

  const cats = form.type === "in" ? categoriesIn : categoriesOut;
  const allCats = Array.from(new Set([...categoriesOut, ...categoriesIn, "Trasferimento"]));
  const targets = [...accounts, ...Object.keys(EXTERNAL_TARGETS)].filter((a) => a !== form.account);

  // mesi disponibili nei movimenti, più recenti prima
  const months = Array.from(new Set(transactions.map((t) => t.date.slice(0, 7)))).sort().reverse();
  const monthLabel = (mk) => {
    const [y, m] = mk.split("-");
    const names = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];
    return `${names[parseInt(m, 10) - 1]} ${y}`;
  };

  const filtered = transactions.filter((t) =>
    (filterAccount === "Tutti" || t.account === filterAccount || t.toAccount === filterAccount) &&
    (filterCategory === "Tutte" || t.category === filterCategory) &&
    (filterMonth === "Tutti" || t.date.slice(0, 7) === filterMonth)
  );
  const selectedTx = transactions.find((t) => t.id === selectedId) || null;

  return (
    <div className="movements">
      <button className="btn-import" onClick={() => setImportOpen(true)}><IconUpload size={16} /> Importa estratto conto (CSV)</button>

      <form className="tx-form" onSubmit={submit}>
        <div className="tx-form-row">
          <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value, category: e.target.value === "in" ? categoriesIn[0] : categoriesOut[0] }))}>
            <option value="out">Uscita</option>
            <option value="in">Entrata</option>
            <option value="transfer">Trasferimento</option>
          </select>
          <select value={form.account} onChange={(e) => setForm((f) => ({ ...f, account: e.target.value }))}>
            {accounts.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          {form.type === "transfer" ? (
            <select value={form.toAccount} onChange={(e) => setForm((f) => ({ ...f, toAccount: e.target.value }))}>
              {targets.map((a) => <option key={a} value={a}>→ {a}</option>)}
            </select>
          ) : (
            <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
              {cats.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
        </div>
        <div className="tx-form-row">
          <input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
          <input type="number" step="0.01" placeholder="Importo DKK" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
          <input type="text" placeholder="Nota (opzionale)" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
        </div>
        <button type="submit" className="btn-add"><IconPlus size={16} /> Aggiungi movimento</button>
      </form>

      <div className="filter-row">
        <span className="filter-label">Conto:</span>
        {["Tutti", ...accounts].map((a) => (
          <button key={a} className={"chip" + (filterAccount === a ? " active" : "")} onClick={() => setFilterAccount(a)}>{a}</button>
        ))}
      </div>

      <div className="filter-row">
        <span className="filter-label">Categoria:</span>
        <button className={"chip" + (filterCategory === "Tutte" ? " active" : "")} onClick={() => setFilterCategory("Tutte")}>Tutte</button>
        {allCats.map((c) => (
          <button
            key={c}
            className={"chip" + (filterCategory === c ? " active" : "")}
            style={filterCategory === c ? { background: catColor(c), borderColor: catColor(c) } : undefined}
            onClick={() => setFilterCategory(c)}
          >{c}</button>
        ))}
      </div>

      {months.length > 0 && (
        <div className="filter-row">
          <span className="filter-label">Mese:</span>
          <button className={"chip" + (filterMonth === "Tutti" ? " active" : "")} onClick={() => setFilterMonth("Tutti")}>Tutti</button>
          {months.map((mk) => (
            <button key={mk} className={"chip" + (filterMonth === mk ? " active" : "")} onClick={() => setFilterMonth(mk)}>{monthLabel(mk)}</button>
          ))}
        </div>
      )}

      <button className="manage-cat-link" onClick={() => setManageCatOpen(true)}>Gestisci categorie e regole</button>

      <div className="tx-list">
        {filtered.length === 0 && <div className="empty-note">Nessun movimento registrato.</div>}
        {filtered.map((t) => (
          <div className="tx-row clickable" key={t.id} onClick={() => setSelectedId(t.id)}>
            <div className="tx-date">{t.date}</div>
            <div className="tx-account">{t.type === "transfer" ? `${t.account} → ${t.toAccount}` : t.account}</div>
            <div className="tx-cat"><span className="cat-dot" style={{ background: catColor(t.category) }} />{t.category}</div>
            <div className="tx-note">{t.note}</div>
            <div className={"tx-amount " + t.type}>{t.type === "in" ? "+" : t.type === "out" ? "−" : "⇄ "}{fmt(t.amount)}</div>
            <button
              className="tx-delete"
              onClick={(e) => { e.stopPropagation(); onDelete(t.id); }}
              aria-label="Elimina"
            ><IconTrash size={14} /></button>
          </div>
        ))}
      </div>

      {selectedTx && (
        <TransactionDetail
          tx={selectedTx}
          accounts={accounts}
          categoriesOut={categoriesOut}
          categoriesIn={categoriesIn}
          onUpdate={(patch) => onUpdate(selectedTx.id, patch)}
          onDelete={() => { onDelete(selectedTx.id); setSelectedId(null); }}
          onClose={() => setSelectedId(null)}
        />
      )}

      {manageCatOpen && (
        <ManageCategories
          categoriesOut={categoriesOut}
          categoriesIn={categoriesIn}
          rules={state.rules}
          onAddCategory={onAddCategory}
          onDeleteCategory={onDeleteCategory}
          onAddRules={onAddRules}
          onDeleteRule={onDeleteRule}
          onClose={() => setManageCatOpen(false)}
        />
      )}

      {importOpen && (
        <CsvImport
          state={state}
          accounts={accounts}
          onImport={(txs, upd, rules) => { onImport(txs, upd); if (rules.length) onAddRules(rules); }}
          onClose={() => setImportOpen(false)}
        />
      )}
    </div>
  );
}

// ---------- import estratto conto CSV ----------
function CsvImport({ state, accounts, onImport, onClose }) {
  const [step, setStep] = useState("file");
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState([]);
  const [header, setHeader] = useState([]);
  const [cols, setCols] = useState({});
  const [account, setAccount] = useState(accounts.includes("Lunar") ? "Lunar" : accounts[0]);
  const [updateBalances, setUpdateBalances] = useState(true);
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const { categoriesOut, categoriesIn, rules, settings } = state;
  const transferOptions = [...accounts, ...Object.keys(EXTERNAL_TARGETS)];

  const readFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setFileName(file.name);
    if (/revolut/i.test(file.name) && accounts.includes("Revolut")) setAccount("Revolut");
    if (/lunar/i.test(file.name) && accounts.includes("Lunar")) setAccount("Lunar");
    const reader = new FileReader();
    reader.onload = (evt) => {
      const all = parseCSV(String(evt.target.result));
      if (all.length < 2) { setError("Il file non contiene righe leggibili."); return; }
      setHeader(all[0]);
      setRows(all.slice(1));
      setCols(guessColumns(all[0]));
      setError("");
      setStep("map");
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const buildItems = () => {
    if (cols.date < 0 || cols.amount < 0) { setError("Indica almeno le colonne data e importo."); return; }
    // doppioni: ogni movimento esistente può "coprire" una sola riga del CSV
    const used = new Set();
    const findDup = (date, type, abs, extId) => {
      if (extId) {
        const same = state.transactions.find((t) => t.extId === extId);
        if (same) { used.add(same.id); return { level: "imported", tx: same }; }
      }
      const d0 = new Date(date);
      let near = null;
      for (const t of state.transactions) {
        if (used.has(t.id)) continue;
        const dec = (t.type === "out" || t.type === "transfer") && t.account === account;
        const inc = (t.type === "in" && t.account === account) || (t.type === "transfer" && t.toAccount === account);
        if (type === "out" ? !dec : !inc) continue;
        const days = Math.abs(new Date(t.date) - d0) / 86400000;
        const diff = Math.abs(t.amount - abs);
        if (days <= 1 && diff < 0.01) { used.add(t.id); return { level: "exact", tx: t }; }
        if (!near && days <= 3 && diff <= Math.max(1, abs * 0.015)) near = t;
      }
      if (near) { used.add(near.id); return { level: "near", tx: near }; }
      return null;
    };
    const out = [];
    rows.forEach((r, idx) => {
      const date = parseDate(r[cols.date]);
      let amount = parseNum(r[cols.amount]);
      if (!date || isNaN(amount) || amount === 0) return;
      const stateVal = cols.state >= 0 ? String(r[cols.state] || "").toUpperCase() : "";
      if (/REVERTED|DECLINED|FAILED|ANNULL|RIFIUT|STORNO|PENDING|IN SOSPESO/.test(stateVal)) return;
      const fee = cols.fee >= 0 ? Math.abs(parseNum(r[cols.fee])) || 0 : 0;
      const currency = cols.currency >= 0 ? String(r[cols.currency] || "").trim().toUpperCase() : "DKK";
      let rate = 1, fxNote = "";
      if (currency && currency !== "DKK") {
        if (currency === "EUR") { rate = settings.eurDkk; fxNote = ` (${Math.abs(amount).toFixed(2)} EUR)`; }
        else fxNote = ` (${currency}: verificare il cambio)`;
      }
      const type = amount > 0 ? "in" : "out";
      const abs = Math.round((Math.abs(amount) + (type === "out" ? fee : 0)) * rate * 100) / 100;
      const title = cols.desc >= 0 ? String(r[cols.desc] || "").trim() : "";
      const userNote = cols.note >= 0 ? String(r[cols.note] || "").trim() : "";
      const desc = userNote ? `${title} – ${userNote}` : title;
      const extId = cols.extId >= 0 ? String(r[cols.extId] || "").trim() : "";
      const kindRaw = cols.kind >= 0 ? String(r[cols.kind] || "").toUpperCase() : "";
      const isTransfer = looksLikeTransfer(kindRaw, title);
      const dup = findDup(date, type, abs, extId);
      const category = suggestCategory(desc, type, rules, categoriesOut, categoriesIn, settings.salaryKeyword);
      out.push({
        key: idx, date, type, amount: abs, desc, note: (desc + fxNote).slice(0, 60), extId,
        category, suggested: category, dup,
        kind: isTransfer ? "transfer" : "normal",
        other: isTransfer ? guessOther(title, account, transferOptions) : transferOptions.find((o) => o !== account),
        action: dup ? "skip" : "import",
      });
    });
    out.sort((a, b) => (a.date < b.date ? 1 : -1));
    if (out.length === 0) { setError("Nessun movimento valido trovato con queste colonne."); return; }
    setItems(out);
    setError("");
    setStep("review");
  };

  const setItem = (key, patch) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  const toImport = items.filter((i) => i.action === "import");
  const totOut = toImport.filter((i) => i.type === "out" && i.kind === "normal").reduce((a, i) => a + i.amount, 0);
  const totIn = toImport.filter((i) => i.type === "in" && i.kind === "normal").reduce((a, i) => a + i.amount, 0);
  const totTr = toImport.filter((i) => i.kind === "transfer").reduce((a, i) => a + i.amount, 0);

  const confirm = () => {
    const extra = updateBalances ? {} : { noBalance: true };
    const txs = toImport.map((i) => {
      const base = { date: i.date, amount: i.amount, note: i.note, source: "csv", ...(i.extId ? { extId: i.extId } : {}), ...extra };
      if (i.kind === "transfer") {
        const from = i.type === "out" ? account : i.other;
        const to = i.type === "out" ? i.other : account;
        return { ...base, type: "transfer", account: from, toAccount: to, category: "Trasferimento" };
      }
      return { ...base, type: i.type, account, category: i.category };
    });
    // impara una regola quando l'utente corregge la categoria proposta
    const learned = [];
    toImport.forEach((i) => {
      if (i.kind === "normal" && i.type === "out" && i.category !== i.suggested) {
        const k = ruleKeyFor(i.desc);
        if (k && !learned.some((r) => r.match === k)) learned.push({ match: k, category: i.category });
      }
    });
    onImport(txs, updateBalances, learned);
    alert(`Importati ${txs.length} movimenti${learned.length ? ` · ${learned.length} nuove regole di categoria` : ""}.`);
    onClose();
  };

  const colSelect = (k, label, optional) => (
    <div className="detail-field-row" key={k}>
      <label>{label}</label>
      <select value={cols[k]} onChange={(e) => setCols((c) => ({ ...c, [k]: parseInt(e.target.value, 10) }))}>
        <option value={-1}>{optional ? "— nessuna —" : "— scegli —"}</option>
        {header.map((h, i) => <option key={i} value={i}>{h || `Colonna ${i + 1}`}</option>)}
      </select>
    </div>
  );

  const dupLabel = (d) => d.level === "imported" ? "già importato" : d.level === "exact" ? "già presente" : `possibile doppione: ${d.tx.date} ${fmt(d.tx.amount)}${d.tx.note ? " " + d.tx.note : ""}`;

  return (
    <div className="quick-add-overlay" onClick={onClose}>
      <div className="quick-add-sheet import-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="quick-add-title">
          Importa estratto conto
          <button className="quick-add-close" onClick={onClose}><IconX size={20} /></button>
        </div>

        {step === "file" && (
          <>
            <div className="kpi-note" style={{ marginBottom: 12 }}>
              Scarica l'estratto in formato CSV dall'app Revolut o Lunar e selezionalo qui. I movimenti già presenti vengono riconosciuti e saltati; i giroconti (es. Lunar → Revolut, PAC, Extra) vengono proposti come trasferimenti.
            </div>
            <label className="btn-add" style={{ cursor: "pointer" }}>
              <IconUpload size={16} /> Scegli file CSV
              <input type="file" accept=".csv,text/csv,text/plain" style={{ display: "none" }} onChange={readFile} />
            </label>
          </>
        )}

        {step === "map" && (
          <>
            <div className="kpi-note" style={{ marginBottom: 8 }}>{fileName} · {rows.length} righe. Controlla le colonne riconosciute.</div>
            <div className="detail-field-row">
              <label>Conto</label>
              <select value={account} onChange={(e) => setAccount(e.target.value)}>
                {accounts.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            {colSelect("date", "Data")}
            {colSelect("desc", "Descrizione", true)}
            {colSelect("note", "Nota", true)}
            {colSelect("amount", "Importo")}
            {colSelect("fee", "Commissione", true)}
            {colSelect("currency", "Valuta", true)}
            {colSelect("state", "Stato", true)}
            {colSelect("kind", "Tipo", true)}
            {colSelect("extId", "ID transazione", true)}
            <label className="check-row">
              <input type="checkbox" checked={updateBalances} onChange={(e) => setUpdateBalances(e.target.checked)} />
              Aggiorna il saldo del conto con i movimenti importati
            </label>
            <button className="btn-add" onClick={buildItems}>Continua</button>
          </>
        )}

        {step === "review" && (
          <>
            <div className="import-summary">
              {toImport.length} da importare · uscite {fmt(totOut)} · entrate {fmt(totIn)} · trasferimenti {fmt(totTr)} DKK
            </div>
            <div className="import-list">
              {items.map((i) => (
                <div className={"import-row" + (i.action === "skip" ? " skipped" : "")} key={i.key}>
                  <div className="import-top">
                    <span className="import-date">{i.date}</span>
                    <span className="import-desc">{i.desc || "—"}</span>
                    <span className={"tx-amount " + (i.kind === "transfer" ? "transfer" : i.type)}>{i.kind === "transfer" ? "⇄ " : i.type === "in" ? "+" : "−"}{fmt(i.amount)}</span>
                  </div>
                  <div className="import-bottom">
                    <select value={i.kind} onChange={(e) => setItem(i.key, { kind: e.target.value })} disabled={i.action === "skip"}>
                      <option value="normal">{i.type === "in" ? "Entrata" : "Spesa"}</option>
                      <option value="transfer">{i.type === "in" ? "Trasferimento da" : "Trasferimento a"}</option>
                    </select>
                    {i.kind === "transfer" ? (
                      <select value={i.other} onChange={(e) => setItem(i.key, { other: e.target.value })} disabled={i.action === "skip"}>
                        {transferOptions.filter((o) => o !== account).map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <select value={i.category} onChange={(e) => setItem(i.key, { category: e.target.value })} disabled={i.action === "skip"}>
                        {(i.type === "in" ? categoriesIn : categoriesOut).map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    )}
                    <button className={"chip" + (i.action === "import" ? " active" : "")} onClick={() => setItem(i.key, { action: i.action === "import" ? "skip" : "import" })}>
                      {i.action === "import" ? "Importa" : "Salta"}
                    </button>
                  </div>
                  {i.dup && <div className="import-dup"><span className="badge">{dupLabel(i.dup)}</span></div>}
                </div>
              ))}
            </div>
            <div className="kpi-note" style={{ margin: "8px 0" }}>Se correggi una categoria, Libretto la ricorda per i prossimi import. I trasferimenti verso il conto di casa contano come tua "Quota casa".</div>
            <button className="btn-add" disabled={toImport.length === 0} onClick={confirm}>Importa {toImport.length} movimenti</button>
            <button className="manage-cat-link" onClick={() => setStep("map")}>← Indietro</button>
          </>
        )}

        {error && <div className="alert-card warn" style={{ marginTop: 10 }}>{error}</div>}
      </div>
    </div>
  );
}

function TransactionDetail({ tx, accounts, categoriesOut, categoriesIn, onUpdate, onDelete, onClose }) {
  const [draft, setDraft] = useState(tx);

  useEffect(() => { setDraft(tx); }, [tx.id]);

  const cats = draft.type === "in" ? categoriesIn : categoriesOut;
  const targets = [...accounts, ...Object.keys(EXTERNAL_TARGETS)].filter((a) => a !== draft.account);

  const save = () => {
    const amt = parseFloat(draft.amount);
    if (!amt || amt <= 0) return;
    if (draft.type === "transfer" && (!draft.toAccount || draft.toAccount === draft.account)) return;
    onUpdate({ ...draft, amount: amt });
    onClose();
  };

  return (
    <div className="quick-add-overlay" onClick={onClose}>
      <div className="quick-add-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="quick-add-title">
          Dettaglio movimento
          <button className="quick-add-close" onClick={onClose}><IconX size={20} /></button>
        </div>

        <div className="quick-add-typerow">
          <button
            className={"quick-add-typebtn out" + (draft.type === "out" ? " active" : "")}
            onClick={() => setDraft((d) => ({ ...d, type: "out", category: categoriesOut[0] }))}
          >Uscita</button>
          <button
            className={"quick-add-typebtn in" + (draft.type === "in" ? " active" : "")}
            onClick={() => setDraft((d) => ({ ...d, type: "in", category: categoriesIn[0] }))}
          >Entrata</button>
          <button
            className={"quick-add-typebtn transfer" + (draft.type === "transfer" ? " active" : "")}
            onClick={() => setDraft((d) => ({ ...d, type: "transfer", category: "Trasferimento", toAccount: d.toAccount || targets[0] }))}
          >Trasferimento</button>
        </div>

        <input
          className="quick-add-amount"
          type="number"
          inputMode="decimal"
          value={draft.amount}
          onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))}
        />

        <div className="detail-field-row">
          <label>Data</label>
          <input type="date" value={draft.date} onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))} />
        </div>

        <div className="detail-field-row">
          <label>{draft.type === "transfer" ? "Da" : "Conto"}</label>
          <select value={draft.account} onChange={(e) => setDraft((d) => ({ ...d, account: e.target.value }))}>
            {accounts.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>

        {draft.type === "transfer" ? (
          <div className="detail-field-row">
            <label>A</label>
            <select value={draft.toAccount} onChange={(e) => setDraft((d) => ({ ...d, toAccount: e.target.value }))}>
              {targets.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        ) : (
          <div className="quick-add-chiprow">
            {cats.map((c) => (
              <button
                key={c}
                className={"chip" + (draft.category === c ? " active" : "")}
                style={draft.category === c ? { background: catColor(c), borderColor: catColor(c) } : undefined}
                onClick={() => setDraft((d) => ({ ...d, category: c }))}
              >{c}</button>
            ))}
          </div>
        )}

        <div className="detail-field-row">
          <label>Nota</label>
          <input type="text" placeholder="Nota (opzionale)" value={draft.note || ""} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} />
        </div>

        <button className="btn-add" onClick={save}><IconPlus size={16} /> Salva modifiche</button>
        <button className="btn-delete-full" onClick={onDelete}><IconTrash size={14} /> Elimina movimento</button>
      </div>
    </div>
  );
}

function ManageCategories({ categoriesOut, categoriesIn, rules, onAddCategory, onDeleteCategory, onAddRules, onDeleteRule, onClose }) {
  const [tab, setTab] = useState("out");
  const [newName, setNewName] = useState("");
  const [ruleMatch, setRuleMatch] = useState("");
  const [ruleCat, setRuleCat] = useState(categoriesOut[0]);

  const list = tab === "out" ? categoriesOut : categoriesIn;

  const submit = (e) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name || list.includes(name)) return;
    onAddCategory(tab, name);
    setNewName("");
  };
  const submitRule = (e) => {
    e.preventDefault();
    const m = ruleMatch.trim().toLowerCase();
    if (!m) return;
    onAddRules([{ match: m, category: ruleCat }]);
    setRuleMatch("");
  };

  return (
    <div className="quick-add-overlay" onClick={onClose}>
      <div className="quick-add-sheet import-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="quick-add-title">
          Categorie e regole
          <button className="quick-add-close" onClick={onClose}><IconX size={20} /></button>
        </div>

        <div className="quick-add-typerow">
          <button className={"quick-add-typebtn out" + (tab === "out" ? " active" : "")} onClick={() => setTab("out")}>Uscite</button>
          <button className={"quick-add-typebtn in" + (tab === "in" ? " active" : "")} onClick={() => setTab("in")}>Entrate</button>
          <button className={"quick-add-typebtn transfer" + (tab === "rules" ? " active" : "")} onClick={() => setTab("rules")}>Regole CSV</button>
        </div>

        {tab !== "rules" && (
          <>
            <div className="manage-cat-list">
              {list.map((c) => (
                <div className="manage-cat-row" key={c}>
                  <span className="cat-dot" style={{ background: catColor(c) }} />
                  <span className="manage-cat-name">{c}</span>
                  <button
                    className="tx-delete"
                    onClick={() => onDeleteCategory(tab, c)}
                    aria-label="Elimina categoria"
                    disabled={list.length <= 1}
                  ><IconTrash size={14} /></button>
                </div>
              ))}
            </div>

            <form className="inline-add-form" onSubmit={submit}>
              <input type="text" placeholder="Nuova categoria" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <button type="submit" className="btn-add" style={{ width: "auto", padding: "8px 16px" }}><IconPlus size={16} /></button>
            </form>
            <div className="empty-note">Le categorie già usate nei movimenti restano visibili anche se eliminate qui.</div>
          </>
        )}

        {tab === "rules" && (
          <>
            <div className="kpi-note" style={{ marginBottom: 8 }}>Se la descrizione contiene la parola, l'import CSV propone la categoria.</div>
            <div className="manage-cat-list">
              {rules.map((r) => (
                <div className="manage-cat-row" key={r.match}>
                  <span className="cat-dot" style={{ background: catColor(r.category) }} />
                  <span className="manage-cat-name">{r.match} → {r.category}</span>
                  <button className="tx-delete" onClick={() => onDeleteRule(r.match)} aria-label="Elimina regola"><IconTrash size={14} /></button>
                </div>
              ))}
            </div>
            <form className="inline-add-form" onSubmit={submitRule}>
              <input type="text" placeholder="Parola (es. rema)" value={ruleMatch} onChange={(e) => setRuleMatch(e.target.value)} />
              <select value={ruleCat} onChange={(e) => setRuleCat(e.target.value)}>
                {categoriesOut.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <button type="submit" className="btn-add" style={{ width: "auto", padding: "8px 16px" }}><IconPlus size={16} /></button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

function CategoryAnalysis({ transactions, accounts }) {
  const [type, setType] = useState("out");
  const [scope, setScope] = useState("personal");
  const [selectedMonth, setSelectedMonth] = useState("media");

  const shared = sharedAccountNames(accounts);
  const filteredByType = type === "out" && scope === "casa"
    ? houseFlows(transactions, shared)
    : personalFlows(transactions, shared).filter((f) => f.kind === type);

  // mesi disponibili tra i movimenti di questo tipo, più recenti prima
  const months = Array.from(new Set(filteredByType.map((t) => t.date.slice(0, 7)))).sort().reverse();
  const monthLabel = (mk) => {
    const [y, m] = mk.split("-");
    const names = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];
    return `${names[parseInt(m, 10) - 1]} ${y}`;
  };

  function totalsForMonth(monthKey) {
    const totals = {};
    filteredByType.filter((t) => t.date.slice(0, 7) === monthKey).forEach((t) => {
      totals[t.category] = (totals[t.category] || 0) + t.amount;
    });
    return totals;
  }

  // media per categoria su tutti i mesi disponibili (mesi senza quella categoria contano come 0)
  function averages() {
    if (months.length === 0) return {};
    const sums = {};
    months.forEach((mk) => {
      const t = totalsForMonth(mk);
      Object.entries(t).forEach(([cat, val]) => {
        sums[cat] = (sums[cat] || 0) + val;
      });
    });
    const avg = {};
    Object.entries(sums).forEach(([cat, sum]) => { avg[cat] = sum / months.length; });
    return avg;
  }

  const displayTotals = selectedMonth === "media" ? averages() : totalsForMonth(selectedMonth);
  const entries = Object.entries(displayTotals).sort((a, b) => b[1] - a[1]);
  const maxVal = entries.length ? entries[0][1] : 1;
  const grandTotal = entries.reduce((a, [, v]) => a + v, 0);

  return (
    <div className="category-analysis">
      <div className="quick-add-typerow">
        <button className={"quick-add-typebtn out" + (type === "out" ? " active" : "")} onClick={() => { setType("out"); setSelectedMonth("media"); }}>Uscite</button>
        <button className={"quick-add-typebtn in" + (type === "in" ? " active" : "")} onClick={() => { setType("in"); setSelectedMonth("media"); }}>Entrate</button>
      </div>
      {type === "out" && shared.size > 0 && (
        <div className="filter-row">
          <span className="filter-label">Vista:</span>
          <button className={"chip" + (scope === "personal" ? " active" : "")} onClick={() => { setScope("personal"); setSelectedMonth("media"); }}>Le tue spese</button>
          <button className={"chip" + (scope === "casa" ? " active" : "")} onClick={() => { setScope("casa"); setSelectedMonth("media"); }}>Conto di casa</button>
        </div>
      )}

      {months.length === 0 ? (
        <div className="panel">
          <div className="empty-note">Nessun movimento di questo tipo ancora registrato.</div>
        </div>
      ) : (
        <>
          <div className="filter-row">
            <span className="filter-label">Periodo:</span>
            <button className={"chip" + (selectedMonth === "media" ? " active" : "")} onClick={() => setSelectedMonth("media")}>Media mensile</button>
            {months.map((mk) => (
              <button key={mk} className={"chip" + (selectedMonth === mk ? " active" : "")} onClick={() => setSelectedMonth(mk)}>{monthLabel(mk)}</button>
            ))}
          </div>

          <div className="panel">
            <div className="panel-title">
              {selectedMonth === "media" ? "Media per categoria" : `Totali — ${monthLabel(selectedMonth)}`}
              <span className="panel-title-sub">{months.length} {months.length === 1 ? "mese" : "mesi"} nello storico</span>
            </div>

            {entries.length === 0 && <div className="empty-note">Nessun dato per questo periodo.</div>}

            {entries.map(([cat, val]) => (
              <div className="cat-row" key={cat}>
                <div className="cat-label"><span className="cat-dot" style={{ background: catColor(cat) }} />{cat}</div>
                <div className="cat-bar-track"><div className="cat-bar-fill" style={{ width: `${(val / maxVal) * 100}%`, background: catColor(cat) }} /></div>
                <div className="cat-val">{fmt(val)}</div>
              </div>
            ))}

            {entries.length > 0 && (
              <div className="account-row total">
                <span className="account-name">Totale {selectedMonth === "media" ? "medio" : "mese"}</span>
                <span className="account-bal">{fmt(grandTotal)} DKK</span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Investments({ investments, onUpdate, onAdd, onDelete }) {
  const [newLabel, setNewLabel] = useState("");
  const [newBucket, setNewBucket] = useState("saxo");
  const [newValue, setNewValue] = useState("");

  const grouped = INVEST_BUCKETS.map((b) => ({ ...b, items: investments.filter((i) => i.bucket === b.key) }));
  const total = investments.reduce((a, i) => a + (i.value || 0), 0);
  const goalInv = investments.filter((i) => GOAL_BUCKETS.includes(i.bucket)).reduce((a, i) => a + (i.value || 0), 0);

  const submit = (e) => {
    e.preventDefault();
    const v = parseFloat(newValue);
    if (!newLabel.trim() || isNaN(v)) return;
    onAdd({ label: newLabel.trim(), bucket: newBucket, value: v });
    setNewLabel(""); setNewValue("");
  };

  return (
    <div className="investments">
      <div className="invest-total-card">
        <div className="eyebrow">Totale investito</div>
        <div className="goal-value">{fmt(total)} <span className="unit">DKK</span></div>
        <div className="goal-breakdown">di cui Fondo Casa (Saxo + Revolut ETF): {fmt(goalInv)} DKK</div>
      </div>
      {grouped.map((g) => (
        <div className="panel" key={g.key}>
          <div className="panel-title">{g.label}{GOAL_BUCKETS.includes(g.key) ? " 🏠" : ""}</div>
          {g.items.length === 0 && <div className="empty-note">Nessuna voce in questo bucket.</div>}
          {g.items.map((i) => (
            <div className="invest-row" key={i.id}>
              <span className="invest-label">{i.label}</span>
              <input type="number" className="invest-input" value={i.value} onChange={(e) => onUpdate(i.id, parseFloat(e.target.value) || 0)} />
              <span className="invest-unit">DKK</span>
              <button className="tx-delete" onClick={() => onDelete(i.id)} aria-label="Elimina"><IconTrash size={14} /></button>
            </div>
          ))}
        </div>
      ))}
      <form className="tx-form" onSubmit={submit}>
        <div className="tx-form-row">
          <input type="text" placeholder="Nome posizione (es. VWCE)" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
          <select value={newBucket} onChange={(e) => setNewBucket(e.target.value)}>
            {INVEST_BUCKETS.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
          </select>
          <input type="number" step="0.01" placeholder="Valore DKK" value={newValue} onChange={(e) => setNewValue(e.target.value)} />
        </div>
        <button type="submit" className="btn-add"><IconPlus size={16} /> Aggiungi posizione</button>
      </form>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
