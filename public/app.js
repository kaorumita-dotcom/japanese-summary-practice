const form = document.querySelector("#summary-form");
const sourceText = document.querySelector("#source-text");
const summaryText = document.querySelector("#summary-text");
const sourceCount = document.querySelector("#source-count");
const targetCount = document.querySelector("#target-count");
const summaryCount = document.querySelector("#summary-count");
const pasteNotice = document.querySelector("#paste-notice");
const submitButton = document.querySelector("#submit-button");
const clearButton = document.querySelector("#clear-button");
const feedbackEmpty = document.querySelector("#feedback-empty");
const feedbackResult = document.querySelector("#feedback-result");
const apiStatus = document.querySelector("#api-status");
const quotaText = document.querySelector("#quota-text");

let pasteNoticeTimer;

sourceText.addEventListener("input", updateCounts);
summaryText.addEventListener("input", updateCounts);
summaryText.addEventListener("paste", blockPaste);
summaryText.addEventListener("drop", blockPaste);
summaryText.addEventListener("contextmenu", blockPaste);
summaryText.addEventListener("beforeinput", (event) => {
  if (event.inputType === "insertFromPaste" || event.inputType === "insertFromDrop") {
    blockPaste(event);
  }
});

form.addEventListener("submit", handleSubmit);
clearButton.addEventListener("click", () => {
  sourceText.value = "";
  summaryText.value = "";
  feedbackResult.hidden = true;
  feedbackResult.innerHTML = "";
  feedbackEmpty.hidden = false;
  updateCounts();
});

loadStatus();
updateCounts();

function blockPaste(event) {
  event.preventDefault();
  showPasteNotice("要約は貼り付けず、自分で入力してください。");
}

function showPasteNotice(message) {
  pasteNotice.textContent = message;
  clearTimeout(pasteNoticeTimer);
  pasteNoticeTimer = setTimeout(() => {
    pasteNotice.textContent = "";
  }, 3600);
}

function countChars(value) {
  return Array.from((value || "").replace(/\s+/g, "")).length;
}

function updateCounts() {
  const source = countChars(sourceText.value);
  const summary = countChars(summaryText.value);
  sourceCount.textContent = String(source);
  targetCount.textContent = source ? String(Math.max(1, Math.round(source / 2))) : "0";
  summaryCount.textContent = String(summary);
}

async function loadStatus() {
  try {
    const response = await fetch("/api/status");
    const data = await response.json();
    apiStatus.hidden = Boolean(data.ready);
    apiStatus.textContent = data.ready ? "" : "AI準備中";
    apiStatus.classList.toggle("ready", false);
    apiStatus.classList.toggle("error", !data.ready);
    updateQuota(data.quota);
  } catch {
    apiStatus.hidden = false;
    apiStatus.textContent = "状態不明";
    apiStatus.classList.add("error");
    quotaText.textContent = "上限確認不可";
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  updateCounts();

  const source = sourceText.value.trim();
  const summary = summaryText.value.trim();
  if (!source || !summary) {
    renderError("原文と要約の両方を入力してください。");
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = "生成中...";
  feedbackEmpty.hidden = true;
  feedbackResult.hidden = false;
  feedbackResult.innerHTML = `<div class="feedback-block"><p>AIフィードバックを生成しています。</p></div>`;

  try {
    const response = await fetch("/api/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceText: source, summaryText: summary })
    });
    const data = await response.json();
    updateQuota(data.quota);

    if (!response.ok) {
      renderError(data.error || "フィードバックを生成できませんでした。");
      return;
    }

    renderFeedback(data.feedback);
  } catch {
    renderError("通信に失敗しました。時間をおいてもう一度試してください。");
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = `<span class="button-icon" aria-hidden="true">✓</span>AIフィードバックを受ける`;
  }
}

function updateQuota(quota) {
  if (!quota) {
    quotaText.textContent = "上限確認不可";
    return;
  }
  quotaText.textContent = `本日 ${quota.used}/${quota.limit} 回`;
}

function renderFeedback(feedback) {
  const points = Array.isArray(feedback?.points) ? feedback.points : [];
  const improvements = Array.isArray(feedback?.improvements) ? feedback.improvements : [];

  feedbackEmpty.hidden = true;
  feedbackResult.hidden = false;
  feedbackResult.innerHTML = `
    <article class="feedback-block">
      <h3>全体コメント</h3>
      <p>${escapeHtml(feedback?.overall || "コメントを取得できませんでした。")}</p>
    </article>
    ${points.map((point) => `
      <article class="feedback-block">
        <h3>${escapeHtml(point.label || "観点")}</h3>
        <p>${escapeHtml(point.comment || "")}</p>
      </article>
    `).join("")}
    <article class="feedback-block">
      <h3>改善ポイント</h3>
      <ul>
        ${improvements.length ? improvements.map((item) => `<li>${escapeHtml(item)}</li>`).join("") : "<li>改善ポイントを取得できませんでした。</li>"}
      </ul>
    </article>
    <article class="feedback-block">
      <h3>模範回答</h3>
      <p>${escapeHtml(feedback?.modelAnswer || "模範回答を取得できませんでした。")}</p>
    </article>
  `;
}

function renderError(message) {
  feedbackEmpty.hidden = true;
  feedbackResult.hidden = false;
  feedbackResult.innerHTML = `
    <article class="feedback-block">
      <h3 class="error-text">エラー</h3>
      <p>${escapeHtml(message)}</p>
    </article>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
