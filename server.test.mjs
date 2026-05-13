import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEvaluationPrompt,
  countJapaneseChars,
  targetSummaryLength,
  validateSubmission
} from "./server.mjs";

test("counts characters without whitespace", () => {
  assert.equal(countJapaneseChars("大学 1 年生\nの要約"), 8);
});

test("calculates target summary length as about half", () => {
  assert.equal(targetSummaryLength("あいうえおか"), 3);
});

test("rejects empty submission", () => {
  const result = validateSubmission("", "要約");
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
});

test("builds Japanese evaluation prompt with fixed rubric", () => {
  const prompt = buildEvaluationPrompt("原文です。", "要約です。", {
    sourceChars: 5,
    targetChars: 3,
    summaryChars: 4
  });
  assert.match(prompt, /要点/);
  assert.match(prompt, /圧縮度/);
  assert.match(prompt, /日本語表現/);
  assert.match(prompt, /模範回答/);
});
