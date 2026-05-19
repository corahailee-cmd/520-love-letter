export const config = { runtime: 'edge' };

const PROMPT = `仔细观察这张照片的主色调和整体氛围，返回以下JSON（只返回JSON，不要其他文字）：
{
  "colorNameZh": "照片主色调对应的中文色名，2~4字，要求：有画面感、高级自然、带法式或日系杂志感，可结合自然/天气/花朵/光影/海洋/黄昏/森林等意象，风格参考：琥珀棕、湖蓝、晚霞紫、月光灰、雾霭青、鸢尾紫、松烟墨、海盐白",
  "colorNameEn": "对应英文色名，2~3个单词，优雅诗意",
  "hex": "照片主色调的十六进制色码",
  "letter": "根据照片氛围写一段情书文案，要求：40~80字；有留白感，不要太满；像摄影作品旁边的小诗；偏第一人称情绪；有"怦然心动""想念""陪伴""时间""光影"等意象；像在描述一个瞬间，而不是直接说"我爱你"；风格参考：「那天下午的光很长，你站在窗边没有说话，我看着你的侧脸，忽然觉得，时间可以就这样停在这里。」"
}`;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: CORS_HEADERS });
  }

  const apiKey = process.env.ARK_API_KEY;
  if (!apiKey) {
    return new Response('Server misconfiguration: missing ARK_API_KEY', {
      status: 500,
      headers: CORS_HEADERS,
    });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400, headers: CORS_HEADERS });
  }

  const { image } = body;
  if (!image) {
    return new Response('Missing image field', { status: 400, headers: CORS_HEADERS });
  }

  const payload = {
    model: 'doubao-1-5-vision-pro-32k-250115',
    max_tokens: 800,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${image}` },
          },
          { type: 'text', text: PROMPT },
        ],
      },
    ],
  };

  let upstream;
  try {
    upstream = await fetch('https://ark.cn-beijing.volces.com/api/v3/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return new Response(`Upstream fetch failed: ${err.message}`, {
      status: 502,
      headers: CORS_HEADERS,
    });
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '');
    return new Response(`Upstream error ${upstream.status}: ${text}`, {
      status: 502,
      headers: CORS_HEADERS,
    });
  }

  const data = await upstream.json();
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
