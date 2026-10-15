/* =========================================================
   Jeu Entre Potes — script.js
   Multijoueur sans serveur : le joueur qui crée le lobby (l'hôte)
   fait tourner la partie dans son navigateur, et ses potes s'y
   connectent directement grâce à PeerJS.
   ========================================================= */

const PEER_PREFIX = "jeuentrepotes-v2-";
const MAX_PLAYERS = 20;
const REVEAL_MS = 6000;
const COUNTDOWN_MS = 3600;

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
const fmt = n => Number(n || 0).toLocaleString("fr-FR");
const AV_COLORS = [["#ff4d6d", "#ff9e00"], ["#3a86ff", "#8338ec"], ["#06d6a0", "#118ab2"], ["#ffbe0b", "#fb5607"], ["#ff3d8b", "#8b5cf6"], ["#22d3ee", "#3a86ff"]];

function avatarHTML(p, size = 40) {
  const s = `style="--s:${size}px"`;
  if (p && p.avatar) return `<img class="avatar" ${s} src="${esc(p.avatar)}" alt="">`;
  const name = (p && p.name) || "?";
  const [c1, c2] = AV_COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AV_COLORS.length];
  return `<span class="avatar" aria-hidden="true" style="--s:${size}px;background:linear-gradient(135deg,${c1},${c2})">${esc([...name][0].toUpperCase())}</span>`;
}
let toastT;
function toast(m) { const t = $("toast"); t.textContent = m; t.hidden = false; t.style.animation = "none"; void t.offsetWidth; t.style.animation = ""; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2400); }
function showWarn(m) { const w = $("warn"); w.textContent = m; w.hidden = !m; }
async function copy(text, okMsg) {
  try { await navigator.clipboard.writeText(text); toast(okMsg); sfx.pop(); }
  catch (e) { const f = $("linkFallback"); f.hidden = false; f.innerHTML = `<p>Copie-le à la main :</p><div class="sel">${esc(text)}</div>`; }
}
const vibrate = p => { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} };

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
  tick() { tone(1200, .05, "square", .05); },
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
function renderSoundBtn() { $("soundBtn").textContent = muted ? "🔇" : "🔊"; $("soundBtn").setAttribute("aria-label", muted ? "Activer le son" : "Couper le son"); }
$("soundBtn").onclick = () => { muted = !muted; store.set("bz_muted", muted); renderSoundBtn(); if (!muted) sfx.pop(); };
renderSoundBtn();
document.addEventListener("pointerdown", () => audio(), { once: true });

/* =========================================================
   Confettis
   ========================================================= */
const fx = $("fx"), ctx = fx.getContext("2d");
let parts = [], fxRun = false;
function resizeFx() { const d = Math.min(2, window.devicePixelRatio || 1); fx.width = innerWidth * d; fx.height = innerHeight * d; ctx.setTransform(d, 0, 0, d, 0, 0); }
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
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  parts = parts.filter(p => p.y < innerHeight + 30 && p.life < 600);
  for (const p of parts) {
    p.vy += .18; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.a += p.va; p.life++;
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c;
    ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); ctx.restore();
  }
  if (parts.length) requestAnimationFrame(stepFx); else { fxRun = false; ctx.clearRect(0, 0, innerWidth, innerHeight); }
}

/* =========================================================
   Profil (pseudo + photo)
   ========================================================= */
// un identifiant par onglet : on peut donc tester à deux onglets dans le même navigateur
let myId = null;
try { myId = sessionStorage.getItem("bz_tab_id"); } catch (e) {}
if (!myId) { myId = "p" + Math.random().toString(36).slice(2, 12); try { sessionStorage.setItem("bz_tab_id", myId); } catch (e) {} }
const saved = store.get("bz_profile") || {};
const me = { id: myId, name: saved.name || "", avatar: saved.avatar || "" };
$("pseudo").value = me.name;

function renderMe() {
  $("bigAvatar").innerHTML = avatarHTML({ name: me.name || "?", avatar: me.avatar }, 86);
  $("meChip").innerHTML = avatarHTML({ name: me.name || "?", avatar: me.avatar }, 30) + `<span>${esc(me.name || "Sans pseudo")}</span>`;
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
      me.avatar = c.toDataURL("image/jpeg", .8); saveProfile(); toast("Photo mise à jour"); sfx.pop();
    };
    img.src = r.result;
  };
  r.readAsDataURL(f);
});
renderMe();

/* ---------- Accueil : chiffres et bandeau défilant ---------- */
const totalQ = THEME_KEYS.reduce((n, k) => n + THEMES[k].q.length, 0);
$("statCats").textContent = THEME_KEYS.length;
$("statQs").textContent = Math.floor(totalQ / 50) * 50 + "+";
const tickerItems = shuffle(THEME_KEYS).map(k => `<span style="--c1:${THEMES[k].c[0]};--c2:${THEMES[k].c[1]}">${THEMES[k].i} ${esc(THEMES[k].n)}</span>`).join("");
$("ticker").innerHTML = tickerItems + tickerItems;

/* code d'invitation dans le lien : index.html?code=ABCDE */
const urlCode = (new URLSearchParams(location.search).get("code") || "").toUpperCase();
if (/^[A-Z0-9]{5}$/.test(urlCode)) { $("joinCode").value = urlCode; setTimeout(() => toast(me.name ? "Code d'invitation détecté, clique sur Rejoindre" : "Choisis un pseudo puis clique sur Rejoindre"), 400); }

/* ---------- Classement général (sur cet appareil) ---------- */
const boardKey = name => "n:" + String(name || "").trim().toLowerCase();
function renderGlobal() {
  const board = store.get("bz_board") || {};
  const rows = Object.entries(board).map(([id, p]) => ({ id, ...p })).sort((a, b) => b.points - a.points).slice(0, 15);
  $("globalEmpty").hidden = rows.length > 0;
  $("globalBoard").innerHTML = rows.map((p, i) => `<li class="${p.id === boardKey(me.name) ? "me" : ""}"><span class="rank">${i < 3 ? ["🥇", "🥈", "🥉"][i] : i + 1}</span>${avatarHTML(p, 36)}<span class="pname">${esc(p.name)}<small>${p.games} partie${p.games > 1 ? "s" : ""} · ${p.wins} victoire${p.wins > 1 ? "s" : ""}</small></span><span class="pts">${fmt(p.points)}</span></li>`).join("");
}
function recordGame(s) {
  const key = s.code + ":" + s.gameNo;
  const done = store.get("bz_recorded") || [];
  if (done.includes(key)) return;
  const board = store.get("bz_board") || {};
  const r = s.players.slice().sort((a, b) => b.score - a.score);
  r.forEach((p, i) => {
    const key = boardKey(p.name);   // le classement général retrouve les joueurs par pseudo
    const e = board[key] || { name: p.name, avatar: "", points: 0, games: 0, wins: 0 };
    e.name = p.name; e.avatar = p.avatar || e.avatar;
    e.points += p.score; e.games += 1;
    if (i === 0 && r.length > 1 && p.score > 0) e.wins += 1;
    board[key] = e;
  });
  // limite la taille pour ne pas remplir la mémoire du navigateur
  const keep = Object.entries(board).sort((a, b) => b[1].points - a[1].points).slice(0, 60);
  for (const k of Object.keys(board)) if (!keep.find(([kk]) => kk === k)) delete board[k];
  store.set("bz_board", board);
  store.set("bz_recorded", [...done, key].slice(-100));
  renderGlobal();
}
renderGlobal();

