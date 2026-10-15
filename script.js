/* =========================================================
   Jeu Entre Potes — script.js
   Multijoueur sans serveur : le joueur qui crée le lobby (l'hôte)
   fait tourner la partie dans son navigateur, et ses potes s'y
   connectent directement grâce à PeerJS.
   Chaque joueur choisit sa langue : l'hôte envoie des références
   (catégorie + numéro de question) et chacun affiche le texte
   dans sa propre langue.
   ========================================================= */

const PEER_PREFIX = "jeuentrepotes-v3-";
const MAX_PLAYERS = 20;
const REVEAL_MS = 6000;
const COUNTDOWN_MS = 3600;
const PICK_MS = 15000, DRAW_MS = 80000;
const CLUE_MS = 45000, VOTE_MS = 30000, WRITE_MS = 60000;

/* ---------- Utilitaires ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};
const ALPH = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode = () => Array.from({ length: 5 }, () => ALPH[Math.floor(Math.random() * ALPH.length)]).join("");
const THEME_KEYS = Object.keys(THEMES);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const AV_COLORS = [["#ff4d6d", "#ff9e00"], ["#3a86ff", "#8338ec"], ["#06d6a0", "#118ab2"], ["#ffbe0b", "#fb5607"], ["#ff3d8b", "#8b5cf6"], ["#22d3ee", "#3a86ff"]];
const vibrate = p => { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} };

/* =========================================================
   Langue
   ========================================================= */
const LANGS = ["fr", "en", "he"];
const LANG_IDX = { fr: 0, en: 1, he: 2 };
const LOCALES = { fr: "fr-FR", en: "en-US", he: "he-IL" };
let LANG = store.get("bz_lang");
if (!LANGS.includes(LANG)) { const n = (navigator.language || "fr").slice(0, 2); LANG = n === "he" || n === "iw" ? "he" : n === "en" ? "en" : "fr"; }

function tr(key, vars) {
  let s = (I18N[LANG] && I18N[LANG][key]) ?? I18N.fr[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, x) => (vars[x] !== undefined ? vars[x] : m));
  return s;
}
const fmt = n => Number(n || 0).toLocaleString(LOCALES[LANG]);
const fmtNum = n => Number(n).toLocaleString(LOCALES[LANG], { maximumFractionDigits: 3, useGrouping: !(Number.isInteger(+n) && n >= 1000 && n <= 2100) });

/* contenus dans chaque langue (le français sert de secours) */
const PACKS = {
  fr: {
    modes: Object.fromEntries(Object.keys(MODES).map(m => [m, { n: MODES[m].n, d: MODES[m].d, how: MODES[m].how }])),
    fams: Object.fromEntries(FAMILIES.map(f => [f.id, f.n])),
    vf: VRAI_FAUX.map(x => [x[0], x[2]]), emoji: EMOJI.map(e => e.slice(1)),
    actions: ACTIONS, verites: VERITES, tp: TU_PREFERES, qps: QUI_POURRAIT, jnj: JAMAIS,
    estim: ESTIMATION.map(e => [e[0], e[2]]), colors: COULEURS.map(c => c.n)
  },
  en: typeof PACK_EN !== "undefined" ? PACK_EN : {},
  he: typeof PACK_HE !== "undefined" ? PACK_HE : {}
};
const THEMES_L = { fr: THEMES, en: typeof THEMES_EN !== "undefined" ? THEMES_EN : {}, he: typeof THEMES_HE !== "undefined" ? THEMES_HE : {} };
function cget(name, i) { const a = (PACKS[LANG] || {})[name]; const v = a && a[i]; return v != null ? v : PACKS.fr[name][i]; }
function themeName(k) { const t = THEMES_L[LANG][k]; return (t && t.n) || THEMES[k].n; }
function themeQ(k, i) { const t = THEMES_L[LANG][k]; return (t && t.q && t.q[i]) || THEMES[k].q[i]; }
function modeT(m) { const p = PACKS[LANG].modes; return (p && p[m]) || PACKS.fr.modes[m]; }
function famName(id) { const p = PACKS[LANG].fams; return (p && p[id]) || PACKS.fr.fams[id]; }
const wordL = i => WORDS[i][LANG_IDX[LANG]];
const promptL = i => PROMPTS[i][LANG_IDX[LANG]];
const colorName = i => cget("colors", i);

function applyLang() {
  document.documentElement.lang = LANG;
  document.documentElement.dir = LANG === "he" ? "rtl" : "ltr";
  for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = tr(el.dataset.i18n);
  for (const el of document.querySelectorAll("[data-i18n-html]")) el.innerHTML = tr(el.dataset.i18nHtml);
  for (const el of document.querySelectorAll("[data-i18n-ph]")) el.placeholder = tr(el.dataset.i18nPh);
  for (const b of $("langSwitch").children) b.setAttribute("aria-pressed", b.dataset.lang === LANG);
  document.title = tr("title");
}
$("langSwitch").onclick = e => {
  const b = e.target.closest("button"); if (!b || b.dataset.lang === LANG) return;
  LANG = b.dataset.lang; store.set("bz_lang", LANG);
  applyLang(); renderMe(); renderTicker(); renderGlobal(); renderSoundBtn(); buildModeButtons();
  for (const id of ["answers", "aovBox", "qText", "textBox"]) $(id).dataset.sig = "";
  if (state) render();
  sfx.select();
};

/* ---------- Petits composants ---------- */
function avatarHTML(p, size = 40) {
  if (p && p.avatar) return `<img class="avatar" style="--s:${size}px" src="${esc(p.avatar)}" alt="">`;
  const name = (p && p.name) || "?";
  const [c1, c2] = AV_COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AV_COLORS.length];
  return `<span class="avatar" aria-hidden="true" style="--s:${size}px;background:linear-gradient(135deg,${c1},${c2})">${esc([...name][0].toUpperCase())}</span>`;
}
let toastT;
function toast(m) { const t = $("toast"); t.textContent = m; t.hidden = false; t.style.animation = "none"; void t.offsetWidth; t.style.animation = ""; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2400); }
function showWarn(m) { const w = $("warn"); w.textContent = m; w.hidden = !m; }
async function copy(text, okMsg) {
  try { await navigator.clipboard.writeText(text); toast(okMsg); sfx.pop(); }
  catch (e) { const f = $("linkFallback"); f.hidden = false; f.innerHTML = `<p>${esc(tr("copyManual"))}</p><div class="sel" dir="ltr">${esc(text)}</div>`; }
}

/* =========================================================
   Sons (générés, aucun fichier à télécharger)
   ========================================================= */
let muted = store.get("bz_muted") === true;
let actx = null;
function audio() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
  if (actx.state === "suspended") actx.resume();
  return actx;
}
function tone(freq, dur = .12, type = "sine", vol = .18, when = 0, slide = 0) {
  if (muted) return; const a = audio(); if (!a) return;
  const t = a.currentTime + when, o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + .01); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + .02);
}
const sfx = {
  pop() { tone(660, .08, "triangle", .15); },
  select() { tone(520, .07, "square", .06); tone(780, .08, "square", .05, .05); },
  hurry() { tone(880, .07, "square", .09); },
  count() { tone(440, .18, "triangle", .2); },
  go() { tone(660, .12, "triangle", .2); tone(990, .3, "triangle", .2, .1); },
  whoosh() { tone(300, .25, "sine", .1, 0, 900); },
  answer() { tone(600, .06, "triangle", .14); tone(900, .1, "triangle", .12, .05); },
  good() { [523, 659, 784, 1046].forEach((f, i) => tone(f, .18, "triangle", .16, i * .08)); },
  bad() { tone(220, .35, "sawtooth", .12, 0, 110); },
  join() { tone(740, .08, "sine", .14); tone(1110, .14, "sine", .12, .07); },
  fanfare() { [523, 659, 784, 659, 784, 1046].forEach((f, i) => tone(f, i === 5 ? .6 : .16, "triangle", .18, i * .14)); }
};
function renderSoundBtn() { $("soundBtn").textContent = muted ? "🔇" : "🔊"; $("soundBtn").setAttribute("aria-label", tr(muted ? "soundOn" : "soundOff")); }
$("soundBtn").onclick = () => { muted = !muted; store.set("bz_muted", muted); renderSoundBtn(); if (!muted) sfx.pop(); };
document.addEventListener("pointerdown", () => audio(), { once: true });

/* =========================================================
   Confettis
   ========================================================= */
const fx = $("fx"), fctx = fx.getContext("2d");
let parts = [], fxRun = false;
function resizeFx() { const d = Math.min(2, window.devicePixelRatio || 1); fx.width = innerWidth * d; fx.height = innerHeight * d; fctx.setTransform(d, 0, 0, d, 0, 0); }
addEventListener("resize", resizeFx); resizeFx();
function confetti(n = 140, from = "top") {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const cols = ["#ffd23f", "#ff3d8b", "#22d3ee", "#8b5cf6", "#06d6a0", "#ffffff"];
  for (let i = 0; i < n; i++) {
    const burst = from === "center";
    parts.push({
      x: burst ? innerWidth / 2 : Math.random() * innerWidth, y: burst ? innerHeight * .45 : -20 - Math.random() * innerHeight * .3,
      vx: burst ? (Math.random() - .5) * 14 : (Math.random() - .5) * 3, vy: burst ? -Math.random() * 12 - 3 : Math.random() * 3 + 2,
      r: Math.random() * 6 + 4, a: Math.random() * 6, va: (Math.random() - .5) * .3, c: cols[i % cols.length], life: 0
    });
  }
  if (!fxRun) { fxRun = true; requestAnimationFrame(stepFx); }
}
function stepFx() {
  fctx.clearRect(0, 0, innerWidth, innerHeight);
  parts = parts.filter(p => p.y < innerHeight + 30 && p.life < 600);
  for (const p of parts) {
    p.vy += .18; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.a += p.va; p.life++;
    fctx.save(); fctx.translate(p.x, p.y); fctx.rotate(p.a); fctx.fillStyle = p.c;
    fctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); fctx.restore();
  }
  if (parts.length) requestAnimationFrame(stepFx); else { fxRun = false; fctx.clearRect(0, 0, innerWidth, innerHeight); }
}

/* =========================================================
   Profil (pseudo + photo)
   ========================================================= */
let myId = null;
try { myId = sessionStorage.getItem("bz_tab_id"); } catch (e) {}
if (!myId) { myId = "p" + Math.random().toString(36).slice(2, 12); try { sessionStorage.setItem("bz_tab_id", myId); } catch (e) {} }
const saved = store.get("bz_profile") || {};
const me = { id: myId, name: saved.name || "", avatar: saved.avatar || "" };
$("pseudo").value = me.name;

function renderMe() {
  $("bigAvatar").innerHTML = avatarHTML({ name: me.name || "?", avatar: me.avatar }, 86);
  $("meChip").innerHTML = avatarHTML({ name: me.name || "?", avatar: me.avatar }, 30) + `<span>${esc(me.name || tr("noName"))}</span>`;
}
function saveProfile() {
  store.set("bz_profile", { name: me.name, avatar: me.avatar });
  renderMe();
  if (role === "host") hostUpdateProfile(me.id, me);
  else if (role === "guest") send({ type: "profile", profile: me });
}
let nameT;
$("pseudo").addEventListener("input", e => { me.name = e.target.value.trim().slice(0, 18); renderMe(); clearTimeout(nameT); nameT = setTimeout(saveProfile, 600); });
$("photo").addEventListener("change", e => {
  const f = e.target.files[0]; if (!f) return;
  const img = new Image(), r = new FileReader();
  r.onload = () => {
    img.onload = () => {
      const c = document.createElement("canvas"); c.width = c.height = 128;
      const x = c.getContext("2d"), m = Math.min(img.width, img.height);
      x.drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, 128, 128);
      me.avatar = c.toDataURL("image/jpeg", .8); saveProfile(); toast(tr("photoOk")); sfx.pop();
    };
    img.src = r.result;
  };
  r.readAsDataURL(f);
});

