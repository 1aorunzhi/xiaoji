import { SAVE_KEY, SAVE_VERSION } from './config.js';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

export function createPet() {
  const now = Date.now();
  return {
    v: SAVE_VERSION,
    name: '小记',
    born: now,
    lastSeen: now,
    feeds: 0,
    exp: 0,
    mood: 68,
    traits: { sharp: 58, calm: 44, social: 40 },
    memories: [],
    history: [],
    daysOn: 1,
    lastDay: dayKey(now),
    idlePinged: false,
    full: 56,
    fullAt: now,
    taste: rollTaste(now),
    ate: [],
    gut: 30,
    gutAt: now,
    poop: [],
    cleaned: 0,
  };
}

export function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/* ---------- 成长 ---------- */

export function levelOf(exp) {
  return Math.min(16, 1 + Math.floor(exp / 72));
}

export function weightOf(exp) {
  return Math.round(20 + exp * 0.85);
}

export function stageOf(level) {
  if (level <= 2) return '幼体';
  if (level <= 4) return '幼崽';
  if (level <= 7) return '少年体';
  if (level <= 10) return '成熟体';
  if (level <= 13) return '完全体';
  return '某种东西';
}

export function expToNext(exp) {
  const lv = levelOf(exp);
  if (lv >= 16) return 0;
  return Math.max(0, Math.ceil(lv * 72 - exp));
}

export function expProgress(exp) {
  const lv = levelOf(exp);
  if (lv >= 16) return 100;
  const base = (lv - 1) * 72;
  return Math.max(3, Math.min(100, ((exp - base) / 72) * 100));
}

export function moodWord(mood) {
  if (mood >= 84) return '兴奋得发抖';
  if (mood >= 66) return '还不错';
  if (mood >= 46) return '有点闷';
  if (mood >= 26) return '不太高兴';
  if (mood >= 12) return '在生气';
  return '冷战中';
}

export function moodLabelShort(mood) {
  if (mood >= 84) return '亢奋';
  if (mood >= 66) return '还行';
  if (mood >= 46) return '闷闷的';
  if (mood >= 26) return '不高兴';
  return '记仇中';
}

/* ---------- 性格 → 人格称号 ---------- */

export function titleOf(traits) {
  const { sharp, calm, social } = traits;
  if (sharp >= 72 && calm >= 72) return '清醒的老阴阳人';
  if (sharp <= 30 && social >= 72) return '黏人的小傻白甜';
  if (calm <= 28 && social <= 30) return '躲起来发疯的小东西';
  if (social >= 76 && sharp >= 66) return '嘴上不饶人的社交恐怖分子';

  const a = sharp >= 64 ? '嘴毒的' : sharp <= 36 ? '软糯的' : '';
  const b = social >= 64 ? '话痨' : social <= 36 ? '独居' : '';
  const c = calm >= 64 ? '小哲学家' : calm <= 36 ? '小疯子' : '小东西';
  const t = `${a}${b}${c}`;
  return t === '小东西' ? '还没长出性格的小东西' : t;
}

export function traitHint(traits) {
  const { sharp, calm, social } = traits;
  const p = [];
  if (sharp >= 60) p.push('说话带刺');
  else if (sharp <= 40) p.push('说话软软的');
  if (calm >= 60) p.push('爱讲道理');
  else if (calm <= 40) p.push('很跳脱');
  if (social >= 60) p.push('特别黏人');
  else if (social <= 40) p.push('不太理人');
  return p.length ? p.join('，') + '。' : '还在长，说不好。';
}

/* ---------- 时间与心情 ---------- */

export function applyOffline(pet, now = Date.now()) {
  const away = now - pet.lastSeen;
  const hours = away / HOUR;

  drainFull(pet, now);
  flushPoop(pet, now);

  // 离开越久越不高兴，但第一次回来不至于归零
  if (hours > 2.5) {
    const drop = Math.min(46, (hours - 2.5) * 2.4);
    pet.mood = clamp(pet.mood - drop, 0, 100);
  }

  // 地上那几坨也在等你
  poopPenalty(pet, hours);

  // 跨天后记天数
  const tk = dayKey(now);
  if (pet.lastDay !== tk) {
    const gap = Math.floor((startOfDay(now) - startOfDay(pet.lastSeen)) / DAY);
    if (gap >= 1) pet.daysOn += gap;
    pet.lastDay = tk;
  }

  pet.lastSeen = now;
  return { awayHours: hours, awayDays: away / DAY };
}

