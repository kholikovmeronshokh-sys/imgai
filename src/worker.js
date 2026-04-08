const DEFAULT_MODEL = "black-forest-labs/FLUX.1-schnell";
const DEFAULT_PROVIDER = "hf-inference";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/status") {
      return json({
        ok: true,
        configured: Boolean(env.HF_TOKEN),
        limit: 2,
        provider: "huggingface",
        model: env.HF_IMAGE_MODEL || DEFAULT_MODEL,
      });
    }

    if (request.method === "POST" && url.pathname === "/api/generate") {
      return handleGenerate(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleGenerate(request, env) {
  if (!env.HF_TOKEN) {
    return json({ error: "HF_TOKEN topilmadi. Cloudflare environment variable sozlang." }, 500);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "JSON noto'g'ri formatda" }, 400);
  }

  const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
  if (!prompt) {
    return json({ error: "Prompt kiriting" }, 400);
  }

  try {
    const imageBase64 = await fetchHuggingFaceImage({
      token: env.HF_TOKEN,
      model: env.HF_IMAGE_MODEL || DEFAULT_MODEL,
      provider: env.HF_PROVIDER || DEFAULT_PROVIDER,
      prompt,
    });

    return json({
      imageBase64,
      text: "Rasm Hugging Face orqali yaratildi.",
    });
  } catch (error) {
    const info = extractUpstreamInfo(error);
    return json(
      {
        error: info.userMessage || "Hugging Face API bilan bog'lanib bo'lmadi",
        reason: info.reason,
        retryAfterMs: info.retryAfterMs,
      },
      502
    );
  }
}

async function fetchHuggingFaceImage({ token, model, provider, prompt }) {
  const response = await fetch(`https://router.huggingface.co/hf-inference/models/${model}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Use-Provider": provider,
    },
    body: JSON.stringify({
      inputs: prompt,
      parameters: {
        num_inference_steps: 4,
        guidance_scale: 6.5,
      },
    }),
  });

  if (!response.ok) {
    const maybeJson = await safeReadJson(response);
    const maybeText = maybeJson?.error || maybeJson?.message || (await safeReadText(response));
    const error = new Error(maybeText || "HF API xatosi");
    error.status = response.status;
    throw error;
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) {
    const text = await safeReadText(response);
    throw new Error(text || "HF API rasm qaytarmadi");
  }

  const arrayBuffer = await response.arrayBuffer();
  if (!arrayBuffer.byteLength) {
    throw new Error("HF API bo'sh rasm qaytardi");
  }

  return arrayBufferToBase64(arrayBuffer);
}

function extractUpstreamInfo(error) {
  const normalized = String(error?.message || "");
  const retryMatch = normalized.match(/retry in ([\d.]+)s/i);
  const retryAfterMs = retryMatch ? Math.round(Number(retryMatch[1]) * 1000) : null;
  const status = error?.status || 0;

  if (status === 401 || status === 403) {
    return {
      reason: "auth_error",
      retryAfterMs: null,
      userMessage: "Hugging Face token noto'g'ri yoki modelga ruxsat yo'q.",
    };
  }

  if (/quota/i.test(normalized) || /billing/i.test(normalized) || status === 402 || status === 429) {
    const retryText = retryAfterMs
      ? ` Taxminan ${Math.ceil(retryAfterMs / 1000)} soniyadan keyin qayta urinib ko'ring.`
      : "";
    return {
      reason: "quota_exceeded",
      retryAfterMs,
      userMessage: "Hugging Face krediti tugagan yoki provider quota cheklovi bor." + retryText,
    };
  }

  return {
    reason: "upstream_error",
    retryAfterMs: null,
    userMessage: normalized || "Hugging Face API bilan bog'lanib bo'lmadi",
  };
}

function arrayBufferToBase64(arrayBuffer) {
  let binary = "";
  const bytes = new Uint8Array(arrayBuffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function safeReadJson(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

async function safeReadText(response) {
  try {
    return await response.clone().text();
  } catch {
    return "";
  }
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
