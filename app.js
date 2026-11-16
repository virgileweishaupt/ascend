'use strict';

/* =========================================================
   Ascend — gamification de vie
   Données stockées localement (localStorage) sur l'appareil.
   ========================================================= */

const KEY = 'ascend.v1';

// --- Règles du jeu (faciles à ajuster) ---
const RANK_MULT = [2, 1.5, 1.2]; // multiplicateur selon le rang du pilier (1er, 2e, 3e)
const OFF_MULT = 1; // actions hors pilier
const DIFF = {
  easy: { label: 'Facile', xp: 10 },
  medium: { label: 'Moyen', xp: 25 },
  hard: { label: 'Difficile', xp: 50 },
};
const STREAK_BONUS = [
  { min: 21, mult: 1.5 },
  { min: 7, mult: 1.25 },
];
const GOLD_RATIO = 0.5; // or gagné par XP
const MAX_PILLARS = 3;
const COLORS = ['#FF375F', '#30D158', '#0AC8FF', '#FF9F0A', '#BF5AF2', '#FFD60A'];
const GOALS = [50, 100, 150, 200, 300];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_LETTER = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

/* ---------- Utilitaires ---------- */
const uid = () => Math.random().toString(36).slice(2, 10);
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Math.round(n).toLocaleString('fr-FR');
const fmtMult = (m) => '×' + String(m).replace('.', ',');

function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseKey(k) {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function addDays(k, n) {
  const d = parseKey(k);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}
const weekdayOf = (k) => parseKey(k).getDay();
function weekKey(k) {
  const d = parseKey(k);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // lundi de la semaine
  return dayKey(d);
}
// La « journée » commence à dayStartHour (4h par défaut) : une action à 1h du matin compte pour la veille.
function today() {
  return dayKey(new Date(Date.now() - S.settings.dayStartHour * 3600e3));
}

/* ---------- État ---------- */
function seed() {
  const k = dayKey(new Date(Date.now() - 4 * 3600e3));
  const [p1, p2, p3] = [uid(), uid(), uid()];
  const h = (title, pillarId, diff, days = ALL_DAYS) => ({ id: uid(), type: 'habit', title, pillarId, diff, days, since: k });
  const q = (title, pillarId, diff) => ({ id: uid(), type: 'quest', title, pillarId, diff, since: k, doneAt: null });
  const work = [1, 2, 3, 4, 5];
  return {
    v: 1,
    since: k,
    lastCheck: addDays(k, -1),
    pillars: [
      { id: p1, name: 'Job corporate', color: COLORS[0], rank: 0, goal: 150, archived: false },
      { id: p2, name: 'Entrepreneuriat', color: COLORS[1], rank: 1, goal: 100, archived: false },
      { id: p3, name: 'Social', color: COLORS[2], rank: 2, goal: 50, archived: false },
    ],
    tasks: [
      h('Bloc de deep work (90 min)', p1, 'hard', work),
      h('Traiter mes mails / inbox à zéro', p1, 'easy', work),
      q('Préparer le point hebdo', p1, 'medium'),
      h('1 h sur mon projet', p2, 'hard'),
      h('20 min de veille ou de lecture business', p2, 'easy'),
      q('Définir la prochaine idée à tester', p2, 'medium'),
      h("Prendre des nouvelles d'un proche", p3, 'easy'),
      q('Organiser une sortie ou un dîner', p3, 'medium'),
      h('Séance de sport', '', 'medium', [1, 3, 5]),
      h('Couché avant minuit', '', 'easy'),
    ],
    log: [],
    rewards: [
      { id: uid(), name: 'Soirée série / jeu sans culpabilité', cost: 150 },
      { id: uid(), name: 'Grasse matinée', cost: 200 },
      { id: uid(), name: 'Resto ou bar', cost: 400 },
      { id: uid(), name: 'Achat plaisir', cost: 800 },
    ],
    purchases: [],
    jokers: {},
    settings: { theme: 'auto', dayStartHour: 4 },
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && Array.isArray(s.pillars) && Array.isArray(s.tasks) && Array.isArray(s.log)) {
        s.rewards ||= [];
        s.purchases ||= [];
        s.jokers ||= {};
        s.settings = { theme: 'auto', dayStartHour: 4, ...(s.settings || {}) };
        return s;
      }
    }
  } catch (e) {
    console.error('Chargement impossible', e);
  }
  return seed();
}

let S = load();
const ui = { tab: 'today', edit: false };
let idx = null; // index recalculé à chaque modification

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(S));
  } catch (e) {
    console.error('Sauvegarde impossible', e);
    toast('Sauvegarde impossible (stockage plein ?)');
  }
}
function commit() {
  idx = null;
  save();
  render();
}

