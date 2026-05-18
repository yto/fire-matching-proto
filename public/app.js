const LS_UUID = "fmp_uuid";
const LS_NAME = "fmp_username";

const state = {
  qs: [],
  answers: [],
  uuid: null,
  username: null,
};

const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  els.identityCard = document.getElementById("identity-card");
  els.identityName = document.getElementById("identity-name");
  els.openViewFromCard = document.getElementById("open-view-from-card");
  els.questions = document.getElementById("questions");
  els.submitBtn = document.getElementById("submit-btn");
  els.submitHint = document.getElementById("submit-hint");
  els.postDialog = document.getElementById("post-dialog");
  els.usernameInput = document.getElementById("username-input");
  els.postSubmit = document.getElementById("post-submit");
  els.postCancel = document.getElementById("post-cancel");
  els.viewDialog = document.getElementById("view-dialog");
  els.viewTableWrap = document.getElementById("view-table-wrap");
  els.viewClose = document.getElementById("view-close");

  state.uuid = localStorage.getItem(LS_UUID);
  state.username = localStorage.getItem(LS_NAME);

  const res = await fetch("/questions.json");
  const data = await res.json();
  state.qs = data.questions;
  state.answers = Array(state.qs.length).fill(null);

  if (state.uuid) {
    await loadPrevAnswers();
  }

  renderQuestions();
  updateSubmitBtnState();
  renderIdentityCard();

  els.openViewFromCard.addEventListener("click", openViewDialog);
  els.submitBtn.addEventListener("click", () => {
    if (isAllAnswered()) openPostDialog();
  });
  els.postCancel.addEventListener("click", () => els.postDialog.close());
  els.postSubmit.addEventListener("click", submitPost);
  els.usernameInput.addEventListener("input", updatePostSubmitState);
  els.viewClose.addEventListener("click", () => els.viewDialog.close());
}

async function loadPrevAnswers() {
  try {
    const r = await fetch("/api/answers");
    const d = await r.json();
    const me = (d.rows || []).find((row) => row.uuid === state.uuid);
    if (me && Array.isArray(me.answers)) {
      const n = state.qs.length;
      for (let i = 0; i < n; i++) {
        if (me.answers[i] === "Yes" || me.answers[i] === "No") {
          state.answers[i] = me.answers[i];
        }
      }
    }
  } catch (_) {
    // 取得失敗時は無視（初期状態のまま）
  }
}

function renderQuestions() {
  els.questions.innerHTML = "";
  state.qs.forEach((q, i) => {
    const card = document.createElement("div");
    card.className = "card";
    card.dataset.idx = String(i);
    card.innerHTML = `
      <div class="qnum">Q${q.number}</div>
      <div class="q"></div>
      <div class="btns">
        <button type="button" data-ans="Yes">
          <span class="ans-main"></span>
          <span class="ans-label"></span>
          <span class="ans-desc"></span>
        </button>
        <button type="button" data-ans="No">
          <span class="ans-main"></span>
          <span class="ans-label"></span>
          <span class="ans-desc"></span>
        </button>
      </div>
    `;
    card.querySelector(".q").textContent = q.q;
    const yesBtn = card.querySelector('button[data-ans="Yes"]');
    const noBtn = card.querySelector('button[data-ans="No"]');
    yesBtn.querySelector(".ans-main").textContent = `${q.a1.emoji} Yes`;
    yesBtn.querySelector(".ans-label").textContent = q.a1.label;
    yesBtn.querySelector(".ans-desc").textContent = q.a1.description;
    noBtn.querySelector(".ans-main").textContent = `${q.a2.emoji} No`;
    noBtn.querySelector(".ans-label").textContent = q.a2.label;
    noBtn.querySelector(".ans-desc").textContent = q.a2.description;
    yesBtn.addEventListener("click", () => selectAnswer(i, "Yes"));
    noBtn.addEventListener("click", () => selectAnswer(i, "No"));
    els.questions.appendChild(card);
  });
  refreshSelectedButtons();
}