/* =========================================================
   Réseau
   ========================================================= */
let role = null;      // "host" | "guest" | null
let peer = null;
let hostConn = null;  // (invité) connexion vers l'hôte
let state = null;     // état public affiché à l'écran
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
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

/* tire un élément sans répétition pendant la partie */
function deck(name, arr) {
  if (!L.decks[name] || !L.decks[name].length) L.decks[name] = shuffle(arr.map((_, i) => i));
  return arr[L.decks[name].pop()];
}
function buildQuestions(themes, n) {
  const keys = themes.filter(k => THEMES[k]);
  const pools = keys.map(k => shuffle(THEMES[k].q).map(q => ({ k, q })));
  const out = [];
  while (out.length < n && pools.some(p => p.length)) {
    for (const p of shuffle(pools)) { if (p.length && out.length < n) out.push(p.pop()); }
  }
  return shuffle(out).map(({ k, q }) => { const o = shuffle(q.slice(1)); return { t: q[0], o, a: o.indexOf(q[1]), k }; });
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
  const ink = pick(COULEURS);
  const word = pick(COULEURS.filter(c => c !== ink));
  const others = shuffle(COULEURS.filter(c => c !== ink && c !== word)).slice(0, 2);
  const o = shuffle([ink, word, ...others]).map(c => c.n);
  return { t: word.n, color: ink.c, o, a: o.indexOf(ink.n) };
}
function makeRound(mode) {
  const base = { mode };
  switch (mode) {
    case "quiz": {
      const q = L.quizQueue.pop() || buildQuestions(L.themes.length ? L.themes : THEME_KEYS, 1)[0];
      return { ...base, kind: "choice", t: q.t, o: q.o, a: q.a, k: q.k };
    }
    case "vf": {
      const [t, v, ex] = deck("vf", VRAI_FAUX);
      return { ...base, kind: "choice", t, o: ["Vrai", "Faux"], a: v ? 0 : 1, ex, two: true };
    }
    case "emoji": {
      const e = deck("emoji", EMOJI); const o = shuffle(e.slice(1));
      return { ...base, kind: "choice", t: e[0], o, a: o.indexOf(e[1]), style: "emoji", sub: "Quel film, série ou jeu se cache ici ?" };
    }
    case "calcul": return { ...base, kind: "choice", ...makeCalc(), style: "calc", sub: "Combien ça fait ?" };
    case "couleur": return { ...base, kind: "choice", ...makeStroop(), style: "stroop", sub: "De quelle couleur est l'ENCRE ?" };
    case "tp": {
      const [a, b] = deck("tp", TU_PREFERES);
      return { ...base, kind: "vote", t: "Tu préfères…", o: [a, b], two: true };
    }
    case "qps": {
      const pl = [...L.players.values()];
      return { ...base, kind: "vote", t: `Qui pourrait ${deck("qps", QUI_POURRAIT)} ?`, o: pl.map(p => p.name), ids: pl.map(p => p.id), sub: "Vote pour le pote le plus susceptible !" };
    }
    case "jnj": return { ...base, kind: "vote", t: `Je n'ai jamais ${deck("jnj", JAMAIS)}.`, o: ["Moi si !", "Jamais"], two: true, sub: "Sois honnête…" };
    case "estim": {
      const [t, a, unit] = deck("estim", ESTIMATION);
      return { ...base, kind: "number", t, a, unit, sub: "Le plus proche gagne !" };
    }
    case "reflexe": return { ...base, kind: "reflex", t: "Tape dès que ça devient vert !", goDelay: 1500 + Math.random() * 3500 };
    case "aov": {
      const pl = [...L.players.values()];
      const p = pl[L.aovTurn++ % pl.length];
      return { ...base, kind: "aov", t: "Action ou Vérité ?", pid: p.id, pname: p.name, choice: null, text: null, result: null };
    }
  }
}
function roundDuration(R) {
  if (R.kind === "aov") return 0;
  if (R.kind === "reflex") return R.goDelay + 4000;
  if (R.kind === "number") return L.dur * 1000 + 5000;
  return L.dur * 1000;
}

/* =========================================================
   Déroulement de la partie (chez l'hôte)
   ========================================================= */
