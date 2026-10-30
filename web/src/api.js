/**
 * 和后端说话的唯一通道。
 *
 * 后端把一次交互拆成一串事件（state / delta / chip / toast ...），
 * 这里负责把 SSE 流解析成一个个对象吐给调用方。
 */

async function* parseSSE(response) {
  if (!response.ok) {
    let detail = `${response.status}`;
    try {
      const data = await response.json();
      detail = data.detail || detail;
    } catch {
      /* 忽略非 JSON 错误体 */
    }
    throw new Error(detail);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let cut;
    while ((cut = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        try {
          yield JSON.parse(line.slice(6));
        } catch {
          /* 半条数据，丢掉 */
        }
      }
    }
  }
}

/** POST 一个动作，拿到事件流 */
export async function* act(path, body = {}) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  yield* parseSSE(response);
}

async function getJSON(path) {
  const response = await fetch(path);
  if (!response.ok) {
    let detail = `${response.status}`;
    try {
      detail = (await response.json()).detail || detail;
    } catch {
      /* 忽略 */
    }
    throw new Error(detail);
  }
  return response.json();
}

export const boot = (stage = 0) => getJSON(`/api/boot${stage ? `?stage=${stage}` : ''}`);
export const poke = () => getJSON('/api/poke');
export const saveCode = () => getJSON('/api/code');

export async function importCode(code) {
  const response = await fetch('/api/code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: code }),
  });
  if (!response.ok) throw new Error('这个存档码读不出来');
  return response.json();
}
