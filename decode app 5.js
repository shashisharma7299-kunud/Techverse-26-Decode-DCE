let playerId = localStorage.getItem("decode-dce-player-id") || "";
let adminPassword = sessionStorage.getItem("decode-dce-admin-password") || "";
let adminData = null;
let selectedAdminPlayerId = "";
let currentPlayerData = null;
let timerInterval = null;
let adminRefreshInterval = null;

const views = [...document.querySelectorAll(".view")];
const els = {
  gameStateLabel: document.querySelector("#gameStateLabel"),
  playerForm: document.querySelector("#playerForm"),
  leaderName: document.querySelector("#leaderName"),
  teamName: document.querySelector("#teamName"),
  registrationNo: document.querySelector("#registrationNo"),
  scoreLabel: document.querySelector("#scoreLabel"),
  timerLabel: document.querySelector("#timerLabel"),
  questionCountLabel: document.querySelector("#questionCountLabel"),
  questionJump: document.querySelector("#questionJump"),
  attemptLabel: document.querySelector("#attemptLabel"),
  questionTitle: document.querySelector("#questionTitle"),
  questionText: document.querySelector("#questionText"),
  answerForm: document.querySelector("#answerForm"),
  answerInput: document.querySelector("#answerInput"),
  answerMessage: document.querySelector("#answerMessage"),
  scoreSummary: document.querySelector("#scoreSummary"),
  feedbackForm: document.querySelector("#feedbackForm"),
  feedbackText: document.querySelector("#feedbackText"),
  adminLoginForm: document.querySelector("#adminLoginForm"),
  adminCreateLabel: document.querySelector("#adminCreateLabel"),
  newAdminPassword: document.querySelector("#newAdminPassword"),
  adminPassword: document.querySelector("#adminPassword"),
  adminDashboard: document.querySelector("#adminDashboard"),
  settingsForm: document.querySelector("#settingsForm"),
  gameMinutes: document.querySelector("#gameMinutes"),
  toggleGameBtn: document.querySelector("#toggleGameBtn"),
  participantCount: document.querySelector("#participantCount"),
  adminQuestionCount: document.querySelector("#adminQuestionCount"),
  adminStatus: document.querySelector("#adminStatus"),
  participantsBody: document.querySelector("#participantsBody"),
  adminScorecard: document.querySelector("#adminScorecard"),
  leaderboardBody: document.querySelector("#leaderboardBody"),
  questionEditor: document.querySelector("#questionEditor")
};

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;

  const action = button.dataset.action;
  const playerRow = button.closest("[data-player-id]");
  const rowPlayerId = playerRow?.dataset.playerId || "";

  const actions = {
    home: () => showView("homeView"),
    start: () => showView("loginView"),
    beginGame,
    skipQuestion: nextQuestion,
    admin: openAdmin,
    adminLogout,
    toggleGame,
    clearPlayers,
    addQuestion: addQuestionEditor,
    saveQuestions,
    viewPlayer: () => viewPlayer(rowPlayerId),
    savePlayerTime: () => savePlayerTime(rowPlayerId),
    endPlayer: () => playerAction(rowPlayerId, "end"),
    restartPlayer: () => playerAction(rowPlayerId, "restart")
  };

  await actions[action]?.();
});

els.playerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const result = await api("/api/player/login", {
      leaderName: els.leaderName.value,
      teamName: els.teamName.value,
      registrationNo: els.registrationNo.value
    });
    playerId = result.playerId;
    localStorage.setItem("decode-dce-player-id", playerId);
    updateGameStateLabel(result.settings);
    showView("rulesView");
  } catch (error) {
    alert(error.message);
  }
});

els.answerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!playerId) return;
  try {
    const result = await api(`/api/player/${playerId}/answer`, { answer: els.answerInput.value });
    renderPlayer(result, result.message);
  } catch (error) {
    els.answerMessage.textContent = error.message;
  }
});

els.feedbackForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (playerId) {
    await api(`/api/player/${playerId}/feedback`, { feedback: els.feedbackText.value });
  }
  showView("thanksView");
});