/* ---------- Accueil ---------- */
const totalQ = THEME_KEYS.reduce((n, k) => n + THEMES[k].q.length, 0);
$("statCats").textContent = THEME_KEYS.length;
$("statQs").textContent = Math.floor(totalQ / 50) * 50 + "+";
$("statModes").textContent = MODE_ORDER.length;
const tickerOrder = shuffle(THEME_KEYS);
function renderTicker() {
  const items = tickerOrder.map(k => `<span style="--c1:${THEMES[k].c[0]};--c2:${THEMES[k].c[1]}">${THEMES[k].i} ${esc(themeName(k))}</span>`).join("");
  $("ticker").innerHTML = items + items;
}

const urlCode = (new URLSearchParams(location.search).get("code") || "").toUpperCase();

/* ---------- Classement général (sur cet appareil) ---------- */
const boardKey = name => "n:" + String(name || "").trim().toLowerCase();
function renderGlobal() {
  const board = store.get("bz_board") || {};
  const rows = Object.entries(board).map(([id, p]) => ({ id, ...p })).sort((a, b) => b.points - a.points).slice(0, 15);
  $("globalEmpty").hidden = rows.length > 0;
  $("globalBoard").innerHTML = rows.map((p, i) => `<li class="${p.id === boardKey(me.name) ? "me" : ""}"><span class="rank">${i < 3 ? ["🥇", "🥈", "🥉"][i] : i + 1}</span>${avatarHTML(p, 36)}<span class="pname">${esc(p.name)}<small>${tr("gamesWins", { g: p.games, w: p.wins })}</small></span><span class="pts">${fmt(p.points)}</span></li>`).join("");
}
function recordGame(s) {
  const key = s.code + ":" + s.gameNo;
  const done = store.get("bz_recorded") || [];
  if (done.includes(key)) return;
  const board = store.get("bz_board") || {};
  const r = s.players.slice().sort((a, b) => b.score - a.score);
  r.forEach((p, i) => {
    const k = boardKey(p.name);
    const e = board[k] || { name: p.name, avatar: "", points: 0, games: 0, wins: 0 };
    e.name = p.name; e.avatar = p.avatar || e.avatar;
    e.points += p.score; e.games += 1;
    if (i === 0 && r.length > 1 && p.score > 0) e.wins += 1;
    board[k] = e;
  });
  const keep = new Set(Object.entries(board).sort((a, b) => b[1].points - a[1].points).slice(0, 60).map(([k]) => k));
  for (const k of Object.keys(board)) if (!keep.has(k)) delete board[k];
  store.set("bz_board", board);
  store.set("bz_recorded", [...done, key].slice(-100));
  renderGlobal();
}

/* =========================================================
   Réseau
   ========================================================= */
let role = null;      // "host" | "guest" | null
let peer = null;
let hostConn = null;  // (invité) connexion vers l'hôte
let state = null;     // état reçu, affiché à l'écran
let deadline = 0;     // fin du chrono local
let L = null;         // (hôte) état complet de la partie
const conns = new Map();

function send(msg) { if (hostConn && hostConn.open) hostConn.send(msg); }
function cleanup() {
  try { peer && peer.destroy(); } catch (e) {}
  if (L) clearTimeout(L.timer);
  peer = null; hostConn = null; role = null; state = null; L = null; conns.clear();
}

/* =========================================================
   Création des manches (chez l'hôte)
   ========================================================= */
