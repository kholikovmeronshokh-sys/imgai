const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");
const {
  InferenceClient,
  InferenceClientProviderApiError,
  InferenceClientHubApiError,
} = require("@huggingface/inference");

const DEFAULT_PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const LIMITS_FILE = path.join(DATA_DIR, "limits.json");
const DAY_MS = 24 * 60 * 60 * 1000;
const DAILY_LIMIT = 2;
const HF_IMAGE_MODEL = process.env.HF_IMAGE_MODEL || "black-forest-labs/FLUX.1-schnell";
const HF_PROVIDER = process.env.HF_PROVIDER || "hf-inference";

loadEnvFile(path.join(ROOT, ".env"));
ensureDataFile();
const hf = process.env.HF_TOKEN ? new InferenceClient(process.env.HF_TOKEN) : null;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/status") {
      return sendJson(res, 200, {
        ok: true,
        configured: Boolean(process.env.HF_TOKEN),
        limit: DAILY_LIMIT,
        provider: "huggingface",
        model: HF_IMAGE_MODEL,
      });
    }

    if (req.method === "GET" && url.pathname === "/api/usage") {
      return handleUsage(req, res);
    }

    if (req.method === "POST" && url.pathname === "/api/generate") {
      return handleGenerate(req, res);
    }

    if (req.method === "GET") {
      return serveStatic(url.pathname, res);
    }

    sendJson(res, 404, { error: "Topilmadi" });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Server xatosi yuz berdi" });
  }
});

startServer(DEFAULT_PORT);

async function handleGenerate(req, res) {
  if (!process.env.HF_TOKEN || !hf) {
    return sendJson(res, 500, {
      error: "HF_TOKEN topilmadi. .env faylini sozlang.",
    });
  }

  const clientId = req.headers["x-client-id"];
  if (!clientId || typeof clientId !== "string") {
    return sendJson(res, 400, { error: "Foydalanuvchi identifikatori topilmadi" });
  }

  const payload = await readJsonBody(req);
  const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";

  if (!prompt) {
    return sendJson(res, 400, { error: "Prompt kiriting" });
  }

  const ip = getRequestIp(req);
  const userAgent = req.headers["user-agent"] || "unknown";
  const fingerprint = crypto
    .createHash("sha256")
    .update(`${clientId}|${ip}|${userAgent}`)
    .digest("hex");

  const limits = readLimits();
  const now = Date.now();
  let record = limits[fingerprint];

  if (!record || now >= record.resetAt) {
    record = {
      count: 0,
      resetAt: now + DAY_MS,
    };
  }

  if (record.count >= DAILY_LIMIT) {
    return sendJson(res, 429, {
      error: "Bugungi limit tugadi",
      remaining: 0,
      resetAt: record.resetAt,
    });
  }

  try {
    const imageBase64 = await fetchHuggingFaceImage(prompt);
    record.count += 1;
    limits[fingerprint] = record;
    writeLimits(limits);

    return sendJson(res, 200, {
      imageBase64,
      text: "Rasm Hugging Face orqali yaratildi.",
      remaining: DAILY_LIMIT - record.count,
      resetAt: record.resetAt,
    });
  } catch (error) {
    const upstreamInfo = extractUpstreamInfo(error);
    if (upstreamInfo.reason === "quota_exceeded") {
      console.warn(`HF quota issue: ${error.message}`);
    } else {
      console.error(error);
    }
    return sendJson(res, 502, {
      error: upstreamInfo.userMessage || error.message || "Hugging Face API bilan bog'lanib bo'lmadi",
      reason: upstreamInfo.reason,
      retryAfterMs: upstreamInfo.retryAfterMs,
    });
  }
}

function handleUsage(req, res) {
  const clientId = req.headers["x-client-id"];
  if (!clientId || typeof clientId !== "string") {
    return sendJson(res, 400, { error: "Foydalanuvchi identifikatori topilmadi" });
  }

  const ip = getRequestIp(req);
  const userAgent = req.headers["user-agent"] || "unknown";
  const fingerprint = crypto
    .createHash("sha256")
    .update(`${clientId}|${ip}|${userAgent}`)
    .digest("hex");

  const limits = readLimits();
  const now = Date.now();
  const record = limits[fingerprint];

  if (!record || now >= record.resetAt) {
    return sendJson(res, 200, {
      remaining: DAILY_LIMIT,
      resetAt: null,
      limit: DAILY_LIMIT,
    });
  }

  return sendJson(res, 200, {
    remaining: Math.max(0, DAILY_LIMIT - record.count),
    resetAt: record.resetAt,
    limit: DAILY_LIMIT,
  });
}