/* ---------- Sélecteurs et calculs ---------- */
function index() {
  if (idx) return idx;
  idx = { done: new Map(), dayXP: new Map(), pillarXP: new Map(), total: 0, earned: 0, days: new Set() };
  for (const e of S.log) {
    idx.done.set(e.taskId + '|' + e.day, e);
    const dk = e.day + '|' + (e.pillarId || '');
    idx.dayXP.set(dk, (idx.dayXP.get(dk) || 0) + e.xp);
    idx.pillarXP.set(e.pillarId || '', (idx.pillarXP.get(e.pillarId || '') || 0) + e.xp);
    idx.total += e.xp;
    idx.earned += e.gold;
    idx.days.add(e.day);
  }
  return idx;
}
const entry = (taskId, k) => index().done.get(taskId + '|' + k);
const isDone = (taskId, k) => index().done.has(taskId + '|' + k);
const dayPillarXP = (k, pid) => index().dayXP.get(k + '|' + pid) || 0;
const pillarXP = (pid) => index().pillarXP.get(pid) || 0;
const totalXP = () => index().total;
const gold = () => index().earned - S.purchases.reduce((a, p) => a + p.cost, 0);
const isJoker = (k) => S.jokers[weekKey(k)] === k;

const activePillars = () => S.pillars.filter((p) => !p.archived).sort((a, b) => a.rank - b.rank);
const pillarById = (id) => S.pillars.find((p) => p.id === id);
const livePillar = (id) => {
  const p = id && pillarById(id);
  return p && !p.archived ? p : null;
};
const multFor = (pid) => {
  const p = livePillar(pid);
  return p ? RANK_MULT[p.rank] ?? OFF_MULT : OFF_MULT;
};
function normalizeRanks() {
  activePillars().forEach((p, i) => (p.rank = i));
}

// Niveau : chaque palier demande un peu plus d'XP que le précédent.
function levelInfo(xp, scale = 1) {
  let level = 1;
  let need = Math.round(100 * scale);
  let cur = xp;
  while (cur >= need) {
    cur -= need;
    level++;
    need = Math.round(100 * scale * Math.pow(level, 1.4));
  }
  return { level, cur, need, pct: cur / need };
}
const pillarLevel = (pid) => levelInfo(pillarXP(pid), 0.6);

const isScheduled = (t, k) => t.type === 'habit' && k >= t.since && t.days.includes(weekdayOf(k));

// Série d'une habitude : jours prévus consécutifs validés, en remontant depuis `k`.
// Un jour protégé par le joker ne casse pas la série (mais ne l'augmente pas).
function habitStreak(t, k) {
  let n = 0;
  while (k >= t.since) {
    if (t.days.includes(weekdayOf(k))) {
      if (isDone(t.id, k)) n++;
      else if (!isJoker(k)) break;
    }
    k = addDays(k, -1);
  }
  return n;
}
function currentStreak(t) {
  const td = today();
  return habitStreak(t, addDays(td, -1)) + (isDone(t.id, td) ? 1 : 0);
}
const streakMult = (n) => (STREAK_BONUS.find((b) => n >= b.min) || { mult: 1 }).mult;

function xpFor(t, streakAfter = 0) {
  const bonus = t.type === 'habit' ? streakMult(streakAfter) : 1;
  return Math.round(DIFF[t.diff].xp * multFor(t.pillarId) * bonus);
}

function ringsClosed(k) {
  const ps = activePillars();
  return ps.length > 0 && ps.every((p) => dayPillarXP(k, p.id) >= p.goal);
}
function ringStreakEnding(k) {
  let n = 0;
  while (k >= S.since) {
    if (ringsClosed(k)) n++;
    else if (!isJoker(k)) break;
    k = addDays(k, -1);
  }
  return n;
}
function ringStreak() {
  const td = today();
  return (ringsClosed(td) ? 1 : 0) + ringStreakEnding(addDays(td, -1));
}

// Joker hebdomadaire : utilisé automatiquement sur un jour raté, seulement s'il protège une série en cours.
function processJokers() {
  const y = addDays(today(), -1);
  let k = S.lastCheck ? addDays(S.lastCheck, 1) : S.since;
  if (k > y) return;
  const used = [];
  while (k <= y) {
    if (!S.jokers[weekKey(k)]) {
      const prev = addDays(k, -1);
      const habitAtRisk = S.tasks.some((t) => isScheduled(t, k) && !isDone(t.id, k) && habitStreak(t, prev) > 0);
      const ringsAtRisk = !ringsClosed(k) && ringStreakEnding(prev) > 0;
      if (habitAtRisk || ringsAtRisk) {
        S.jokers[weekKey(k)] = k;
        used.push(k);
      }
    }
    k = addDays(k, 1);
  }
  S.lastCheck = y;
  idx = null;
  save();
  if (used.length) setTimeout(() => toast('🃏 Joker utilisé : tes séries sont protégées'), 600);
}