function deckIdx(name, len) {
  if (!L.decks[name] || !L.decks[name].length) L.decks[name] = shuffle([...Array(len).keys()]);
  return L.decks[name].pop();
}
function buildQuizQueue(themes, n) {
  const keys = themes.filter(k => THEMES[k]);
  const pools = keys.map(k => shuffle([...THEMES[k].q.keys()]).map(i => ({ k, i })));
  const out = [];
  while (out.length < n && pools.some(p => p.length)) {
    for (const p of shuffle(pools)) { if (p.length && out.length < n) out.push(p.pop()); }
  }
  return shuffle(out);
}
function makeCalc() {
  const r = Math.random(); let a, b, ans, t;
  if (r < .35) { a = rand(12, 99); b = rand(12, 99); ans = a + b; t = `${a} + ${b}`; }
  else if (r < .65) { a = rand(40, 160); b = rand(11, a - 8); ans = a - b; t = `${a} − ${b}`; }
  else { a = rand(3, 15); b = rand(3, 12); ans = a * b; t = `${a} × ${b}`; }
  const set = new Set([ans]);
  while (set.size < 4) { const v = ans + pick([1, 2, 10, -1, -2, -10, 5, -5, 11, -9, 3, -3]); if (v >= 0) set.add(v); }
  const o = shuffle([...set].map(String));
  return { t, o, a: o.indexOf(String(ans)) };
}
function makeStroop() {
  const all = [...COULEURS.keys()];
  const ink = pick(all), w = pick(all.filter(i => i !== ink));
  const others = shuffle(all.filter(i => i !== ink && i !== w)).slice(0, 2);
  const o = shuffle([ink, w, ...others]);
  return { w, ink, o, a: o.indexOf(ink) };
}
const maskOf = s => [...s].map(ch => /[\s\-']/.test(ch) ? ch : "_").join("");
function nextTurnPlayer() { const pl = [...L.players.values()]; return pl[L.turn++ % pl.length]; }

function makeRound(mode) {
  const R = { mode };
  switch (mode) {
    case "quiz": {
      const q = L.quizQueue.pop() || buildQuizQueue(L.themes.length ? L.themes : THEME_KEYS, 1)[0];
      const perm = shuffle([0, 1, 2, 3]);
      return { ...R, kind: "choice", src: "quiz", k: q.k, i: q.i, perm, n: 4, a: perm.indexOf(0) };
    }
    case "vf": { const i = deckIdx("vf", VRAI_FAUX.length); return { ...R, kind: "choice", src: "vf", i, n: 2, a: VRAI_FAUX[i][1] ? 0 : 1 }; }
    case "emoji": { const i = deckIdx("emoji", EMOJI.length), perm = shuffle([0, 1, 2, 3]); return { ...R, kind: "choice", src: "emoji", i, perm, n: 4, a: perm.indexOf(0) }; }
    case "calcul": { const c = makeCalc(); return { ...R, kind: "choice", src: "calc", ...c, n: 4 }; }
    case "couleur": { const c = makeStroop(); return { ...R, kind: "choice", src: "color", ...c, n: 4 }; }
    case "tp": return { ...R, kind: "vote", src: "tp", i: deckIdx("tp", TU_PREFERES.length), n: 2 };
    case "qps": {
      const pl = [...L.players.values()];
      return { ...R, kind: "vote", src: "qps", i: deckIdx("qps", QUI_POURRAIT.length), ids: pl.map(p => p.id), names: pl.map(p => p.name), n: pl.length };
    }
    case "jnj": return { ...R, kind: "vote", src: "jnj", i: deckIdx("jnj", JAMAIS.length), n: 2 };
    case "estim": { const i = deckIdx("estim", ESTIMATION.length); return { ...R, kind: "number", src: "estim", i, a: ESTIMATION[i][1] }; }
    case "reflexe": return { ...R, kind: "reflex", src: "reflex", goDelay: 1500 + Math.random() * 3500 };
    case "aov": { const p = nextTurnPlayer(); return { ...R, kind: "aov", src: "aov", pid: p.id, pname: p.name, choice: null, ti: null, result: null }; }
    case "dessin": {
      const p = nextTurnPlayer();
      const choices = [deckIdx("words", WORDS.length), deckIdx("words", WORDS.length), deckIdx("words", WORDS.length)];
      return { ...R, kind: "draw", src: "draw", pid: p.id, pname: p.name, choices, w: null, found: {}, drawerPts: 0, strokes: [], chat: [] };
    }
    case "imposteur": {
      const pl = [...L.players.values()];
      return { ...R, kind: "spy", src: "spy", spy: pick(pl).id, w: deckIdx("words", WORDS.length), step: "clue", clues: {}, votes: {}, ids: pl.map(p => p.id), names: pl.map(p => p.name) };
    }
    case "blagues": return { ...R, kind: "joke", src: "joke", pi: deckIdx("prompts", PROMPTS.length), step: "write", answers: {}, order: [], votes: {} };
  }
}

/* =========================================================
   Déroulement de la partie (chez l'hôte)
   ========================================================= */
function isDone(p) {
  const R = L.round;
  if (!R) return false;
  switch (R.kind) {
    case "draw": return p.id === R.pid || R.found[p.id] != null;
    case "spy": return R.step === "clue" ? R.clues[p.id] != null : R.votes[p.id] != null;
    case "joke": return R.step === "write" ? R.answers[p.id] != null : R.votes[p.id] != null || !R.order.some(id => id !== p.id);
    case "aov": return false;
    default: return !!p.answer;
  }
}
function everyoneDone() { const ps = [...L.players.values()]; return ps.length > 0 && ps.every(isDone); }

/* ce que voit un joueur précis (le mot secret n'est envoyé qu'à ceux qui ont le droit de le voir) */
function publicRound(R, viewer) {
  const rev = L.phase === "reveal";
  const q = { kind: R.kind, mode: R.mode, src: R.src, n: R.n };
  for (const f of ["k", "i", "perm", "t", "o", "w", "ink", "ids", "names", "pid", "pname", "pi"]) if (R[f] !== undefined) q[f] = R[f];
  if (R.kind === "choice" || R.kind === "number") { if (rev) q.a = R.a; }
  if (R.src === "color") q.w = R.w;
  if (R.kind === "vote" && rev) { q.counts = R.counts; q.win = R.win; }
  if (R.kind === "reflex") q.goIn = Math.max(0, L.roundStart + R.goDelay - Date.now());
  if (R.kind === "aov") Object.assign(q, { choice: R.choice, ti: R.ti, result: R.result });
  if (R.kind === "draw") {
    const drawer = viewer === R.pid;
    q.w = rev || drawer ? R.w : null;
    q.choices = drawer && R.w == null ? R.choices : null;
    q.picked = R.w != null;
    q.masks = R.w != null ? WORDS[R.w].map(maskOf) : null;
    q.found = Object.keys(R.found);
    q.chat = R.chat.slice(-30);
  }
  if (R.kind === "spy") {
    q.step = R.step;
    q.isSpy = viewer === R.spy;
    q.w = rev || viewer !== R.spy ? R.w : null;
    q.spy = rev ? R.spy : null;
    q.clues = R.step === "vote" || rev ? R.clues : null;
    q.votes = rev ? R.votes : null;
    q.caught = rev ? R.caught : null;
  }
  if (R.kind === "joke") {
    q.step = R.step;
    q.order = R.step === "vote" || rev ? R.order : null;
    q.texts = R.step === "vote" || rev ? R.order.map(id => R.answers[id]) : null;
    q.authors = rev ? R.order : null;
    q.votes = rev ? R.votes : null;
    q.mine = R.order.indexOf(viewer);
  }
  return q;
}
function publicState(viewer) {
  const showQ = L.round && (L.phase === "question" || L.phase === "reveal");
  const rev = L.phase === "reveal";
  return {
    code: L.code, host: L.host, mode: L.mode, themes: L.themes, nbQ: L.nbQ, dur: L.dur, phase: L.phase,
    qIndex: L.qIndex, total: L.nbQ, gameNo: L.gameNo,
    question: showQ ? publicRound(L.round, viewer) : null,
    timeLeft: L.phaseEnd ? Math.max(0, L.phaseEnd - Date.now()) : -1,
    timeTotal: L.timeTotal || 0,
    history: L.phase === "end" ? L.history : null,
    players: [...L.players.values()].map(p => ({
      id: p.id, name: p.name, avatar: p.avatar, score: p.score, streak: p.streak,
      answered: L.phase === "question" && L.round ? isDone(p) : false,
      choice: rev && p.answer && p.answer.c !== undefined ? p.answer.c : null,
      pts: rev && p.answer ? p.answer.pts || 0 : 0
    }))
  };
}
function broadcast() {
  for (const [id, c] of conns) if (c.open) c.send({ type: "state", state: publicState(id) });
  applyState(publicState(me.id));
}
function relay(msg, exceptId) { for (const [id, c] of conns) if (c.open && id !== exceptId) c.send(msg); }

function setTimer(ms) {
  clearTimeout(L.timer);
  L.timeTotal = ms; L.phaseEnd = Date.now() + ms;
  L.timer = setTimeout(onTimer, ms + 300);
}
function onTimer() {
  if (!L) return;
  if (L.phase === "countdown") return startRound();
  if (L.phase === "reveal") return nextRound();
  if (L.phase !== "question") return;
  const R = L.round;
  if (R.kind === "draw" && R.w == null) return hostDrawPick(R.pid, R.choices[0]);
  if ((R.kind === "spy" && R.step === "clue") || (R.kind === "joke" && R.step === "write")) return toVoteStep();
  reveal();
}
function startGame() {
  if (!L || (L.phase !== "lobby" && L.phase !== "end")) return;
  if (L.mode === "quiz" && !L.themes.length) return toast(tr("needCat"));
  L.decks = {}; L.history = []; L.turn = Math.floor(Math.random() * L.players.size);
  L.quizQueue = L.mode === "quiz" || L.mode === "mix" ? buildQuizQueue(L.themes.length ? L.themes : THEME_KEYS, L.nbQ) : [];
  L.qIndex = 0; L.gameNo++;
  for (const p of L.players.values()) { p.score = 0; p.streak = 0; p.answer = null; }
  L.phase = "countdown"; setTimer(COUNTDOWN_MS);
  broadcast();
}
function startRound() {
  const mode = L.mode === "mix" ? pick(MIX_POOL) : L.mode;
  L.round = makeRound(mode);
  for (const p of L.players.values()) p.answer = null;
  L.phase = "question"; L.roundStart = Date.now();
  const R = L.round;
  if (R.kind === "aov") { clearTimeout(L.timer); L.phaseEnd = 0; L.timeTotal = 0; }
  else if (R.kind === "draw") setTimer(PICK_MS);
  else if (R.kind === "spy") setTimer(CLUE_MS);
  else if (R.kind === "joke") setTimer(WRITE_MS);
  else if (R.kind === "reflex") setTimer(R.goDelay + 4000);
  else if (R.kind === "number") setTimer(L.dur * 1000 + 5000);
  else setTimer(L.dur * 1000);
  broadcast();
}
function toVoteStep() {
  const R = L.round;
  R.step = "vote";
  if (R.kind === "joke") {
    R.order = shuffle(Object.keys(R.answers));
    if (R.order.length < 2) { reveal(); return; }
  }
  setTimer(VOTE_MS);
  broadcast();
}
function afterAction() {
  const R = L.round;
  if (!everyoneDone()) return broadcast();
  if ((R.kind === "spy" && R.step === "clue") || (R.kind === "joke" && R.step === "write")) return toVoteStep();
  reveal();
}

/* ---------- Réponses reçues ---------- */
function hostAnswer(id, c) {
  if (!L || L.phase !== "question") return;
  const p = L.players.get(id), R = L.round;
  if (!p) return;
  c = Number(c);
  if (R.kind === "spy") {
    if (R.step !== "vote" || R.votes[id] != null || !Number.isInteger(c) || c < 0 || c >= R.ids.length || R.ids[c] === id) return;
    R.votes[id] = c; return afterAction();
  }
  if (R.kind === "joke") {
    if (R.step !== "vote" || R.votes[id] != null || !Number.isInteger(c) || c < 0 || c >= R.order.length || R.order[c] === id) return;
    R.votes[id] = c; return afterAction();
  }
  if (p.answer || R.kind === "aov" || R.kind === "draw") return;
  if (R.kind === "choice" || R.kind === "vote") { if (!(Number.isInteger(c) && c >= 0 && c < R.n)) return; p.answer = { c, left: Math.max(0, L.phaseEnd - Date.now()) }; }
  else if (R.kind === "number") { if (!isFinite(c)) return; p.answer = { c }; }
  else if (R.kind === "reflex") { if (!isFinite(c)) return; p.answer = { c: c < 0 ? -1 : Math.max(80, Math.min(Math.round(c), 9999)) }; }
  afterAction();
}
function hostText(id, msg) {
  if (!L || L.phase !== "question") return;
  const R = L.round, p = L.players.get(id);
  if (!p) return;
  const clean = String(msg.text || "").replace(/\s+/g, " ").trim().slice(0, msg.kind === "joke" ? 80 : 40);
  if (!clean) return;
  if (msg.kind === "clue" && R.kind === "spy" && R.step === "clue" && R.clues[id] == null) { R.clues[id] = clean; return afterAction(); }
  if (msg.kind === "joke" && R.kind === "joke" && R.step === "write" && R.answers[id] == null) { R.answers[id] = clean; return afterAction(); }
  if (msg.kind === "guess" && R.kind === "draw" && R.w != null && id !== R.pid && R.found[id] == null) {
    if (guessMatches(clean, R.w)) {
      const left = Math.max(0, L.phaseEnd - Date.now());
      R.found[id] = 300 + Math.round(700 * left / DRAW_MS);
      R.drawerPts += 150;
      R.chat.push({ id, name: p.name, ok: true });
    } else R.chat.push({ id, name: p.name, text: clean });
    if (R.chat.length > 60) R.chat.splice(0, R.chat.length - 60);
    return afterAction();
  }
}
function hostAov(id, msg) {
  if (!L || L.phase !== "question" || L.round.kind !== "aov") return;
  const R = L.round;
  if (msg.step === "choose" && id === R.pid && !R.choice) {
    R.choice = msg.c === "action" ? "action" : "verite";
    R.ti = R.choice === "action" ? deckIdx("action", ACTIONS.length) : deckIdx("verite", VERITES.length);
    broadcast();
  } else if (msg.step === "done" && R.choice && R.result === null && (id === R.pid || id === L.host)) {
    R.result = !!msg.ok; reveal();
  } else if (msg.step === "skip" && id === L.host) {
    R.result = false; reveal();
  }
}
function hostDrawPick(id, w) {
  if (!L || L.phase !== "question") return;
  const R = L.round;
  if (R.kind !== "draw" || id !== R.pid || R.w != null || !R.choices.includes(w)) return;
  R.w = w; setTimer(DRAW_MS); broadcast();
}
function hostStroke(id, seg) {
  if (!L || L.phase !== "question") return;
  const R = L.round;
  if (R.kind !== "draw" || id !== R.pid || R.w == null || !seg) return;
  if (seg.clear) R.strokes = [];
  else if (seg.undo) R.strokes = R.strokes.filter(s => s.s !== seg.undo);
  else { if (R.strokes.length > 6000) return; R.strokes.push(seg); }
  relay({ type: "stroke", seg }, id);
  if (id !== me.id) applyStroke(seg);
}
/* normalise une proposition : minuscules, sans accents ni articles */
function normGuess(s) {
  s = String(s).toLowerCase().normalize("NFD").replace(/[̀-֑ͯ-ׇ]/g, "").trim();
  s = s.replace(/^(le |la |les |l'|un |une |des |du |the |a |an )/, "");
  return s.replace(/[^a-z0-9א-ת]/g, "");
}
function guessMatches(text, w) {
  const g = normGuess(text);
  if (!g) return false;
  return WORDS[w].some(x => {
    const c = normGuess(x);
    return g === c || g === c + "s" || g + "s" === c || g === c + "es" || (g[0] === "ה" && g.slice(1) === c);
  });
}

/* ---------- Correction d'une manche ---------- */
const RANK_PTS = [1000, 700, 500, 300];
function reveal() {
  if (!L || L.phase !== "question") return;
  clearTimeout(L.timer);
  const R = L.round, ps = [...L.players.values()], dur = L.dur * 1000;
  const res = new Map(); // id -> {pts, ok, val}
  if (R.kind === "choice") {
    for (const p of ps) {
      const ok = !!p.answer && p.answer.c === R.a;
      let pts = 0;
      if (ok) { p.streak++; pts = 500 + Math.round(500 * p.answer.left / dur) + Math.min(300, (p.streak - 1) * 100); } else p.streak = 0;
      res.set(p.id, { pts, ok, val: p.answer ? p.answer.c : null });
    }
  } else if (R.kind === "vote") {
    const counts = Array(R.n).fill(0);
    for (const p of ps) if (p.answer) counts[p.answer.c]++;
    const max = Math.max(...counts);
    R.counts = counts;
    R.win = R.src === "jnj" ? [] : counts.map((n, i) => (n === max && max > 0 ? i : -1)).filter(i => i >= 0);
    for (const p of ps) {
      const c = p.answer ? p.answer.c : null;
      let pts = 0, ok = false;
      if (R.src === "jnj") { ok = c === 0; pts = ok ? 300 : 0; }
      else { ok = c != null && R.win.includes(c); pts = ok ? 500 : 0; }
      res.set(p.id, { pts, ok, val: c });
    }
  } else if (R.kind === "number") {
    const ranked = ps.filter(p => p.answer).map(p => ({ p, d: Math.abs(p.answer.c - R.a) })).sort((x, y) => x.d - y.d);
    let rank = 0;
    ranked.forEach((x, i) => { if (i > 0 && x.d > ranked[i - 1].d) rank = i; x.rank = rank; });
    for (const p of ps) {
      const x = ranked.find(r => r.p === p);
      const pts = !x ? 0 : x.d === 0 ? 1500 : (RANK_PTS[x.rank] || 100);
      res.set(p.id, { pts, ok: !!x && x.rank === 0, val: x ? p.answer.c : null });
    }
  } else if (R.kind === "reflex") {
    const ranked = ps.filter(p => p.answer && p.answer.c >= 0).sort((x, y) => x.answer.c - y.answer.c);
    for (const p of ps) {
      const i = ranked.indexOf(p);
      res.set(p.id, { pts: i < 0 ? 0 : (RANK_PTS[i] || 150), ok: i === 0, val: p.answer ? p.answer.c : null });
    }
  } else if (R.kind === "aov") {
    for (const p of ps) res.set(p.id, p.id === R.pid ? { pts: R.result ? 500 : 0, ok: !!R.result, val: R.result } : { pts: 0, ok: false, val: undefined });
  } else if (R.kind === "draw") {
    for (const p of ps) {
      if (p.id === R.pid) res.set(p.id, { pts: R.drawerPts, ok: R.drawerPts > 0, val: "drawer" });
      else res.set(p.id, { pts: R.found[p.id] || 0, ok: R.found[p.id] != null, val: R.found[p.id] != null });
    }
  } else if (R.kind === "spy") {
    const counts = R.ids.map(() => 0);
    for (const v of Object.values(R.votes)) counts[v]++;
    const max = Math.max(0, ...counts);
    const top = counts.map((n, i) => (n === max && max > 0 ? i : -1)).filter(i => i >= 0);
    R.counts = counts;
    R.caught = top.length === 1 && R.ids[top[0]] === R.spy;
    const spyIdx = R.ids.indexOf(R.spy);
    for (const p of ps) {
      let pts = 0, ok = false;
      if (p.id === R.spy) { ok = !R.caught; pts = ok ? 1000 : 0; }
      else { ok = R.votes[p.id] === spyIdx; pts = R.caught && ok ? 500 : 0; }
      res.set(p.id, { pts, ok, val: R.clues[p.id] || "" });
    }
  } else if (R.kind === "joke") {
    const got = {};
    for (const v of Object.values(R.votes)) { const a = R.order[v]; got[a] = (got[a] || 0) + 1; }
    const max = Math.max(0, ...Object.values(got));
    R.got = got;
    for (const p of ps) {
      const n = got[p.id] || 0;
      res.set(p.id, { pts: n * 300, ok: n > 0 && n === max, val: R.answers[p.id] || "" });
    }
  }
  for (const p of ps) {
    const r = res.get(p.id);
    p.answer = p.answer || {};
    p.answer.pts = r.pts; p.score += r.pts;
    if (r.val !== undefined && p.answer.c === undefined && (R.kind === "draw" || R.kind === "aov")) p.answer.c = r.val;
  }
  L.history.push({ ref: historyRef(R), res: ps.map(p => ({ id: p.id, name: p.name, ...res.get(p.id) })) });
  L.phase = "reveal";
  setTimer(R.kind === "aov" ? 4500 : R.kind === "spy" || R.kind === "joke" || R.kind === "draw" ? 8000 : REVEAL_MS);
  broadcast();
}
/* référence d'une manche pour le récap, sans texte : chacun l'affiche dans sa langue */
function historyRef(R) {
  const h = { kind: R.kind, mode: R.mode, src: R.src };
  for (const f of ["k", "i", "perm", "a", "t", "o", "w", "ink", "ids", "names", "pid", "pname", "choice", "ti", "result", "pi", "spy", "caught", "counts", "win"]) if (R[f] !== undefined) h[f] = R[f];
  if (R.kind === "draw") h.w = R.w;
  if (R.kind === "spy") h.w = R.w;
  if (R.kind === "joke") { h.order = R.order; h.texts = R.order.map(id => R.answers[id]); h.got = R.got; }
  return h;
}
function nextRound() {
  if (!L || L.phase !== "reveal") return;
  clearTimeout(L.timer);
  if (L.qIndex + 1 >= L.nbQ) { L.phase = "end"; L.phaseEnd = 0; L.timeTotal = 0; broadcast(); return; }
  L.qIndex++; startRound();
}
function backToLobby() {
  if (!L || L.phase !== "end") return;
  L.phase = "lobby"; for (const p of L.players.values()) { p.score = 0; p.streak = 0; }
  broadcast();
}
function hostUpdateProfile(id, prof) {
  const p = L && L.players.get(id); if (!p) return;
  p.name = String(prof.name || p.name).slice(0, 18);
  p.avatar = typeof prof.avatar === "string" && prof.avatar.startsWith("data:image/") ? prof.avatar : "";
  broadcast();
}
function hostRemove(id) {
  if (!L || !L.players.has(id)) return;
  L.players.delete(id); conns.delete(id);
  if (!L.players.size) return;
  const R = L.round;
  if (L.phase === "question" && R && (R.kind === "aov" || R.kind === "draw") && R.pid === id) {
    if (R.kind === "aov") R.result = false;
    return reveal();
  }
  if (L.phase === "question" && R && R.kind !== "aov") return afterAction();
  broadcast();
}

/* créer un lobby : on réserve l'identifiant PeerJS correspondant au code */
function createLobby(tries = 0) {
  cleanup(); showWarn("");
  if (typeof Peer === "undefined") return showWarn(tr("netFail"));
  const code = newCode();
  $("createBtn").disabled = true;
  peer = new Peer(PEER_PREFIX + code);
  peer.on("open", () => {
    role = "host"; $("createBtn").disabled = false;
    const last = store.get("bz_lastThemes");
    const lastMode = store.get("bz_lastMode");
    L = { code, host: me.id, mode: MODES[lastMode] ? lastMode : "quiz",
      themes: Array.isArray(last) && last.length ? last.filter(k => THEMES[k]) : ["valorant", "fortnite", "dbz", "marvel"],
      nbQ: 10, dur: 15, phase: "lobby", qIndex: 0, round: null, history: [], decks: {}, quizQueue: [], turn: 0,
      gameNo: 0, timer: null, phaseEnd: 0, timeTotal: 0, roundStart: 0, players: new Map() };
    L.players.set(me.id, { id: me.id, name: me.name, avatar: me.avatar, score: 0, streak: 0, answer: null });
    sfx.join(); broadcast();
  });
  peer.on("connection", conn => {
    conn.on("data", msg => {
      if (!msg || typeof msg !== "object" || !L) return;
      const pid = conn.playerId;
      if (msg.type === "join") {
        const prof = msg.profile || {};
        const id = String(prof.id || conn.peer).slice(0, 40);
        if (!L.players.has(id) && L.players.size >= MAX_PLAYERS) { conn.send({ type: "error", err: "lobbyFull" }); return; }
        conn.playerId = id; conns.set(id, conn);
        const ex = L.players.get(id);
        const av = typeof prof.avatar === "string" && prof.avatar.startsWith("data:image/") ? prof.avatar : "";
        if (ex) { ex.name = String(prof.name || ex.name).slice(0, 18); ex.avatar = av || ex.avatar; }
        else { L.players.set(id, { id, name: String(prof.name || "?").slice(0, 18), avatar: av, score: 0, streak: 0, answer: null }); sfx.join(); }
        broadcast();
        if (L.phase === "question" && L.round && L.round.kind === "draw") conn.send({ type: "strokes", all: L.round.strokes });
      } else if (msg.type === "answer") hostAnswer(pid, msg.c);
      else if (msg.type === "text") hostText(pid, msg);
      else if (msg.type === "aov") hostAov(pid, msg);
      else if (msg.type === "drawPick") hostDrawPick(pid, Number(msg.w));
      else if (msg.type === "stroke") hostStroke(pid, msg.seg);
      else if (msg.type === "profile") hostUpdateProfile(pid, msg.profile || {});
      else if (msg.type === "leave") hostRemove(pid);
    });
    conn.on("close", () => { if (conn.playerId && conns.get(conn.playerId) === conn) hostRemove(conn.playerId); });
  });
  peer.on("error", err => {
    $("createBtn").disabled = false;
    if (err.type === "unavailable-id" && tries < 3) return createLobby(tries + 1);
    if (role === "host") return;
    showWarn(tr("createFail"));
    cleanup(); show("home");
  });
  peer.on("disconnected", () => { try { peer.reconnect(); } catch (e) {} });
}

/* rejoindre un lobby : on se connecte à l'hôte */
function joinLobby(code) {
  cleanup(); showWarn("");
  if (typeof Peer === "undefined") return showWarn(tr("netFail"));
  $("joinBtn").disabled = true; $("joinBtn").textContent = tr("joining");
  peer = new Peer();
  const done = () => { $("joinBtn").disabled = false; $("joinBtn").textContent = tr("join"); };
  const fail = key => { done(); toast(tr(key)); sfx.bad(); cleanup(); show("home"); };
  const timeout = setTimeout(() => { if (!state) fail("noLobby"); }, 12000);
  peer.on("open", () => {
    hostConn = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: "json" });
    hostConn.on("open", () => { role = "guest"; hostConn.send({ type: "join", profile: me }); });
    hostConn.on("data", msg => {
      if (msg.type === "state") { if (!state) { clearTimeout(timeout); done(); sfx.join(); } applyState(msg.state); }
      else if (msg.type === "stroke") applyStroke(msg.seg);
      else if (msg.type === "strokes") { strokes = msg.all || []; redrawBoard(); }
      else if (msg.type === "error") { clearTimeout(timeout); fail(msg.err); }
    });
    hostConn.on("close", () => { if (role === "guest") { cleanup(); show("home"); showWarn(tr("hostLeft")); } });
  });
  peer.on("error", err => { clearTimeout(timeout); fail(err.type === "peer-unavailable" ? "noLobby" : "connFail"); });
}

function leave() {
  if (role === "guest") send({ type: "leave" });
  setTimeout(cleanup, 150);
  if (L) clearTimeout(L.timer);
  state = null; lastPhaseKey = null; $("countdown").hidden = true; show("home");
  history.replaceState(null, "", location.pathname);
}

/* actions du joueur, qu'il soit hôte ou invité */
function act(msg) {
  if (role !== "host") return send(msg);
  if (msg.type === "answer") hostAnswer(me.id, msg.c);
  else if (msg.type === "text") hostText(me.id, msg);
  else if (msg.type === "aov") hostAov(me.id, msg);
  else if (msg.type === "drawPick") hostDrawPick(me.id, msg.w);
  else if (msg.type === "stroke") hostStroke(me.id, msg.seg);
}

/* =========================================================
   Interface
   ========================================================= */
function needName() { if (!me.name) { toast(tr("needName")); $("pseudo").focus(); vibrate(60); return true; } return false; }
$("createBtn").onclick = () => { audio(); if (!needName()) createLobby(); };
$("joinBtn").onclick = () => {
  audio(); if (needName()) return;
  const c = $("joinCode").value.trim().toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(c)) return toast(tr("codeLen"));
  joinLobby(c);
};
$("joinCode").addEventListener("input", e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); });
$("joinCode").addEventListener("keydown", e => { if (e.key === "Enter") $("joinBtn").click(); });
$("leaveBtn").onclick = leave;
$("homeBtn").onclick = leave;
$("logo").onclick = () => { if (!state) show("home"); };
$("copyCode").onclick = () => copy(state.code, tr("copied"));
$("copyLink").onclick = () => copy(`${location.origin}${location.pathname}?code=${state.code}`, tr("linkCopied"));