async function fetchHuggingFaceImage(prompt) {
  const imageBlob = await hf.textToImage({
    provider: HF_PROVIDER,
    model: HF_IMAGE_MODEL,
    inputs: prompt,
    parameters: {
      num_inference_steps: 4,
      guidance_scale: 6.5,
    },
  });

  const arrayBuffer = await imageBlob.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (!buffer.length) {
    throw new Error("HF API rasm qaytarmadi. Promptni boshqacharoq yozib ko'ring.");
  }

  return buffer.toString("base64");
}

function serveStatic(requestPath, res) {
  let normalizedPath = requestPath;

  if (requestPath === "/" || requestPath === "/home") {
    normalizedPath = "/home.html";
  } else if (requestPath === "/generate") {
    normalizedPath = "/generate.html";
  }

  const filePath = path.normalize(path.join(PUBLIC_DIR, normalizedPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendJson(res, 403, { error: "Ruxsat yo'q" });
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === "ENOENT") {
        return sendJson(res, 404, { error: "Sahifa topilmadi" });
      }

      return sendJson(res, 500, { error: "Faylni o'qib bo'lmadi" });
    }

    res.writeHead(200, {
      "Content-Type": getContentType(filePath),
      "Cache-Control": "no-cache",
    });
    res.end(content);
  });
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    default:
      return "application/octet-stream";
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        reject(new Error("So'rov juda katta"));
      }
    });

    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error("JSON noto'g'ri formatda"));
      }
    });

    req.on("error", reject);
  });
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(LIMITS_FILE)) {
    fs.writeFileSync(LIMITS_FILE, "{}", "utf8");
  }
}

function readLimits() {
  try {
    const raw = fs.readFileSync(LIMITS_FILE, "utf8");
    return JSON.parse(raw || "{}");
  } catch (error) {
    return {};
  }
}

function writeLimits(data) {
  fs.writeFileSync(LIMITS_FILE, JSON.stringify(data, null, 2), "utf8");
}

function getRequestIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }

  return req.socket.remoteAddress || "unknown";
}

function extractUpstreamInfo(error) {
  const message = error?.message || "";
  const normalized = String(message);
  const retryMatch = normalized.match(/Please retry in ([\d.]+)s/i);
  const retryAfterMs = retryMatch ? Math.round(Number(retryMatch[1]) * 1000) : null;
  const isQuotaError =
    /quota exceeded/i.test(normalized) ||
    /billing details/i.test(normalized) ||
    error?.response?.status === 402 ||
    error?.response?.status === 429;

  if (error instanceof InferenceClientProviderApiError || error instanceof InferenceClientHubApiError) {
    if (error.response?.status === 401 || error.response?.status === 403) {
      return {
        reason: "auth_error",
        retryAfterMs: null,
        userMessage: "Hugging Face token noto'g'ri yoki bu modelga ruxsat yo'q.",
      };
    }
  }

  if (!isQuotaError) {
    return {
      reason: "upstream_error",
      retryAfterMs: null,
      userMessage: "",
    };
  }

  const retryText = retryAfterMs
    ? ` Taxminan ${Math.ceil(retryAfterMs / 1000)} soniyadan keyin qayta urinib ko'ring.`
    : "";

  return {
    reason: "quota_exceeded",
    retryAfterMs,
    userMessage:
      "Hugging Face krediti tugagan yoki provider tomonda quota cheklovi bor. HF billing va usage sahifasini tekshiring." +
      retryText,
  };
}

function startServer(port) {
  server.listen(port, () => {
    console.log(`Rasmboz AI running on http://localhost:${port}`);
  });
}

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    const currentPort = Number(error.port || DEFAULT_PORT);
    const nextPort = currentPort + 1;
    console.warn(`Port ${currentPort} band. Server http://localhost:${nextPort} da ishga tushiriladi.`);
    setTimeout(() => {
      startServer(nextPort);
    }, 200);
    return;
  }

  throw error;
});
