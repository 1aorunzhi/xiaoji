import {
  createPet, loadPet, savePet, clearPet, applyOffline, feed, settleGrudges,
  addMemory, levelOf, clamp, encodeSave, decodeSave, weightOf, titleOf, stageOf,
  isApology, raiseDemand, payOff, matchGrudge, pendingDeal, looksPaid, activeGrudges,
  foodById, feedFood, foodPaysFor, fullWord,
  flushPoop, cleanPoop, poopSick, poopWord,
} from './state.js';
import { buildSystemPrompt, buildExtractPrompt, buildExtractInput, directive, offlineReply, polishReply } from './brain.js';
import { streamChat, jsonChat, friendlyError, isReady } from './cloud.js';
import * as ui from './ui.js';

const { el } = ui;

let pet = loadPet();
let awayHours = 0;

// ?stage=10 —— 演示用：直接把等级摆到指定档位，只看不存
// （笔试演示时不用先喂 28 次才看得到长大的样子；也不许污染访客的真实存档）
const demoStage = Math.min(16, Math.max(0, Number(new URLSearchParams(location.search).get('stage')) || 0));

function persist() {
  if (demoStage) return;
  savePet(pet);
}
let busy = false;
let idleTimer = null;
let idlePinged = false;
let refusal = null;   // 同一口东西连续被挡回来时，复用一个提示条

/* ---------------- 启动 ---------------- */

function boot() {
  // 页面要是旧缓存（少了新加的节点），按钮会静默失灵。这里直接喊出来
  const need = ['tray', 'trayBtn', 'trayItems', 'poopLayer'];
  const missing = need.filter((id) => !document.getElementById(id));
  if (missing.length) {
    console.warn('[小记] 页面上缺这些节点：', missing, '——多半是浏览器缓存了旧版页面');
    ui.toast('页面是旧版本，按 Ctrl+F5（Mac 是 Cmd+Shift+R）硬刷新一下', 8000);
  }

  // 演示模式：连存档都没有也直接给一只对应等级的，跳过起名
  if (!pet && demoStage) {
    pet = createPet();
    pet.exp = (demoStage - 1) * 72;
    pet.feeds = demoStage * 6;
    awayHours = 0;
  }

  ui.initEyeTracking(pet);

  if (!pet) {
    showIntro();
  } else {
    const info = applyOffline(pet);
    awayHours = info.awayHours;
    if (demoStage) {
      pet.exp = (demoStage - 1) * 72;
      pet.feeds = Math.max(pet.feeds, demoStage * 6);
      awayHours = 0;
    }
    begin(false);
    if (awayHours > 4) {
      setTimeout(() => speak('return'), 900);
    } else if (!pet.history.length) {
      setTimeout(() => speak('return'), 700);
    }
  }

  el.composer.addEventListener('submit', onSubmit);
  el.openSheet.addEventListener('click', () => {
    ui.closeTray();
    ui.openSheet(pet);
  });
  el.sheetMask.addEventListener('click', ui.closeSheet);

  // 食盆：用 pointerdown 而不是 click。
  // 移动端手指点一下偶尔根本收不到 click（尤其页面刚有动画时），这按钮就"点不开"了
  let trayLock = 0;
  const flipTray = () => {
    const t = Date.now();
    if (t - trayLock < 240) return;   // 一次手指可能触发两回，去个重
    trayLock = t;
    ui.toggleTray(pet);
  };

  if (el.trayBtn) {
    el.trayBtn.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      e.preventDefault();
      e.stopPropagation();
      flipTray();
    });
    // 键盘（Enter/空格）走的是 detail === 0 的 click，指针已经处理过了
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
      sweep(node.dataset.id, node);
    });
  }

  document.addEventListener('click', (e) => {
    if (!el.tray || el.tray.classList.contains('hidden')) return;
    if (e.target.closest('#tray') || e.target.closest('#trayBtn')) return;
    ui.closeTray();
  });

  // 档案里点「给了」= 条件真兑现了
  ui.setPayHandler((id) => {
    const g = pet.memories.find((m) => m.id === id);
    if (!g || !payOff(pet, g)) return;
    const line = '（收下了）……行吧，这次算你过了。';
    ui.addMessage('pet', line);
    pet.history.push({ role: 'assistant', content: line, ts: Date.now() });
    trimHistory();
    persist();
    ui.renderSheet(pet);
    ui.renderHud(pet);
    ui.addChip(`赔清了 · ${g.text}`, 'paid');
    ui.toast('它把东西收下了，这笔账划掉', 2400);
  });

  el.pet.addEventListener('click', () => {
    ui.jump();
    const lines = ['唔？', '……干嘛。', '摸头是要收费的。', '嗯。', '别戳。'];
    const line = lines[Math.floor(Math.random() * lines.length)];
    ui.toast(line, 900);
  });

  document.getElementById('genCode').addEventListener('click', () => {
    document.getElementById('saveCode').value = encodeSave(pet);
    ui.toast('存档码已生成，复制走就能换设备养');
  });

  document.getElementById('loadCode').addEventListener('click', () => {
    const code = window.prompt('把存档码贴进来：');
    if (!code) return;
    const loaded = decodeSave(code);
    if (!loaded) {
      ui.toast('这个存档码读不出来');
      return;
    }
    pet = loaded;
    persist();
    ui.closeSheet();
    location.reload();
  });

  document.getElementById('resetBtn').addEventListener('click', () => {
    if (!window.confirm('要把它扔掉，重新养一只吗？这件事没法撤销。')) return;
    clearPet();
    location.reload();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      pet.lastSeen = Date.now();
      persist();
    } else if (pet) {
      const info = applyOffline(pet);
      if (info.awayHours > 4) {
        awayHours = info.awayHours;
        ui.renderHud(pet);
        speak('return');
      }
    }
  });

  window.addEventListener('beforeunload', () => persist());

  // 还是只新宠物：碗叫两下，不然没人知道这儿能点（新用户这会儿 pet 还是 null）
  if (el.trayBtn && pet && (pet.feeds || 0) < 3) el.trayBtn.classList.add('hint');

  // 它自己会拉，用不着你操心；收拾才要你上手
  setTimeout(tickPoop, 4000);
  setInterval(tickPoop, 45000);

  requestAnimationFrame(() => el.app.classList.remove('booting'));
}