function show(screen) { for (const s of ["home", "lobby", "game", "end"]) $(s).hidden = s !== screen; }
const isHost = () => role === "host";
const ranked = () => state.players.slice().sort((a, b) => b.score - a.score);
const catVars = k => THEMES[k] ? `--c1:${THEMES[k].c[0]};--c2:${THEMES[k].c[1]}` : "";
const modeVars = m => MODES[m] ? `--c1:${MODES[m].c[0]};--c2:${MODES[m].c[1]}` : "";
const playerById = id => state && state.players.find(p => p.id === id);
const nameOf = (id, fallback) => (playerById(id) || {}).name || fallback || "?";

function boardHTML(list, showPlus, offset = 0) {
  return list.map((p, i) => `<li class="${p.id === me.id ? "me" : ""}"><span class="rank">${i + 1 + offset}</span>${avatarHTML(p, 34)}<span class="pname">${esc(p.name)}${p.streak >= 2 ? `<span class="streak">🔥${p.streak}</span>` : ""}</span><span class="pts">${showPlus && p.pts > 0 ? `<span class="plus">+${fmt(p.pts)}</span>` : ""}${fmt(p.score)}</span></li>`).join("");
}

/* ---------- Texte d'une manche dans la langue du joueur ---------- */
function qv(q) {
  const v = { t: "", o: [], a: q.a, sub: "", style: "", color: "", ex: "", unit: "", two: false };
  switch (q.src) {
    case "quiz": { const x = themeQ(q.k, q.i); v.t = x[0]; v.o = q.perm.map(j => x[1 + j]); break; }
    case "vf": { const x = cget("vf", q.i); v.t = x[0]; v.ex = q.a != null ? x[1] : ""; v.o = [tr("vTrue"), tr("vFalse")]; v.two = true; break; }
    case "emoji": { const x = cget("emoji", q.i); v.t = EMOJI[q.i][0]; v.o = q.perm.map(j => x[j]); v.style = "emoji"; v.sub = tr("emojiSub"); break; }
    case "calc": v.t = q.t; v.o = q.o; v.style = "calc"; v.sub = tr("calcSub"); break;
    case "color": v.t = colorName(q.w); v.color = COULEURS[q.ink].c; v.o = q.o.map(colorName); v.style = "stroop"; v.sub = tr("stroopSub"); break;
    case "tp": v.t = tr("tpQ"); v.o = cget("tp", q.i); v.two = true; break;
    case "qps": v.t = tr("qpsQ", { x: cget("qps", q.i) }); v.o = q.ids.map((id, i) => nameOf(id, q.names[i])); v.sub = tr("qpsSub"); break;
    case "jnj": v.t = tr("jnjQ", { x: cget("jnj", q.i) }); v.o = [tr("jnjYesBtn"), tr("jnjNoBtn")]; v.two = true; v.sub = tr("jnjSub"); break;
    case "estim": { const x = cget("estim", q.i); v.t = x[0]; v.unit = x[1]; v.sub = tr("estimSub"); break; }
    case "reflex": v.t = tr("reflexQ"); break;
    case "aov": v.t = tr("aovQ"); break;
    case "draw": v.t = q.w != null ? wordL(q.w) : q.masks ? q.masks[LANG_IDX[LANG]] : tr("drawTitle"); v.style = q.w == null && q.masks ? "mask" : ""; break;
    case "spy": v.t = tr("spyTitle"); break;
    case "joke": v.t = promptL(q.pi); v.style = "prompt"; break;
  }
  return v;
}
function roundLabel(q) {
  if (q.src === "quiz" && THEMES[q.k]) return { txt: `${THEMES[q.k].i} ${themeName(q.k)}`, vars: catVars(q.k) };
  return { txt: `${MODES[q.mode].i} ${modeT(q.mode).n}`, vars: modeVars(q.mode) };
}

