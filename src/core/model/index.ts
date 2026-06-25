import type { ModelConfig } from '@/types';

export class ModelError extends Error {
  constructor(
    public code:
      | 'MODEL_API_KEY_MISSING'
      | 'MODEL_REQUEST_FAILED'
      | 'TASK_PARSE_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'ModelError';
  }
}

interface ImageContentPart {
  type: 'image_url';
  image_url: {
    url: string;
  };
}

interface TextContentPart {
  type: 'text';
  text: string;
}

type ChatMessageContent = string | Array<TextContentPart | ImageContentPart>;

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: ChatMessageContent;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

export interface VisionPointResult {
  found: boolean;
  x: number;
  y: number;
  confidence: number;
  reason?: string;
}

/** 调用 chat completions 接口，返回模型文本输出 */
export async function chatCompletion(
  config: ModelConfig,
  messages: ChatMessage[],
  options?: { temperature?: number; signal?: AbortSignal },
): Promise<string> {
  if (!config.apiKey) {
    throw new ModelError('MODEL_API_KEY_MISSING', '未配置模型 API Key，请先在设置页填写。');
  }
  const url = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: options?.temperature ?? 0.7,
        stream: false,
      }),
      signal: options?.signal,
    });
  } catch (err) {
    throw new ModelError(
      'MODEL_REQUEST_FAILED',
      `请求模型服务失败: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!res.ok) {
    let detail = '';
    try {
      const data = (await res.json()) as ChatCompletionResponse;
      detail = data.error?.message ?? '';
    } catch {
      detail = await res.text().catch(() => '');
    }
    throw new ModelError(
      'MODEL_REQUEST_FAILED',
      `模型服务返回错误 ${res.status}: ${detail || res.statusText}`,
    );
  }

  const data = (await res.json()) as ChatCompletionResponse;
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new ModelError('MODEL_REQUEST_FAILED', '模型返回内容为空。');
  }
  return content;
}

/** 使用视觉模型在截图中定位目标按钮，返回归一化视口坐标（0-1）。 */
export async function locatePointInScreenshot(
  config: ModelConfig,
  params: {
    imageDataUrl: string;
    instruction: string;
  },
  signal?: AbortSignal,
): Promise<VisionPointResult> {
  const reply = await chatCompletion(
    config,
    [
      {
        role: 'system',
        content:
          '你是浏览器自动化的视觉定位器。只返回 JSON，不要输出解释。坐标必须是截图视口内的归一化坐标，x 和 y 均为 0 到 1。',
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `${params.instruction}\n\n只返回 JSON：{"found":boolean,"x":number,"y":number,"confidence":number,"reason":string}`,
          },
          {
            type: 'image_url',
            image_url: {
              url: params.imageDataUrl,
            },
          },
        ],
      },
    ],
    { temperature: 0, signal },
  );
  const parsed = extractJson<Partial<VisionPointResult>>(reply);
  const found = parsed.found === true;
  const x = Number(parsed.x);
  const y = Number(parsed.y);
  const confidence = Number(parsed.confidence ?? 0);
  if (!found) {
    return {
      found: false,
      x: 0,
      y: 0,
      confidence,
      reason: parsed.reason,
    };
  }
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
    return {
      found: false,
      x: 0,
      y: 0,
      confidence,
      reason: '视觉模型返回的坐标不在 0-1 范围内',
    };
  }
  return {
    found: true,
    x,
    y,
    confidence: Number.isFinite(confidence) ? confidence : 0,
    reason: parsed.reason,
  };
}

/**
 * 从模型输出文本中提取 JSON 对象。
 * 模型有时会包裹 ```json ... ``` 或附带说明文字，这里做容错提取。
 */
export function extractJson<T = unknown>(text: string): T {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  try {
    return JSON.parse(candidate) as T;
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      const slice = candidate.slice(start, end + 1);
      return JSON.parse(slice) as T;
    }
    throw new ModelError('TASK_PARSE_FAILED', `无法从模型输出解析 JSON: ${text.slice(0, 200)}`);
  }
}

/** 测试模型连接是否可用 */
export async function testModelConnection(config: ModelConfig): Promise<{
  ok: boolean;
  message: string;
}> {
  try {
    const reply = await chatCompletion(
      config,
      [
        { role: 'system', content: '你是一个连接测试助手。' },
        { role: 'user', content: '只回复两个字：成功' },
      ],
      { temperature: 0 },
    );
    return { ok: true, message: `连接成功，模型返回: ${reply.trim().slice(0, 40)}` };
  } catch (err) {
    if (err instanceof ModelError) {
      return { ok: false, message: `[${err.code}] ${err.message}` };
    }
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