function begin(isNew) {
  ui.renderHud(pet);
  if (pet.history.length || !isNew) ui.setCompact(true);

  for (const m of pet.history.slice(-8)) {
    if (m.hidden) continue;
    ui.addMessage(m.role === 'user' ? 'me' : 'pet', m.content);
  }
  ui.scrollDown(false);
  el.input.focus();
  if (!isReady()) {
    ui.toast('大脑还没连上，先当个哑巴宠物养着', 4000);
  }
}

/* ---------------- 开场 ---------------- */

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
    pet = createPet();
    pet.name = name;
    persist();
    wrap.classList.add('leaving');
    setTimeout(() => wrap.remove(), 700);
    begin(true);
    // 刚起完名，碗叫两下：不然一个新用户根本不知道这儿能喂真东西
    if (el.trayBtn) el.trayBtn.classList.add('hint');
    setTimeout(() => speak('birth'), 600);
  });
}

/* ---------------- 喂它 ---------------- */

async function onSubmit(e) {
  e.preventDefault();
  const text = el.input.value.trim();
  if (!text || busy) return;

  el.input.value = '';
  ui.setCompact(true);

  ui.addMessage('me', text);
  const res = feed(pet, text);
  awayHours = 0;
  ui.renderHud(pet);
  persist();

  if (res.levelUp) {
    ui.jump();
    ui.toast(`它长了一点 · Lv.${res.level} ${stageOf(res.level)}`, 2200);
    ui.addMessage('sys', `—— Lv.${res.level} ${stageOf(res.level)} · ${res.weight}g ——`);
  }

  // 先看东西到手没有：到手就先记上，它开口时才知道该松口
  let justPaid = null;
  const pending = pendingDeal(pet);
  if (pending && looksPaid(text)) {
    payOff(pet, pending);
    justPaid = pending;
    ui.addChip(`赔清了 · ${pending.text}`, 'paid');
    persist();
  }

  // 道歉不顶用：它会当场开价，第二回还加价
  if (!justPaid && isApology(text)) {
    const deal = raiseDemand(pet);
    if (deal) {
      const cond = deal.grudge.demand.text;
      ui.addChip(
        deal.capped
          ? `它不松口 · 条件早摆着了：${cond}`
          : deal.escalated
          ? `它加价了 · 现在要 ${cond}`
          : `它开了个价 · ${cond}，不然不翻篇`,
        'demand'
      );
      ui.toast(deal.escalated ? '道歉了两次，价钱翻了一档' : '它不接受道歉，只接受补偿', 2400);
      persist();
    }
  }

  await reply(text, justPaid);
  reflect(text, pet.history[pet.history.length - 1]?.content || '');
}

