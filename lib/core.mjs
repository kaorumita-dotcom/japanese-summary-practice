export function getConfig() {
  return {
    geminiApiKey: process.env.GEMINI_API_KEY || "",
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    dailyRequestLimit: Number(process.env.DAILY_REQUEST_LIMIT || 80),
    minSecondsBetweenRequests: Number(process.env.MIN_SECONDS_BETWEEN_REQUESTS || 20),
    maxSourceChars: Number(process.env.MAX_SOURCE_CHARS || 800),
    maxSummaryChars: Number(process.env.MAX_SUMMARY_CHARS || 500)
  };
}

export function createQuotaState() {
  return {
    day: currentDay(),
    dailyRequests: 0,
    lastRequestByIp: new Map()
  };
}

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

export function validateSubmission(sourceText, summaryText, config = getConfig()) {
  const sourceChars = countJapaneseChars(sourceText);
  const summaryChars = countJapaneseChars(summaryText);

  if (!sourceText || !sourceText.trim()) {
    return { ok: false, status: 400, message: "原文を入力してください。" };
  }
  if (!summaryText || !summaryText.trim()) {
    return { ok: false, status: 400, message: "要約を入力してください。" };
  }
  if (sourceChars > config.maxSourceChars) {
    return { ok: false, status: 400, message: `原文は${config.maxSourceChars}文字以内にしてください。` };
  }
  if (summaryChars > config.maxSummaryChars) {
    return { ok: false, status: 400, message: `要約は${config.maxSummaryChars}文字以内にしてください。` };
  }

  return { ok: true, sourceChars, summaryChars, targetChars: targetSummaryLength(sourceText) };
}

export function checkCostGuard(ip, state, config = getConfig(), now = Date.now()) {
  refreshDailyCounter(state);

  if (state.dailyRequests >= config.dailyRequestLimit) {
    return {
      ok: false,
      status: 429,
      message: "本日のAIフィードバック受付上限に達しました。追加費用を防ぐため、受付を停止しています。"
    };
  }

  const lastRequestAt = state.lastRequestByIp.get(ip) || 0;
  const elapsedSeconds = (now - lastRequestAt) / 1000;
  if (elapsedSeconds < config.minSecondsBetweenRequests) {
    return {
      ok: false,
      status: 429,
      message: `連続送信を制限しています。あと${Math.ceil(config.minSecondsBetweenRequests - elapsedSeconds)}秒待ってください。`
    };
  }

  return { ok: true };
}

export function markRequestAccepted(ip, state, now = Date.now()) {
  refreshDailyCounter(state);
  state.dailyRequests += 1;
  state.lastRequestByIp.set(ip, now);
}

export function quotaSnapshot(state, config = getConfig()) {
  refreshDailyCounter(state);
  return {
    day: state.day,
    used: state.dailyRequests,
    limit: config.dailyRequestLimit,
    remaining: Math.max(0, config.dailyRequestLimit - state.dailyRequests)
  };
}

export function refreshDailyCounter(state) {
  const today = currentDay();
  if (state.day !== today) {
    state.day = today;
    state.dailyRequests = 0;
    state.lastRequestByIp.clear();
  }
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

export async function callGemini(sourceText, summaryText, meta, config = getConfig()) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${encodeURIComponent(config.geminiApiKey)}`;
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

export function parseGeminiJson(text) {
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

export function clientIpFromHeaders(headers, fallback = "unknown") {
  const forwarded = typeof headers.get === "function"
    ? headers.get("x-forwarded-for")
    : headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return fallback;
}

async function safeReadText(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