/* ---------- Actions ---------- */
function completeTask(t, ev) {
  const td = today();
  if (isDone(t.id, td)) return;
  const lvBefore = levelInfo(totalXP()).level;
  const pillar = livePillar(t.pillarId);
  const pLvBefore = pillar ? pillarLevel(pillar.id).level : 0;
  const ringBefore = pillar ? dayPillarXP(td, pillar.id) >= pillar.goal : true;
  const allBefore = ringsClosed(td);

  const streak = t.type === 'habit' ? habitStreak(t, addDays(td, -1)) + 1 : 0;
  const xp = xpFor(t, streak);
  const g = Math.round(xp * GOLD_RATIO);
  const e = { id: uid(), taskId: t.id, title: t.title, day: td, ts: Date.now(), xp, gold: g, pillarId: pillar ? pillar.id : '' };
  S.log.push(e);
  if (t.type === 'quest') t.doneAt = td;
  commit();

  const row = $(`.task[data-id="${t.id}"]`);
  if (row) row.classList.add('pop');
  floatXP(ev, `+${xp} XP`, pillar ? pillar.color : 'var(--accent)');
  toast(`+${xp} XP · +${g} or`, { label: 'Annuler', fn: () => uncompleteTask(t, true) });

  const lvAfter = levelInfo(totalXP()).level;
  if (lvAfter > lvBefore) celebrate({ kicker: 'Niveau supérieur', num: lvAfter, text: 'Tu montes en puissance. Continue.' });
  if (pillar) {
    const pLvAfter = pillarLevel(pillar.id).level;
    if (pLvAfter > pLvBefore && lvAfter === lvBefore) toast(`${pillar.name} passe niveau ${pLvAfter} !`);
    if (!ringBefore && dayPillarXP(td, pillar.id) >= pillar.goal) {
      if (!allBefore && ringsClosed(td)) {
        celebrate({ kicker: 'Journée parfaite', num: `${activePillars().length}/${activePillars().length}`, small: true, text: `Tous tes anneaux sont fermés · série de ${ringStreak()} j` });
      } else {
        toast(`Anneau ${pillar.name} fermé !`);
      }
    }
  }
}

function uncompleteTask(t, silent) {
  const td = today();
  const e = entry(t.id, td);
  if (!e) return;
  S.log = S.log.filter((x) => x.id !== e.id);
  const live = S.tasks.find((x) => x.id === t.id);
  if (live && live.type === 'quest') live.doneAt = null;
  commit();
  if (!silent) toast(`Action annulée (−${e.xp} XP)`);
}

function movePillar(id, dir) {
  const ps = activePillars();
  const i = ps.findIndex((p) => p.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ps.length) return;
  [ps[i].rank, ps[j].rank] = [ps[j].rank, ps[i].rank];
  commit();
}

/* ---------- Rendu ---------- */
const app = $('#app');
const prevAnim = {};

