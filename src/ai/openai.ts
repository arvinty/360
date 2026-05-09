const CHAT_URL = "https://api.openai.com/v1/chat/completions";
const IMAGE_URL = "https://api.openai.com/v1/images/generations";
const IMAGE_EDIT_URL = "https://api.openai.com/v1/images/edits";

const DEFAULT_CHAT_MODEL = "gpt-4.1-mini";
const DEFAULT_IMAGE_MODEL = "gpt-image-2";

function getKey(): string {
  const key = import.meta.env.VITE_OPENAI_API_KEY || import.meta.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error("Missing VITE_OPENAI_API_KEY in .env");
  }
  return key;
}

export class OpenAIError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "OpenAIError";
  }
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (err instanceof OpenAIError && err.status !== 429 && err.status < 500) throw err;
      if (i < attempts - 1) {
        const backoff = 600 * Math.pow(2, i) + Math.random() * 300;
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function chatJSON<T>(
  systemPrompt: string,
  userPrompt: string,
  opts?: { model?: string; temperature?: number; maxTokens?: number }
): Promise<T> {
  return withRetry(async () => {
    const r = await fetch(CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getKey()}`,
      },
      body: JSON.stringify({
        model: opts?.model ?? DEFAULT_CHAT_MODEL,
        temperature: opts?.temperature ?? 0.85,
        max_tokens: opts?.maxTokens ?? 12000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      throw new OpenAIError(r.status, data?.error?.message || `HTTP ${r.status}`);
    }
    const choice = data.choices?.[0];
    const content = choice?.message?.content;
    if (!content) throw new OpenAIError(500, "Empty completion");
    if (choice?.finish_reason === "length") {
      throw new OpenAIError(500, "Model output truncated (hit max_tokens). Increase maxTokens.");
    }
    try {
      return JSON.parse(content) as T;
    } catch {
      throw new OpenAIError(500, "Model returned non-JSON content (likely truncated)");
    }
  });
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(",");
  const mime = /data:(.*?);base64/.exec(meta)?.[1] ?? "image/png";
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: mime });
}

export async function generateImage(
  prompt: string,
  opts?: { referenceImage?: string; model?: string; size?: string }
): Promise<string> {
  const model = opts?.model ?? DEFAULT_IMAGE_MODEL;
  const size = opts?.size ?? "1536x1024";

  return withRetry(async () => {
    let r: Response;
    if (opts?.referenceImage) {
      const fd = new FormData();
      fd.append("model", model);
      fd.append("prompt", prompt);
      fd.append("size", size);
      fd.append("n", "1");
      fd.append("image", dataUrlToBlob(opts.referenceImage), "reference.png");
      r = await fetch(IMAGE_EDIT_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${getKey()}` },
        body: fd,
      });
    } else {
      r = await fetch(IMAGE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getKey()}`,
        },
        body: JSON.stringify({ model, prompt, size, n: 1 }),
      });
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      throw new OpenAIError(r.status, data?.error?.message || `HTTP ${r.status}`);
    }
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) throw new OpenAIError(500, "No image returned");
    return `data:image/png;base64,${b64}`;
  });
}