function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/* ---------- 一次喂养 ---------- */

export function feed(pet, text) {
  const len = text.trim().length;
  const gain = 12 + Math.min(50, len) * 0.4;
  const beforeLv = levelOf(pet.exp);

  pet.feeds += 1;
  pet.exp += gain;
  pet.mood = clamp(pet.mood + 5, 0, 100);
  pet.lastSeen = Date.now();

  pet.history.push({ role: 'user', content: text, ts: Date.now() });

  return {
    gain: Math.round(gain),
    levelUp: levelOf(pet.exp) > beforeLv,
    level: levelOf(pet.exp),
    weight: weightOf(pet.exp),
  };
}

/* ---------- 吃的：真的喂进去的东西 ---------- */

export const FOODS = [
  { id: 'snack', name: '小鱼干', note: '咸的，嚼起来带劲', exp: 16, mood: 4, full: 9, trait: { sharp: 1.4 } },
  { id: 'stick', name: '猫条', note: '一挤就出来', exp: 24, mood: 7, full: 12, trait: { social: 1.4 } },
  { id: 'can', name: '罐头', note: '开罐声隔着两道门都听得见', exp: 38, mood: 11, full: 32, trait: { social: 1 } },
  { id: 'salmon', name: '三文鱼', note: '整条的，得抱着啃', exp: 52, mood: 15, full: 38, trait: { calm: 1.2 } },
  { id: 'mystery', name: '不明物体', note: '你也忘了这是什么', exp: 30, mood: 0, full: 18, trait: {} },
];

export function foodById(id) {
  return FOODS.find((f) => f.id === id) || null;
}

// 这些是可以有偏爱的东西；不明物体没得挑
const EDIBLE = ['snack', 'stick', 'can', 'salmon'];

/** 口味是出生那一刻定死的：拿出生时间当种子，刷新多少次都不会变 */
function rollTaste(seed) {
  const n = Math.abs(Math.floor(Number(seed) || 1)) >> 3;
  const love = EDIBLE[n % EDIBLE.length];
  let hate = EDIBLE[(n + 1 + ((n >> 2) % 3)) % EDIBLE.length];
  if (hate === love) hate = EDIBLE[(EDIBLE.indexOf(love) + 2) % EDIBLE.length];
  return { love, hate };
}

export function tasteOf(pet, id) {
  if (!pet.taste) pet.taste = rollTaste(pet.born);
  if (pet.taste.love === id) return 'love';
  if (pet.taste.hate === id) return 'hate';
  return 'ok';
}

export function tasteText(pet) {
  if (!pet.taste) pet.taste = rollTaste(pet.born);
  const love = foodById(pet.taste.love);
  const hate = foodById(pet.taste.hate);
  if (!love || !hate) return '还在摸索';
  return `爱吃${love.name}，不碰${hate.name}`;
}

export function fullWord(v) {
  if (v >= 96) return '撑得摊平了';
  if (v >= 78) return '有点撑';
  if (v >= 46) return '八分饱';
  if (v >= 22) return '有点饿';
  return '饿得发慌';
}

/** 肚子会自己空下去：一小时掉一成半，七小时回到底 */
function drainFull(pet, now) {
  if (typeof pet.full !== 'number') pet.full = 56;
  const last = pet.fullAt || pet.lastSeen || now;
  const h = (now - last) / HOUR;
  pet.fullAt = now;
  if (h <= 0) return;
  pet.full = clamp(pet.full - h * 14, 0, 100);
}

/**
 * 真的喂一口。返回这次到底吃成了没有、长了多少、爱不爱吃
 */