async function reply(userText, justPaid = null) {
  busy = true;
  ui.setBusy(true);
  ui.setPetMode('thinking');

  const bubble = ui.addStreamingMessage('pet');
  const messages = pet.history.slice(-10).map((m) => ({ role: m.role, content: m.content }));

  try {
    const full = await streamChat({
      system: buildSystemPrompt(pet, { awayHours, justPaid }),
      messages,
      temperature: 1.05,
      onDelta: (d) => bubble.push(d),
    });
    if (!full.trim()) throw new Error('empty');
    const clean = polishReply(full, lastAssistantText());
    bubble.finish(clean);
    pet.history.push({ role: 'assistant', content: clean, ts: Date.now() });
    trimHistory();
  } catch (err) {
    const fallback = offlineReply(pet, 'feed');
    bubble.finish(fallback);
    pet.history.push({ role: 'assistant', content: fallback, ts: Date.now() });
    trimHistory();
    ui.toast(friendlyError(err), 3200);
  } finally {
    ui.setPetMode(null);
    ui.setBusy(false);
    busy = false;
    persist();
    armIdle();
  }
}

function trimHistory() {
  if (pet.history.length > 20) pet.history = pet.history.slice(-20);
}
function lastAssistantText() {
  for (let i = pet.history.length - 1; i >= 0; i -= 1) {
    if (pet.history[i].role === 'assistant') return pet.history[i].content;
  }
  return '';
}

/* ---------------- 真的喂点吃的 ---------------- */

async function eat(id) {
  const food = foodById(id);
  if (!food) return;
  if (busy) {
    ui.toast('等它把这句话说完', 1600);
    return;
  }

  ui.closeTray();
  const res = feedFood(pet, id);
  if (!res) return;

  // 撑得塞不进去
  if (res.refused) {
    ui.refuseShake();
    ui.renderHud(pet);
    ui.renderTray(pet);
    persist();

    const text = `${food.name}被推回来了 · 它吃不下了`;
    // 连着喂同一口东西被挡回来，只占一行，数字往上加
    if (refusal && refusal.id === food.id && refusal.node === el.chat.lastElementChild) {
      refusal.n += 1;
      if (refusal.node.lastChild) {
        refusal.node.lastChild.nodeValue = `${food.name}被推回来了 · 第 ${refusal.n} 次被挡在外面`;
      }
    } else {
      refusal = { id: food.id, n: 1, node: ui.addChip(text, 'fact') };
    }
    ui.toast(`它${fullWord(pet.full)}，塞不进去`, 2400);
    return;
  }
  refusal = null;

  busy = true;
  ui.setBusy(true);
  persist();

  ui.playFeed(food, async () => {
    try {
      // 落嘴那一刻数字才动：先看见它吃，再看见它长
      ui.renderHud(pet);
      ui.addChip(`吃掉${food.name} · +${res.exp} 经验`, 'food');
      if (res.taste === 'love') ui.jump();

      if (res.firstTime && res.taste === 'love') {
        setTimeout(() => ui.toast('它吃得很快。原来它爱吃这个', 2200), 260);
      } else if (res.firstTime && res.taste === 'hate') {
        setTimeout(() => ui.toast('它嚼得很慢。好像不太行', 2200), 260);
      } else if (res.stuffed) {
        setTimeout(() => ui.toast('它有点撑了，硬塞的', 1800), 260);
      }

      // 喂的东西正好是它开的价：这笔账当场划掉
      let justPaid = null;
      const pending = pendingDeal(pet);
      if (pending && pending.demand && foodPaysFor(pending.demand.text, id)) {
        if (payOff(pet, pending)) {
          justPaid = pending;
          ui.addChip(`赔清了 · ${pending.demand.text}`, 'paid');
          ui.toast('东西到手了，这笔账划掉', 2400);
        }
      }

      if (res.levelUp) {
        ui.toast(`它长了一点 · Lv.${res.level} ${stageOf(res.level)}`, 2200);
        ui.addMessage('sys', `—— Lv.${res.level} ${stageOf(res.level)} · ${weightOf(pet.exp)}g ——`);
      }

      if (res.firstTime) {
        addMemory(pet, { text: `主人第一次喂我吃${food.name}`, kind: 'fact' });
      }

      persist();
      ui.renderHud(pet);
      await foodTalk(food, res, justPaid);
    } catch {
      ui.setPetMode(null);
      ui.setBusy(false);
      busy = false;
    }
  });
}

