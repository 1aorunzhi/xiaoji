import { PUBLIC_CONFIG } from './config.js';

let client = null;
let modelId = null;
let modelPromise = null;

export class BrainError extends Error {
  constructor(code, userMessage) {
    super(code);
    this.code = code;
    this.userMessage = userMessage;
  }
}

function sdk() {
  const WB = window.WorkBuddyCloud;
  return WB && typeof WB.createWorkBuddyCloud === 'function' ? WB : null;
}

export function getClient() {
  if (client) return client;
  const WB = sdk();
  if (!WB) throw new BrainError('sdk_not_loaded', '大脑还没连上，刷新一下试试。');
  client = WB.createWorkBuddyCloud({
    endpoint: PUBLIC_CONFIG.endpoint,
    oauthRelayBaseUrl: PUBLIC_CONFIG.oauthRelayBaseUrl,
    publishableKey: PUBLIC_CONFIG.publishableKey,
  });
  return client;
}

export function isReady() {
  return Boolean(sdk());
}

// 优先用首字快、中文口语自然的模型；不可用时退回列表里第一个可用的对话模型
const PREFERRED = ['deepseek-v4.1-flash', 'deepseek-v4-flash', 'glm-5.3-flash', 'hy3'];
const NON_CHAT = /image|video|tts|asr|embed|rerank|kling|vision-only/i;

async function ensureModel() {
  if (modelId) return modelId;
  if (!modelPromise) {
    modelPromise = (async () => {
      const models = await getClient().llm.models.list();
      if (!Array.isArray(models) || models.length === 0) return null;

      const usable = models.filter(
        (m) => m && m.disabled !== true && m.enabled !== false && !NON_CHAT.test(m.id || '')
      );
      if (!usable.length) return null;

      const byPref = PREFERRED.map((id) => usable.find((m) => m.id === id)).find(Boolean);
      const chosen = byPref || usable.find((m) => m.id !== 'auto') || usable[0];
      modelId = chosen.id;
      return modelId;
    })().catch((err) => {
      modelPromise = null;
      throw err;
    });
  }
  return modelPromise;
}

// 把各家 SDK 错误翻译成用户能懂的一句话
export function friendlyError(err) {
  if (err instanceof BrainError) return err.userMessage;
  const code = err?.error?.code || '';
  const status = err?.status;
  if (code.startsWith('quota_')) return '小记吃不下了（额度用尽），过一会儿再来。';
  if (code.startsWith('auth_')) return '小记认不出这里，可能需要在正式域名下打开。';
  if (code.startsWith('gateway_') || code.startsWith('model_')) return '小记走神了，再喂一次试试。';
  if (code === 'request_stream_required') return '内部参数出错了。';
  if (status === 401 || status === 403) return '小记没被授权在这里说话。';
  return '小记突然不吭声了，再试一次。';
}

/**
 * 流式对话：返回完整文本，边收边回调
 */
export async function streamChat({ system, messages, temperature = 1, onDelta, signal }) {
  const model = await ensureModel();
  if (!model) throw new BrainError('no_model', '暂时没有可用的大脑。');

  const client = getClient();
  let full = '';
  for await (const chunk of client.llm.chat.completions.create({
    model,
    messages: [{ role: 'system', content: system }, ...messages],
    stream: true,
    temperature,
    signal,
  })) {
    const delta = chunk?.choices?.[0]?.delta?.content;
    if (delta) {
      full += delta;
      if (onDelta) onDelta(delta, full);
    }
  }
  return full;
}

/**
 * 一次性调用（内部仍然走流式，只是把结果收齐再解析 JSON）
 */
export async function jsonChat({ system, messages, temperature = 0.4 }) {
  const model = await ensureModel();
  if (!model) throw new BrainError('no_model', '暂时没有可用的大脑。');

  const client = getClient();
  let raw = '';
  for await (const chunk of client.llm.chat.completions.create({
    model,
    messages: [{ role: 'system', content: system }, ...messages],
    stream: true,
    temperature,
    response_format: { type: 'json_object' },
  })) {
    const delta = chunk?.choices?.[0]?.delta?.content;
    if (delta) raw += delta;
  }
  return extractJson(raw);
}

export function extractJson(text) {
  if (!text) return null;
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const obj = JSON.parse(t.slice(start, end + 1));
    return obj && typeof obj === 'object' ? obj : null;
  } catch {
    return null;
  }
}