export function feedFood(pet, foodId) {
  const food = foodById(foodId);
  if (!food) return null;

  const now = Date.now();
  drainFull(pet, now);

  const taste = tasteOf(pet, food.id);
  if (!Array.isArray(pet.ate)) pet.ate = [];
  const firstTime = !pet.ate.includes(food.id);

  // 已经塞到嗓子眼了
  if (pet.full >= 96) {
    pet.mood = clamp(pet.mood - 2, 0, 100);
    return { food, refused: true, taste, full: pet.full, exp: 0, firstTime };
  }

  const beforeLv = levelOf(pet.exp);
  const stuffed = pet.full >= 78;

  let exp = food.exp;
  let mood = food.mood;
  let weird = 0;

  if (food.id === 'mystery') {
    // 它自己也不知道这次是什么味道
    weird = Math.random();
    exp = Math.round(14 + weird * 48);
    mood = Math.round(-9 + weird * 19);
  }

  if (taste === 'love') {
    exp = Math.round(exp * 1.3);
    mood = Math.round(mood * 1.5 + 2);
  } else if (taste === 'hate') {
    exp = Math.round(exp * 0.7);
    mood -= 4;
  }

  if (stuffed) exp = Math.round(exp * 0.55);

  pet.feeds += 1;
  pet.exp += exp;
  pet.mood = clamp(pet.mood + mood, 0, 100);
  pet.full = clamp(pet.full + (stuffed ? food.full * 0.5 : food.full), 0, 100);
  pet.lastSeen = now;
  pet.fullAt = now;
  // 吃进去的东西不会凭空消失，它总得还回来
  pet.gut = clamp((pet.gut || 0) + food.full * 0.75, 0, 220);
  pet.gutAt = now;

  if (firstTime) pet.ate.push(food.id);

  // 吃的东西会慢慢驯化它
  for (const [k, v] of Object.entries(food.trait || {})) {
    if (typeof pet.traits[k] === 'number') pet.traits[k] = clamp(pet.traits[k] + v, 0, 100);
  }

  return {
    food,
    exp,
    mood,
    taste,
    weird,
    firstTime,
    stuffed,
    refused: false,
    levelUp: levelOf(pet.exp) > beforeLv,
    level: levelOf(pet.exp),
    full: pet.full,
  };
}

// 它开的价里提到的东西，喂对了就算兑现
const FOOD_WORDS = {
  snack: ['小鱼干', '鱼干'],
  stick: ['猫条'],
  can: ['罐头'],
  salmon: ['三文鱼'],
};

export function foodPaysFor(demandText, foodId) {
  const words = FOOD_WORDS[foodId] || [];
  const s = String(demandText || '');
  return words.some((w) => s.includes(w));
}

/* ---------- 吃了就得拉 ---------- */

const POOP_MAX = 4;

/** 消化进度：吃得越饱，走得越快 */
function digest(pet, now) {
  if (typeof pet.gut !== 'number') pet.gut = 30;
  const last = pet.gutAt || pet.lastSeen || now;
  const h = (now - last) / HOUR;
  pet.gutAt = now;
  if (h <= 0) return;
  const speed = 6 + (pet.full / 100) * 12;
  pet.gut = clamp(pet.gut + h * speed, 0, 220);
}

/**
 * 到点了就拉一坨。返回这次新拉出来的（可能不止一坨）
 */
export function flushPoop(pet, now = Date.now()) {
  if (!Array.isArray(pet.poop)) pet.poop = [];
  digest(pet, now);

  const made = [];
  // 地上堆满了它也拉不出来，先憋着
  while (pet.gut >= 100 && pet.poop.length < POOP_MAX) {
    pet.gut -= 100;
    const p = {
      id: `p${now}${Math.floor(Math.random() * 997)}`,
      at: now,
      // 落点别叠在一起
      x: [-0.62, 0.5, -0.28, 0.78][pet.poop.length % 4],
      size: 0.86 + Math.random() * 0.34,
    };
    pet.poop.push(p);
    made.push(p);
  }
  if (pet.poop.length >= POOP_MAX && pet.gut > 99) pet.gut = 99;
  return made;
}

/** 地上有东西不收拾，心情会一点点烂下去 */
export function poopPenalty(pet, hours) {
  if (!pet.poop || !pet.poop.length) return 0;
  const n = pet.poop.length;
  const drop = n * Math.min(7, 1.1 + hours * 0.85);
  pet.mood = clamp(pet.mood - drop, 0, 100);
  return drop;
}

/**
 * 收拾掉一坨。越早收拾越值钱，放久了它已经不高兴了，只值一句「算你还有点良心」
 */
export function cleanPoop(pet, id) {
  if (!Array.isArray(pet.poop)) return null;
  const i = pet.poop.findIndex((p) => p.id === id);
  if (i < 0) return null;

  const [p] = pet.poop.splice(i, 1);
  const hours = (Date.now() - p.at) / HOUR;
  const quick = hours < 0.5;
  const exp = quick ? 6 : 3;
  const mood = quick ? 7 : 3;

  pet.cleaned = (pet.cleaned || 0) + 1;
  pet.exp += exp;
  pet.mood = clamp(pet.mood + mood, 0, 100);
  pet.lastSeen = Date.now();

  return { poop: p, hours, quick, exp, mood, left: pet.poop.length };
}