/** 吃完这一口，让它自己说一句 —— 走同一个大脑，只是多给一块「刚吃了什么」 */
async function foodTalk(food, res, justPaid) {
  ui.setPetMode('thinking');
  const bubble = ui.addStreamingMessage('pet');

  const tasteLine =
    res.taste === 'love'
      ? '这是它最爱吃的，吃得很快'
      : res.taste === 'hate'
      ? '它其实不太爱吃这个，嚼得很勉强'
      : '味道一般';
  const note = `（主人递给你${food.name}，你已经咽下去了。${tasteLine}。${res.stuffed ? '肚子里有点撑。' : ''}）`;

  // 藏起来的这一条只给模型看，不进聊天记录
  const hidden = { role: 'user', content: note, ts: Date.now(), hidden: true };
  pet.history.push(hidden);

  try {
    const full = await streamChat({
      system: buildSystemPrompt(pet, {
        awayHours: 0,
        justPaid,
        justAte: { name: food.name, taste: res.taste, stuffed: res.stuffed },
      }),
      messages: pet.history.slice(-10).map((m) => ({ role: m.role, content: m.content })),
      temperature: 1.15,
      onDelta: (d) => bubble.push(d),
    });
    if (!full.trim()) throw new Error('empty');
    const clean = polishReply(full, lastAssistantText());
    bubble.finish(clean);
    pet.history.push({ role: 'assistant', content: clean, ts: Date.now() });
  } catch (err) {
    const fallback = offlineReply(pet, 'food', res.taste);
    bubble.finish(fallback);
    pet.history.push({ role: 'assistant', content: fallback, ts: Date.now() });
    ui.toast(friendlyError(err), 3000);
  } finally {
    trimHistory();
    ui.setPetMode(null);
    ui.setBusy(false);
    busy = false;
    persist();
    if (!el.sheet.classList.contains('hidden')) ui.renderSheet(pet);
    armIdle();
  }
}

/* ---------------- 地上：它会拉，你得收拾 ---------------- */

function tickPoop() {
  if (!pet || busy) return;

  const made = flushPoop(pet);
  const grudge = poopSick(pet);

  if (made.length) {
    ui.renderHud(pet);
    persist();
    const n = pet.poop.length;
    ui.toast(n >= 4 ? '地上已经堆满了，它没地方下脚' : '它拉了。点一下地上的东西就能收拾', 2800);
  }

  if (grudge) {
    ui.addChip(`记仇 · ${grudge.text}`, 'grudge');
    ui.toast('这件事它记下了', 2600);
    persist();
  }
}

function sweep(id, node) {
  const res = cleanPoop(pet, id);
  if (!res) {
    node && node.remove();
    return;
  }

  ui.sweepPoop(node);
  ui.renderHud(pet);
  persist();
  if (!el.sheet.classList.contains('hidden')) ui.renderSheet(pet);

  ui.addChip(
    res.left ? `收拾掉一坨 · 地上还剩 ${res.left}` : `收拾干净了 · +${res.exp} 经验`,
    'fact'
  );

  // 还剩就不啰嗦，全弄干净它才肯开口
  if (res.left > 0) return;
  poopTalk(res);
}

/** 全收拾干净之后，它会别扭地说点什么 */
async function poopTalk(res) {
  if (busy) return;
  busy = true;
  ui.setBusy(true);
  ui.setPetMode('thinking');

  const bubble = ui.addStreamingMessage('pet');
  const mins = Math.max(1, Math.round(res.hours * 60));
  const note = `（主人把地上你拉的那坨收掉了。${
    res.quick ? '动作很快，没让它在那儿放多久' : `那坨在原地待了 ${mins} 分钟才被收走`
  }。地上现在干净了。）`;

  const hidden = { role: 'user', content: note, ts: Date.now(), hidden: true };
  pet.history.push(hidden);

  try {
    const full = await streamChat({
      system: buildSystemPrompt(pet, { awayHours: 0, justCleaned: { quick: res.quick, mins } }),
      messages: pet.history.slice(-10).map((m) => ({ role: m.role, content: m.content })),
      temperature: 1.15,
      onDelta: (d) => bubble.push(d),
    });
    if (!full.trim()) throw new Error('empty');
    const clean = polishReply(full, lastAssistantText());
    bubble.finish(clean);
    pet.history.push({ role: 'assistant', content: clean, ts: Date.now() });
  } catch {
    const fallback = res.quick ? '……手脚还挺快。' : '总算想起来了。';
    bubble.finish(fallback);
    pet.history.push({ role: 'assistant', content: fallback, ts: Date.now() });
  } finally {
    trimHistory();
    ui.setPetMode(null);
    ui.setBusy(false);
    busy = false;
    persist();
    armIdle();
  }
}