function publicRound(R) {
  const rev = L.phase === "reveal";
  const q = { kind: R.kind, mode: R.mode, t: R.t, o: R.o, two: R.two, style: R.style, color: R.color, sub: R.sub, unit: R.unit, ids: R.ids, k: R.k };
  if (R.kind === "choice" && rev) { q.a = R.a; q.ex = R.ex; }
  if (R.kind === "vote" && rev) { q.counts = R.counts; q.win = R.win; }
  if (R.kind === "number" && rev) q.a = R.a;
  if (R.kind === "reflex") q.goIn = Math.max(0, L.roundStart + R.goDelay - Date.now());
  if (R.kind === "aov") Object.assign(q, { pid: R.pid, pname: R.pname, choice: R.choice, text: R.text, result: R.result });
  return q;
}
function publicState() {
  const showQ = L.round && (L.phase === "question" || L.phase === "reveal");
  const rev = L.phase === "reveal";
  return {
    code: L.code, host: L.host, mode: L.mode, themes: L.themes, nbQ: L.nbQ, dur: L.dur, phase: L.phase,
    qIndex: L.qIndex, total: L.nbQ, gameNo: L.gameNo,
    question: showQ ? publicRound(L.round) : null,
    timeLeft: L.phaseEnd ? Math.max(0, L.phaseEnd - Date.now()) : -1,
    history: L.phase === "end" ? L.history : null,
    players: [...L.players.values()].map(p => ({
      id: p.id, name: p.name, avatar: p.avatar, score: p.score, streak: p.streak, answered: !!p.answer,
      choice: rev && p.answer ? p.answer.c : null,
      pts: rev && p.answer ? p.answer.pts || 0 : 0
    }))
  };
}
function broadcast() {
  const s = publicState();
  for (const c of conns.values()) if (c.open) c.send({ type: "state", state: s });
  applyState(s);
}
function startGame() {
  if (!L || (L.phase !== "lobby" && L.phase !== "end")) return;
  if (L.mode === "quiz" && !L.themes.length) return toast("Choisis au moins une catégorie");
  L.decks = {}; L.history = []; L.aovTurn = Math.floor(Math.random() * L.players.size);
  L.quizQueue = L.mode === "quiz" || L.mode === "mix" ? buildQuestions(L.themes.length ? L.themes : THEME_KEYS, L.nbQ) : [];
  L.qIndex = 0; L.gameNo++;
  for (const p of L.players.values()) { p.score = 0; p.streak = 0; p.answer = null; }
  L.phase = "countdown"; L.phaseEnd = Date.now() + COUNTDOWN_MS;
  clearTimeout(L.timer); L.timer = setTimeout(startRound, COUNTDOWN_MS);
  broadcast();
}
function startRound() {
  const mode = L.mode === "mix" ? pick(MIX_POOL) : L.mode;
  L.round = makeRound(mode);
  for (const p of L.players.values()) p.answer = null;
  L.phase = "question"; L.roundStart = Date.now();
  const d = roundDuration(L.round);
  clearTimeout(L.timer);
  if (d) { L.phaseEnd = Date.now() + d; L.timer = setTimeout(reveal, d + 300); } else L.phaseEnd = 0;
  broadcast();
}
function everyoneAnswered() { const ps = [...L.players.values()]; return ps.length > 0 && ps.every(p => p.answer); }
function hostAnswer(id, c) {
  if (!L || L.phase !== "question") return;
  const p = L.players.get(id), R = L.round;
  if (!p || p.answer || R.kind === "aov") return;
  c = Number(c);
  if (R.kind === "choice" || R.kind === "vote") { if (!(Number.isInteger(c) && c >= 0 && c < R.o.length)) return; p.answer = { c, left: Math.max(0, L.phaseEnd - Date.now()) }; }
  else if (R.kind === "number") { if (!isFinite(c)) return; p.answer = { c }; }
  else if (R.kind === "reflex") { if (!isFinite(c)) return; p.answer = { c: c < 0 ? -1 : Math.max(80, Math.min(Math.round(c), 9999)) }; }
  if (everyoneAnswered()) reveal(); else broadcast();
}
function hostAov(id, msg) {
  if (!L || L.phase !== "question" || L.round.kind !== "aov") return;
  const R = L.round;
  if (msg.step === "choose" && id === R.pid && !R.choice) {
    R.choice = msg.c === "action" ? "action" : "verite";
    R.text = R.choice === "action" ? deck("action", ACTIONS) : deck("verite", VERITES);
    broadcast();
  } else if (msg.step === "done" && R.choice && R.result === null && (id === R.pid || id === L.host)) {
    R.result = !!msg.ok; reveal();
  } else if (msg.step === "skip" && id === L.host) {
    R.result = false; reveal();
  }
}
const RANK_PTS = [1000, 700, 500, 300];
function reveal() {
  if (!L || L.phase !== "question") return;
  clearTimeout(L.timer);
  const R = L.round, ps = [...L.players.values()], dur = L.dur * 1000;
  const res = new Map(); // id -> {pts, ok, label}
  let ans = "";
  if (R.kind === "choice") {
    for (const p of ps) {
      const ok = !!p.answer && p.answer.c === R.a;
      let pts = 0;
      if (ok) { p.streak++; pts = 500 + Math.round(500 * p.answer.left / dur) + Math.min(300, (p.streak - 1) * 100); } else p.streak = 0;
      res.set(p.id, { pts, ok, label: p.answer ? R.o[p.answer.c] : "Pas de réponse" });
    }
    ans = R.o[R.a];
  } else if (R.kind === "vote") {
    const counts = R.o.map(() => 0);
    for (const p of ps) if (p.answer) counts[p.answer.c]++;
    const max = Math.max(...counts);
    R.counts = counts;
    R.win = R.mode === "jnj" ? [] : counts.map((n, i) => (n === max && max > 0 ? i : -1)).filter(i => i >= 0);
    for (const p of ps) {
      const c = p.answer ? p.answer.c : -1;
      let pts = 0, ok = false;
      if (R.mode === "jnj") { ok = c === 0; pts = ok ? 300 : 0; }
      else { ok = R.win.includes(c); pts = ok ? 500 : 0; }
      res.set(p.id, { pts, ok, label: c >= 0 ? R.o[c] : "Pas de vote" });
    }
    if (R.mode === "jnj") ans = `${counts[0]} sur ${ps.length} ont avoué`;
    else if (R.mode === "qps") ans = R.win.length ? `Désigné : ${R.win.map(i => R.o[i]).join(", ")}` : "Personne n'a voté";
    else ans = R.win.length ? `Majorité : ${R.win.map(i => R.o[i]).join(" / ")}` : "Personne n'a voté";
  } else if (R.kind === "number") {
    const ranked = ps.filter(p => p.answer).map(p => ({ p, d: Math.abs(p.answer.c - R.a) })).sort((x, y) => x.d - y.d);
    let rank = 0;
    ranked.forEach((x, i) => { if (i > 0 && x.d > ranked[i - 1].d) rank = i; x.rank = rank; });
    for (const p of ps) {
      const x = ranked.find(r => r.p === p);
      const pts = !x ? 0 : x.d === 0 ? 1500 : (RANK_PTS[x.rank] || 100);
      res.set(p.id, { pts, ok: !!x && x.rank === 0, label: x ? `${fmtNum(p.answer.c)} ${R.unit || ""}`.trim() : "Pas de réponse" });
    }
    ans = `${fmtNum(R.a)} ${R.unit || ""}`.trim();
  } else if (R.kind === "reflex") {
    const ranked = ps.filter(p => p.answer && p.answer.c >= 0).sort((x, y) => x.answer.c - y.answer.c);
    for (const p of ps) {
      const i = ranked.indexOf(p);
      const pts = i < 0 ? 0 : (RANK_PTS[i] || 150);
      res.set(p.id, { pts, ok: i === 0, label: !p.answer ? "Pas de réponse" : p.answer.c < 0 ? "Trop tôt !" : `${p.answer.c} ms` });
    }
    ans = ranked.length ? `Le plus rapide : ${ranked[0].name} (${ranked[0].answer.c} ms)` : "Personne n'a été assez rapide";
  } else if (R.kind === "aov") {
    for (const p of ps) {
      const me2 = p.id === R.pid;
      res.set(p.id, { pts: me2 && R.result ? 500 : 0, ok: me2 && R.result, label: me2 ? (R.result ? "Défi relevé ✅" : "Défi refusé ❌") : "" });
    }
    ans = `${R.pname} · ${R.choice === "action" ? "Action" : R.choice === "verite" ? "Vérité" : "Pas de choix"}${R.text ? " : " + R.text : ""}`;
  }
  for (const p of ps) {
    const r = res.get(p.id);
    p.answer = p.answer || {};
    p.answer.pts = r.pts; p.score += r.pts;
  }
  L.history.push({
    mode: R.mode, kind: R.kind, t: R.kind === "choice" && R.style === "stroop" ? `Le mot « ${R.t} » écrit en ${R.o[R.a].toLowerCase()}` : R.mode === "tp" ? `Tu préfères : ${R.o[0]} ou ${R.o[1]} ?` : R.t,
    style: R.style, ans, ex: R.ex || "",
    res: ps.map(p => ({ id: p.id, name: p.name, ...res.get(p.id) })).filter(r => R.kind !== "aov" || r.label)
  });
  L.phase = "reveal";
  const wait = R.kind === "aov" ? 4500 : REVEAL_MS;
  L.phaseEnd = Date.now() + wait;
  L.timer = setTimeout(nextRound, wait);
  broadcast();
}
function nextRound() {
  if (!L || L.phase !== "reveal") return;
  clearTimeout(L.timer);
  if (L.qIndex + 1 >= L.nbQ) { L.phase = "end"; L.phaseEnd = 0; broadcast(); return; }
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
  if (L.phase === "question" && L.round && L.round.kind === "aov" && L.round.pid === id) { L.round.result = false; reveal(); return; }
  if (L.phase === "question" && L.players.size && L.round.kind !== "aov" && everyoneAnswered()) reveal(); else broadcast();
}
const fmtNum = n => Number(n).toLocaleString("fr-FR", { maximumFractionDigits: 3, useGrouping: !(Number.isInteger(+n) && n >= 1000 && n <= 2100) });

