import http from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import {
  callGemini,
  checkCostGuard,
  clientIpFromHeaders,
  createQuotaState,
  getConfig,
  markRequestAccepted,
  quotaSnapshot,
  validateSubmission
} from "./lib/core.mjs";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(rootDir, "public");

loadDotEnv(join(rootDir, ".env"));

const PORT = Number(process.env.PORT || 3000);
const state = createQuotaState();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon"
};

async function handleEvaluate(req, res) {
  const config = getConfig();
  if (!config.geminiApiKey) {
    return sendJson(res, 503, {
      error: "Gemini APIキーが未設定です。サーバーの環境変数 GEMINI_API_KEY を設定してください。"
    });
  }

  let payload;
  try {
    payload = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { error: "リクエストの形式が不正です。" });
  }

  const sourceText = String(payload.sourceText || "");
  const summaryText = String(payload.summaryText || "");
  const validation = validateSubmission(sourceText, summaryText, config);
  if (!validation.ok) {
    return sendJson(res, validation.status, { error: validation.message });
  }

  const ip = clientIpFromHeaders(req.headers, req.socket.remoteAddress || "unknown");
  const guard = checkCostGuard(ip, state, config);
  if (!guard.ok) {
    return sendJson(res, guard.status, { error: guard.message, quota: quotaSnapshot(state, config) });
  }

  markRequestAccepted(ip, state);

  try {
    const feedback = await callGemini(sourceText, summaryText, validation, config);
    sendJson(res, 200, { feedback, meta: validation, quota: quotaSnapshot(state, config) });
  } catch (error) {
    sendJson(res, error.status || 502, {
      error: error.message || "AIフィードバックの生成に失敗しました。",
      quota: quotaSnapshot(state, config)
    });
  }
}

async function handleStatus(_req, res) {
  const config = getConfig();
  sendJson(res, 200, {
    ready: Boolean(config.geminiApiKey),
    model: config.model,
    quota: quotaSnapshot(state, config),
    limits: {
      maxSourceChars: config.maxSourceChars,
      maxSummaryChars: config.maxSummaryChars,
      minSecondsBetweenRequests: config.minSecondsBetweenRequests
    }
  });
}

async function serveStatic(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);
  const safePath = normalize(pathname === "/" ? "/index.html" : pathname).replace(/^([/\\])+/, "");
  const filePath = join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    return sendText(res, 403, "Forbidden");
  }

  try {
    const content = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(content);
  } catch {
    sendText(res, 404, "Not found");
  }
}

export function createServer() {
  return http.createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/api/evaluate") {
      await handleEvaluate(req, res);
      return;
    }
    if (req.method === "GET" && req.url === "/api/status") {
      await handleStatus(req, res);
      return;
    }
    if (req.method === "GET" || req.method === "HEAD") {
      await serveStatic(req, res);
      return;
    }
    sendJson(res, 405, { error: "Method not allowed" });
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 32_000) {
        req.destroy();
        reject(new Error("Body too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(text);
}

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer().listen(PORT, "127.0.0.1", () => {
    console.log(`Japanese summary practice app: http://127.0.0.1:${PORT}`);
  });
}