function refreshSelectedButtons() {
  els.questions.querySelectorAll(".card").forEach((card) => {
    const idx = Number(card.dataset.idx);
    const ans = state.answers[idx];
    card.querySelectorAll(".btns button").forEach((btn) => {
      btn.classList.toggle("selected", btn.dataset.ans === ans);
    });
  });
}

function selectAnswer(idx, ans) {
  state.answers[idx] = ans;
  refreshSelectedButtons();
  updateSubmitBtnState();
}

function updateSubmitBtnState() {
  const ok = isAllAnswered();
  els.submitBtn.disabled = !ok;
  els.submitHint.textContent = ok ? "" : "全ての質問に回答してください";
}

function isAllAnswered() {
  return state.answers.length > 0 && state.answers.every((a) => a === "Yes" || a === "No");
}

function renderIdentityCard() {
  if (state.uuid && state.username) {
    els.identityName.textContent = state.username;
    els.identityCard.hidden = false;
  } else {
    els.identityCard.hidden = true;
  }
}

function openPostDialog() {
  els.usernameInput.value = state.username || randomUsername();
  updatePostSubmitState();
  els.postDialog.showModal();
}

function updatePostSubmitState() {
  const name = els.usernameInput.value.trim();
  els.postSubmit.disabled = !(isAllAnswered() && name.length > 0);
}

function randomUsername() {
  const head = String(1 + Math.floor(Math.random() * 9));
  let rest = "";
  for (let i = 0; i < 7; i++) rest += Math.floor(Math.random() * 10);
  return head + rest;
}

async function submitPost() {
  if (!isAllAnswered()) return;
  const name = els.usernameInput.value.trim() || randomUsername();
  const uuid = state.uuid || crypto.randomUUID();

  const res = await fetch("/api/answers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ uuid, username: name, answers: state.answers }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert(`投稿に失敗しました: ${err.error || res.status}`);
    return;
  }

  state.uuid = uuid;
  state.username = name;
  localStorage.setItem(LS_UUID, uuid);
  localStorage.setItem(LS_NAME, name);
  renderIdentityCard();

  els.postDialog.close();
  await openViewDialog();
}

async function openViewDialog() {
  const res = await fetch("/api/answers");
  const data = await res.json();
  const rows = data.rows || [];

  const me = rows.find((r) => r.uuid === state.uuid) || {
    uuid: state.uuid,
    username: state.username,
    answers: state.answers,
  };
  const others = rows
    .filter((r) => r.uuid !== state.uuid)
    .map((r) => ({
      ...r,
      matchCount: countMatches(me.answers, r.answers),
    }))
    .sort((a, b) => b.matchCount - a.matchCount);

  renderViewTable(me, others);
  els.viewDialog.showModal();
}

function countMatches(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return 0;
  const n = Math.min(a.length, b.length);
  let c = 0;
  for (let i = 0; i < n; i++) if (a[i] === b[i]) c++;
  return c;
}

function renderViewTable(me, others) {
  const n = state.qs.length;
  const headers = ["名前"];
  for (let i = 1; i <= n; i++) headers.push(`A${i}`);

  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const trh = document.createElement("tr");
  headers.forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h;
    trh.appendChild(th);
  });
  thead.appendChild(trh);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  tbody.appendChild(buildRow(me, { isMe: true, me }));
  others.forEach((r) => tbody.appendChild(buildRow(r, { isMe: false, me })));
  table.appendChild(tbody);

  els.viewTableWrap.innerHTML = "";
  els.viewTableWrap.appendChild(table);
}

function buildRow(row, { isMe, me }) {
  const tr = document.createElement("tr");
  if (isMe) tr.className = "me";
  const nameTd = document.createElement("td");
  nameTd.textContent = isMe ? row.username : `${row.username} (${row.matchCount})`;
  tr.appendChild(nameTd);
  state.qs.forEach((q, i) => {
    const td = document.createElement("td");
    const a = row.answers ? row.answers[i] : null;
    if (a === "Yes") td.textContent = `${q.a1.emoji}Yes`;
    else if (a === "No") td.textContent = `${q.a2.emoji}No`;
    else td.textContent = "-";
    if (!isMe && me && me.answers && a != null && a === me.answers[i]) {
      td.classList.add("match");
    }
    tr.appendChild(td);
  });
  return tr;
}
