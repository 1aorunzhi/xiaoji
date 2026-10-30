/**
 * 前端入口：只做三件事 —— 接事件、调用渲染、把用户操作转成请求。
 *
 * 所有数值、判定、提示文案都来自后端事件流，这里不重新实现任何规则。
 */

import * as api from './api.js';
import * as ui from './ui.js';

const { el } = ui;

let state = null; // 后端给的完整状态
let busy = false;
let bubble = null; // 当前正在打字的气泡
let lastFood = null; // 刚点的那个食物，飞行要用
let idleTimer = null;
let idlePinged = false;

/* ---------------- 事件分发 ---------------- */

async function handle(event) {
  switch (event.type) {
    case 'born':
      state = event.data;
      ui.renderHud(state);
      ui.setCompact(true);
      break;

    case 'state':
      state = event.data;
      ui.renderHud(state);
      if (!el.sheet.classList.contains('hidden')) ui.renderSheet(state);
      break;

    case 'thinking':
      if (event.on) {
        ui.setPetMode('thinking');
        ui.setBusy(true);
        bubble = ui.addStreamingMessage('pet');
      } else {
        ui.setPetMode(null);
        ui.setBusy(false);
      }
      break;

    case 'delta':
      if (!bubble) bubble = ui.addStreamingMessage('pet');
      bubble.push(event.text);
      break;

    case 'finish':
      if (bubble) {
        bubble.finish(event.text);
        bubble = null;
      } else {
        ui.addMessage('pet', event.text);
      }
      break;

    case 'chip':
      ui.addChip(event.text, event.kind, event.id || '');
      break;

    case 'drop':
      ui.dropChip(event.id);
      break;

    case 'toast':
      ui.toast(event.text, event.ms || 2600);
      break;

    case 'note':
      ui.addMessage('sys', event.text);
      break;

    case 'message':
      ui.addMessage(event.role === 'user' ? 'me' : 'pet', event.text);
      break;

    case 'jump':
      ui.jump();
      break;

    case 'chew':
      await new Promise((resolve) => {
        if (lastFood) ui.playFeed(lastFood, resolve);
        else {
          ui.chew();
          resolve();
        }
      });
      lastFood = null;
      break;

    case 'refuse_shake':
      lastFood = null;
      ui.refuseShake();
      break;

    case 'sweep': {
      const node = el.poopLayer.querySelector(`[data-id="${event.id}"]`);
      ui.sweepPoop(node);
      break;
    }

    case 'error':
      ui.toast(event.text, 3200);
      break;

    case 'done':
      break;

    default:
      break;
  }
}

/** 跑完一条事件流 */
async function run(events) {
  busy = true;
  try {
    for await (const event of events) {
      await handle(event);
    }
  } catch (err) {
    ui.toast(err.message || '连不上后端，检查一下服务还在不在', 3200);
  } finally {
    busy = false;
    ui.setBusy(false);
    ui.setPetMode(null);
    bubble = null;
    armIdle();
  }
}

/* ---------------- 启动 ---------------- */

function showIntro() {
  const wrap = document.createElement('div');
  wrap.className = 'intro';
  wrap.innerHTML = `
    <div class="intro-egg"></div>
    <h1>这里有一只刚出生的东西</h1>
    <p>它不会回答问题，只会记住你说过的话。<br/>你先给它起个名字。</p>
    <form class="intro-form">
      <input type="text" maxlength="6" placeholder="小记" />
      <button type="submit">叫这个名字</button>
    </form>
    <span class="intro-tip">它有记性，也会记仇</span>
  `;
  document.body.appendChild(wrap);

  const form = wrap.querySelector('form');
  const input = wrap.querySelector('input');
  setTimeout(() => input.focus(), 400);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = (input.value || '小记').trim().slice(0, 6) || '小记';
    wrap.classList.add('leaving');
    setTimeout(() => wrap.remove(), 700);
    // 刚起完名，碗叫两下：不然新用户不知道这儿能喂真东西
    if (el.trayBtn) el.trayBtn.classList.add('hint');
    run(api.act('/api/intro', { name }));
  });
}

async function boot() {
  ui.initEyeTracking();

  // 页面要是旧缓存（少了新加的节点），按钮会静默失灵
  const need = ['tray', 'trayBtn', 'trayItems', 'poopLayer'];
  const missing = need.filter((id) => !document.getElementById(id));
  if (missing.length) {
    console.warn('[小记] 页面上缺这些节点：', missing, '——多半是浏览器缓存了旧版页面');
    ui.toast('页面是旧版本，按 Ctrl+F5（Mac 是 Cmd+Shift+R）硬刷新一下', 8000);
  }

  // ?stage=10 —— 演示用：把等级摆到指定档位，只看不存
  const demoStage = Math.min(16, Math.max(0, Number(new URLSearchParams(location.search).get('stage')) || 0));

  let info = null;
  try {
    info = await api.boot(demoStage);
  } catch (err) {
    ui.toast('后端起不来，先在终端跑 python run.py', 6000);
  }

  if (!info || !info.exists) {
    showIntro();
  } else {
    state = info.state;
    ui.renderHud(state);
    if (info.history && info.history.length) ui.setCompact(true);
    for (const m of info.history || []) {
      if (m.hidden) continue;
      ui.addMessage(m.role === 'user' ? 'me' : 'pet', m.content);
    }
    ui.scrollDown(false);
    for (const chip of info.chips || []) ui.addChip(chip.text, chip.kind);
    el.input.focus();
    if (!info.aiReady) ui.toast('大脑还没连上，先当个哑巴宠物养着', 4000);
    if (info.awayHours > 4 || !(info.history || []).length) {
      setTimeout(() => run(api.act('/api/speak', { kind: 'return' })), 800);
    }
  }

  bindEvents();
  requestAnimationFrame(() => el.app.classList.remove('booting'));
}