/* créer un lobby : on réserve l'identifiant "jeuentrepotes-v2-CODE" sur PeerJS */
function createLobby(tries = 0) {
  cleanup(); showWarn("");
  if (typeof Peer === "undefined") return showWarn("Impossible de charger le module réseau. Vérifie ta connexion internet puis recharge la page.");
  const code = newCode();
  $("createBtn").disabled = true;
  peer = new Peer(PEER_PREFIX + code);
  peer.on("open", () => {
    role = "host"; $("createBtn").disabled = false;
    const last = store.get("bz_lastThemes");
    const lastMode = store.get("bz_lastMode");
    L = { code, host: me.id, mode: MODES[lastMode] ? lastMode : "quiz",
      themes: Array.isArray(last) && last.length ? last.filter(k => THEMES[k]) : ["valorant", "fortnite", "dbz", "marvel"],
      nbQ: 10, dur: 15, phase: "lobby", qIndex: 0, round: null, history: [], decks: {}, quizQueue: [], aovTurn: 0,
      gameNo: 0, timer: null, phaseEnd: 0, roundStart: 0, players: new Map() };
    L.players.set(me.id, { id: me.id, name: me.name, avatar: me.avatar, score: 0, streak: 0, answer: null });
    sfx.join(); broadcast();
  });
  peer.on("connection", conn => {
    conn.on("data", msg => {
      if (!msg || typeof msg !== "object" || !L) return;
      if (msg.type === "join") {
        const prof = msg.profile || {};
        const id = String(prof.id || conn.peer).slice(0, 40);
        if (!L.players.has(id) && L.players.size >= MAX_PLAYERS) { conn.send({ type: "error", err: "Ce lobby est plein" }); return; }
        conn.playerId = id; conns.set(id, conn);
        const ex = L.players.get(id);
        const av = typeof prof.avatar === "string" && prof.avatar.startsWith("data:image/") ? prof.avatar : "";
        if (ex) { ex.name = String(prof.name || ex.name).slice(0, 18); ex.avatar = av || ex.avatar; }
        else { L.players.set(id, { id, name: String(prof.name || "Joueur").slice(0, 18), avatar: av, score: 0, streak: 0, answer: null }); sfx.join(); }
        broadcast();
      } else if (msg.type === "answer") hostAnswer(conn.playerId, msg.c);
      else if (msg.type === "aov") hostAov(conn.playerId, msg);
      else if (msg.type === "profile") hostUpdateProfile(conn.playerId, msg.profile || {});
      else if (msg.type === "leave") hostRemove(conn.playerId);
    });
    conn.on("close", () => { if (conn.playerId && conns.get(conn.playerId) === conn) hostRemove(conn.playerId); });
  });
  peer.on("error", err => {
    $("createBtn").disabled = false;
    if (err.type === "unavailable-id" && tries < 3) return createLobby(tries + 1);
    if (role === "host") return;
    showWarn("Impossible de créer le lobby : vérifie ta connexion internet puis réessaie.");
    cleanup(); show("home");
  });
  peer.on("disconnected", () => { try { peer.reconnect(); } catch (e) {} });
}

/* rejoindre un lobby : on se connecte à l'hôte */
function joinLobby(code) {
  cleanup(); showWarn("");
  if (typeof Peer === "undefined") return showWarn("Impossible de charger le module réseau. Vérifie ta connexion internet puis recharge la page.");
  $("joinBtn").disabled = true; $("joinBtn").textContent = "Connexion…";
  peer = new Peer();
  const done = () => { $("joinBtn").disabled = false; $("joinBtn").textContent = "Rejoindre"; };
  const fail = msg => { done(); toast(msg); sfx.bad(); cleanup(); show("home"); };
  const timeout = setTimeout(() => { if (!state) fail("Aucun lobby avec ce code"); }, 12000);
  peer.on("open", () => {
    hostConn = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: "json" });
    hostConn.on("open", () => { role = "guest"; hostConn.send({ type: "join", profile: me }); });
    hostConn.on("data", msg => {
      if (msg.type === "state") { if (!state) { clearTimeout(timeout); done(); sfx.join(); } applyState(msg.state); }
      if (msg.type === "error") { clearTimeout(timeout); fail(msg.err); }
    });
    hostConn.on("close", () => { if (role === "guest") { cleanup(); show("home"); showWarn("L'hôte a quitté la partie, le lobby est fermé."); } });
  });
  peer.on("error", err => { clearTimeout(timeout); fail(err.type === "peer-unavailable" ? "Aucun lobby avec ce code" : "Connexion impossible, réessaie"); });
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
  if (role === "host") { if (msg.type === "answer") hostAnswer(me.id, msg.c); else if (msg.type === "aov") hostAov(me.id, msg); }
  else send(msg);
}

/* =========================================================
   Interface
   ========================================================= */
function needName() { if (!me.name) { toast("Choisis d'abord un pseudo"); $("pseudo").focus(); vibrate(60); return true; } return false; }
$("createBtn").onclick = () => { audio(); if (!needName()) createLobby(); };
$("joinBtn").onclick = () => {
  audio(); if (needName()) return;
  const c = $("joinCode").value.trim().toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(c)) return toast("Le code fait 5 caractères");
  joinLobby(c);
};
$("joinCode").addEventListener("input", e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); });
$("joinCode").addEventListener("keydown", e => { if (e.key === "Enter") $("joinBtn").click(); });
$("leaveBtn").onclick = leave;
$("homeBtn").onclick = leave;
$("logo").onclick = () => { if (!state) show("home"); };
$("copyCode").onclick = () => copy(state.code, "Code copié");
$("copyLink").onclick = () => copy(`${location.origin}${location.pathname}?code=${state.code}`, "Lien d'invitation copié");
$("statModes").textContent = MODE_ORDER.length;