function render() {
  const th = S.settings.theme;
  if (th === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = th;

  app.innerHTML = ui.tab === 'today' ? viewToday() : ui.tab === 'shop' ? viewShop() : viewProfile();
  document.querySelectorAll('#tabbar .tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === ui.tab));
  animate();
}

// Anime anneaux et barres depuis leur valeur précédente vers la nouvelle.
function animate() {
  const apply = (el, v) => {
    if (el.classList.contains('ring')) {
      el.style.strokeDashoffset = +el.dataset.c * (1 - v);
      el.style.opacity = v > 0 ? 1 : 0;
    } else {
      el.style.width = v * 100 + '%';
    }
  };
  document.querySelectorAll('[data-anim]').forEach((el) => {
    const k = el.dataset.anim;
    const to = Math.max(0, Math.min(1, +el.dataset.to || 0));
    apply(el, prevAnim[k] ?? 0);
    prevAnim[k] = to;
    requestAnimationFrame(() => requestAnimationFrame(() => apply(el, to)));
  });
}

const bar = (key, pct) => `<div class="bar"><i data-anim="${key}" data-to="${pct}"></i></div>`;
const CHECK_SVG = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

function ringsSVG(ps, td) {
  const size = 148;
  const sw = ps.length > 2 ? 15 : 17;
  const gap = 3;
  let out = '';
  ps.forEach((p, i) => {
    const r = size / 2 - sw / 2 - i * (sw + gap);
    const c = 2 * Math.PI * r;
    const pct = Math.min(dayPillarXP(td, p.id) / p.goal, 1);
    out += `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${p.color}" stroke-opacity=".2" stroke-width="${sw}"/>
      <circle class="ring" data-anim="ring-${p.id}" data-to="${pct}" data-c="${c}" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none"
        stroke="${p.color}" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c}"
        transform="rotate(-90 ${size / 2} ${size / 2})"/>`;
  });
  return `<svg class="rings" viewBox="0 0 ${size} ${size}" role="img" aria-label="Anneaux du jour">${out}</svg>`;
}

function taskRow(t, td) {
  const p = livePillar(t.pillarId);
  const color = p ? p.color : 'var(--muted)';
  const e = entry(t.id, td);
  const done = !!e;
  const meta = [DIFF[t.diff].label];
  let xp;
  if (t.type === 'habit') {
    const before = habitStreak(t, addDays(td, -1));
    const streak = before + (done ? 1 : 0);
    xp = done ? e.xp : xpFor(t, before + 1);
    if (streak > 0) meta.push(`<span class="streak">🔥 ${streak} j</span>`);
    const m = streakMult(done ? streak : before + 1);
    if (m > 1) meta.push(`<span class="bonus">Bonus série ${fmtMult(m)}</span>`);
    if (ui.edit && t.days.length < 7) meta.push(WEEK_ORDER.filter((d) => t.days.includes(d)).map((d) => DAY_LETTER[d]).join(' '));
  } else {
    xp = done ? e.xp : xpFor(t);
    meta.push('Quête');
  }
  const right = ui.edit ? '<span class="chev">›</span>' : `<span class="t-xp">+${xp}</span>`;
  return `<button class="task ${done ? 'done' : ''}" data-act="${ui.edit ? 'edit-task' : 'toggle'}" data-id="${t.id}" style="--c:${color}">
    <span class="check">${CHECK_SVG}</span>
    <span class="t-body"><span class="t-title">${esc(t.title)}</span><span class="t-meta">${meta.join('<span>·</span>')}</span></span>
    ${right}
  </button>`;
}

function viewToday() {
  const td = today();
  const ps = activePillars();
  const lv = levelInfo(totalXP());
  const dateStr = parseKey(td).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const jokerFree = !S.jokers[weekKey(td)];

  let h = `<header class="head">
    <div><div class="date">${dateStr}</div><h1>Aujourd'hui</h1></div>
    <div class="pills"><span class="pill"><i class="coin"></i>${fmt(gold())}</span><span class="pill lvl">Niv. ${lv.level}</span></div>
  </header>`;

  if (ps.length) {
    h += `<section class="card rings-card">${ringsSVG(ps, td)}<div class="legend">${ps
      .map((p) => {
        const v = dayPillarXP(td, p.id);
        return `<div class="row"><div class="n" style="--c:${p.color}">${esc(p.name)}</div>
          <div class="v">${fmt(v)}<small> / ${p.goal} XP${v >= p.goal ? ' ✓' : ''}</small></div></div>`;
      })
      .join('')}</div></section>`;
  }

  h += `<div class="strip">
    <div class="chip-stat"><span class="ico">🔥</span><span><b>${ringStreak()}</b> j d'anneaux fermés</span></div>
    <div class="chip-stat"><span class="ico">🃏</span><span>Joker <b style="font-size:14px">${jokerFree ? 'dispo' : 'utilisé'}</b></span></div>
  </div>`;

  h += `<section class="card level-card">
    <div class="top"><b>Niveau ${lv.level}</b><span>${fmt(lv.cur)} / ${fmt(lv.need)} XP</span></div>
    ${bar('lvl', lv.pct)}
  </section>`;

  // Tâches du jour (en mode édition : toutes les tâches en cours)
  const visible = S.tasks.filter((t) =>
    t.type === 'habit' ? ui.edit || isScheduled(t, td) : !t.doneAt || t.doneAt === td
  );
  const sortDone = (a, b) => isDone(a.id, td) - isDone(b.id, td);
  const groups = ps.map((p) => ({ p, tasks: visible.filter((t) => t.pillarId === p.id).sort(sortDone) }));
  const off = visible.filter((t) => !livePillar(t.pillarId)).sort(sortDone);

  h += `<div style="display:flex;justify-content:flex-end;margin:-4px 4px -14px">
    <button class="link" data-act="toggle-edit">${ui.edit ? 'Terminé' : 'Modifier'}</button></div>`;

  for (const { p, tasks } of groups) {
    h += `<div class="sec-head"><span class="dot" style="background:${p.color}"></span><h2>${esc(p.name)}</h2>
      <span class="mult" style="background:${p.color};color:#0b0b0f">${fmtMult(RANK_MULT[p.rank])}</span></div>
      <div class="list">${tasks.map((t) => taskRow(t, td)).join('') || '<div class="empty">Rien de prévu ici. Ajoute une action avec +</div>'}</div>`;
  }
  if (off.length || !ps.length) {
    h += `<div class="sec-head"><span class="dot" style="background:var(--muted)"></span><h2>Hors pilier</h2>
      <span class="mult off">${fmtMult(OFF_MULT)}</span></div>
      <div class="list">${off.map((t) => taskRow(t, td)).join('') || '<div class="empty">Aucune action pour le moment.</div>'}</div>`;
  }

  h += `<button class="fab" data-act="add-task" aria-label="Ajouter une action">+</button>`;
  return h;
}

function viewShop() {
  const g = gold();
  let h = `<header class="head"><div><div class="date">Récompenses</div><h1>Boutique</h1></div>
    <div class="pills"><button class="link" data-act="add-reward">+ Ajouter</button></div></header>`;
  h += `<section class="card balance"><div class="big"><i class="coin"></i>${fmt(g)}</div>
    <p>Ton or. Tu en gagnes à chaque action validée.</p></section>`;

  const rewards = [...S.rewards].sort((a, b) => a.cost - b.cost);
  h += `<div class="list">${
    rewards
      .map((r) => {
        const ok = g >= r.cost;
        return `<div class="reward">
          <button class="r-body" data-act="edit-reward" data-id="${r.id}">
            <div class="r-name">${esc(r.name)}</div>
            ${ok ? '<div class="r-sub">Disponible ✓</div>' : `${bar('rw-' + r.id, g / r.cost)}<div class="r-sub">Encore ${fmt(r.cost - g)} or</div>`}
          </button>
          <button class="buy ${ok ? 'ok' : ''}" data-act="buy" data-id="${r.id}" ${ok ? '' : 'disabled'}><i class="coin"></i>${fmt(r.cost)}</button>
        </div>`;
      })
      .join('') || '<div class="empty">Ajoute tes premières récompenses : de vraies choses qui te font plaisir.</div>'
  }</div>`;

  if (S.purchases.length) {
    h += `<div class="sec-head"><h2>Historique</h2></div><div class="list">${[...S.purchases]
      .reverse()
      .slice(0, 20)
      .map(
        (p) =>
          `<div class="hist"><span>${esc(p.name)}</span><span>−${fmt(p.cost)} · ${new Date(p.ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</span></div>`
      )
      .join('')}</div>`;
  }
  return h;
}

function viewProfile() {
  const ps = activePillars();
  const lv = levelInfo(totalXP());
  const widths = ['76%', '88%', '100%'];
  let h = `<header class="head"><div><div class="date">Ta progression</div><h1>Pyramide</h1></div></header>`;

  h += `<section class="card hero"><div class="lbl">Niveau</div><div class="lvl-num">${lv.level}</div>
    ${bar('lvl', lv.pct)}<div class="sub">${fmt(lv.cur)} / ${fmt(lv.need)} XP avant le niveau ${lv.level + 1}</div></section>`;

  h += `<div class="pyramid">`;
  ps.forEach((p, i) => {
    const pl = pillarLevel(p.id);
    h += `<div class="tier" style="width:${widths[i + (3 - ps.length)] || '100%'};background:${p.color}" data-act="edit-pillar" data-id="${p.id}">
      <div class="body"><div class="name">${esc(p.name)}</div>
        <div class="meta">Niv. ${pl.level} · ${fmt(pillarXP(p.id))} XP</div>${bar('pl-' + p.id, pl.pct)}</div>
      <span class="x">${fmtMult(RANK_MULT[p.rank])}</span>
      <div class="arrows">
        <button data-act="pillar-up" data-id="${p.id}" ${i === 0 ? 'disabled' : ''} aria-label="Monter">▲</button>
        <button data-act="pillar-down" data-id="${p.id}" ${i === ps.length - 1 ? 'disabled' : ''} aria-label="Descendre">▼</button>
      </div></div>`;
  });
  h += `<div class="tier off" style="width:100%">
      <div class="body"><div class="name">Hors pilier</div><div class="meta">${fmt(pillarXP(''))} XP · le reste de ta vie</div></div>
      <span class="x">${fmtMult(OFF_MULT)}</span></div></div>`;
  h += `<p class="hint" style="margin:-4px 8px 14px;text-align:center">Plus un pilier est haut, plus ses actions rapportent. Touche un pilier pour le modifier, ▲▼ pour changer les priorités.</p>`;
  if (ps.length < MAX_PILLARS) h += `<button class="btn ghost" style="margin-bottom:14px" data-act="add-pillar">+ Ajouter un pilier</button>`;

  const habits = S.tasks.filter((t) => t.type === 'habit');
  const best = habits.reduce((m, t) => Math.max(m, currentStreak(t)), 0);
  h += `<div class="grid2">
    <div class="stat"><b>${fmt(totalXP())}</b><span>XP au total</span></div>
    <div class="stat"><b>${fmt(S.log.length)}</b><span>Actions validées</span></div>
    <div class="stat"><b>${index().days.size}</b><span>Jours actifs</span></div>
    <div class="stat"><b>${best} j</b><span>Meilleure série en cours</span></div>
  </div>`;

  const archived = S.pillars.filter((p) => p.archived);
  if (archived.length) {
    h += `<div class="sec-head"><h2>Piliers archivés</h2></div><div class="list">${archived
      .map(
        (p) => `<div class="setting"><span>${esc(p.name)}<small>Niv. ${pillarLevel(p.id).level} · ${fmt(pillarXP(p.id))} XP</small></span>
          ${ps.length < MAX_PILLARS ? `<button class="link" data-act="restore-pillar" data-id="${p.id}">Réactiver</button>` : ''}</div>`
      )
      .join('')}</div>`;
  }

  const th = S.settings.theme;
  const seg = (v, l) => `<label><input type="radio" name="theme" value="${v}" ${th === v ? 'checked' : ''}><span>${l}</span></label>`;
  h += `<div class="sec-head"><h2>Réglages</h2></div><div class="list">
    <div class="setting" style="display:block"><div style="margin-bottom:9px">Apparence</div>
      <div class="seg" data-change="theme">${seg('auto', 'Auto')}${seg('light', 'Clair')}${seg('dark', 'Sombre')}</div></div>
    <div class="setting"><span>Début de la journée<small>Avant cette heure, une action compte pour la veille</small></span>
      <select data-change="daystart">${[0, 1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}" ${S.settings.dayStartHour === n ? 'selected' : ''}>${n} h</option>`).join('')}</select></div>
    <button class="setting" data-act="export"><span>Exporter une sauvegarde<small>Tes données ne sont stockées que sur cet appareil</small></span><span class="chev">›</span></button>
    <button class="setting" data-act="import"><span>Importer une sauvegarde</span><span class="chev">›</span></button>
    <button class="setting red" data-act="reset"><span>Tout réinitialiser</span></button>
  </div>
  <input type="file" id="import-file" accept="application/json,.json" hidden>`;
  return h;
}

/* ---------- Feuilles (formulaires) ---------- */
const sheetRoot = $('#sheet-root');
let sheetSubmit = null;

function openSheet(title, body, onSubmit, onMount) {
  sheetSubmit = onSubmit;
  sheetRoot.innerHTML = `<div class="backdrop" data-act="close-sheet"><form class="sheet" novalidate>
    <div class="grab"></div><h3>${title}</h3>${body}</form></div>`;
  if (onMount) onMount($('.sheet', sheetRoot));
}
function closeSheet() {
  sheetRoot.innerHTML = '';
  sheetSubmit = null;
}
sheetRoot.addEventListener('submit', (e) => {
  e.preventDefault();
  if (sheetSubmit) sheetSubmit(new FormData(e.target), e.submitter);
});

const radio = (name, value, label, checked, style = '') =>
  `<label><input type="radio" name="${name}" value="${value}" ${checked ? 'checked' : ''}><span style="${style}">${label}</span></label>`;

function taskSheet(t) {
  const isNew = !t;
  const ps = activePillars();
  t = t || { type: 'habit', title: '', pillarId: ps[0] ? ps[0].id : '', diff: 'medium', days: ALL_DAYS };
  const curPillar = livePillar(t.pillarId) ? t.pillarId : '';
  const days = t.days || ALL_DAYS;

  const body = `
    <div class="field"><label for="f-title">Action</label>
      <input class="input" id="f-title" name="title" value="${esc(t.title)}" placeholder="Ex. 30 min de prospection" autocomplete="off" maxlength="80"></div>
    <div class="field"><div class="lab">Type</div><div class="seg">
      ${radio('type', 'habit', 'Habitude', t.type === 'habit')}${radio('type', 'quest', 'Quête ponctuelle', t.type === 'quest')}</div></div>
    <div class="field"><div class="lab">Pilier</div><div class="choices">
      ${ps.map((p) => radio('pillar', p.id, `<i></i>${esc(p.name)} ${fmtMult(RANK_MULT[p.rank])}`, curPillar === p.id, `--c:${p.color}`)).join('')}
      ${radio('pillar', '', `<i></i>Hors pilier ${fmtMult(OFF_MULT)}`, curPillar === '')}</div></div>
    <div class="field"><div class="lab">Difficulté</div><div class="seg">
      ${Object.entries(DIFF).map(([k, d]) => radio('diff', k, `${d.label} · ${d.xp}`, t.diff === k)).join('')}</div></div>
    <div class="field" id="f-days"><div class="lab">Jours</div><div class="choices days">
      ${WEEK_ORDER.map((d) => `<label><input type="checkbox" name="days" value="${d}" ${days.includes(d) ? 'checked' : ''}><span>${DAY_LETTER[d]}</span></label>`).join('')}</div></div>
    <div class="preview-xp" id="f-preview"></div>
    <div class="actions">
      <button class="btn" type="submit" value="save">${isNew ? 'Ajouter' : 'Enregistrer'}</button>
      ${isNew ? '<button class="btn ghost" type="submit" value="now" id="f-now">Ajouter et valider tout de suite</button>' : ''}
      ${isNew ? '' : `<button class="btn danger" type="button" data-act="delete-task" data-id="${t.id}">Supprimer</button>`}
    </div>`;

  openSheet(
    isNew ? 'Nouvelle action' : "Modifier l'action",
    body,
    (fd, submitter) => {
      const title = String(fd.get('title') || '').trim();
      if (!title) {
        $('#f-title').focus();
        return;
      }
      const type = fd.get('type');
      const picked = fd.getAll('days').map(Number);
      const data = { title, type, pillarId: fd.get('pillar') || '', diff: fd.get('diff'), days: picked.length ? picked : ALL_DAYS };
      const td = today();
      let task;
      if (isNew) {
        task = { id: uid(), since: td, doneAt: null, ...data };
        S.tasks.push(task);
      } else {
        task = S.tasks.find((x) => x.id === t.id);
        Object.assign(task, data);
        if (task.type === 'quest' && task.doneAt === undefined) task.doneAt = null;
      }
      closeSheet();
      if (isNew && submitter && submitter.value === 'now') completeTask(task, null);
      else commit();
    },
    (form) => {
      const refresh = () => {
        const fd = new FormData(form);
        const habit = fd.get('type') === 'habit';
        $('#f-days', form).style.display = habit ? '' : 'none';
        const xp = Math.round(DIFF[fd.get('diff')].xp * multFor(fd.get('pillar')));
        $('#f-preview', form).innerHTML = `Rapporte <b>+${xp} XP</b> et ${Math.round(xp * GOLD_RATIO)} or${habit ? ' (hors bonus de série)' : ''}`;
      };
      form.addEventListener('change', refresh);
      refresh();
      if (isNew) setTimeout(() => $('#f-title', form).focus(), 350);
    }
  );
}

function pillarSheet(p) {
  const isNew = !p;
  const used = activePillars().map((x) => x.color);
  p = p || { name: '', color: COLORS.find((c) => !used.includes(c)) || COLORS[0], goal: 100 };
  const body = `
    <div class="field"><label for="f-name">Nom du pilier</label>
      <input class="input" id="f-name" name="name" value="${esc(p.name)}" placeholder="Ex. Santé" autocomplete="off" maxlength="30"></div>
    <div class="field"><div class="lab">Couleur</div><div class="choices colors">
      ${COLORS.map((c) => radio('color', c, '', p.color === c, `--c:${c}`)).join('')}</div></div>
    <div class="field"><div class="lab">Objectif quotidien (XP pour fermer l'anneau)</div><div class="seg">
      ${GOALS.map((g) => radio('goal', g, g, p.goal === g)).join('')}</div>
      <p class="hint">Vise un objectif atteignable un jour normal : c'est la régularité qui compte.</p></div>
    <div class="actions">
      <button class="btn" type="submit">${isNew ? 'Créer le pilier' : 'Enregistrer'}</button>
      ${isNew ? '' : `<button class="btn danger" type="button" data-act="archive-pillar" data-id="${p.id}">Archiver ce pilier</button>`}
    </div>`;
  openSheet(isNew ? 'Nouveau pilier' : 'Modifier le pilier', body, (fd) => {
    const name = String(fd.get('name') || '').trim();
    if (!name) {
      $('#f-name').focus();
      return;
    }
    const data = { name, color: fd.get('color') || p.color, goal: Number(fd.get('goal')) || 100 };
    if (isNew) {
      if (activePillars().length >= MAX_PILLARS) return;
      S.pillars.push({ id: uid(), rank: activePillars().length, archived: false, ...data });
    } else {
      Object.assign(pillarById(p.id), data);
    }
    closeSheet();
    commit();
  });
}

function rewardSheet(r) {
  const isNew = !r;
  r = r || { name: '', cost: 200 };
  const body = `
    <div class="field"><label for="f-name">Récompense</label>
      <input class="input" id="f-name" name="name" value="${esc(r.name)}" placeholder="Ex. Ciné" autocomplete="off" maxlength="50"></div>
    <div class="field"><label for="f-cost">Prix en or</label>
        <input class="input" id="f-cost" name="cost" type="number" inputmode="numeric" min="1" step="10" value="${r.cost}"></div>
    <p class="hint" style="margin:-6px 4px 16px">Repère : une bonne journée rapporte environ 100 à 150 or.</p>
    <div class="actions">
      <button class="btn" type="submit">${isNew ? 'Ajouter' : 'Enregistrer'}</button>
      ${isNew ? '' : `<button class="btn danger" type="button" data-act="delete-reward" data-id="${r.id}">Supprimer</button>`}
    </div>`;
  openSheet(isNew ? 'Nouvelle récompense' : 'Modifier la récompense', body, (fd) => {
    const name = String(fd.get('name') || '').trim();
    const cost = Math.max(1, Math.round(Number(fd.get('cost')) || 0));
    if (!name) {
      $('#f-name').focus();
      return;
    }
    const data = { name, cost };
    if (isNew) S.rewards.push({ id: uid(), ...data });
    else Object.assign(S.rewards.find((x) => x.id === r.id), data);
    closeSheet();
    commit();
  });
}

function buySheet(r) {
  const g = gold();
  openSheet(
    esc(r.name),
    `<p class="hint" style="font-size:15px;margin:-6px 0 18px">Dépenser <b>${fmt(r.cost)} or</b> ? Il te restera ${fmt(g - r.cost)} or.</p>
     <div class="actions"><button class="btn" type="submit">Je me l'offre</button>
     <button class="btn ghost" type="button" data-act="close-sheet-btn">Pas maintenant</button></div>`,
    () => {
      if (gold() < r.cost) return;
      const p = { id: uid(), rewardId: r.id, name: r.name, cost: r.cost, ts: Date.now() };
      S.purchases.push(p);
      closeSheet();
      commit();
      toast("Profite bien, tu l'as mérité", {
        label: 'Annuler',
        fn: () => {
          S.purchases = S.purchases.filter((x) => x.id !== p.id);
          commit();
        },
      });
    }
  );
}

/* ---------- Toasts et effets ---------- */
const toastRoot = $('#toast-root');
function toast(msg, action) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${esc(msg)}</span>`;
  const kill = () => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 260);
  };
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.onclick = () => {
      action.fn();
      el.remove();
    };
    el.appendChild(b);
  }
  while (toastRoot.children.length >= 2) toastRoot.firstChild.remove();
  toastRoot.appendChild(el);
  setTimeout(kill, action ? 4500 : 2800);
}