/* ---------- Application de l'état reçu ---------- */
let lastPhaseKey = null, lastPlayerCount = 0, lastRoundKey = null, lastStepKey = null;
function applyState(s) {
  const prev = state;
  state = s;
  deadline = s.timeLeft >= 0 ? Date.now() + s.timeLeft : 0;
  const roundKey = s.gameNo + ":" + s.qIndex;
  if ((s.phase === "question" || s.phase === "reveal") && roundKey !== lastRoundKey) {
    lastRoundKey = roundKey; myChoice = null; numSent = null; reflexState = null; lastSec = null; textSent = null;
    $("numInput").value = ""; $("guessInput").value = "";
    if (s.question && s.question.kind === "reflex") { reflexGoAt = Date.now() + s.question.goIn; reflexState = "wait"; }
    if (s.question && s.question.kind === "draw" && role === "host") { /* l'hôte garde ses traits */ }
    strokes = []; myStrokeCount = 0; redrawBoard();
  }
  const q = s.question;
  const stepKey = roundKey + ":" + (q && q.step);
  if (stepKey !== lastStepKey) { lastStepKey = stepKey; myChoice = s.phase === "question" && q && (q.kind === "spy" || q.kind === "joke") ? null : myChoice; }
  const key = s.phase + ":" + s.gameNo + ":" + s.qIndex;
  if (key !== lastPhaseKey) { lastPhaseKey = key; onPhaseChange(s, prev); }
  if (s.phase === "end") recordGame(s);
  render();
}
function onPhaseChange(s) {
  if (s.phase === "countdown") lastCd = null;
  if (s.phase === "question") sfx.whoosh();
  if (s.phase === "reveal") {
    const mine = s.players.find(p => p.id === me.id);
    const q = s.question;
    let good = mine && mine.pts > 0;
    if (q && q.kind === "aov") good = q.result;
    if (good) { sfx.good(); vibrate(40); if (mine && mine.streak >= 3) confetti(60, "center"); }
    else if (q && q.kind !== "vote") { sfx.bad(); vibrate([60, 40, 60]); }
    else sfx.pop();
  }
  if (s.phase === "end") setTimeout(() => { sfx.fanfare(); confetti(180); }, 900);
}

function render() {
  if (!state) return show("home");
  $("countdown").hidden = state.phase !== "countdown";
  if (state.phase === "lobby") { show("lobby"); renderLobby(); }
  else if (state.phase === "countdown") { show("lobby"); renderLobby(); renderCountdown(); }
  else if (state.phase === "question" || state.phase === "reveal") { show("game"); renderGame(); }
  else { show("end"); renderEnd(); }
}

/* ---------- Lobby ---------- */
function buildModeButtons() {
  $("modes").innerHTML = MODE_ORDER.map(m => `<button class="mode" data-m="${m}" aria-pressed="false" style="${modeVars(m)}"><span class="ic">${MODES[m].i}</span><span class="nm">${esc(modeT(m).n)}</span></button>`).join("");
}
$("modes").onclick = e => {
  const b = e.target.closest(".mode"); if (!b || !isHost() || !L) return;
  L.mode = b.dataset.m; store.set("bz_lastMode", L.mode); sfx.select(); broadcast();
};
let famFilter = "all", search = "";
function renderFamTabs() {
  const sel = state ? state.themes.length : 0;
  const tabs = [{ id: "all", n: tr("famAll"), i: "✨", count: THEME_KEYS.length }, { id: "sel", n: tr("famSel"), i: "✅", count: sel },
    ...FAMILIES.map(f => ({ id: f.id, n: famName(f.id), i: f.i, count: THEME_KEYS.filter(k => THEMES[k].f === f.id).length }))];
  $("famTabs").innerHTML = tabs.map(t => `<button role="tab" data-f="${t.id}" aria-selected="${t.id === famFilter}">${t.i} ${esc(t.n)}<b>${t.count}</b></button>`).join("");
}
const fold = s => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
function renderCats() {
  const sel = new Set(state.themes);
  const q = fold(search.trim());
  const keys = THEME_KEYS.filter(k => {
    const t = THEMES[k];
    if (famFilter === "sel" && !sel.has(k)) return false;
    if (famFilter !== "all" && famFilter !== "sel" && t.f !== famFilter) return false;
    if (q && !fold(themeName(k)).includes(q) && !fold(t.n).includes(q)) return false;
    return true;
  });
  $("cats").innerHTML = keys.length ? keys.map(k => {
    const t = THEMES[k];
    return `<button class="cat" data-k="${k}" aria-pressed="${sel.has(k)}" style="${catVars(k)}"><span class="tick">✓</span><span class="ic">${t.i}</span><span><span class="nm">${esc(themeName(k))}</span><br><span class="qc">${tr("qCount", { n: t.q.length })}</span></span></button>`;
  }).join("") : `<p class="empty">${esc(tr("noMatch", { q: search }))}</p>`;
}
function setThemes(list) {
  if (!isHost() || !L) return;
  L.themes = [...new Set(list)].filter(k => THEMES[k]);
  store.set("bz_lastThemes", L.themes);
  broadcast();
}
$("famTabs").onclick = e => { const b = e.target.closest("button"); if (!b) return; famFilter = b.dataset.f; sfx.select(); renderFamTabs(); renderCats(); };
$("catSearch").addEventListener("input", e => { search = e.target.value; if (search && famFilter === "sel") famFilter = "all"; renderFamTabs(); renderCats(); });
$("cats").onclick = e => {
  const b = e.target.closest(".cat"); if (!b || !isHost()) return;
  const k = b.dataset.k, sel = new Set(L.themes);
  if (sel.has(k)) sel.delete(k); else sel.add(k);
  sfx.select(); setThemes([...sel]);
};
$("pickMix").onclick = () => { setThemes(THEME_KEYS); sfx.good(); toast(tr("megaToast")); };
$("pickRandom").onclick = () => { setThemes(shuffle(THEME_KEYS).slice(0, 5)); sfx.select(); toast(tr("randomToast")); };
$("pickNone").onclick = () => { setThemes([]); sfx.pop(); };
for (const id of ["nbQ", "dur"]) {
  $(id).onclick = e => {
    const b = e.target.closest("button"); if (!b || !isHost() || !L) return;
    L[id] = +b.dataset.v; sfx.select(); broadcast();
  };
}
$("startBtn").onclick = () => { if (isHost()) { audio(); startGame(); } };

function renderLobby() {
  const host = isHost(), m = modeT(state.mode), usesCats = state.mode === "quiz" || state.mode === "mix";
  $("lobbyCode").textContent = state.code;
  $("nbPlayers").textContent = state.players.length;
  if (state.players.length > lastPlayerCount && lastPlayerCount && !host) sfx.join();
  lastPlayerCount = state.players.length;
  $("players").innerHTML = state.players.map(p => `<div class="pl">${p.id === state.host ? `<span class="crown" title="${esc(tr("host"))}">👑</span>` : ""}${avatarHTML(p, 34)}<b>${esc(p.name)}${p.id === me.id ? " " + esc(tr("you")) : ""}</b></div>`).join("");

  for (const b of $("modes").children) { b.setAttribute("aria-pressed", b.dataset.m === state.mode); b.disabled = !host; }
  $("modePill").textContent = `${MODES[state.mode].i} ${m.n}`; $("modePill").setAttribute("style", modeVars(state.mode));
  const few = ["dessin", "imposteur", "blagues", "qps"].includes(state.mode) && state.players.length < 3 ? `<p class="hint">${esc(tr("needPlayers"))}</p>` : "";
  $("modeInfo").innerHTML = `<b>${MODES[state.mode].i} ${esc(m.n)}</b><p>${esc(m.d)} ${esc(m.how)}</p>${few}${host ? "" : `<p>${esc(tr("hostPicks"))}</p>`}`;

  for (const id of ["nbQ", "dur"]) for (const b of $(id).children) { b.setAttribute("role", "radio"); b.setAttribute("aria-checked", +b.dataset.v === state[id]); b.disabled = !host; }
  $("durSeg").hidden = ["aov", "reflexe", "dessin", "imposteur", "blagues"].includes(state.mode);

  $("catsCard").hidden = !usesCats;
  $("catsTitle").textContent = tr(state.mode === "mix" ? "catsMix" : "cats");
  $("selCount").textContent = state.themes.length;
  $("hostPicker").hidden = !host; $("guestPicker").hidden = host;
  if (usesCats) {
    if (host) { renderFamTabs(); renderCats(); }
    else {
      $("guestHint").textContent = state.themes.length ? tr("guestChosen") : tr(state.mode === "mix" ? "allCats" : "guestWait");
      $("selChips").innerHTML = state.themes.slice(0, 40).map(k => `<span style="${catVars(k)}">${THEMES[k].i} ${esc(themeName(k))}</span>`).join("") + (state.themes.length > 40 ? `<span style="--c1:#444;--c2:#222">+${state.themes.length - 40}</span>` : "");
    }
  }
  $("startBtn").hidden = !host; $("waitHost").hidden = host;
  const n = state.themes.length;
  $("startBtn").disabled = state.mode === "quiz" && !n;
  $("startHint").textContent = state.mode === "quiz" && !n ? tr("needCat")
    : `${MODES[state.mode].i} ${m.n} · ${tr("roundsN", { n: state.nbQ })}` + (state.mode === "quiz" ? ` · ${tr("catsN", { n })}` : "");
}

/* ---------- Compte à rebours ---------- */
let lastCd = null;
function renderCountdown() {
  const left = Math.max(0, deadline - Date.now());
  const n = left > 3000 ? 3 : left > 2000 ? 2 : left > 1000 ? 1 : 0;
  const label = n ? String(n) : tr("go");
  if (label !== lastCd) {
    lastCd = label;
    const el = $("cdNum"); el.textContent = label; el.style.animation = "none"; void el.offsetWidth; el.style.animation = "";
    if (n) sfx.count(); else sfx.go();
    const m = modeT(state.mode);
    if (state.mode === "quiz") {
      const names = state.themes.slice(0, 6).map(k => THEMES[k].i + " " + themeName(k)).join("  ·  ");
      $("cdCats").textContent = state.themes.length > 6 ? names + `  · +${state.themes.length - 6}` : names;
    } else $("cdCats").textContent = `${MODES[state.mode].i} ${m.n} — ${m.how}`;
  }
}

/* ---------- Manche en cours ---------- */
let myChoice = null, numSent = null, lastSec = null, reflexGoAt = 0, reflexState = null, textSent = null;
const SHAPES = ["▲", "◆", "●", "■"];
const ANS_COLORS = ["var(--a1)", "var(--a2)", "var(--a3)", "var(--a4)"];

