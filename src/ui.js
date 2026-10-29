import {
  levelOf, weightOf, stageOf, moodWord, moodLabelShort, titleOf,
  activeGrudges, howText, expToNext, expProgress,
  FOODS, tasteOf, fullWord, tasteText, poopWord,
} from './state.js';

// 档案里点「给了」时回调，由 main.js 注入
let payHandler = null;
export function setPayHandler(fn) {
  payHandler = fn;
}

const $ = (id) => document.getElementById(id);

export const el = {
  app: $('app'),
  pet: $('pet'),
  petBody: $('petBody'),
  petMouth: $('petMouth'),
  statusline: $('statusline'),
  chat: $('chat'),
  input: $('input'),
  send: $('send'),
  composer: $('composer'),
  petName: $('petName'),
  petTitle: $('petTitle'),
  lvBadge: $('lvBadge'),
  weightBadge: $('weightBadge'),
  moodFill: $('moodFill'),
  sheet: $('sheet'),
  sheetMask: $('sheetMask'),
  openSheet: $('openSheet'),
  toastWrap: $('toastWrap'),
  tray: $('tray'),
  trayBtn: $('trayBtn'),
  trayItems: $('trayItems'),
  traySub: $('traySub'),
  poopLayer: $('poopLayer'),
};

const MOUTHS = {
  happy: 'M135 183 Q150 199 165 183',
  neutral: 'M140 189 L160 189',
  sad: 'M137 194 Q150 181 163 194',
};

export function renderHud(pet) {
  const lv = levelOf(pet.exp);
  const weight = weightOf(pet.exp);
  const mood = Math.round(pet.mood);

  el.petName.textContent = pet.name;
  el.petTitle.textContent = titleOf(pet.traits);
  el.lvBadge.textContent = `Lv.${lv}`;
  el.weightBadge.textContent = `${weight}g`;

  el.moodFill.style.width = `${expProgress(pet.exp)}%`;
  el.moodFill.classList.remove('low');
  el.app.classList.toggle('mood-low', mood < 30);

  // 形态演化：长大是「长出新的部件」，不只是把同一颗球放大
  const PART_AT = {
    'part-ear': 3,   // 幼崽：长出两只耳朵
    'part-hand': 5,  // 少年体：长出小手
    'part-tail': 6,  // 少年体：长出尾巴
    'part-brow': 8,  // 成熟体：开始皱眉头
    'part-spot': 10, // 成熟体后期：背上浮出斑纹
    'part-halo': 11, // 完全体：头顶多一圈东西
  };
  for (const [cls, at] of Object.entries(PART_AT)) {
    for (const node of el.pet.querySelectorAll(`.${cls}`)) {
      node.classList.toggle('on', lv >= at);
    }
  }
  // 天线只属于幼体，长出耳朵就退场
  for (const node of el.pet.querySelectorAll('.part-stalk')) {
    node.classList.toggle('on', lv <= 2);
  }

  el.pet.classList.toggle('juvenile', lv >= 3 && lv <= 4);
  el.pet.classList.toggle('teen', lv >= 5 && lv <= 7);
  el.pet.classList.toggle('mature', lv >= 8 && lv <= 10);
  el.pet.classList.toggle('ultra', lv >= 11);

  // 体型随等级长大：SVG 里球体只占容器一半，所以容器必须涨得更狠，肉眼才看得出变化
  const big = Math.min(252, 146 + (lv - 1) * 8.2);
  const small = Math.min(168, 104 + (lv - 1) * 5.2);
  el.pet.style.setProperty('--pet-size', `${big}px`);
  el.pet.style.setProperty('--pet-size-c', `${small}px`);
  // 变量必须设在 stage 的共同祖先上，设在 .pet 上父元素读不到
  el.app.style.setProperty('--stage-h', `${Math.min(306, Math.round(big + 54))}px`);
  el.app.style.setProperty('--stage-hc', `${Math.min(236, Math.round(small + 46))}px`);

  const fill = mood >= 66 ? '#ff9d72' : mood >= 40 ? '#e6a06a' : '#b7a79c';
  el.pet.style.setProperty('--skin', fill);

  el.petMouth.setAttribute('d', mood >= 66 ? MOUTHS.happy : mood >= 36 ? MOUTHS.neutral : MOUTHS.sad);

  const next = expToNext(pet.exp);
  el.statusline.dataset.base = next > 0
    ? `还差 ${next} 点经验升级 · ${moodLabelShort(mood)}`
    : `已经长到头了 · ${moodLabelShort(mood)}`;

  // 地上那几坨要跟着任何一次刷新同步（它同时负责把状态行拼完整）
  renderPoop(pet);
}