function show(screen) { for (const s of ["home", "lobby", "game", "end"]) $(s).hidden = s !== screen; }
const isHost = () => role === "host";
const ranked = () => state.players.slice().sort((a, b) => b.score - a.score);
const catVars = k => THEMES[k] ? `--c1:${THEMES[k].c[0]};--c2:${THEMES[k].c[1]}` : "";
const modeVars = m => MODES[m] ? `--c1:${MODES[m].c[0]};--c2:${MODES[m].c[1]}` : "";
const playerById = id => state && state.players.find(p => p.id === id);

function boardHTML(list, showPlus, offset = 0) {
  return list.map((p, i) => `<li class="${p.id === me.id ? "me" : ""}"><span class="rank">${i + 1 + offset}</span>${avatarHTML(p, 34)}<span class="pname">${esc(p.name)}${p.streak >= 2 ? `<span class="streak">🔥${p.streak}</span>` : ""}</span><span class="pts">${showPlus && p.pts > 0 ? `<span class="plus">+${fmt(p.pts)}</span>` : ""}${fmt(p.score)}</span></li>`).join("");
}

/* ---------- Application de l'état reçu ---------- */
let lastPhaseKey = null, lastPlayerCount = 0, lastRoundKey = null;
function applyState(s) {
  const prev = state;
  state = s;
  deadline = s.timeLeft >= 0 ? Date.now() + s.timeLeft : 0;
  const roundKey = s.gameNo + ":" + s.qIndex;
  if ((s.phase === "question" || s.phase === "reveal") && roundKey !== lastRoundKey) {
    lastRoundKey = roundKey; myChoice = null; numSent = null; reflexState = null; lastSec = null;
    $("numInput").value = "";
    if (s.question && s.question.kind === "reflex") { reflexGoAt = Date.now() + s.question.goIn; reflexState = "wait"; }
  }
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
$("modes").innerHTML = MODE_ORDER.map(m => `<button class="mode" data-m="${m}" aria-pressed="false" style="${modeVars(m)}"><span class="ic">${MODES[m].i}</span><span class="nm">${esc(MODES[m].n)}</span></button>`).join("");
$("modes").onclick = e => {
  const b = e.target.closest(".mode"); if (!b || !isHost() || !L) return;
  L.mode = b.dataset.m; store.set("bz_lastMode", L.mode); sfx.select(); broadcast();
};
let famFilter = "all", search = "";
function renderFamTabs() {
  const sel = state ? state.themes.length : 0;
  const tabs = [{ id: "all", n: "Toutes", i: "✨", count: THEME_KEYS.length }, { id: "sel", n: "Choisies", i: "✅", count: sel },
    ...FAMILIES.map(f => ({ ...f, count: THEME_KEYS.filter(k => THEMES[k].f === f.id).length }))];
  $("famTabs").innerHTML = tabs.map(t => `<button role="tab" data-f="${t.id}" aria-selected="${t.id === famFilter}">${t.i} ${esc(t.n)}<b>${t.count}</b></button>`).join("");
}
function renderCats() {
  const sel = new Set(state.themes);
  const q = search.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const keys = THEME_KEYS.filter(k => {
    const t = THEMES[k];
    if (famFilter === "sel" && !sel.has(k)) return false;
    if (famFilter !== "all" && famFilter !== "sel" && t.f !== famFilter) return false;
    if (q && !t.n.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").includes(q)) return false;
    return true;
  });
  $("cats").innerHTML = keys.length ? keys.map(k => {
    const t = THEMES[k];
    return `<button class="cat" data-k="${k}" aria-pressed="${sel.has(k)}" style="${catVars(k)}"><span class="tick">✓</span><span class="ic">${t.i}</span><span><span class="nm">${esc(t.n)}</span><br><span class="qc">${t.q.length} questions</span></span></button>`;
  }).join("") : `<p class="empty">Aucune catégorie ne correspond à « ${esc(search)} ».</p>`;
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
$("pickMix").onclick = () => { setThemes(THEME_KEYS); sfx.good(); toast("Méga mix : toutes les catégories !"); };
$("pickRandom").onclick = () => { setThemes(shuffle(THEME_KEYS).slice(0, 5)); sfx.select(); toast("5 catégories tirées au hasard"); };
$("pickNone").onclick = () => { setThemes([]); sfx.pop(); };
for (const id of ["nbQ", "dur"]) {
  $(id).onclick = e => {
    const b = e.target.closest("button"); if (!b || !isHost() || !L) return;
    L[id] = +b.dataset.v; sfx.select(); broadcast();
  };
}
$("startBtn").onclick = () => { if (isHost()) { audio(); startGame(); } };

function renderLobby() {
  const host = isHost(), m = MODES[state.mode], usesCats = state.mode === "quiz" || state.mode === "mix";
  $("lobbyCode").textContent = state.code;
  $("nbPlayers").textContent = state.players.length;
  if (state.players.length > lastPlayerCount && lastPlayerCount && !host) sfx.join();
  lastPlayerCount = state.players.length;
  $("players").innerHTML = state.players.map(p => `<div class="pl">${p.id === state.host ? '<span class="crown" title="Hôte">👑</span>' : ""}${avatarHTML(p, 34)}<b>${esc(p.name)}${p.id === me.id ? " (toi)" : ""}</b></div>`).join("");

  for (const b of $("modes").children) { b.setAttribute("aria-pressed", b.dataset.m === state.mode); b.disabled = !host; }
  $("modePill").textContent = `${m.i} ${m.n}`; $("modePill").setAttribute("style", modeVars(state.mode));
  $("modeInfo").innerHTML = `<b>${m.i} ${esc(m.n)}</b><p>${esc(m.d)} ${esc(m.how)}</p>${host ? "" : "<p>C'est l'hôte qui choisit le mode.</p>"}`;

  for (const id of ["nbQ", "dur"]) for (const b of $(id).children) { b.setAttribute("role", "radio"); b.setAttribute("aria-checked", +b.dataset.v === state[id]); b.disabled = !host; }
  $("durSeg").hidden = state.mode === "aov" || state.mode === "reflexe";

  $("catsCard").hidden = !usesCats;
  $("catsTitle").textContent = state.mode === "mix" ? "Catégories des manches quiz" : "Catégories";
  $("selCount").textContent = state.themes.length;
  $("hostPicker").hidden = !host; $("guestPicker").hidden = host;
  if (usesCats) {
    if (host) { renderFamTabs(); renderCats(); }
    else {
      $("guestHint").textContent = state.themes.length ? "Catégories choisies par l'hôte :" : (state.mode === "mix" ? "Toutes les catégories" : "L'hôte choisit les catégories…");
      $("selChips").innerHTML = state.themes.slice(0, 40).map(k => `<span style="${catVars(k)}">${THEMES[k].i} ${esc(THEMES[k].n)}</span>`).join("") + (state.themes.length > 40 ? `<span style="--c1:#444;--c2:#222">+${state.themes.length - 40}</span>` : "");
    }
  }
  $("startBtn").hidden = !host; $("waitHost").hidden = host;
  const n = state.themes.length;
  $("startBtn").disabled = state.mode === "quiz" && !n;
  $("startHint").textContent = state.mode === "quiz" && !n ? "Choisis au moins une catégorie"
    : `${m.i} ${m.n} · ${state.nbQ} manches` + (state.mode === "quiz" ? ` · ${n} catégorie${n > 1 ? "s" : ""}` : "");
}

/* ---------- Compte à rebours ---------- */
let lastCd = null;
function renderCountdown() {
  const left = Math.max(0, deadline - Date.now());
  const n = left > 3000 ? 3 : left > 2000 ? 2 : left > 1000 ? 1 : 0;
  const label = n ? String(n) : "GO !";
  if (label !== lastCd) {
    lastCd = label;
    const el = $("cdNum"); el.textContent = label; el.style.animation = "none"; void el.offsetWidth; el.style.animation = "";
    if (n) sfx.count(); else sfx.go();
    const m = MODES[state.mode];
    if (state.mode === "quiz") {
      const names = state.themes.slice(0, 6).map(k => THEMES[k].i + " " + THEMES[k].n).join("  ·  ");
      $("cdCats").textContent = state.themes.length > 6 ? names + `  · +${state.themes.length - 6}` : names;
    } else $("cdCats").textContent = `${m.i} ${m.n} — ${m.how}`;
  }
}

/* ---------- Manche en cours ---------- */
let myChoice = null, numSent = null, lastSec = null, reflexGoAt = 0, reflexState = null;
const SHAPES = ["▲", "◆", "●", "■"];
const ANS_COLORS = ["var(--a1)", "var(--a2)", "var(--a3)", "var(--a4)"];

function roundLabel(q) {
  if (q.mode === "quiz" && THEMES[q.k]) return { txt: `${THEMES[q.k].i} ${THEMES[q.k].n}`, vars: catVars(q.k) };
  return { txt: `${MODES[q.mode].i} ${MODES[q.mode].n}`, vars: modeVars(q.mode) };
}

function renderGame() {
  const q = state.question; if (!q) return;
  const mine = state.players.find(p => p.id === me.id);
  const reveal = state.phase === "reveal";
  if (reveal && mine && (q.kind === "choice" || q.kind === "vote")) myChoice = mine.choice;

  const lab = roundLabel(q);
  $("qNum").textContent = `${state.qIndex + 1}/${state.total}`;
  $("qCat").textContent = lab.txt; $("qCat").setAttribute("style", lab.vars);
  $("qProg").style.width = `${(state.qIndex + (reveal ? 1 : 0)) / state.total * 100}%`;
  $("game").querySelector(".ring").hidden = q.kind === "aov";

  const qt = $("qText");
  const qtSig = state.gameNo + ":" + state.qIndex;
  if (qt.dataset.sig !== qtSig) {
    qt.dataset.sig = qtSig;
    qt.textContent = q.t;
    qt.className = "question" + (q.style ? " " + q.style : "");
    qt.style.color = q.color || "";
    qt.style.animation = "none"; void qt.offsetWidth; qt.style.animation = "";
  }
  $("qSub").hidden = !q.sub; $("qSub").textContent = q.sub || "";

  const showAnswers = q.kind === "choice" || q.kind === "vote";
  $("answers").hidden = !showAnswers;
  if (showAnswers) renderAnswers(q, reveal);
  renderNumber(q, reveal);
  renderReflex(q, reveal);
  renderAov(q, reveal);

  const answered = state.players.filter(p => p.answered);
  const showWho = !reveal && q.kind !== "aov";
  $("answeredRow").innerHTML = showWho ? answered.map(p => avatarHTML(p, 30)).join("") : "";
  $("gStatus").textContent = !showWho ? "" : `${answered.length}/${state.players.length} ${q.kind === "vote" ? "ont voté" : "ont répondu"}`;

  $("reveal").hidden = !reveal;
  if (reveal) renderReveal(q, mine);
  updateTimer();
}

function renderAnswers(q, reveal) {
  const isPlayers = !!q.ids;
  const box = $("answers");
  box.className = "answers" + (q.two ? " two" : "") + (isPlayers ? " players" : "");
  const sig = [state.gameNo, state.qIndex, state.phase, myChoice, q.o.length].join(":");
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  box.innerHTML = q.o.map((o, i) => {
    let cls = "answer";
    const col = q.mode === "vf" ? (i === 0 ? "var(--a4)" : "var(--a1)") : q.mode === "jnj" ? (i === 0 ? "var(--a1)" : "var(--a2)") : ANS_COLORS[i % 4];
    if (reveal) {
      if (q.kind === "choice") { cls += i === q.a ? " right" : " dim"; if (i === myChoice && i !== q.a) cls += " wrong chosen"; }
      else { const win = (q.win || []).includes(i); cls += win ? " right" : " dim"; if (i === myChoice) cls += " chosen"; }
    } else if (myChoice !== null) cls += i === myChoice ? " chosen" : " dim";
    const pl = isPlayers ? playerById(q.ids[i]) : null;
    const lead = isPlayers ? avatarHTML(pl || { name: o }, 34) : `<span class="sh">${q.mode === "vf" ? (i === 0 ? "✔" : "✘") : SHAPES[i % 4]}</span>`;
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

function renderNumber(q, reveal) {
  const show = q.kind === "number" && !reveal;
  $("numBox").hidden = !show;
  if (!show) return;
  $("numUnit").textContent = q.unit || "";
  const sent = numSent !== null;
  $("numInput").disabled = sent; $("numSend").disabled = sent;
  $("numSend").textContent = sent ? "Envoyé ✓" : "Valider";
}
$("numBox").addEventListener("submit", e => {
  e.preventDefault();
  if (!state || state.phase !== "question" || numSent !== null) return;
  const v = parseFloat(String($("numInput").value).replace(",", "."));
  if (!isFinite(v)) return toast("Tape un nombre");
  numSent = v; sfx.answer(); vibrate(25);
  act({ type: "answer", c: v });
  renderGame();
});

function renderReflex(q, reveal) {
  const pad = $("reflexPad");
  const show = q.kind === "reflex" && !reveal;
  pad.hidden = !show;
  if (!show) return;
  pad.className = "reflex-pad" + (reflexState === "go" ? " go" : reflexState === "done" ? " done" : reflexState === "fail" ? " fail" : "");
  const t = $("reflexTxt"), s = $("reflexSub");
  if (reflexState === "wait") { t.textContent = "Attends le vert…"; s.textContent = "Ne touche pas trop tôt !"; }
  else if (reflexState === "go") { t.textContent = "TAPE !"; s.textContent = "Maintenant !"; }
  else if (reflexState === "done") { t.textContent = `${reflexMs} ms`; s.textContent = "En attente des autres…"; }
  else if (reflexState === "fail") { t.textContent = "Trop tôt !"; s.textContent = "Manche perdue, attends la suivante"; }
}
let reflexMs = 0;
function reflexTap() {
  if (!state || state.phase !== "question" || !state.question || state.question.kind !== "reflex") return;
  if (reflexState === "wait") { reflexState = "fail"; sfx.bad(); vibrate(120); act({ type: "answer", c: -1 }); }
  else if (reflexState === "go") { reflexMs = Math.max(1, Math.round(performance.now() - reflexGoPerf)); reflexState = "done"; sfx.answer(); vibrate(25); act({ type: "answer", c: reflexMs }); }
  renderGame();
}
let reflexGoPerf = 0;
$("reflexPad").addEventListener("pointerdown", e => { e.preventDefault(); reflexTap(); });
addEventListener("keydown", e => { if (e.code === "Space" && !$("reflexPad").hidden) { e.preventDefault(); reflexTap(); } });

function renderAov(q, reveal) {
  const box = $("aovBox");
  box.hidden = q.kind !== "aov";
  if (q.kind !== "aov") return;
  const p = playerById(q.pid) || { name: q.pname };
  const mineTurn = q.pid === me.id;
  const sig = [state.gameNo, state.qIndex, q.choice, q.result, state.phase].join(":");
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  let html = `<div class="who">${avatarHTML(p, 46)}<span>${mineTurn ? "C'est ton tour !" : `Au tour de ${esc(p.name)}`}</span></div>`;
  if (!q.choice) {
    html += mineTurn
      ? `<div class="aov-choice"><button class="act" data-c="action">🔥 Action<small>Un défi à relever</small></button><button class="ver" data-c="verite">💬 Vérité<small>Une question à laquelle répondre</small></button></div>`
      : `<p class="wait"><span class="dots"><i></i><i></i><i></i></span> ${esc(p.name)} choisit action ou vérité…</p>`;
    if (isHost() && !mineTurn) html += `<div class="aov-actions"><button class="btn small ghost" data-skip="1">Passer son tour</button></div>`;
  } else {
    const isAct = q.choice === "action";
    html += `<div class="aov-card" style="--c1:${isAct ? "#ff4d6d" : "#3a86ff"};--c2:${isAct ? "#fb5607" : "#8338ec"}"><span class="tag">${isAct ? "🔥 Action" : "💬 Vérité"}</span><p>${esc(q.text)}</p></div>`;
    if (q.result === null && !reveal) {
      if (mineTurn || isHost()) html += `<div class="aov-actions"><button class="btn ok" data-ok="1">Défi relevé ✅</button><button class="btn no" data-ok="0">Je refuse ❌</button></div>`;
      if (!mineTurn) html += `<p class="wait">${isHost() ? "Tu peux valider à sa place si le défi est fait." : "Regardez bien s'il relève le défi !"}</p>`;
    }
  }
  box.innerHTML = html;
}
$("aovBox").onclick = e => {
  const b = e.target.closest("button"); if (!b || !state) return;
  if (b.dataset.c) { sfx.select(); act({ type: "aov", step: "choose", c: b.dataset.c }); }
  else if (b.dataset.ok !== undefined) { act({ type: "aov", step: "done", ok: b.dataset.ok === "1" }); }
  else if (b.dataset.skip) act({ type: "aov", step: "skip" });
};

function renderReveal(q, mine) {
  const v = $("verdict");
  const pts = mine ? mine.pts : 0;
  let cls = pts > 0 ? "ok" : "ko", title = "", sub = "";
  if (q.kind === "choice") {
    const ok = myChoice === q.a;
    title = ok ? "Bien joué !" : myChoice === null ? "Trop tard !" : "Raté !";
    sub = ok ? `+${fmt(pts)} points` + (mine.streak >= 2 ? ` · <span class="fire">🔥 Série de ${mine.streak}</span>` : "") : `La bonne réponse : ${esc(q.o[q.a])}`;
    if (q.ex) sub += `<br>${esc(q.ex)}`;
  } else if (q.kind === "vote") {
    if (q.mode === "jnj") { title = myChoice === 0 ? "Aveu enregistré 🙈" : myChoice === 1 ? "Tout propre 😇" : "Pas de réponse"; sub = myChoice === 0 ? `+${pts} points d'audace` : ""; cls = myChoice === 0 ? "ok" : ""; }
    else if (q.mode === "qps") {
      const names = (q.win || []).map(i => q.o[i]).join(", ");
      title = names ? `${names} 👑` : "Personne n'a voté";
      sub = pts > 0 ? `Tu as voté comme la majorité · +${pts}` : myChoice === null ? "Tu n'as pas voté" : "Tu n'as pas suivi la majorité";
      cls = "ok";
    } else {
      title = pts > 0 ? "Comme la majorité !" : myChoice === null ? "Pas de vote" : "Tu es dans la minorité";
      sub = pts > 0 ? `+${pts} points` : "Tu as des goûts uniques 😄";
    }
  } else if (q.kind === "number") {
    title = `Réponse : ${fmtNum(q.a)} ${q.unit || ""}`;
    sub = mine && mine.choice !== null ? `Tu as dit ${fmtNum(mine.choice)} · +${fmt(pts)}` : "Tu n'as pas répondu";
    cls = pts >= 1000 ? "ok" : "";
  } else if (q.kind === "reflex") {
    const c = mine ? mine.choice : null;
    title = c === null ? "Pas de réponse" : c < 0 ? "Trop tôt !" : `${c} ms`;
    sub = pts > 0 ? `+${fmt(pts)} points` : "";
  } else if (q.kind === "aov") {
    const p = playerById(q.pid) || { name: q.pname };
    title = q.result ? "Défi relevé ✅" : "Défi refusé ❌";
    sub = `${esc(p.name)}${q.result ? " gagne +500 points" : ""}`;
    cls = q.result ? "ok" : "ko";
  }
  v.className = "verdict " + cls;
  v.innerHTML = `<b>${esc(title)}</b><span>${sub}</span>`;
  $("voteRes").innerHTML = resultRows(q);
  $("roundBoard").innerHTML = boardHTML(ranked(), true);
  $("nextBtn").hidden = !isHost();
  $("nextBtn").textContent = state.qIndex + 1 >= state.total ? "Voir le podium" : "Manche suivante";
}
function resultRows(q) {
  const ps = state.players;
  if (q.kind === "vote") {
    const total = Math.max(1, ps.filter(p => p.choice !== null).length);
    return q.o.map((o, i) => {
      const voters = ps.filter(p => p.choice === i);
      const pct = Math.round(voters.length / total * 100);
      const win = (q.win || []).includes(i);
      return `<div class="vote-row${win ? " win" : ""}" style="--c:${ANS_COLORS[i % 4]}"><span class="bar" style="width:${pct}%"></span><div class="top"><span>${esc(o)}</span><span>${voters.length} · ${pct}%</span></div><div class="who">${voters.map(p => avatarHTML(p, 24)).join("")}</div></div>`;
    }).join("");
  }
  if (q.kind === "number" || q.kind === "reflex") {
    const rows = ps.filter(p => p.choice !== null).sort((a, b) => q.kind === "number" ? Math.abs(a.choice - q.a) - Math.abs(b.choice - q.a) : (a.choice < 0) - (b.choice < 0) || a.choice - b.choice);
    if (!rows.length) return "";
    return rows.map((p, i) => `<div class="vote-row${i === 0 && (q.kind === "number" || p.choice >= 0) ? " win" : ""}"><div class="top"><span>${avatarHTML(p, 22)} ${esc(p.name)}</span><span>${q.kind === "number" ? fmtNum(p.choice) + " " + (q.unit || "") : p.choice < 0 ? "Trop tôt" : p.choice + " ms"}</span></div></div>`).join("");
  }
  return "";
}
$("nextBtn").onclick = () => isHost() && nextRound();

const RING = 119.4;
function updateTimer() {
  if (!state) return;
  if (state.phase === "countdown") return renderCountdown();
  if ($("game").hidden) return;
  const q = state.question;
  // réflexes : passage au vert
  if (q && q.kind === "reflex" && state.phase === "question" && reflexState === "wait" && Date.now() >= reflexGoAt) {
    reflexState = "go"; reflexGoPerf = performance.now(); sfx.go(); vibrate(30); renderReflex(q, false);
  }
  const ring = $("game").querySelector(".ring");
  const left = deadline ? Math.max(0, deadline - Date.now()) : 0;
  if (state.phase === "reveal") {
    $("ringFg").style.strokeDashoffset = RING; $("secs").textContent = "0"; ring.classList.remove("hurry");
    $("autoNext").textContent = state.qIndex + 1 >= state.total ? `Podium dans ${Math.ceil(left / 1000)} s` : `Manche suivante dans ${Math.ceil(left / 1000)} s`;
    return;
  }
  if (state.phase !== "question" || !q || q.kind === "aov") return;
  const dur = q.kind === "reflex" ? Math.max(left, 1) : (q.kind === "number" ? state.dur * 1000 + 5000 : state.dur * 1000);
  const sec = Math.ceil(left / 1000);
  $("ringFg").style.strokeDashoffset = q.kind === "reflex" ? 0 : RING * (1 - left / dur);
  $("secs").textContent = q.kind === "reflex" ? "⚡" : sec;
  const hurry = q.kind !== "reflex" && sec <= 5 && left > 0;
  ring.classList.toggle("hurry", hurry);
  const waiting = (q.kind === "choice" || q.kind === "vote") ? myChoice === null : q.kind === "number" ? numSent === null : false;
  if (sec !== lastSec) { lastSec = sec; if (hurry && waiting) sfx.hurry(); }
  if (left <= 0 && waiting) {
    $("answers").querySelectorAll("button").forEach(b => b.disabled = true);
    $("numInput").disabled = true; $("numSend").disabled = true;
    $("gStatus").textContent = "Temps écoulé…";
  }
}
setInterval(updateTimer, 50);

/* ---------- Fin de partie ---------- */
$("againBtn").onclick = () => { if (isHost()) startGame(); };
$("toLobbyBtn").onclick = () => isHost() && backToLobby();
function renderEnd() {
  const r = ranked();
  const myRank = r.findIndex(p => p.id === me.id) + 1;
  $("endSub").textContent = myRank === 1 && r.length > 1 ? "Tu es le boss de la bande 👑" : myRank ? `Tu termines ${myRank}${myRank === 1 ? "er" : "e"} sur ${r.length}` : "";
  $("podium").innerHTML = [1, 0, 2].map(ix => {
    const p = r[ix]; if (!p) return "<div></div>";
    return `<div class="pod p${ix + 1}"><div class="who">${ix === 0 ? '<span class="crown">👑</span>' : ""}${avatarHTML(p, ix === 0 ? 72 : 54)}</div><b>${esc(p.name)}</b><span class="pts">${fmt(p.score)}</span><div class="step">${ix + 1}</div></div>`;
  }).join("");
  $("finalBoard").innerHTML = boardHTML(r.slice(3), false, 3);
  $("againBtn").hidden = !isHost(); $("toLobbyBtn").hidden = !isHost(); $("againWait").hidden = isHost();
  renderRecap();
}
function renderRecap() {
  const h = state.history || [];
  const graded = h.filter(x => x.kind === "choice");
  const good = graded.filter(x => (x.res.find(r => r.id === me.id) || {}).ok).length;
  $("recapScore").hidden = !graded.length;
  $("recapScore").textContent = `${good}/${graded.length} bonnes`;
  $("recap").innerHTML = h.map(x => {
    const m = MODES[x.mode];
    const mine = x.res.find(r => r.id === me.id);
    const graded = x.kind === "choice" || x.kind === "number" || x.kind === "reflex";
    let mineHtml = "";
    if (mine && mine.label) {
      const okCls = graded ? (mine.ok || mine.pts >= 1000 ? " ok" : " ko") : "";
      mineHtml = `<span class="rmine${okCls}">Toi : ${esc(mine.label)}${mine.pts ? ` · +${fmt(mine.pts)}` : ""}</span>`;
    }
    const chips = x.res.filter(r => r.label).map(r => {
      const p = playerById(r.id) || { name: r.name };
      const cls = x.kind === "vote" ? "" : r.ok ? " ok" : " ko";
      const lab = x.kind === "choice" ? (r.ok ? "✓" : "✗") : esc(r.label);
      return `<span class="chip${cls}">${avatarHTML(p, 20)}${esc(r.name)} ${lab}</span>`;
    }).join("");
    const label = x.kind === "vote" ? "" : x.kind === "aov" ? "" : "Réponse : ";
    return `<li style="--c:${m.c[0]}"><span class="rmode">${m.i} ${esc(m.n)}</span><span class="rq">${esc(x.t)}</span><span class="rans">${label}${esc(x.ans)}</span>${x.ex ? `<span class="rmode">${esc(x.ex)}</span>` : ""}${mineHtml}<div class="rppl">${chips}</div></li>`;
  }).join("");
}

/* prévenir l'hôte avant de fermer l'onglet */
addEventListener("beforeunload", e => { if (role === "host" && L && L.players.size > 1) { e.preventDefault(); e.returnValue = ""; } });