function renderGame() {
  const q = state.question; if (!q) return;
  const v = qv(q);
  const mine = state.players.find(p => p.id === me.id);
  const reveal = state.phase === "reveal";
  if (reveal && mine && (q.kind === "choice" || q.kind === "vote")) myChoice = mine.choice;

  const lab = roundLabel(q);
  $("qNum").textContent = `${state.qIndex + 1}/${state.total}`;
  $("qCat").textContent = lab.txt; $("qCat").setAttribute("style", lab.vars);
  $("qProg").style.width = `${(state.qIndex + (reveal ? 1 : 0)) / state.total * 100}%`;
  $("game").querySelector(".ring").hidden = q.kind === "aov";

  const qt = $("qText");
  const qtSig = [state.gameNo, state.qIndex, LANG, v.t].join(":");
  if (qt.dataset.sig !== qtSig) {
    const isNew = !qt.dataset.sig || qt.dataset.sig.split(":").slice(0, 2).join(":") !== qtSig.split(":").slice(0, 2).join(":");
    qt.dataset.sig = qtSig;
    qt.textContent = v.t;
    qt.className = "question" + (v.style ? " " + v.style : "");
    qt.style.color = v.color || "";
    qt.dir = v.style === "mask" ? "auto" : "";
    if (isNew) { qt.style.animation = "none"; void qt.offsetWidth; qt.style.animation = ""; }
  }
  $("qSub").hidden = !v.sub; $("qSub").textContent = v.sub;

  const showAnswers = q.kind === "choice" || q.kind === "vote";
  $("answers").hidden = !showAnswers;
  if (showAnswers) renderAnswers(q, v, reveal);
  renderNumber(q, v, reveal);
  renderReflex(q, reveal);
  renderAov(q, reveal);
  renderDraw(q, reveal);
  renderTextGame(q, reveal);

  const answered = state.players.filter(p => p.answered);
  const showWho = !reveal && !["aov", "draw"].includes(q.kind);
  $("answeredRow").innerHTML = showWho ? answered.map(p => avatarHTML(p, 30)).join("") : "";
  const verb = q.kind === "vote" || ((q.kind === "spy" || q.kind === "joke") && q.step === "vote") ? "voted" : "answered";
  $("gStatus").textContent = !showWho ? "" : tr(verb, { n: answered.length, t: state.players.length });

  $("reveal").hidden = !reveal;
  if (reveal) renderReveal(q, v, mine);
  updateTimer();
}

function renderAnswers(q, v, reveal) {
  const isPlayers = q.src === "qps";
  const box = $("answers");
  box.className = "answers" + (v.two ? " two" : "") + (isPlayers ? " players" : "");
  const sig = [state.gameNo, state.qIndex, state.phase, myChoice, LANG, v.o.length].join(":");
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  box.innerHTML = v.o.map((o, i) => {
    let cls = "answer";
    const col = q.src === "vf" ? (i === 0 ? "var(--a4)" : "var(--a1)") : q.src === "jnj" ? (i === 0 ? "var(--a1)" : "var(--a2)") : ANS_COLORS[i % 4];
    if (reveal) {
      if (q.kind === "choice") { cls += i === q.a ? " right" : " dim"; if (i === myChoice && i !== q.a) cls += " wrong chosen"; }
      else { const win = (q.win || []).includes(i); cls += win ? " right" : " dim"; if (i === myChoice) cls += " chosen"; }
    } else if (myChoice !== null) cls += i === myChoice ? " chosen" : " dim";
    const lead = isPlayers ? avatarHTML(playerById(q.ids[i]) || { name: o }, 34) : `<span class="sh">${q.src === "vf" ? (i === 0 ? "✔" : "✘") : SHAPES[i % 4]}</span>`;
    const count = reveal && q.kind === "vote" && q.counts ? `<span class="vote-count">${q.counts[i]}</span>` : "";
    return `<button class="${cls}" data-i="${i}" style="--c:${col}" ${reveal || myChoice !== null ? "disabled" : ""}>${lead}<span>${esc(o)}</span>${count}</button>`;
  }).join("");
}
$("answers").onclick = e => {
  const b = e.target.closest(".answer");
  if (!b || b.disabled || !state || state.phase !== "question" || myChoice !== null) return;
  myChoice = +b.dataset.i; sfx.answer(); vibrate(25);
  act({ type: "answer", c: myChoice });
  renderGame();
};

function renderNumber(q, v, reveal) {
  const show = q.kind === "number" && !reveal;
  $("numBox").hidden = !show;
  if (!show) return;
  $("numUnit").textContent = v.unit || "";
  const sent = numSent !== null;
  $("numInput").disabled = sent; $("numSend").disabled = sent;
  $("numSend").textContent = tr(sent ? "sent" : "send");
}
$("numBox").addEventListener("submit", e => {
  e.preventDefault();
  if (!state || state.phase !== "question" || numSent !== null) return;
  const val = parseFloat(String($("numInput").value).replace(",", "."));
  if (!isFinite(val)) return toast(tr("typeNumber"));
  numSent = val; sfx.answer(); vibrate(25);
  act({ type: "answer", c: val });
  renderGame();
});

/* réflexes */
let reflexMs = 0, reflexGoPerf = 0;
function renderReflex(q, reveal) {
  const pad = $("reflexPad");
  const show = q.kind === "reflex" && !reveal;
  pad.hidden = !show;
  if (!show) return;
  pad.className = "reflex-pad" + (reflexState === "go" ? " go" : reflexState === "done" ? " done" : reflexState === "fail" ? " fail" : "");
  const t = $("reflexTxt"), s = $("reflexSub");
  if (reflexState === "wait") { t.textContent = tr("reflexWait"); s.textContent = tr("reflexWaitSub"); }
  else if (reflexState === "go") { t.textContent = tr("reflexGo"); s.textContent = tr("reflexGoSub"); }
  else if (reflexState === "done") { t.textContent = `${reflexMs} ms`; s.textContent = tr("waitingOthers"); }
  else if (reflexState === "fail") { t.textContent = tr("tooEarly"); s.textContent = tr("reflexFailSub"); }
}
function reflexTap() {
  if (!state || state.phase !== "question" || !state.question || state.question.kind !== "reflex") return;
  if (reflexState === "wait") { reflexState = "fail"; sfx.bad(); vibrate(120); act({ type: "answer", c: -1 }); }
  else if (reflexState === "go") { reflexMs = Math.max(1, Math.round(performance.now() - reflexGoPerf)); reflexState = "done"; sfx.answer(); vibrate(25); act({ type: "answer", c: reflexMs }); }
  renderGame();
}
$("reflexPad").addEventListener("pointerdown", e => { e.preventDefault(); reflexTap(); });
addEventListener("keydown", e => { if (e.code === "Space" && !$("reflexPad").hidden) { e.preventDefault(); reflexTap(); } });

/* action ou vérité */
function renderAov(q, reveal) {
  const box = $("aovBox");
  box.hidden = q.kind !== "aov";
  if (q.kind !== "aov") return;
  const p = playerById(q.pid) || { name: q.pname };
  const mineTurn = q.pid === me.id;
  const sig = [state.gameNo, state.qIndex, q.choice, q.result, state.phase, LANG].join(":");
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  let html = `<div class="who">${avatarHTML(p, 46)}<span>${esc(mineTurn ? tr("aovYourTurn") : tr("aovTurnOf", { name: p.name }))}</span></div>`;
  if (!q.choice) {
    html += mineTurn
      ? `<div class="aov-choice"><button class="act" data-c="action">🔥 ${esc(tr("action"))}<small>${esc(tr("actionSub"))}</small></button><button class="ver" data-c="verite">💬 ${esc(tr("truth"))}<small>${esc(tr("truthSub"))}</small></button></div>`
      : `<p class="wait"><span class="dots"><i></i><i></i><i></i></span> ${esc(tr("aovChoosing", { name: p.name }))}</p>`;
    if (isHost() && !mineTurn) html += `<div class="aov-actions"><button class="btn small ghost" data-skip="1">${esc(tr("skipTurn"))}</button></div>`;
  } else {
    const isAct = q.choice === "action";
    const text = isAct ? cget("actions", q.ti) : cget("verites", q.ti);
    html += `<div class="aov-card" style="--c1:${isAct ? "#ff4d6d" : "#3a86ff"};--c2:${isAct ? "#fb5607" : "#8338ec"}"><span class="tag">${isAct ? "🔥 " + esc(tr("action")) : "💬 " + esc(tr("truth"))}</span><p>${esc(text)}</p></div>`;
    if (q.result === null && !reveal) {
      if (mineTurn || isHost()) html += `<div class="aov-actions"><button class="btn ok" data-ok="1">${esc(tr("aovOk"))}</button><button class="btn no" data-ok="0">${esc(tr("aovNo"))}</button></div>`;
      if (!mineTurn) html += `<p class="wait">${esc(tr(isHost() ? "aovHostHint" : "aovWatch"))}</p>`;
    }
  }
  box.innerHTML = html;
}
$("aovBox").onclick = e => {
  const b = e.target.closest("button"); if (!b || !state) return;
  if (b.dataset.c) { sfx.select(); act({ type: "aov", step: "choose", c: b.dataset.c }); }
  else if (b.dataset.ok !== undefined) act({ type: "aov", step: "done", ok: b.dataset.ok === "1" });
  else if (b.dataset.skip) act({ type: "aov", step: "skip" });
};

/* =========================================================
   Dessine et devine
   ========================================================= */
const board = $("board"), bctx = board.getContext("2d");
let strokes = [], myStrokeCount = 0;
const PALETTE = ["#111111", "#ffffff", "#ef4444", "#f97316", "#facc15", "#22c55e", "#3b82f6", "#a855f7", "#ec4899", "#8b5a2b"];
const SIZES = [0.006, 0.014, 0.03];
let penColor = PALETTE[0], penSize = SIZES[1], erasing = false;

$("swatches").innerHTML = PALETTE.map(c => `<button type="button" class="sw" data-c="${c}" style="--sw:${c}" aria-label="${c}"></button>`).join("");
$("sizes").innerHTML = SIZES.map((s, i) => `<button type="button" class="sz" data-s="${i}"><i style="--d:${6 + i * 7}px"></i></button>`).join("");
function renderTools() {
  for (const b of $("swatches").children) b.setAttribute("aria-pressed", !erasing && b.dataset.c === penColor);
  for (const b of $("sizes").children) b.setAttribute("aria-pressed", SIZES[+b.dataset.s] === penSize);
  $("eraserBtn").setAttribute("aria-pressed", erasing);
}
$("swatches").onclick = e => { const b = e.target.closest(".sw"); if (!b) return; penColor = b.dataset.c; erasing = false; renderTools(); };
$("sizes").onclick = e => { const b = e.target.closest(".sz"); if (!b) return; penSize = SIZES[+b.dataset.s]; renderTools(); };
$("eraserBtn").onclick = () => { erasing = !erasing; renderTools(); };
$("clearBtn").onclick = () => { const seg = { clear: true }; applyStroke(seg); act({ type: "stroke", seg }); };
$("undoBtn").onclick = () => {
  const mineIds = [...new Set(strokes.map(s => s.s))];
  const last = mineIds[mineIds.length - 1]; if (!last) return;
  const seg = { undo: last }; applyStroke(seg); act({ type: "stroke", seg });
};
renderTools();