const fxRoot = $('#fx-root');
function floatXP(ev, text, color) {
  const el = document.createElement('div');
  el.className = 'float-xp';
  el.textContent = text;
  el.style.color = color;
  el.style.left = (ev && ev.clientX ? ev.clientX : window.innerWidth / 2) + 'px';
  el.style.top = (ev && ev.clientY ? ev.clientY - 20 : window.innerHeight / 2) + 'px';
  fxRoot.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}

const celebrateQueue = [];
function celebrate(c) {
  celebrateQueue.push(c);
  if (celebrateQueue.length === 1) showCelebrate();
}
function showCelebrate() {
  const c = celebrateQueue[0];
  if (!c) return;
  const el = document.createElement('div');
  el.className = 'celebrate';
  let confetti = '';
  for (let i = 0; i < 46; i++) {
    confetti += `<i class="confetti" style="left:${Math.random() * 100}%;background:${COLORS[i % COLORS.length]};animation-duration:${1.6 + Math.random() * 1.8}s;animation-delay:${Math.random() * 0.5}s;transform:rotate(${Math.random() * 360}deg)"></i>`;
  }
  el.innerHTML = `${confetti}<div class="inner"><div class="kicker">${esc(c.kicker)}</div>
    <div class="num ${c.small ? 'small' : ''}">${esc(c.num)}</div><p>${esc(c.text)}</p><div class="tap">Touche pour continuer</div></div>`;
  const close = () => {
    if (!el.isConnected) return;
    el.remove();
    celebrateQueue.shift();
    showCelebrate();
  };
  el.onclick = close;
  setTimeout(close, 4200);
  fxRoot.appendChild(el);
}