els.adminLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const password = els.adminPassword.value || els.newAdminPassword.value;
    adminData = await api("/api/admin/login", {
      password,
      newPassword: els.newAdminPassword.value
    });
    adminPassword = password;
    sessionStorage.setItem("decode-dce-admin-password", adminPassword);
    els.adminDashboard.classList.remove("is-hidden");
    renderAdmin(adminData);
    startAdminRefresh();
  } catch (error) {
    alert(error.message);
  }
});

els.settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const resetAllTimers = confirm("Apply this time to all currently playing participants?");
  adminData = await adminApi("/api/admin/settings", {
    gameMinutes: Number(els.gameMinutes.value),
    resetAllTimers
  });
  renderAdmin(adminData);
});

async function api(url, body) {
  const options = body === undefined
    ? {}
    : {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    };
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function adminApi(url, body = {}) {
  return api(url, { ...body, password: adminPassword });
}

function showView(id) {
  views.forEach((view) => view.classList.toggle("is-active", view.id === id));
  if (id !== "gameView") stopTimer();
  if (id !== "adminView") stopAdminRefresh();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function beginGame() {
  if (!playerId) {
    showView("loginView");
    return;
  }
  try {
    const data = await api(`/api/player/${playerId}/begin`, {});
    renderPlayer(data);
    showView("gameView");
    startTimer();
  } catch (error) {
    alert(error.message);
    showView("loginView");
  }
}

async function nextQuestion() {
  if (!currentPlayerData?.currentQuestion.closed) {
    els.answerMessage.textContent = "Finish this question first: correct answer or all 3 attempts.";
    return;
  }
  const data = await api(`/api/player/${playerId}`);
  renderPlayer(data);
}

function renderPlayer(data, message = "") {
  currentPlayerData = data;
  updateGameStateLabel(data.settings);

  if (data.player.status !== "Playing") {
    renderScorecard(data.player);
    showView("scoreView");
    return;
  }

  const question = data.currentQuestion;
  els.scoreLabel.textContent = data.player.score;
  els.questionCountLabel.textContent = `${question.number}/${data.settings.questionCount}`;
  els.attemptLabel.textContent = question.closed
    ? question.solved ? "Solved" : "No attempts left"
    : `${question.attemptsLeft} attempts left`;
  els.questionTitle.textContent = `Q${question.number}.`;
  els.questionText.textContent = question.text;
  els.answerInput.value = "";
  els.answerInput.disabled = question.closed;
  els.answerForm.querySelector(".primary-btn").disabled = question.closed;
  document.querySelector('[data-action="skipQuestion"]').disabled = !question.closed;
  els.answerMessage.textContent = message || (question.closed ? "Question finished. Next unlocked." : "");

  els.questionJump.innerHTML = data.questionStatuses.map((item) => `
    <button type="button" disabled class="${item.current ? "is-current" : ""} ${item.solved ? "is-solved" : ""} ${item.closed && !item.solved ? "is-locked" : ""} ${item.locked ? "is-future" : ""}">
      ${item.number}
    </button>
  `).join("");
}

function renderScorecard(player) {
  els.scoreSummary.innerHTML = `
    <div><strong>${escapeHtml(player.teamName)}</strong><span>Team Name</span></div>
    <div><strong>${escapeHtml(player.leaderName)}</strong><span>Leader</span></div>
    <div><strong>${player.score}</strong><span>Final Score</span></div>
  `;
}

function startTimer() {
  stopTimer();
  tickTimer();
  timerInterval = setInterval(async () => {
    tickTimer();
    if (currentPlayerData && currentPlayerData.player.remainingMs <= 0) {
      const data = await api(`/api/player/${playerId}`);
      renderPlayer(data);
    }
  }, 1000);
}

function stopTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
}

function tickTimer() {
  if (!currentPlayerData) return;
  currentPlayerData.player.remainingMs = Math.max(0, currentPlayerData.player.remainingMs - 1000);
  els.timerLabel.textContent = formatMs(currentPlayerData.player.remainingMs);
}

async function openAdmin() {
  showView("adminView");
  if (!adminPassword) return;
  try {
    adminData = await adminApi("/api/admin/dashboard");
    els.adminDashboard.classList.remove("is-hidden");
    renderAdmin(adminData);
    startAdminRefresh();
  } catch {
    adminLogout();
  }
}

function renderAdmin(data) {
  adminData = data;
  updateGameStateLabel(data.settings);
  els.adminCreateLabel.classList.toggle("is-hidden", data.hasAdminPassword);
  els.gameMinutes.value = data.settings.gameMinutes;
  els.toggleGameBtn.textContent = data.settings.gameActive ? "End Event" : "Start Event";
  els.participantCount.textContent = data.players.length;
  els.adminQuestionCount.textContent = data.questions.length;
  els.adminStatus.textContent = data.settings.gameActive ? "Active" : "Ended";

  els.participantsBody.innerHTML = data.players.length
    ? data.players.map((player) => `
      <tr>
        <td><strong>${escapeHtml(player.teamName)}</strong><span class="table-subtext">${escapeHtml(player.leaderName)}</span></td>
        <td>${escapeHtml(player.registrationNo)}</td>
        <td>${player.progress}/${data.settings.questionCount}</td>
        <td>${player.score}</td>
        <td>
          <label class="inline-field">
            <span>Minutes</span>
            <input type="number" min="1" max="600" value="${player.timeLimitMinutes}" data-player-time="${player.id}">
          </label>
          <span class="table-subtext">${formatMs(player.remainingMs)} left</span>
        </td>
        <td>${escapeHtml(player.status)}</td>
        <td>
          <div class="row-actions" data-player-id="${player.id}">
            <button class="ghost-btn small-btn" data-action="viewPlayer" type="button">Scorecard</button>
            <button class="primary-btn small-btn" data-action="savePlayerTime" type="button">Set Time</button>
            <button class="danger-btn small-btn" data-action="endPlayer" type="button">End</button>
            <button class="ghost-btn small-btn" data-action="restartPlayer" type="button">Restart</button>
          </div>
        </td>
      </tr>
    `).join("")
    : `<tr><td colspan="7">No participants yet.</td></tr>`;

  els.leaderboardBody.innerHTML = data.leaderboard.length
    ? data.leaderboard.map((player) => `
      <tr>
        <td>${player.rank}</td>
        <td>${escapeHtml(player.teamName)}</td>
        <td>${escapeHtml(player.leaderName)}</td>
        <td>${player.progress}/${data.settings.questionCount}</td>
        <td>${player.score}</td>
        <td>${formatMs(player.remainingMs)}</td>
        <td>${escapeHtml(player.feedback || "No feedback")}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="7">No participants yet.</td></tr>`;

  renderQuestionEditor(data.questions);
  if (selectedAdminPlayerId) viewPlayer(selectedAdminPlayerId, false);
}

async function toggleGame() {
  adminData = await adminApi("/api/admin/event", { gameActive: !adminData.settings.gameActive });
  renderAdmin(adminData);
}

async function savePlayerTime(rowPlayerId) {
  const input = document.querySelector(`[data-player-time="${rowPlayerId}"]`);
  adminData = await adminApi(`/api/admin/players/${rowPlayerId}/time`, { minutes: Number(input.value) });
  renderAdmin(adminData);
}

async function playerAction(rowPlayerId, action) {
  adminData = await adminApi(`/api/admin/players/${rowPlayerId}/${action}`);
  renderAdmin(adminData);
}

async function viewPlayer(rowPlayerId, keepSelection = true) {
  if (keepSelection) selectedAdminPlayerId = rowPlayerId;
  const scorecard = await adminApi(`/api/admin/players/${rowPlayerId}/scorecard`);
  els.adminScorecard.innerHTML = `
    <div class="scorecard-head">
      <p class="eyebrow">Student Scorecard</p>
      <h3>${escapeHtml(scorecard.teamName)} - ${escapeHtml(scorecard.leaderName)}</h3>
      <div class="mini-stats">
        <span>Score: <strong>${scorecard.score}</strong></span>
        <span>Solved: <strong>${scorecard.progress}/${adminData.settings.questionCount}</strong></span>
        <span>Attempts: <strong>${scorecard.attempts}</strong></span>
        <span>Status: <strong>${escapeHtml(scorecard.status)}</strong></span>
      </div>
    </div>
    <div class="table-wrap">
      <table class="question-score-table">
        <thead><tr><th>Q</th><th>Status</th><th>Attempts</th><th>Last Answer</th></tr></thead>
        <tbody>
          ${scorecard.questions.map((question) => `
            <tr>
              <td>Q${question.number}</td>
              <td>${escapeHtml(question.status)}</td>
              <td>${question.attempts}/3</td>
              <td>${escapeHtml(question.lastAnswer || "-")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

async function clearPlayers() {
  if (!confirm("Clear all participants and scorecards?")) return;
  selectedAdminPlayerId = "";
  els.adminScorecard.innerHTML = "";
  adminData = await adminApi("/api/admin/clear-players");
  renderAdmin(adminData);
}

function renderQuestionEditor(questions = adminData?.questions || []) {
  els.questionEditor.innerHTML = questions.map((question, index) => `
    <div class="question-edit">
      <label><span>No.</span><input value="${index + 1}" disabled></label>
      <label><span>Question</span><textarea rows="2" data-question-text="${index}">${escapeHtml(question.text)}</textarea></label>
      <label><span>Answer</span><input data-question-answer="${index}" value="${escapeAttribute(question.answer)}"></label>
      <button class="icon-btn" type="button" title="Delete question" data-delete-question="${index}">&times;</button>
    </div>
  `).join("");

  els.questionEditor.querySelectorAll("[data-delete-question]").forEach((button) => {
    button.addEventListener("click", () => {
      adminData.questions.splice(Number(button.dataset.deleteQuestion), 1);
      renderQuestionEditor(adminData.questions);
    });
  });
}

function addQuestionEditor() {
  adminData.questions.push({ text: "New question", answer: "answer" });
  renderQuestionEditor(adminData.questions);
}

async function saveQuestions() {
  const questions = adminData.questions.map((question, index) => ({
    text: document.querySelector(`[data-question-text="${index}"]`)?.value.trim() || question.text,
    answer: document.querySelector(`[data-question-answer="${index}"]`)?.value.trim() || question.answer
  }));
  adminData = await adminApi("/api/admin/questions", { questions });
  renderAdmin(adminData);
  alert("Questions saved.");
}

function adminLogout() {
  adminPassword = "";
  sessionStorage.removeItem("decode-dce-admin-password");
  els.adminPassword.value = "";
  els.newAdminPassword.value = "";
  els.adminDashboard.classList.add("is-hidden");
  stopAdminRefresh();
}

function startAdminRefresh() {
  stopAdminRefresh();
  adminRefreshInterval = setInterval(async () => {
    if (!adminPassword || !document.querySelector("#adminView").classList.contains("is-active")) return;
    try {
      adminData = await adminApi("/api/admin/dashboard");
      renderAdmin(adminData);
    } catch {
      stopAdminRefresh();
    }
  }, 5000);
}

function stopAdminRefresh() {
  if (adminRefreshInterval) clearInterval(adminRefreshInterval);
  adminRefreshInterval = null;
}

function updateGameStateLabel(settings) {
  if (!settings) return;
  els.gameStateLabel.textContent = settings.gameActive ? "Event active" : "Event ended";
}

function formatMs(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

function drawSignalCanvas() {
  const canvas = document.querySelector("#signalCanvas");
  const ctx = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;

  function resize() {
    canvas.width = window.innerWidth * ratio;
    canvas.height = window.innerHeight * ratio;
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function draw() {
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    ctx.strokeStyle = "rgba(91, 245, 176, 0.16)";
    ctx.lineWidth = 1;
    for (let x = 0; x < window.innerWidth; x += 42) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, window.innerHeight);
      ctx.stroke();
    }
    for (let y = 0; y < window.innerHeight; y += 42) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(window.innerWidth, y);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(255, 209, 102, 0.22)";
    for (let i = 0; i < 70; i += 1) {
      const x = (i * 97 + Date.now() * 0.012) % window.innerWidth;
      const y = (i * 53) % window.innerHeight;
      ctx.fillRect(x, y, 3, 3);
    }
    requestAnimationFrame(draw);
  }

  resize();
  window.addEventListener("resize", resize);
  draw();
}

api("/api/state").then(updateGameStateLabel).catch(() => {
  els.gameStateLabel.textContent = "Start server.py first";
});
drawSignalCanvas();