/** 状态行 = 升级进度 + （地上实在太多时的）提醒 */
function refreshStatusline() {
  if (!el.statusline) return;
  el.statusline.textContent = `${el.statusline.dataset.base || ''}${el.statusline.dataset.dirty || ''}`;
}

export function setPetMode(mode) {
  el.pet.classList.remove('thinking', 'jump');
  if (mode) el.pet.classList.add(mode);
}

export function jump() {
  el.pet.classList.remove('jump');
  void el.pet.offsetWidth;
  el.pet.classList.add('jump');
  setTimeout(() => el.pet.classList.remove('jump'), 700);
}

export function scrollDown(smooth = true) {
  el.chat.scrollTo({ top: el.chat.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
}

export function addMessage(role, text = '') {
  const div = document.createElement('div');
  div.className = `msg from-${role}`;
  div.textContent = text;
  el.chat.appendChild(div);
  scrollDown();
  return div;
}

// 流式气泡：文字和光标分开，避免 textContent 覆盖把光标也冲掉
export function addStreamingMessage(role = 'pet') {
  const div = document.createElement('div');
  div.className = `msg from-${role} pending`;
  const txt = document.createElement('span');
  const caret = document.createElement('span');
  caret.className = 'caret';
  div.append(txt, caret);
  el.chat.appendChild(div);
  scrollDown();

  return {
    node: div,
    push(delta) {
      if (div.classList.contains('pending')) div.classList.remove('pending');
      txt.textContent += delta;
      const near = el.chat.scrollHeight - el.chat.scrollTop - el.chat.clientHeight < 140;
      if (near) el.chat.scrollTop = el.chat.scrollHeight;
    },
    finish(finalText) {
      div.classList.remove('pending');
      if (typeof finalText === 'string') txt.textContent = finalText;
      caret.remove();
    },
  };
}

export function appendDelta(node, delta) {
  node.textContent += delta;
  const near = el.chat.scrollHeight - el.chat.scrollTop - el.chat.clientHeight < 120;
  if (near) el.chat.scrollTop = el.chat.scrollHeight;
}

export function withCaret(node) {
  const c = document.createElement('span');
  c.className = 'caret';
  node.appendChild(c);
  return () => c.remove();
}

export function addChip(text, kind = 'fact') {
  const div = document.createElement('div');
  const extra =
    kind === 'grudge' ? ' grudge'
    : kind === 'demand' ? ' demand'
    : kind === 'paid' ? ' paid'
    : kind === 'food' ? ' food'
    : '';
  div.className = `memo-chip${extra}`;
  const dot = document.createElement('span');
  dot.className = 'dot';
  div.append(dot, document.createTextNode(text));
  el.chat.appendChild(div);
  scrollDown();
  return div;
}

/* ---------- 地上 ---------- */

const POOP_SVG = `
  <svg viewBox="0 0 40 34" aria-hidden="true">
    <g class="stink">
      <path d="M13.4 9.6c-2-2.2 1.2-3.4-.4-6" />
      <path d="M26.6 9.6c2-2.2-1.2-3.4.4-6" />
    </g>
    <ellipse cx="20" cy="27.6" rx="15.6" ry="5.4" fill="#6d4c33" />
    <ellipse cx="20" cy="21.4" rx="12" ry="5.9" fill="#8b6444" />
    <ellipse cx="20" cy="15" rx="8" ry="4.9" fill="#a67c56" />
    <path d="M20 10.4c.5-2.1 2.2-3.4 4.2-3.6" stroke="#a67c56" stroke-width="3.6" fill="none" stroke-linecap="round" />
    <ellipse cx="15.4" cy="13.6" rx="2.6" ry="1.2" fill="#c49a72" opacity=".6" />
    <ellipse cx="14.2" cy="24.6" rx="3.1" ry="1.4" fill="#7d5a3d" opacity=".55" />
  </svg>`;

/**
 * 地上的东西跟着存档走。只增删差异，不整体重建 —— 重建会让掉落动画重播一遍
 */
export function renderPoop(pet) {
  const layer = el.poopLayer;
  if (!layer) return;

  const list = Array.isArray(pet.poop) ? pet.poop : [];
  const ids = new Set(list.map((p) => p.id));

  for (const node of [...layer.children]) {
    if (!ids.has(node.dataset.id)) node.remove();
  }

  for (const p of list) {
    if (layer.querySelector(`[data-id="${p.id}"]`)) continue;
    const size = p.size || 1;
    const w = 30 * size;
    const h = 26 * size;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'poop';
    btn.dataset.id = p.id;
    btn.style.width = `${w.toFixed(1)}px`;
    btn.style.height = `${h.toFixed(1)}px`;
    btn.style.left = `calc(50% + ${(p.x || 0) * 62 - w / 2}px)`;
    btn.setAttribute('aria-label', '收拾掉');
    btn.title = '收拾';
    btn.innerHTML = POOP_SVG;
    layer.appendChild(btn);
  }

  // 1～2 坨靠画面就能看见，不啰嗦；堆到 3 坨以上才在状态行提醒
  const dirty = list.length >= 3 ? ` · 地上 ${list.length} 坨没收拾` : '';
  if (el.statusline) el.statusline.dataset.dirty = dirty;
  refreshStatusline();
}

/** 点一下，缩回地里 */
export function sweepPoop(node, done) {
  if (!node) {
    done && done();
    return;
  }
  node.classList.add('cleaning');
  setTimeout(() => {
    node.remove();
    done && done();
  }, 400);
}

/* ---------- 食盆 ---------- */

export const FOOD_ICONS = {
  snack: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M3.6 16c3.4-4.8 7.8-7.2 11.8-7.2S23.8 11.2 27.2 16c-3.4 4.8-7.8 7.2-11.8 7.2S7 20.8 3.6 16Z" fill="#e8b27a"/><path d="M27.2 16l3.6-4.6v9.2Z" fill="#cf9558"/><path d="M8.6 13.4l5.4 2.6M8.6 18.6l5.4-2.6" stroke="#bd8047" stroke-width="1.5" stroke-linecap="round"/><circle cx="8.6" cy="14.6" r="1.6" fill="#3a2a20"/></svg>`,
  stick: `<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="9" y="4" width="14" height="24" rx="4" fill="#ffb27a"/><rect x="9" y="10.5" width="14" height="4.2" fill="#e58a52"/><path d="M13 20.5h6" stroke="#e58a52" stroke-width="2" stroke-linecap="round"/><circle cx="16" cy="7.4" r="1.3" fill="#fff6ee" opacity=".75"/></svg>`,
  can: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M6 10v13c0 2.3 4.5 3.9 10 3.9S26 25.3 26 23V10Z" fill="#a8a49b"/><ellipse cx="16" cy="10" rx="10" ry="3.7" fill="#cfc9bf"/><ellipse cx="16" cy="10" rx="6.6" ry="2.3" fill="#ff9d72"/><path d="M6 18.2c0 2.2 4.5 3.8 10 3.8S26 20.4 26 18.2" fill="none" stroke="#8d897f" stroke-width="1.2"/></svg>`,
  salmon: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M3.6 11.2h13.8l7.4 4.8-7.4 4.8H3.6Z" fill="#ff8a5c"/><path d="M3.6 11.2h13.8l7.4 4.8-7.4 4.8H3.6Z" fill="none" stroke="#d96a45" stroke-width="1.2"/><path d="M8 12.4v7.2M13 11.8v8.4M18.4 12.6v6.8" stroke="#ffe2d2" stroke-width="1.6" stroke-linecap="round" opacity=".85"/></svg>`,
  mystery: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 5c6 0 10 3.4 10 8.4 0 3.6-2 5.4-3.4 7.4-1.2 1.8-1.6 3-1.6 4.4 0 1.4-1.2 2.2-5 2.2s-5-.8-5-2.2c0-1.4-.4-2.6-1.6-4.4C8 18.8 6 17 6 13.4 6 8.4 10 5 16 5Z" fill="#c9b8a8"/><path d="M13 12.6c0-1.6 1.3-2.7 3-2.7s3 1.1 3 2.7c0 1.4-1.2 1.9-1.9 2.8-.4.5-.5.9-.5 1.6" fill="none" stroke="#6b5d54" stroke-width="2" stroke-linecap="round"/><circle cx="16.6" cy="21.4" r="1.4" fill="#6b5d54"/></svg>`,
};

export function renderTray(pet) {
  const box = el.trayItems;
  if (!box) return;
  box.innerHTML = '';
  for (const f of FOODS) {
    const taste = tasteOf(pet, f.id);
    const known = (pet.ate || []).includes(f.id);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'food';
    btn.dataset.id = f.id;
    // 喂过之后它才肯把偏好露出来
    if (known && taste === 'love') btn.classList.add('love');
    if (known && taste === 'hate') btn.classList.add('hate');
    btn.title = f.note;

    const ico = document.createElement('span');
    ico.className = 'food-ico';
    ico.innerHTML = FOOD_ICONS[f.id] || '';

    const name = document.createElement('span');
    name.className = 'food-name';
    name.textContent = f.name;

    const exp = document.createElement('span');
    exp.className = 'food-exp';
    exp.textContent = f.id === 'mystery' ? '?' : `+${f.exp}`;

    btn.append(ico, name, exp);
    box.appendChild(btn);
  }
  el.traySub.textContent = `肚子 ${Math.round(pet.full)}% · ${fullWord(pet.full)}`;
}

export function openTray(pet) {
  if (!el.tray) return;
  renderTray(pet);
  el.tray.classList.remove('hidden');
  el.trayBtn.classList.add('open');
  el.trayBtn.classList.remove('hint');
  el.trayBtn.setAttribute('aria-expanded', 'true');
}

export function closeTray() {
  if (!el.tray) return;
  el.tray.classList.add('hidden');
  el.trayBtn.classList.remove('open');
  el.trayBtn.setAttribute('aria-expanded', 'false');
}

export function toggleTray(pet) {
  if (el.tray.classList.contains('hidden')) openTray(pet);
  else closeTray();
}

/** 食物从食盆飞进嘴里，落嘴的那一刻才算吃到 */
export function playFeed(food, onEat) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) {
    chew();
    onEat && onEat();
    return;
  }

  const node = document.createElement('div');
  node.className = 'food-fly';
  node.innerHTML = FOOD_ICONS[food.id] || '';
  document.body.appendChild(node);

  const box = el.pet.getBoundingClientRect();
  const mouth = el.petMouth.getBoundingClientRect();
  // 从它脚边递上去，别横穿整个聊天区
  const startX = box.left + box.width * 0.14;
  const startY = box.top + box.height * 0.9;
  const tx = mouth.left + mouth.width / 2 - 16;
  const ty = mouth.top + mouth.height / 2 - 16;
  const dx = tx - startX;
  const dy = ty - startY;

  const anim = node.animate(
    [
      { transform: `translate(${startX}px, ${startY}px) scale(.5) rotate(-20deg)`, opacity: 0 },
      {
        transform: `translate(${startX + dx * 0.42}px, ${startY + dy * 0.56}px) scale(1.15) rotate(12deg)`,
        opacity: 1,
      },
      { transform: `translate(${tx}px, ${ty}px) scale(.4) rotate(0deg)`, opacity: 0.95 },
    ],
    { duration: 480, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' }
  );

  anim.onfinish = () => {
    node.remove();
    chew();
    onEat && onEat();
  };
}

export function chew() {
  el.pet.classList.remove('eating');
  void el.pet.offsetWidth;
  el.pet.classList.add('eating');
  setTimeout(() => el.pet.classList.remove('eating'), 820);
}

/** 吃不下的时候别过头去 */
export function refuseShake() {
  el.pet.classList.remove('refusing');
  void el.pet.offsetWidth;
  el.pet.classList.add('refusing');
  setTimeout(() => el.pet.classList.remove('refusing'), 560);
}

export function setBusy(busy) {
  el.send.disabled = busy;
  el.input.placeholder = busy ? '它在想事情…' : '跟它说句话，就是喂它…';
}

export function toast(msg, ms = 2600) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  el.toastWrap.appendChild(t);
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 320);
  }, ms);
}