/* ---------- Sauvegarde ---------- */
async function exportData() {
  const name = `ascend-sauvegarde-${today()}.json`;
  const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
  try {
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Sauvegarde Ascend' });
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const s = JSON.parse(reader.result);
      if (!s || !Array.isArray(s.pillars) || !Array.isArray(s.tasks) || !Array.isArray(s.log)) throw new Error('format');
      if (!confirm('Remplacer toutes les données actuelles par cette sauvegarde ?')) return;
      localStorage.setItem(KEY, JSON.stringify(s));
      S = load();
      idx = null;
      render();
      toast('Sauvegarde importée');
    } catch (e) {
      toast("Ce fichier n'est pas une sauvegarde valide");
    }
  };
  reader.readAsText(file);
}

/* ---------- Événements ---------- */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const { act, id } = el.dataset;
  const task = () => S.tasks.find((t) => t.id === id);

  switch (act) {
    case 'tab':
      ui.tab = el.dataset.tab;
      ui.edit = false;
      render();
      window.scrollTo(0, 0);
      break;
    case 'toggle': {
      const t = task();
      if (!t) break;
      if (isDone(t.id, today())) uncompleteTask(t);
      else completeTask(t, e);
      break;
    }
    case 'toggle-edit':
      ui.edit = !ui.edit;
      render();
      break;
    case 'add-task':
      taskSheet(null);
      break;
    case 'edit-task':
      if (task()) taskSheet(task());
      break;
    case 'delete-task':
      S.tasks = S.tasks.filter((t) => t.id !== id);
      closeSheet();
      commit();
      toast("Action supprimée (l'XP déjà gagnée est conservée)");
      break;
    case 'close-sheet':
      if (e.target === el) closeSheet();
      break;
    case 'close-sheet-btn':
      closeSheet();
      break;
    case 'add-pillar':
      pillarSheet(null);
      break;
    case 'edit-pillar':
      if (pillarById(id)) pillarSheet(pillarById(id));
      break;
    case 'pillar-up':
      movePillar(id, -1);
      break;
    case 'pillar-down':
      movePillar(id, 1);
      break;
    case 'archive-pillar': {
      const p = pillarById(id);
      if (!p) break;
      p.archived = true;
      normalizeRanks();
      closeSheet();
      commit();
      toast(`${p.name} archivé. Son XP reste acquise.`);
      break;
    }
    case 'restore-pillar': {
      const p = pillarById(id);
      if (!p || activePillars().length >= MAX_PILLARS) break;
      p.rank = activePillars().length;
      p.archived = false;
      commit();
      break;
    }
    case 'add-reward':
      rewardSheet(null);
      break;
    case 'edit-reward': {
      const r = S.rewards.find((x) => x.id === id);
      if (r) rewardSheet(r);
      break;
    }
    case 'delete-reward':
      S.rewards = S.rewards.filter((x) => x.id !== id);
      closeSheet();
      commit();
      break;
    case 'buy': {
      const r = S.rewards.find((x) => x.id === id);
      if (r && gold() >= r.cost) buySheet(r);
      break;
    }
    case 'export':
      exportData();
      break;
    case 'import':
      $('#import-file').click();
      break;
    case 'reset':
      if (confirm('Effacer toutes tes données (XP, actions, récompenses) et repartir de zéro ?')) {
        localStorage.removeItem(KEY);
        S = seed();
        idx = null;
        save();
        ui.tab = 'today';
        render();
      }
      break;
  }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'import-file' && t.files[0]) {
    importData(t.files[0]);
    return;
  }
  const holder = t.closest('[data-change]');
  if (!holder) return;
  if (holder.dataset.change === 'theme') S.settings.theme = t.value;
  if (holder.dataset.change === 'daystart') S.settings.dayStartHour = Number(t.value);
  commit();
});

// Au retour dans l'app (nouvelle journée possible) : jokers + rafraîchissement.
let lastDay = null;
function refreshDay() {
  processJokers();
  const td = today();
  if (td !== lastDay) {
    lastDay = td;
    render();
  }
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshDay();
});
setInterval(refreshDay, 60e3);

/* ---------- Démarrage ---------- */
save();
refreshDay();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
