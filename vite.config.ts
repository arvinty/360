import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const CHAT_URL = "https://api.openai.com/v1/chat/completions";
const IMAGE_URL = "https://api.openai.com/v1/images/generations";
const IMAGE_EDIT_URL = "https://api.openai.com/v1/images/edits";

function readBody(req: { on: (event: string, cb: (chunk?: unknown) => void) => void }): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(",");
  const mime = /data:(.*?);base64/.exec(meta)?.[1] ?? "image/png";
  const bin = Buffer.from(b64, "base64");
  return new Blob([bin], { type: mime });
}

function openAIProxyPlugin(apiKey: string): Plugin {
  async function handleOpenAIProxy(req: any, res: any, next: () => void) {
    if (req.method !== "POST" || !req.url?.startsWith("/api/openai/")) {
      next();
      return;
    }

    if (!apiKey) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: { message: "Missing OPENAI_API_KEY or VITE_OPENAI_API_KEY in .env" } }));
      return;
    }

    try {
      const body = JSON.parse(await readBody(req));
      let upstream: Response;

      if (req.url.startsWith("/api/openai/chat")) {
        upstream = await fetch(CHAT_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
        });
      } else if (req.url.startsWith("/api/openai/image")) {
        if (body.referenceImage) {
          const fd = new FormData();
          fd.append("model", body.model);
          fd.append("prompt", body.prompt);
          fd.append("size", body.size);
          fd.append("n", "1");
          fd.append("image", dataUrlToBlob(body.referenceImage), "reference.png");
          upstream = await fetch(IMAGE_EDIT_URL, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}` },
            body: fd,
          });
        } else {
          upstream = await fetch(IMAGE_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: body.model,
              prompt: body.prompt,
              size: body.size,
              n: 1,
            }),
          });
        }
      } else {
        next();
        return;
      }

      res.statusCode = upstream.status;
      res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "application/json");
      res.end(await upstream.text());
    } catch (err) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: { message: err instanceof Error ? err.message : "OpenAI proxy failed" } }));
    }
  }

  return {
    name: "local-openai-proxy",
    configureServer(server) {
      server.middlewares.use(handleOpenAIProxy);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handleOpenAIProxy);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiKey = env.OPENAI_API_KEY || env.VITE_OPENAI_API_KEY || "";

  return {
    plugins: [react(), openAIProxyPlugin(apiKey)],
  };
});