/* ---------------- 交互 ---------------- */

function bindEvents() {
  el.composer.addEventListener('submit', onSubmit);

  el.openSheet.addEventListener('click', () => {
    ui.closeTray();
    ui.openSheet(state);
  });
  el.sheetMask.addEventListener('click', ui.closeSheet);

  // 食盆：pointerdown 而不是 click。移动端手指点一下偶尔收不到 click
  let trayLock = 0;
  const flipTray = () => {
    const t = Date.now();
    if (t - trayLock < 240) return;
    trayLock = t;
    ui.toggleTray(state);
  };
  if (el.trayBtn) {
    el.trayBtn.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      e.preventDefault();
      e.stopPropagation();
      flipTray();
    });
    el.trayBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.detail === 0) flipTray();
    });
  }

  let foodLock = 0;
  if (el.trayItems) {
    el.trayItems.addEventListener('pointerdown', (e) => {
      const btn = e.target.closest('.food');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      const t = Date.now();
      if (t - foodLock < 260) return;
      foodLock = t;
      eat(btn.dataset.id);
    });
  }

  // 地上那几坨：点一下收拾
  if (el.poopLayer) {
    el.poopLayer.addEventListener('pointerdown', (e) => {
      const node = e.target.closest('.poop');
      if (!node) return;
      e.preventDefault();
      e.stopPropagation();
      clean(node.dataset.id);
    });
  }

  document.addEventListener('click', (e) => {
    if (!el.tray || el.tray.classList.contains('hidden')) return;
    if (e.target.closest('#tray') || e.target.closest('#trayBtn')) return;
    ui.closeTray();
  });

  // 档案里点「给了」= 条件真兑现了
  ui.setPayHandler((id) => {
    if (busy) return;
    run(api.act('/api/pay', { id }));
  });

  el.pet.addEventListener('click', async () => {
    ui.jump();
    try {
      const res = await api.poke();
      ui.toast(res.text, 900);
    } catch {
      /* 后端没起来就算了 */
    }
  });

  document.getElementById('genCode').addEventListener('click', async () => {
    try {
      const res = await api.saveCode();
      document.getElementById('saveCode').value = res.code;
      ui.toast('存档码已生成，复制走就能换设备养');
    } catch {
      ui.toast('还没有宠物，生不出存档码');
    }
  });

  document.getElementById('loadCode').addEventListener('click', async () => {
    const code = window.prompt('把存档码贴进来：');
    if (!code) return;
    try {
      await api.importCode(code);
      ui.closeSheet();
      location.reload();
    } catch (err) {
      ui.toast(err.message || '这个存档码读不出来');
    }
  });

  document.getElementById('resetBtn').addEventListener('click', () => {
    if (!window.confirm('要把它扔掉，重新养一只吗？这件事没法撤销。')) return;
    run(api.act('/api/reset')).then(() => location.reload());
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      fetch('/api/touch', { method: 'POST' });
    }
  });

  // 它自己会拉，用不着你操心；收拾才要你上手
  // 注意：必须把事件流读完，只取第一个事件会丢掉「堆久了记账」这类提醒
  setInterval(async () => {
    if (busy || document.hidden) return;
    try {
      for await (const event of api.act('/api/tick')) {
        if (event.type === 'done') continue;
        await handle(event);
      }
    } catch {
      /* 后端没起来就算了，下一轮再试 */
    }
  }, 45000);
}

function onSubmit(e) {
  e.preventDefault();
  const text = el.input.value.trim();
  if (!text || busy) return;
  el.input.value = '';
  ui.setCompact(true);
  ui.addMessage('me', text);
  run(api.act('/api/feed', { text }));
}

function eat(id) {
  if (busy) {
    ui.toast('等它把这句话说完', 1600);
    return;
  }
  lastFood = (state?.foods || []).find((f) => f.id === id) || null;
  ui.closeTray();
  run(api.act('/api/eat', { id }));
}

function clean(id) {
  if (busy) return;
  run(api.act('/api/clean', { id }));
}

/* ---------------- 摸鱼提醒 ---------------- */

function armIdle() {
  clearTimeout(idleTimer);
  if (idlePinged || !state) return;
  idleTimer = setTimeout(() => {
    if (busy || document.hidden) return;
    idlePinged = true;
    run(api.act('/api/speak', { kind: 'idle' }));
  }, 75000);
}

boot();
