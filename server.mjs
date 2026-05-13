import http from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(rootDir, "public");

loadDotEnv(join(rootDir, ".env"));

const PORT = Number(process.env.PORT || 3000);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const DAILY_REQUEST_LIMIT = Number(process.env.DAILY_REQUEST_LIMIT || 80);
const MIN_SECONDS_BETWEEN_REQUESTS = Number(process.env.MIN_SECONDS_BETWEEN_REQUESTS || 20);
const MAX_SOURCE_CHARS = Number(process.env.MAX_SOURCE_CHARS || 800);
const MAX_SUMMARY_CHARS = Number(process.env.MAX_SUMMARY_CHARS || 500);

const state = {
  day: currentDay(),
  dailyRequests: 0,
  lastRequestByIp: new Map()
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon"
};

export function currentDay(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function countJapaneseChars(text) {
  return Array.from((text || "").replace(/\s+/g, "")).length;
}

export function targetSummaryLength(sourceText) {
  return Math.max(1, Math.round(countJapaneseChars(sourceText) / 2));
}

export function validateSubmission(sourceText, summaryText) {
  const sourceChars = countJapaneseChars(sourceText);
  const summaryChars = countJapaneseChars(summaryText);

  if (!sourceText || !sourceText.trim()) {
    return { ok: false, status: 400, message: "原文を入力してください。" };
  }
  if (!summaryText || !summaryText.trim()) {
    return { ok: false, status: 400, message: "要約を入力してください。" };
  }
  if (sourceChars > MAX_SOURCE_CHARS) {
    return { ok: false, status: 400, message: `原文は${MAX_SOURCE_CHARS}文字以内にしてください。` };
  }
  if (summaryChars > MAX_SUMMARY_CHARS) {
    return { ok: false, status: 400, message: `要約は${MAX_SUMMARY_CHARS}文字以内にしてください。` };
  }

  return { ok: true, sourceChars, summaryChars, targetChars: targetSummaryLength(sourceText) };
}

export function checkCostGuard(ip, now = Date.now()) {
  refreshDailyCounter();

  if (state.dailyRequests >= DAILY_REQUEST_LIMIT) {
    return {
      ok: false,
      status: 429,
      message: "本日のAIフィードバック受付上限に達しました。追加費用を防ぐため、受付を停止しています。"
    };
  }

  const lastRequestAt = state.lastRequestByIp.get(ip) || 0;
  const elapsedSeconds = (now - lastRequestAt) / 1000;
  if (elapsedSeconds < MIN_SECONDS_BETWEEN_REQUESTS) {
    return {
      ok: false,
      status: 429,
      message: `連続送信を制限しています。あと${Math.ceil(MIN_SECONDS_BETWEEN_REQUESTS - elapsedSeconds)}秒待ってください。`
    };
  }

  return { ok: true };
}

export function markRequestAccepted(ip, now = Date.now()) {
  refreshDailyCounter();
  state.dailyRequests += 1;
  state.lastRequestByIp.set(ip, now);
}

export function buildEvaluationPrompt(sourceText, summaryText, meta) {
  return `
あなたは大学1年生の初年次教育で日本語要約を指導する教員です。
学生の要約を、厳しすぎず具体的に評価してください。

条件:
- 原文は教員が用意した50語程度の日本語文章です。
- 学生は原文の約半分の文字数で要約する練習をしています。
- 原文文字数: ${meta.sourceChars}
- 目標文字数: ${meta.targetChars}
- 学生の要約文字数: ${meta.summaryChars}
- 学生向けに、短く具体的な日本語で返してください。
- 事実と異なる指摘は避けてください。
- 模範回答は原文の内容だけに基づいてください。

原文:
${sourceText}

学生の要約:
${summaryText}

次のJSONだけを返してください。
{
  "overall": "全体コメントを1から2文で書く",
  "points": [
    {"label": "要点", "comment": "要点を押さえているか"},
    {"label": "圧縮度", "comment": "半分程度に圧縮できているか"},
    {"label": "日本語表現", "comment": "日本語として自然か"}
  ],
  "improvements": ["改善ポイント1", "改善ポイント2"],
  "modelAnswer": "原文の約半分の文字数の模範回答"
}
`.trim();
}

async function callGemini(sourceText, summaryText, meta) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
  const prompt = buildEvaluationPrompt(sourceText, summaryText, meta);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        temperature: 0.3,
        responseMimeType: "application/json"
      }
    })
  });

  if (!response.ok) {
    const detail = await safeReadText(response);
    const message = response.status === 429
      ? "Gemini APIの無料枠またはレート上限に達した可能性があります。追加費用を防ぐため、受付を停止しました。"
      : "Gemini APIから正常な応答がありませんでした。";
    throw Object.assign(new Error(message), { status: response.status, detail });
  }

  const json = await response.json();
  const text = json?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
  if (!text) {
    throw Object.assign(new Error("Gemini APIの応答を読み取れませんでした。"), { status: 502 });
  }

  return parseGeminiJson(text);
}

function parseGeminiJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw Object.assign(new Error("Gemini APIの応答形式が不正でした。"), { status: 502 });
  }
}

async function handleEvaluate(req, res) {
  if (!GEMINI_API_KEY) {
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
  const validation = validateSubmission(sourceText, summaryText);
  if (!validation.ok) {
    return sendJson(res, validation.status, { error: validation.message });
  }

  const ip = clientIp(req);
  const guard = checkCostGuard(ip);
  if (!guard.ok) {
    return sendJson(res, guard.status, { error: guard.message, quota: quotaSnapshot() });
  }

  markRequestAccepted(ip);

  try {
    const feedback = await callGemini(sourceText, summaryText, validation);
    sendJson(res, 200, { feedback, meta: validation, quota: quotaSnapshot() });
  } catch (error) {
    sendJson(res, error.status || 502, {
      error: error.message || "AIフィードバックの生成に失敗しました。",
      quota: quotaSnapshot()
    });
  }
}

async function handleStatus(_req, res) {
  sendJson(res, 200, {
    ready: Boolean(GEMINI_API_KEY),
    model: MODEL,
    quota: quotaSnapshot(),
    limits: {
      maxSourceChars: MAX_SOURCE_CHARS,
      maxSummaryChars: MAX_SUMMARY_CHARS,
      minSecondsBetweenRequests: MIN_SECONDS_BETWEEN_REQUESTS
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

function refreshDailyCounter() {
  const today = currentDay();
  if (state.day !== today) {
    state.day = today;
    state.dailyRequests = 0;
    state.lastRequestByIp.clear();
  }
}

function quotaSnapshot() {
  refreshDailyCounter();
  return {
    day: state.day,
    used: state.dailyRequests,
    limit: DAILY_REQUEST_LIMIT,
    remaining: Math.max(0, DAILY_REQUEST_LIMIT - state.dailyRequests)
  };
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
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

async function safeReadText(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
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