export function poopWord(n) {
  if (!n) return '很干净';
  if (n === 1) return '一坨';
  if (n <= 3) return `${n} 坨`;
  return `${n} 坨，它没地方下脚`;
}

/** 堆太久又太多：这笔账得记上 */
export function poopSick(pet) {
  const list = pet.poop || [];
  if (list.length < 3) return null;
  const oldest = list.reduce((a, b) => (a.at < b.at ? a : b));
  if (Date.now() - oldest.at < 5 * HOUR) return null;
  // 同一件事只记一次
  const exists = pet.memories.some((m) => m.text.includes('踩在自己'));
  if (exists) return null;
  return addMemory(pet, {
    text: '主人让我踩在自己拉的东西上，一直不收拾',
    kind: 'grudge',
    intensity: 4,
  });
}

export function settleGrudges(pet) {
  let changed = false;
  for (const m of pet.memories) {
    if (m.kind !== 'grudge' || m.settled) continue;
    // 开了价的账更难淡忘：每加一次价，就多耗五顿
    const need = 5 + (m.intensity || 3) + (m.demand ? m.demand.tier * 5 : 0);
    if (pet.feeds - m.feedAt >= need) {
      m.settled = true;
      m.how = 'faded';
      changed = true;
    }
  }
  return changed;
}

export function activeGrudges(pet) {
  return pet.memories.filter((m) => m.kind === 'grudge' && !m.settled);
}

/* ---------- 索赔：道歉不算数，得赔 ---------- */

// 每一档都是三级台阶：先开价，再提价，最后翻倍。加价才是它的天赋
const DEMAND_LADDERS = [
  ['三块小鱼干', '一整条三文鱼', '一条三文鱼，外加摸头十分钟'],
  ['一顿罐头', '两顿罐头', '三顿罐头，一顿都不能少'],
  ['十句好话', '三十句好话，得当面说', '一百句好话，还要录音'],
  ['一根猫条', '三根猫条', '一整盒猫条，拆开一根根喂'],
  ['陪它玩十分钟', '陪它玩半小时，不许看手机', '陪它一整晚，手机扔远点'],
  ['一个抱抱', '抱满五分钟', '抱着它睡一觉'],
  ['当面认输一次', '当着别人的面认输', '写下「我输了」贴在它窝边'],
];

const APOLOGY_RE = /对不起|抱歉|我错了|知道错了|认个错|认错|是我不对|我不该|不该那么|别生气|别气了|消消气|原谅我|道个歉|道歉|对不住|怪我|我检讨/;