/* ---------------- 让它自己开口 ---------------- */

async function speak(kind) {
  if (busy) return;
  busy = true;
  ui.setBusy(true);
  ui.setPetMode('thinking');

  const bubble = ui.addStreamingMessage('pet');
  const messages = [
    ...pet.history.slice(-8).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: directive(kind, pet) },
  ];

  try {
    const full = await streamChat({
      system: buildSystemPrompt(pet, { awayHours }),
      messages,
      temperature: 1.1,
      onDelta: (d) => bubble.push(d),
    });
    if (!full.trim()) throw new Error('empty');
    const clean = polishReply(full, lastAssistantText());
    bubble.finish(clean);
    pet.history.push({ role: 'assistant', content: clean, ts: Date.now() });
  } catch (err) {
    const fallback = offlineReply(pet, kind);
    bubble.finish(fallback);
    pet.history.push({ role: 'assistant', content: fallback, ts: Date.now() });
  } finally {
    trimHistory();
    awayHours = 0;
    ui.setPetMode(null);
    ui.setBusy(false);
    busy = false;
    persist();
    armIdle();
  }
}

/* ---------------- 记忆抽取 ---------------- */

async function reflect(userText, petReply) {
  if (!userText || !petReply) return;

  const thinking = ui.addChip('正在把这句话写进脑子里…', 'fact');

  try {
    const data = await jsonChat({
      system: buildExtractPrompt(),
      messages: [{ role: 'user', content: buildExtractInput(userText, petReply, pet) }],
      temperature: 0.3,
    });
    thinking.remove();
    if (!data) return;

    const t = data.traits || {};
    pet.traits.sharp = clamp(pet.traits.sharp + clamp(num(t.sharp), -6, 6) * 1.7, 0, 100);
    pet.traits.calm = clamp(pet.traits.calm + clamp(num(t.calm), -6, 6) * 1.7, 0, 100);
    pet.traits.social = clamp(pet.traits.social + clamp(num(t.social), -6, 6) * 1.7, 0, 100);

    if (typeof data.mood === 'number') {
      pet.mood = clamp(pet.mood + clamp(data.mood, -12, 12) * 0.7, 0, 100);
    }

    const mems = Array.isArray(data.memories) ? data.memories.slice(0, 2) : [];
    let shown = 0;
    for (const m of mems) {
      const added = addMemory(pet, m);
      if (added) {
        const label = added.kind === 'grudge' ? `记仇 · ${added.text}` : added.kind === 'promise' ? `承诺 · ${added.text}` : added.text;
        setTimeout(() => ui.addChip(label, added.kind), 120 * shown);
        shown += 1;
      }
    }
    if (shown) ui.jump();

    // 条件真兑现了才翻篇
    const pays = Array.isArray(data.pay) ? data.pay.slice(0, 2) : [];
    let paid = 0;
    for (const snippet of pays) {
      const g = matchGrudge(pet, snippet);
      if (g && payOff(pet, g)) {
        setTimeout(() => ui.addChip(`赔清了 · ${g.text}`, 'paid'), 200 + 120 * paid);
        paid += 1;
      }
    }
    if (paid) ui.toast('……这还差不多。', 2200);

    // 同一轮里既认了错又新开了一笔账：这个价也得当场摆出来
    if (!paid && isApology(userText)) {
      const fresh = activeGrudges(pet).find((g) => !g.demand && g.feedAt === pet.feeds);
      if (fresh) {
        const deal = raiseDemand(pet, fresh);
        if (deal) {
          setTimeout(() => ui.addChip(`它开了个价 · ${deal.grudge.demand.text}，不然不翻篇`, 'demand'), 260);
        }
      }
    }

    if (settleGrudges(pet)) ui.toast('它把一件旧账淡忘了', 2200);

    ui.renderHud(pet);
    persist();
    if (!el.sheet.classList.contains('hidden')) ui.renderSheet(pet);
  } catch {
    thinking.remove();
  }
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/* ---------------- 摸鱼提醒 ---------------- */

function armIdle() {
  clearTimeout(idleTimer);
  if (idlePinged) return;
  idleTimer = setTimeout(() => {
    if (busy || document.hidden) return;
    if (Date.now() - pet.lastSeen < 60000) return;
    idlePinged = true;
    speak('idle');
  }, 75000);
}

boot();
