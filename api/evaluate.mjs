import {
  callGemini,
  checkCostGuard,
  clientIpFromHeaders,
  createQuotaState,
  getConfig,
  markRequestAccepted,
  quotaSnapshot,
  validateSubmission
} from "../lib/core.mjs";

const state = globalThis.__summaryPracticeQuotaState || createQuotaState();
globalThis.__summaryPracticeQuotaState = state;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const config = getConfig();
  if (!config.geminiApiKey) {
    res.status(503).json({
      error: "Gemini APIキーが未設定です。サーバーの環境変数 GEMINI_API_KEY を設定してください。"
    });
    return;
  }

  const payload = typeof req.body === "object" && req.body !== null ? req.body : {};
  const sourceText = String(payload.sourceText || "");
  const summaryText = String(payload.summaryText || "");
  const validation = validateSubmission(sourceText, summaryText, config);
  if (!validation.ok) {
    res.status(validation.status).json({ error: validation.message });
    return;
  }

  const ip = clientIpFromHeaders(req.headers, req.socket?.remoteAddress || "unknown");
  const guard = checkCostGuard(ip, state, config);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.message, quota: quotaSnapshot(state, config) });
    return;
  }

  markRequestAccepted(ip, state);

  try {
    const feedback = await callGemini(sourceText, summaryText, validation, config);
    res.status(200).json({ feedback, meta: validation, quota: quotaSnapshot(state, config) });
  } catch (error) {
    res.status(error.status || 502).json({
      error: error.message || "AIフィードバックの生成に失敗しました。",
      quota: quotaSnapshot(state, config)
    });
  }
}