export function isApology(text) {
  return APOLOGY_RE.test(String(text || ''));
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function demandText(g) {
  return g && g.demand ? g.demand.text : '';
}

/** 还挂着条件、等着主人兑现的那笔账 */
export function pendingDeal(pet) {
  const list = activeGrudges(pet).filter((g) => g.demand);
  return list.length ? list.sort((a, b) => b.intensity - a.intensity)[0] : null;
}

// 主人这一轮像是真的把东西给了（"已经给过" 的语气，不是 "以后给"）
const GIVEN_RE = /买了|买回来|给你买|我给你带|带回来了|拿来了|拿过来了|放桌上了|放你面前|搁你面前|请你吃|给你弄了|已经给你|给你准备了|赔你|补给|抱你|抱抱你|陪你(玩|半|一|坐|待)/;
const LATER_RE = /明天|下次|改天|待会|等会|一会儿|晚点|以后|回头|过两天/;

export function looksPaid(text) {
  const s = String(text || '');
  return GIVEN_RE.test(s) && !LATER_RE.test(s);
}

/**
 * 它开口要补偿。同一条账再提一次就加价——道歉越诚恳，价钱越贵
 */
export function raiseDemand(pet, target) {
  const g = target || activeGrudges(pet).slice().sort((a, b) => b.intensity - a.intensity)[0];
  if (!g) return null;

  const idx = hashStr(g.text) % DEMAND_LADDERS.length;
  const before = g.demand ? g.demand.tier : 0;
  const tier = Math.min(3, before + 1);
  g.demand = { ladder: idx, tier, text: DEMAND_LADDERS[idx][tier - 1] };
  g.intensity = clamp((g.intensity || 3) + 1, 1, 5);
  g.ts = Date.now();

  return { grudge: g, tier, escalated: before > 0, capped: before >= 3 };
}

/**
 * 条件真兑现了才算翻篇。这是唯一能正常让它松口的途径
 */
export function payOff(pet, grudge) {
  if (!grudge || grudge.settled) return false;
  grudge.settled = true;
  grudge.how = 'paid';
  grudge.settledAt = Date.now();
  return true;
}

/** 记仇簿上那行状态字 */
export function howText(m) {
  if (!m.settled) return grudgeAge(m.ts);
  if (m.how === 'paid') return '赔清了';
  if (m.how === 'faded') return '懒得计较';
  return '已释怀';
}

/** 用模型抄回来的「原文片段」找回对应的那条账 */
export function matchGrudge(pet, snippet) {
  const s = String(snippet || '').trim();
  if (!s) return null;
  const list = activeGrudges(pet);
  let best = null;
  let bestScore = 0;
  for (const g of list) {
    let score = 0;
    if (g.text.includes(s) || s.includes(g.text)) score = 1;
    else score = similarity(g.text, s);
    if (score > bestScore) {
      bestScore = score;
      best = g;
    }
  }
  return bestScore >= 0.5 ? best : null;
}

// 记下一件事。仇只记不消——要消得靠 payOff
export function addMemory(pet, { text, kind, intensity }) {
  const clean = String(text || '').trim().slice(0, 60);
  if (!clean) return null;
  const k = kind === 'grudge' || kind === 'promise' ? kind : 'fact';
  // 去重：意思太像的就不重复记
  const dup = pet.memories.find(
    (m) => m.text === clean || (m.kind === k && similarity(m.text, clean) > 0.72)
  );
  if (dup) {
    dup.intensity = Math.min(5, dup.intensity + 1);
    dup.ts = Date.now();
    return null;
  }
  const mem = {
    id: `m${Date.now()}${Math.floor(Math.random() * 999)}`,
    text: clean,
    kind: k,
    intensity: clamp(Number(intensity) || 3, 1, 5),
    ts: Date.now(),
    feedAt: pet.feeds,
    settled: false,
    demand: null,
  };
  pet.memories.unshift(mem);
  if (pet.memories.length > 40) pet.memories.length = 40;
  return mem;
}

function similarity(a, b) {
  if (!a || !b) return 0;
  const setB = new Set([...b]);
  let hit = 0;
  for (const ch of new Set([...a])) if (setB.has(ch)) hit += 1;
  return hit / Math.max(new Set([...a]).size, 1);
}

/* ---------- 存档 ---------- */

export function loadPet() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    return normalize(data);
  } catch {
    return null;
  }
}

/** 老存档没有的新字段在这里补齐。口味必须由出生时间推出来，不能每次随机构造 */
function normalize(data) {
  const pet = {
    ...createPet(),
    ...data,
    traits: { ...{ sharp: 58, calm: 44, social: 40 }, ...(data.traits || {}) },
  };
  pet.taste = data.taste || rollTaste(pet.born);
  if (typeof pet.full !== 'number') pet.full = 56;
  if (!pet.fullAt) pet.fullAt = pet.lastSeen || Date.now();
  if (!Array.isArray(pet.ate)) pet.ate = [];
  if (typeof pet.gut !== 'number') pet.gut = 30;
  if (!pet.gutAt) pet.gutAt = pet.lastSeen || Date.now();
  if (!Array.isArray(pet.poop)) pet.poop = [];
  if (typeof pet.cleaned !== 'number') pet.cleaned = 0;
  return pet;
}

export function savePet(pet) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(pet));
    return true;
  } catch {
    return false;
  }
}

export function clearPet() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}

/* ---------- 存档码 ---------- */

export function encodeSave(pet) {
  const json = JSON.stringify(pet);
  return 'XJ1-' + btoa(encodeURIComponent(json));
}

export function decodeSave(code) {
  const raw = String(code || '').trim();
  if (!raw.startsWith('XJ1-')) return null;
  try {
    const json = decodeURIComponent(atob(raw.slice(4)));
    const data = JSON.parse(json);
    if (!data || !data.traits) return null;
    return normalize(data);
  } catch {
    return null;
  }
}

/* ---------- 时间文案 ---------- */

export function agoText(ts) {
  const d = Date.now() - ts;
  if (d < 60 * 1000) return '刚刚';
  if (d < HOUR) return `${Math.floor(d / 60000)} 分钟前`;
  if (d < DAY) return `${Math.floor(d / HOUR)} 小时前`;
  return `${Math.floor(d / DAY)} 天前`;
}

export function grudgeAge(ts) {
  const d = Date.now() - ts;
  if (d < DAY) return '耿耿于怀';
  return `记了 ${Math.floor(d / DAY)} 天`;
}