function sizeBoard() {
  const w = $("canvasWrap").clientWidth; if (!w) return;
  const d = Math.min(2, window.devicePixelRatio || 1);
  const h = Math.round(w * 3 / 4);
  if (board.width !== Math.round(w * d)) { board.width = Math.round(w * d); board.height = Math.round(h * d); }
  redrawBoard();
}
addEventListener("resize", sizeBoard);
function drawSeg(seg) {
  const W = board.width, H = board.height;
  bctx.lineCap = "round"; bctx.lineJoin = "round";
  bctx.strokeStyle = seg.c; bctx.lineWidth = Math.max(1, seg.w * W);
  const p = seg.p;
  bctx.beginPath();
  bctx.moveTo(p[0][0] * W, p[0][1] * H);
  if (p.length === 1) bctx.lineTo(p[0][0] * W + .1, p[0][1] * H + .1);
  for (let i = 1; i < p.length; i++) bctx.lineTo(p[i][0] * W, p[i][1] * H);
  bctx.stroke();
}
function redrawBoard() {
  bctx.fillStyle = "#ffffff"; bctx.fillRect(0, 0, board.width, board.height);
  for (const s of strokes) drawSeg(s);
}
function applyStroke(seg) {
  if (!seg) return;
  if (seg.clear) { strokes = []; redrawBoard(); }
  else if (seg.undo) { strokes = strokes.filter(s => s.s !== seg.undo); redrawBoard(); }
  else if (Array.isArray(seg.p) && seg.p.length) { strokes.push(seg); drawSeg(seg); }
}
/* dessin au doigt ou à la souris, envoyé par petits morceaux */
let drawing = null, pending = [], lastPt = null, flushT = null;
function canDraw() { const q = state && state.question; return q && q.kind === "draw" && state.phase === "question" && q.pid === me.id && q.picked; }
function ptOf(e) { const r = board.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))].map(n => Math.round(n * 1000) / 1000); }
function flush() {
  flushT = null;
  if (!drawing || !pending.length) return;
  const seg = { s: drawing.id, c: drawing.c, w: drawing.w, p: lastPt ? [lastPt, ...pending] : pending.slice() };
  lastPt = pending[pending.length - 1]; pending = [];
  applyStroke(seg); act({ type: "stroke", seg });
}
board.addEventListener("pointerdown", e => {
  if (!canDraw()) return;
  e.preventDefault(); try { board.setPointerCapture(e.pointerId); } catch (err) {}
  drawing = { id: me.id + "-" + (++myStrokeCount), c: erasing ? "#ffffff" : penColor, w: erasing ? SIZES[2] * 1.4 : penSize };
  lastPt = null; pending = [ptOf(e)]; flush();
});
board.addEventListener("pointermove", e => {
  if (!drawing) return;
  pending.push(ptOf(e));
  if (!flushT) flushT = setTimeout(flush, 40);
});
const endDraw = () => { if (!drawing) return; clearTimeout(flushT); flush(); drawing = null; lastPt = null; };
board.addEventListener("pointerup", endDraw); board.addEventListener("pointercancel", endDraw);

function renderDraw(q, reveal) {
  const box = $("drawBox");
  box.hidden = q.kind !== "draw";
  if (q.kind !== "draw") return;
  const drawer = playerById(q.pid) || { name: q.pname };
  const mineTurn = q.pid === me.id;
  const found = new Set(q.found || []);
  let info = "";
  if (!q.picked) info = mineTurn ? tr("drawChoose") : tr("drawChoosing", { name: drawer.name });
  else if (mineTurn) info = tr("drawYou");
  else if (found.has(me.id)) info = tr("youFoundShort");
  else info = tr("drawGuess", { name: drawer.name });
  $("drawInfo").innerHTML = `${avatarHTML(drawer, 30)}<span>${esc(info)}</span><span class="found-count">${tr("foundN", { n: found.size, t: Math.max(0, state.players.length - 1) })}</span>`;
  const pickBox = $("drawPick");
  pickBox.hidden = !(mineTurn && !q.picked && q.choices && !reveal);
  if (!pickBox.hidden) pickBox.innerHTML = q.choices.map(w => `<button class="btn" data-w="${w}">${esc(wordL(w))}</button>`).join("");
  $("drawStage").hidden = !q.picked && !reveal;
  $("drawTools").hidden = !(mineTurn && q.picked && !reveal);
  const canGuess = q.picked && !mineTurn && !found.has(me.id) && !reveal;
  $("guessForm").hidden = !canGuess;
  $("chat").innerHTML = (q.chat || []).map(m => m.ok
    ? `<li class="ok">✅ ${esc(tr("foundIt", { name: m.name }))}</li>`
    : `<li><b>${esc(m.name)}</b> ${esc(m.text)}</li>`).join("");
  $("chat").scrollTop = $("chat").scrollHeight;
  if (!$("drawStage").hidden) requestAnimationFrame(sizeBoard);
}
$("drawPick").onclick = e => { const b = e.target.closest("button"); if (!b) return; sfx.select(); act({ type: "drawPick", w: +b.dataset.w }); };
$("guessForm").addEventListener("submit", e => {
  e.preventDefault();
  const text = $("guessInput").value.trim(); if (!text) return;
  $("guessInput").value = "";
  act({ type: "text", kind: "guess", text });
});

/* =========================================================
   L'Imposteur et Réponse la plus drôle
   ========================================================= */
function renderTextGame(q, reveal) {
  const box = $("textBox");
  const on = (q.kind === "spy" || q.kind === "joke") && !reveal;
  box.hidden = !on;
  if (!on) return;
  const sentKey = q.kind + ":" + q.step;
  const done = textSent === sentKey;
  const sig = [state.gameNo, state.qIndex, q.step, LANG, done, myChoice, q.kind === "spy" && q.step === "vote" ? JSON.stringify(q.clues) : ""].join("|");
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  let html = "";
  if (q.kind === "spy" && q.step === "clue") {
    html += q.isSpy
      ? `<div class="secret spy"><span class="tag">${esc(tr("spyYou"))}</span><p>${esc(tr("spyYouSub"))}</p></div>`
      : `<div class="secret"><span class="tag">${esc(tr("spyWordLbl"))}</span><b>${esc(wordL(q.w))}</b><p>${esc(tr("spyWordSub"))}</p></div>`;
    html += textForm("clue", tr("cluePh"), 40, done);
  } else if (q.kind === "spy" && q.step === "vote") {
    html += `<p class="step-title">${esc(tr("spyVote"))}</p><div class="pick-list">` + q.ids.map((id, i) => {
      const p = playerById(id) || { name: q.names[i] };
      const self = id === me.id;
      const clue = (q.clues || {})[id];
      return `<button class="pick-row${myChoice === i ? " chosen" : ""}" data-v="${i}" ${self || myChoice !== null ? "disabled" : ""}>${avatarHTML(p, 34)}<span class="pr-name">${esc(p.name)}${self ? " " + esc(tr("you")) : ""}</span><span class="pr-text">${clue ? "« " + esc(clue) + " »" : "—"}</span></button>`;
    }).join("") + `</div>`;
  } else if (q.kind === "joke" && q.step === "write") {
    html += textForm("joke", tr("jokePh"), 80, done);
  } else if (q.kind === "joke" && q.step === "vote") {
    html += `<p class="step-title">${esc(tr("jokeVote"))}</p><div class="pick-list">` + (q.texts || []).map((t, i) => {
      const own = i === q.mine;
      return `<button class="pick-row joke${myChoice === i ? " chosen" : ""}" data-v="${i}" ${own || myChoice !== null ? "disabled" : ""}><span class="pr-text">${esc(t)}</span>${own ? `<small>${esc(tr("jokeOwn"))}</small>` : ""}</button>`;
    }).join("") + `</div>`;
  }
  box.innerHTML = html;
  const inp = box.querySelector("input");
  if (inp && !done && matchMedia("(pointer: fine)").matches) inp.focus();
}
function textForm(kind, ph, max, done) {
  return `<form class="text-form" data-kind="${kind}"><input type="text" maxlength="${max}" placeholder="${esc(ph)}" autocomplete="off" ${done ? "disabled" : ""}><button class="btn" type="submit" ${done ? "disabled" : ""}>${esc(tr(done ? "sent" : "send"))}</button></form>`;
}
$("textBox").addEventListener("submit", e => {
  e.preventDefault();
  const f = e.target.closest(".text-form"); if (!f || !state) return;
  const text = f.querySelector("input").value.trim();
  if (!text) return;
  textSent = state.question.kind + ":" + state.question.step;
  sfx.answer(); act({ type: "text", kind: f.dataset.kind, text });
  renderGame();
});
$("textBox").addEventListener("click", e => {
  const b = e.target.closest(".pick-row"); if (!b || b.disabled || myChoice !== null) return;
  myChoice = +b.dataset.v; sfx.answer(); vibrate(25);
  act({ type: "answer", c: myChoice });
  $("textBox").dataset.sig = ""; renderGame();
});

/* ---------- Correction ---------- */
function renderReveal(q, v, mine) {
  const vEl = $("verdict");
  const pts = mine ? mine.pts : 0;
  let cls = pts > 0 ? "ok" : "ko", title = "", sub = "";
  if (q.kind === "choice") {
    const ok = myChoice === q.a;
    title = tr(ok ? "good" : myChoice === null ? "late" : "miss");
    sub = ok ? tr("pointsN", { n: fmt(pts) }) + (mine.streak >= 2 ? ` · <span class="fire">${esc(tr("streak", { n: mine.streak }))}</span>` : "") : esc(tr("goodAns", { a: v.o[q.a] }));
    if (v.ex) sub += `<br>${esc(v.ex)}`;
  } else if (q.kind === "vote") {
    if (q.src === "jnj") { title = tr(myChoice === 0 ? "jnjYes" : myChoice === 1 ? "jnjNo" : "noAnswer"); sub = myChoice === 0 ? esc(tr("audace", { n: pts })) : ""; cls = myChoice === 0 ? "ok" : ""; }
    else if (q.src === "qps") {
      const names = (q.win || []).map(i => v.o[i]).join(", ");
      title = names ? `${names} 👑` : tr("nobodyVoted");
      sub = esc(tr(pts > 0 ? "qpsMaj" : myChoice === null ? "qpsNoVote" : "qpsMin", { n: pts }));
      cls = "ok";
    } else {
      title = tr(pts > 0 ? "tpMaj" : myChoice === null ? "noVote" : "tpMin");
      sub = esc(pts > 0 ? tr("pointsN", { n: pts }) : tr("tpUnique"));
    }
  } else if (q.kind === "number") {
    title = tr("answerIs", { a: `${fmtNum(q.a)} ${v.unit || ""}`.trim() });
    sub = esc(mine && mine.choice !== null ? tr("youSaid", { v: fmtNum(mine.choice), n: fmt(pts) }) : tr("noAnswer"));
    cls = pts >= 1000 ? "ok" : "";
  } else if (q.kind === "reflex") {
    const c = mine ? mine.choice : null;
    title = c === null ? tr("noAnswer") : c < 0 ? tr("tooEarly") : `${c} ms`;
    sub = pts > 0 ? esc(tr("pointsN", { n: fmt(pts) })) : "";
  } else if (q.kind === "aov") {
    const p = playerById(q.pid) || { name: q.pname };
    title = tr(q.result ? "aovDone" : "aovRefused");
    sub = esc(q.result ? tr("aovWins", { name: p.name }) : p.name);
    cls = q.result ? "ok" : "ko";
  } else if (q.kind === "draw") {
    title = tr("wordWas", { w: wordL(q.w) });
    const n = (q.found || []).length;
    sub = esc(n ? tr("foundN", { n, t: Math.max(0, state.players.length - 1) }) : tr("drawNobody")) + (pts > 0 ? " · " + esc(tr("pointsN", { n: fmt(pts) })) : "");
    cls = pts > 0 ? "ok" : "";
  } else if (q.kind === "spy") {
    const spyName = nameOf(q.spy);
    title = tr(q.caught ? "spyCaught" : "spyEscaped");
    sub = esc(tr("spyWas", { name: spyName })) + " · " + esc(tr("secretWas", { w: wordL(q.w) })) + (pts > 0 ? " · " + esc(tr("pointsN", { n: fmt(pts) })) : "");
    cls = pts > 0 ? "ok" : "ko";
  } else if (q.kind === "joke") {
    title = tr("jokeResults");
    sub = pts > 0 ? esc(tr("pointsN", { n: fmt(pts) })) : "";
    cls = pts > 0 ? "ok" : "";
  }
  vEl.className = "verdict " + cls;
  vEl.innerHTML = `<b>${esc(title)}</b><span>${sub}</span>`;
  $("voteRes").innerHTML = resultRows(q, v);
  $("roundBoard").innerHTML = boardHTML(ranked(), true);
  $("nextBtn").hidden = !isHost();
  $("nextBtn").textContent = tr(state.qIndex + 1 >= state.total ? "seePodium" : "nextRound");
}
function resultRows(q, v) {
  const ps = state.players;
  if (q.kind === "vote") {
    const total = Math.max(1, ps.filter(p => p.choice !== null).length);
    return v.o.map((o, i) => {
      const voters = ps.filter(p => p.choice === i);
      const pct = Math.round(voters.length / total * 100);
      const win = (q.win || []).includes(i);
      return `<div class="vote-row${win ? " win" : ""}" style="--c:${ANS_COLORS[i % 4]}"><span class="bar" style="width:${pct}%"></span><div class="top"><span>${esc(o)}</span><span>${voters.length} · ${pct}%</span></div><div class="who">${voters.map(p => avatarHTML(p, 24)).join("")}</div></div>`;
    }).join("");
  }
  if (q.kind === "number" || q.kind === "reflex") {
    const rows = ps.filter(p => p.choice !== null).sort((a, b) => q.kind === "number" ? Math.abs(a.choice - q.a) - Math.abs(b.choice - q.a) : (a.choice < 0) - (b.choice < 0) || a.choice - b.choice);
    return rows.map((p, i) => `<div class="vote-row${i === 0 && (q.kind === "number" || p.choice >= 0) ? " win" : ""}"><div class="top"><span>${avatarHTML(p, 22)} ${esc(p.name)}</span><span dir="ltr">${q.kind === "number" ? fmtNum(p.choice) + " " + esc(v.unit || "") : p.choice < 0 ? esc(tr("tooEarly")) : p.choice + " ms"}</span></div></div>`).join("");
  }
  if (q.kind === "spy") {
    const total = Math.max(1, Object.keys(q.votes || {}).length);
    return q.ids.map((id, i) => {
      const p = playerById(id) || { name: q.names[i] };
      const voters = Object.entries(q.votes || {}).filter(([, c]) => c === i).map(([vid]) => playerById(vid) || { name: "?" });
      const pct = Math.round(voters.length / total * 100);
      return `<div class="vote-row${id === q.spy ? " win" : ""}" style="--c:${id === q.spy ? "var(--bad)" : "var(--violet)"}"><span class="bar" style="width:${pct}%"></span><div class="top"><span>${avatarHTML(p, 24)} ${esc(p.name)}${id === q.spy ? " 🕵️" : ""}</span><span>${voters.length}</span></div><div class="clue">${(q.clues || {})[id] ? "« " + esc(q.clues[id]) + " »" : "—"}</div><div class="who">${voters.map(x => avatarHTML(x, 22)).join("")}</div></div>`;
    }).join("");
  }
  if (q.kind === "joke") {
    const counts = (q.authors || []).map((_, i) => Object.values(q.votes || {}).filter(c => c === i).length);
    const max = Math.max(0, ...counts);
    return (q.authors || []).map((id, i) => ({ id, i, n: counts[i] })).sort((a, b) => b.n - a.n).map(r => {
      const p = playerById(r.id) || { name: "?" };
      return `<div class="vote-row${r.n === max && max > 0 ? " win" : ""}"><div class="top"><span class="joke-text">${esc(q.texts[r.i])}</span><span>${r.n} 👍</span></div><div class="who">${avatarHTML(p, 22)} <small>${esc(p.name)}</small></div></div>`;
    }).join("");
  }
  return "";
}
$("nextBtn").onclick = () => isHost() && nextRound();

