import { createQuotaState, getConfig, quotaSnapshot } from "../lib/core.mjs";

const state = globalThis.__summaryPracticeQuotaState || createQuotaState();
globalThis.__summaryPracticeQuotaState = state;

export default function handler(_req, res) {
  const config = getConfig();
  res.status(200).json({
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