/* ---------- 档案面板 ---------- */

function setBar(node, value) {
  const v = Math.max(0, Math.min(100, value));
  if (v >= 50) {
    node.style.left = '50%';
    node.style.width = `${v - 50}%`;
  } else {
    node.style.left = `${v}%`;
    node.style.width = `${50 - v}%`;
  }
}

export function renderSheet(pet) {
  const lv = levelOf(pet.exp);
  const mood = Math.round(pet.mood);

  $('sheetTitle').textContent = `${pet.name}的档案`;
  $('sLv').textContent = lv;
  $('sStage').textContent = stageOf(lv);
  $('sWeight').innerHTML = `${weightOf(pet.exp)}<span class="unit">g</span>`;
  $('sFeeds').textContent = `被喂 ${pet.feeds} 次`;
  $('sMood').textContent = mood;
  $('sMoodWord').textContent = moodWord(mood);
  $('sTitle').textContent = titleOf(pet.traits);

  const full = Math.round(pet.full);
  $('sFull').innerHTML = `${full}<span class="unit">%</span>`;
  $('sFullWord').textContent = fullWord(pet.full);
  $('sTaste').textContent = tasteText(pet);

  // 地上有东西才值得占一行
  const poops = Array.isArray(pet.poop) ? pet.poop.length : 0;
  const poopRow = $('sPoopRow');
  if (poopRow) {
    poopRow.hidden = poops === 0 && (pet.cleaned || 0) === 0;
    $('sPoop').textContent = poops
      ? `${poopWord(poops)} · 已收拾 ${pet.cleaned || 0} 次`
      : `干净 · 已收拾 ${pet.cleaned || 0} 次`;
  }

  setBar($('tSharp'), pet.traits.sharp);
  setBar($('tCalm'), pet.traits.calm);
  setBar($('tSocial'), pet.traits.social);

  const list = $('grudgeList');
  list.innerHTML = '';
  const grudges = pet.memories.filter((m) => m.kind === 'grudge');
  if (!grudges.length) {
    list.innerHTML = '<li class="empty" style="background:none;border:none;color:var(--ink-faint)">它还什么都没记恨你。</li>';
  } else {
    for (const g of grudges.slice(0, 12)) {
      const li = document.createElement('li');
      if (g.settled) li.classList.add('settled');

      const head = document.createElement('div');
      head.className = 'grudge-head';
      const age = document.createElement('span');
      age.className = 'age';
      age.textContent = howText(g);
      const txt = document.createElement('span');
      txt.className = 'grudge-text';
      txt.textContent = g.text;
      head.append(age, txt);
      li.appendChild(head);

      if (!g.settled) {
        const deal = document.createElement('div');
        deal.className = 'deal';
        const label = document.createElement('span');
        if (g.demand) {
          label.innerHTML = `它开的条件：<b>${g.demand.text}</b>`;
          deal.appendChild(label);
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'pay-btn';
          btn.textContent = '给了';
          btn.addEventListener('click', () => payHandler && payHandler(g.id));
          deal.appendChild(btn);
        } else {
          deal.classList.add('quiet');
          label.textContent = '它还在等你开口';
          deal.appendChild(label);
        }
        li.appendChild(deal);
      }

      list.appendChild(li);
    }
  }

  const memList = $('memList');
  memList.innerHTML = '';
  const others = pet.memories.filter((m) => m.kind !== 'grudge').slice(0, 14);
  $('memCount').textContent = pet.memories.length;
  if (!others.length) {
    memList.innerHTML = '<li class="empty">脑子里还是空的。</li>';
  } else {
    for (const m of others) {
      const li = document.createElement('li');
      li.textContent = m.text;
      memList.appendChild(li);
    }
  }
}

export function openSheet(pet) {
  renderSheet(pet);
  el.sheet.classList.remove('hidden');
  el.sheetMask.classList.remove('hidden');
}

export function closeSheet() {
  el.sheet.classList.add('hidden');
  el.sheetMask.classList.add('hidden');
}

/* ---------- 眼神跟随 ---------- */

export function initEyeTracking(pet) {
  if (matchMedia('(pointer: coarse)').matches) return;
  const pupils = Array.from(document.querySelectorAll('.pupil'));
  window.addEventListener('mousemove', (e) => {
    const r = el.pet.getBoundingClientRect();
    if (!r.width) return;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height * 0.52;
    const dx = Math.max(-1, Math.min(1, (e.clientX - cx) / 260));
    const dy = Math.max(-1, Math.min(1, (e.clientY - cy) / 260));
    for (const p of pupils) p.style.transform = `translate(${dx * 3.4}px, ${dy * 3}px)`;
    const ang = Math.atan2(e.clientY - cy, e.clientX - cx) * (180 / Math.PI);
    el.pet.style.setProperty('--tilt', `${Math.max(-4, Math.min(4, ang / 22))}deg`);
  });
}

export function setCompact(on) {
  el.app.classList.toggle('compact', on);
}
