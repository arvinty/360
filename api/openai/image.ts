export const config = { maxDuration: 60 };

function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(",");
  const mime = /data:(.*?);base64/.exec(meta)?.[1] ?? "image/png";
  const bin = Buffer.from(b64, "base64");
  return new Blob([bin], { type: mime });
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: { message: "Method not allowed" } });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: { message: "Missing OPENAI_API_KEY" } });
    return;
  }

  try {
    const body = req.body ?? {};
    let upstream: Response;

    if (body.referenceImage) {
      const fd = new FormData();
      fd.append("model", String(body.model));
      fd.append("prompt", String(body.prompt));
      fd.append("size", String(body.size));
      fd.append("n", "1");
      fd.append("image", dataUrlToBlob(body.referenceImage), "reference.png");
      upstream = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: fd,
      });
    } else {
      upstream = await fetch("https://api.openai.com/v1/images/generations", {
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

    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "application/json");
    res.send(text);
  } catch (err) {
    res.status(500).json({
      error: { message: err instanceof Error ? err.message : "OpenAI proxy failed" },
    });
  }
}