/* ---------- Chrono ---------- */
const RING = 119.4;
function updateTimer() {
  if (!state) return;
  if (state.phase === "countdown") return renderCountdown();
  if ($("game").hidden) return;
  const q = state.question;
  if (q && q.kind === "reflex" && state.phase === "question" && reflexState === "wait" && Date.now() >= reflexGoAt) {
    reflexState = "go"; reflexGoPerf = performance.now(); sfx.go(); vibrate(30); renderReflex(q, false);
  }
  const ring = $("game").querySelector(".ring");
  const left = deadline ? Math.max(0, deadline - Date.now()) : 0;
  if (state.phase === "reveal") {
    $("ringFg").style.strokeDashoffset = RING; $("secs").textContent = "0"; ring.classList.remove("hurry");
    $("autoNext").textContent = tr(state.qIndex + 1 >= state.total ? "podiumIn" : "nextIn", { s: Math.ceil(left / 1000) });
    return;
  }
  if (state.phase !== "question" || !q || q.kind === "aov") return;
  const total = state.timeTotal || 1;
  const sec = Math.ceil(left / 1000);
  $("ringFg").style.strokeDashoffset = q.kind === "reflex" ? 0 : RING * (1 - left / total);
  $("secs").textContent = q.kind === "reflex" ? "⚡" : sec;
  const hurry = q.kind !== "reflex" && sec <= 5 && left > 0;
  ring.classList.toggle("hurry", hurry);
  const waiting = (q.kind === "choice" || q.kind === "vote") ? myChoice === null : q.kind === "number" ? numSent === null : false;
  if (sec !== lastSec) { lastSec = sec; if (hurry && waiting) sfx.hurry(); }
  if (left <= 0 && waiting) {
    $("answers").querySelectorAll("button").forEach(b => b.disabled = true);
    $("numInput").disabled = true; $("numSend").disabled = true;
    $("gStatus").textContent = tr("timeUp");
  }
}
setInterval(updateTimer, 50);

/* ---------- Fin de partie ---------- */
$("againBtn").onclick = () => { if (isHost()) startGame(); };
$("toLobbyBtn").onclick = () => isHost() && backToLobby();
function renderEnd() {
  const r = ranked();
  const myRank = r.findIndex(p => p.id === me.id) + 1;
  $("endSub").textContent = myRank === 1 && r.length > 1 ? tr("endBoss") : myRank ? tr("endRank", { r: ordinal(myRank), n: r.length }) : "";
  $("podium").innerHTML = [1, 0, 2].map(ix => {
    const p = r[ix]; if (!p) return "<div></div>";
    return `<div class="pod p${ix + 1}"><div class="who">${ix === 0 ? '<span class="crown">👑</span>' : ""}${avatarHTML(p, ix === 0 ? 72 : 54)}</div><b>${esc(p.name)}</b><span class="pts">${fmt(p.score)}</span><div class="step">${ix + 1}</div></div>`;
  }).join("");
  $("finalBoard").innerHTML = boardHTML(r.slice(3), false, 3);
  $("againBtn").hidden = !isHost(); $("toLobbyBtn").hidden = !isHost(); $("againWait").hidden = isHost();
  renderRecap();
}
function ordinal(n) {
  if (LANG === "fr") return n === 1 ? "1er" : n + "e";
  if (LANG === "en") { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  return String(n);
}
/* ce que la manche demandait, et sa réponse, dans la langue du joueur */
function recapText(h) {
  const v = qv({ ...h, masks: null });
  let t = v.t, ans = "";
  switch (h.src) {
    case "quiz": case "vf": case "emoji": case "calc": ans = v.o[h.a]; break;
    case "color": t = tr("stroopRecap", { w: colorName(h.w), c: colorName(h.ink) }); ans = colorName(h.ink); break;
    case "tp": t = tr("tpRecap", { a: v.o[0], b: v.o[1] }); ans = (h.win || []).length ? tr("majority", { x: h.win.map(i => v.o[i]).join(" / ") }) : tr("nobodyVoted"); break;
    case "qps": ans = (h.win || []).length ? tr("designated", { x: h.win.map(i => v.o[i]).join(", ") }) : tr("nobodyVoted"); break;
    case "jnj": ans = tr("jnjCount", { n: (h.counts || [0])[0], t: (h.counts || []).reduce((a, b) => a + b, 0) }); break;
    case "estim": ans = `${fmtNum(h.a)} ${v.unit || ""}`.trim(); break;
    case "reflex": ans = ""; break;
    case "aov": t = `${h.pname} · ${h.choice ? tr(h.choice === "action" ? "action" : "truth") : tr("noChoice")}`; ans = h.ti != null ? (h.choice === "action" ? cget("actions", h.ti) : cget("verites", h.ti)) : ""; break;
    case "draw": t = tr("drawRecap", { name: h.pname }); ans = h.w != null ? wordL(h.w) : ""; break;
    case "spy": t = tr("spyRecap", { w: wordL(h.w) }); ans = tr("spyWas", { name: nameOf(h.spy, h.names[h.ids.indexOf(h.spy)]) }) + (h.caught ? " · " + tr("caughtShort") : " · " + tr("escapedShort")); break;
    case "joke": t = promptL(h.pi); ans = ""; break;
  }
  return { t, ans, v };
}
function valLabel(h, r, v) {
  if (r.val === null || r.val === undefined || r.val === "") return h.kind === "aov" ? "" : tr("noAnswer");
  switch (h.kind) {
    case "choice": case "vote": return v.o[r.val];
    case "number": return `${fmtNum(r.val)} ${v.unit || ""}`.trim();
    case "reflex": return r.val < 0 ? tr("tooEarly") : `${r.val} ms`;
    case "aov": return tr(r.val ? "aovDone" : "aovRefused");
    case "draw": return r.val === "drawer" ? tr("drawerLbl") : r.val ? tr("foundLbl") : tr("notFoundLbl");
    case "spy": case "joke": return `« ${r.val} »`;
  }
  return "";
}
function renderRecap() {
  const hist = state.history || [];
  const graded = hist.filter(x => x.ref.kind === "choice");
  const good = graded.filter(x => (x.res.find(r => r.id === me.id) || {}).ok).length;
  $("recapScore").hidden = !graded.length;
  $("recapScore").textContent = tr("recapGood", { g: good, n: graded.length });
  $("recap").innerHTML = hist.map(x => {
    const h = x.ref;
    const { t, ans, v } = recapText(h);
    const mine = x.res.find(r => r.id === me.id);
    const gradedRound = ["choice", "number", "reflex", "draw", "spy"].includes(h.kind);
    let mineHtml = "";
    const ml = mine ? valLabel(h, mine, v) : "";
    if (mine && ml) mineHtml = `<span class="rmine${gradedRound ? (mine.ok ? " ok" : " ko") : ""}">${esc(tr("youLbl", { v: ml }))}${mine.pts ? ` · +${fmt(mine.pts)}` : ""}</span>`;
    const chips = x.res.map(r => {
      const lab = valLabel(h, r, v);
      if (!lab && h.kind === "aov") return "";
      const p = playerById(r.id) || { name: r.name };
      const cls = h.kind === "vote" || h.kind === "joke" ? "" : r.ok ? " ok" : " ko";
      const shown = h.kind === "choice" ? (r.ok ? "✓" : "✗") : esc(lab) + (h.kind === "joke" && r.pts ? ` +${r.pts}` : "");
      return `<span class="chip${cls}">${avatarHTML(p, 20)}${esc(r.name)} ${shown}</span>`;
    }).join("");
    const m = MODES[h.mode];
    const ansLabel = ["quiz", "vf", "emoji", "calc", "color", "estim", "draw"].includes(h.src) ? tr("answerLbl") : "";
    return `<li style="--c:${m.c[0]}"><span class="rmode">${m.i} ${esc(h.src === "quiz" ? themeName(h.k) : modeT(h.mode).n)}</span><span class="rq">${esc(t)}</span>${ans ? `<span class="rans">${esc(ansLabel)}${esc(ans)}</span>` : ""}${v.ex ? `<span class="rmode">${esc(cget("vf", h.i)[1])}</span>` : ""}${mineHtml}<div class="rppl">${chips}</div></li>`;
  }).join("");
}

/* prévenir l'hôte avant de fermer l'onglet */
addEventListener("beforeunload", e => { if (role === "host" && L && L.players.size > 1) { e.preventDefault(); e.returnValue = ""; } });

/* ---------- Démarrage ---------- */
applyLang(); renderMe(); renderTicker(); renderGlobal(); renderSoundBtn(); buildModeButtons();
if (/^[A-Z0-9]{5}$/.test(urlCode)) { $("joinCode").value = urlCode; setTimeout(() => toast(tr(me.name ? "inviteDetected" : "inviteNeedName")), 400); }
