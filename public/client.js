(function () {
  "use strict";

  const socket = io();
  const COLORS = ["#ffca28", "#29b6f6", "#ef5350", "#ab47bc", "#66bb6a", "#ff7043"];
  const colorBySocket = new Map();
  function colorFor(socketId) {
    if (!colorBySocket.has(socketId)) colorBySocket.set(socketId, COLORS[colorBySocket.size % COLORS.length]);
    return colorBySocket.get(socketId);
  }

  // ---- screens ----
  const screens = {
    lobby: document.getElementById("screen-lobby"),
    waiting: document.getElementById("screen-waiting"),
    game: document.getElementById("screen-game"),
    over: document.getElementById("screen-over"),
  };
  function showScreen(name) {
    for (const key of Object.keys(screens)) screens[key].classList.toggle("hidden", key !== name);
  }

  function showError(el, message) {
    el.textContent = message;
    if (message) setTimeout(() => { if (el.textContent === message) el.textContent = ""; }, 4000);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // Heart glyph, standardized to match the other QMoji games' lives icon.
  function shieldRow(lives, total, small) {
    let html = "";
    for (let i = 0; i < total; i++) {
      const broken = i >= lives;
      html += `<span class="${small ? "sb-shields" : "shield-icon"}${broken ? " broken" : ""}">${broken ? "💔" : "❤️"}</span>`;
    }
    return html;
  }

  // ---- sound mute toggle ----
  const muteBtn = document.getElementById("muteBtn");
  muteBtn.addEventListener("click", () => {
    const next = !window.SFX.isMuted();
    window.SFX.setMuted(next);
    muteBtn.textContent = next ? "🔇" : "🔊";
    muteBtn.classList.toggle("muted", next);
  });

  // ---- lobby screen ----
  const usernameInput = document.getElementById("username");
  const roomCodeInput = document.getElementById("roomCode");
  const lobbyError = document.getElementById("lobbyError");

  function getUsername() {
    const name = usernameInput.value.trim();
    if (!name) showError(lobbyError, "Enter a username first.");
    return name;
  }

  document.getElementById("createRoomBtn").addEventListener("click", () => {
    const username = getUsername();
    if (!username) return;
    socket.emit("create_room", { username });
  });

  document.getElementById("joinRoomBtn").addEventListener("click", () => {
    const username = getUsername();
    if (!username) return;
    const code = roomCodeInput.value.trim().toUpperCase();
    if (!code) return showError(lobbyError, "Enter a room code.");
    socket.emit("join_room", { username, code });
  });

  // ---- waiting room ----
  const waitingCode = document.getElementById("waitingCode");
  const waitingPlayers = document.getElementById("waitingPlayers");
  const waitingHint = document.getElementById("waitingHint");
  const startGameBtn = document.getElementById("startGameBtn");

  startGameBtn.addEventListener("click", () => socket.emit("start_game"));

  socket.on("lobby_state", (payload) => {
    if (payload.status !== "lobby") return;
    showScreen("waiting");
    waitingCode.textContent = payload.code;
    waitingPlayers.innerHTML = "";
    let amHost = false;
    for (const p of payload.players) {
      if (p.socketId === socket.id && p.isHost) amHost = true;
      const li = document.createElement("li");
      li.innerHTML = `<span><span class="swatch" style="background:${colorFor(p.socketId)}"></span>${escapeHtml(p.username)}${p.isHost ? " (host)" : ""}</span>`;
      waitingPlayers.appendChild(li);
    }
    startGameBtn.classList.toggle("hidden", !amHost);
    waitingHint.textContent = amHost ? "" : "Waiting for the host to start the game...";
  });

  socket.on("error_message", ({ message }) => {
    const visible = Object.keys(screens).find((k) => !screens[k].classList.contains("hidden"));
    if (visible === "lobby") showError(lobbyError, message);
    else if (visible === "waiting") showError(waitingHint, message);
    else console.warn(message);
  });

  // ---- game screen ----
  const boardEl = document.getElementById("board");
  const keywordEl = document.getElementById("keywordName");
  const roundNumEl = document.getElementById("roundNum");
  const roundTotalEl = document.getElementById("roundTotal");
  const timerFillEl = document.getElementById("timerFill");
  const myScoreValEl = document.getElementById("myScoreVal");
  const myLivesEl = document.getElementById("myLives");
  const scoreboardListEl = document.getElementById("scoreboardList");

  let cellSize = 58;
  let cols = 7, rows = 6;
  let startingLives = 3;
  let cellEls = new Map(); // "col,row" -> el
  let muncherEls = new Map(); // socketId -> el
  let myPrev = null; // { score, lives, eaten: Set }
  const animatingKeys = new Set();
  let lastPlayers = [];

  // Keeps the board from ever overflowing a narrow (mobile) viewport --
  // shrinks the cell size to fit rather than letting the grid's fixed pixel
  // width run off the edge of the screen.
  function computeCellSize(colsArg) {
    const available = Math.min(window.innerWidth - 24, 480);
    const raw = Math.floor(available / colsArg);
    return Math.max(30, Math.min(58, raw));
  }

  function applyCellSize(size) {
    cellSize = size;
    document.documentElement.style.setProperty("--cell", cellSize + "px");
    boardEl.style.width = (cellSize * cols) + "px";
    boardEl.style.height = (cellSize * rows) + "px";
  }

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (screens.game.classList.contains("hidden") || cellEls.size === 0) return;
      const newSize = computeCellSize(cols);
      if (newSize === cellSize) return;
      applyCellSize(newSize);
      for (const [key, el] of cellEls) {
        const [col, row] = key.split(",").map(Number);
        el.style.left = (col * cellSize) + "px";
        el.style.top = (row * cellSize) + "px";
      }
      renderMunchers(lastPlayers);
    }, 150);
  });

  // ---- go home (available in-game and post-game; deliberately absent from
  // the waiting-room screen so players can't slip out of an active lobby) ----
  function goHome() {
    socket.emit("leave_room");
    colorBySocket.clear();
    cellEls.clear();
    muncherEls.clear();
    animatingKeys.clear();
    myPrev = null;
    roomCodeInput.value = "";
    showScreen("lobby");
  }
  document.getElementById("homeBtnGame").addEventListener("click", goHome);
  document.getElementById("homeBtnOver").addEventListener("click", goHome);

  function renderGrid(payload) {
    cols = payload.cols; rows = payload.rows;
    startingLives = payload.startingLives || startingLives;
    applyCellSize(computeCellSize(cols));
    boardEl.innerHTML = "";
    cellEls.clear();
    muncherEls.clear();
    animatingKeys.clear();
    myPrev = null;
    for (const cell of payload.grid) {
      const el = document.createElement("div");
      el.className = "cell";
      el.textContent = cell.symbol;
      el.style.left = (cell.col * cellSize) + "px";
      el.style.top = (cell.row * cellSize) + "px";
      boardEl.appendChild(el);
      cellEls.set(`${cell.col},${cell.row}`, el);
    }
    if (payload.destination) {
      const destEl = cellEls.get(`${payload.destination.col},${payload.destination.row}`);
      if (destEl) destEl.classList.add("destination");
    }
  }

  function startTimer(timeLimitMs) {
    timerFillEl.style.transition = "none";
    timerFillEl.style.width = "100%";
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        timerFillEl.style.transition = `width ${timeLimitMs}ms linear`;
        timerFillEl.style.width = "0%";
      });
    });
  }

  function renderMunchers(players) {
    const seen = new Set();
    for (const p of players) {
      seen.add(p.socketId);
      let el = muncherEls.get(p.socketId);
      if (!el) {
        el = document.createElement("div");
        el.className = "muncher";
        boardEl.appendChild(el);
        muncherEls.set(p.socketId, el);
      }
      el.style.background = colorFor(p.socketId);
      el.style.left = (p.muncherCol * cellSize) + "px";
      el.style.top = (p.muncherRow * cellSize) + "px";
      el.style.opacity = p.eliminated ? "0.35" : "1";
      el.textContent = (p.username || "?").slice(0, 1).toUpperCase();
    }
    for (const [socketId, el] of muncherEls) {
      if (!seen.has(socketId)) { el.remove(); muncherEls.delete(socketId); }
    }
  }

  // Sends the eaten emoji flying from its cell over to the lives chip and
  // cracks the shield it "hits", instead of the cell just quietly vanishing.
  function flyToShield(cellEl, shieldEl) {
    if (!shieldEl || !cellEl) return;
    const from = cellEl.getBoundingClientRect();
    const to = shieldEl.getBoundingClientRect();
    const clone = document.createElement("div");
    clone.className = "flying-emoji";
    clone.textContent = cellEl.textContent;
    clone.style.left = (from.left + from.width / 2) + "px";
    clone.style.top = (from.top + from.height / 2) + "px";
    document.body.appendChild(clone);
    const anim = clone.animate(
      [
        { left: clone.style.left, top: clone.style.top, transform: "translate(-50%,-50%) scale(1)", opacity: 1 },
        { left: (to.left + to.width / 2) + "px", top: (to.top + to.height / 2) + "px", transform: "translate(-50%,-50%) scale(0.4)", opacity: 0.6 },
      ],
      { duration: 300, easing: "ease-in" }
    );
    anim.onfinish = () => {
      clone.remove();
      shieldEl.classList.add("just-broke");
      window.SFX.wrong();
      setTimeout(() => shieldEl.classList.remove("just-broke"), 400);
    };
  }

  function renderMyShields(lives) {
    myLivesEl.innerHTML = `<span class="shields">${shieldRow(lives, startingLives, false)}</span>`;
  }

  // Diffs my own state against the previous update to trigger the right
  // per-cell animation + sound (correct pop, or wrong-shake + fly-to-shield),
  // then reconciles every cell's hidden/visible state with the server truth.
  function syncMyBoard(players) {
    const me = players.find((p) => p.socketId === socket.id);
    if (!me) return;
    const eatenSet = new Set(me.eatenCells);
    myScoreValEl.textContent = me.score;

    let shieldsRendered = false;
    if (myPrev) {
      const newKeys = [...eatenSet].filter((k) => !myPrev.eaten.has(k));
      const correct = me.score > myPrev.score;
      const livesLost = myPrev.lives > me.lives;

      if (livesLost) { renderMyShields(me.lives); shieldsRendered = true; }

      for (const key of newKeys) {
        const cellEl = cellEls.get(key);
        if (!cellEl) continue;
        animatingKeys.add(key);
        if (correct) {
          cellEl.classList.add("correct-flash");
          window.SFX.correct();
          setTimeout(() => { cellEl.classList.add("eaten-mine"); animatingKeys.delete(key); }, 260);
        } else if (livesLost) {
          cellEl.classList.add("wrong-flash");
          const shieldEl = myLivesEl.querySelectorAll(".shield-icon")[me.lives];
          flyToShield(cellEl, shieldEl);
          setTimeout(() => { cellEl.classList.add("eaten-mine"); animatingKeys.delete(key); }, 340);
        } else {
          cellEl.classList.add("eaten-mine");
          animatingKeys.delete(key);
        }
      }
    }

    if (!shieldsRendered) renderMyShields(me.lives);

    for (const [key, el] of cellEls) {
      if (animatingKeys.has(key)) continue;
      el.classList.toggle("eaten-mine", eatenSet.has(key));
    }

    myPrev = { score: me.score, lives: me.lives, eaten: eatenSet };
  }

  function renderScoreboard(players) {
    const sorted = [...players].sort((a, b) => b.score - a.score);
    scoreboardListEl.innerHTML = "";
    for (const p of sorted) {
      const li = document.createElement("li");
      if (p.eliminated) li.classList.add("eliminated");
      li.innerHTML = `
        <span class="name"><span class="dot" style="background:${colorFor(p.socketId)}"></span>${escapeHtml(p.username)}${p.socketId === socket.id ? " (you)" : ""}</span>
        <span>💯 ${p.score}${p.eliminated ? "" : " &nbsp; " + shieldRow(p.lives, startingLives, true)}</span>`;
      scoreboardListEl.appendChild(li);
    }
  }

  socket.on("round_start", (payload) => {
    showScreen("game");
    roundNumEl.textContent = payload.round;
    roundTotalEl.textContent = payload.totalRounds;
    keywordEl.textContent = payload.keyword;
    renderGrid(payload);
    lastPlayers = payload.players;
    renderMunchers(payload.players);
    syncMyBoard(payload.players);
    renderScoreboard(payload.players);
    startTimer(payload.timeLimitMs);
    window.SFX.roundStart();
  });

  socket.on("state_update", (payload) => {
    lastPlayers = payload.players;
    renderMunchers(payload.players);
    syncMyBoard(payload.players);
    renderScoreboard(payload.players);
  });

  socket.on("round_end", (payload) => {
    renderScoreboard(payload.players);
  });

  const DIR_KEYS = {
    ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
    w: "up", s: "down", a: "left", d: "right",
    W: "up", S: "down", A: "left", D: "right",
  };
  window.addEventListener("keydown", (e) => {
    const dir = DIR_KEYS[e.key];
    if (!dir) return;
    if (screens.game.classList.contains("hidden")) return;
    e.preventDefault();
    socket.emit("move", { dir });
  });
  document.getElementById("touchpad").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-dir]");
    if (!btn) return;
    socket.emit("move", { dir: btn.dataset.dir });
  });

  // ---- game over screen ----
  const finalScoreboardEl = document.getElementById("finalScoreboard");
  const leaderboardListEl = document.getElementById("leaderboardList");
  const playAgainBtn = document.getElementById("playAgainBtn");
  const overHint = document.getElementById("overHint");

  playAgainBtn.addEventListener("click", () => socket.emit("restart_game"));

  socket.on("game_over", (payload) => {
    showScreen("over");
    window.SFX.gameOver();
    const sorted = [...payload.players].sort((a, b) => b.score - a.score);
    finalScoreboardEl.innerHTML = "";
    sorted.forEach((p, i) => {
      const li = document.createElement("li");
      li.innerHTML = `<span><span class="swatch" style="background:${colorFor(p.socketId)}"></span>#${i + 1} ${escapeHtml(p.username)}${p.socketId === socket.id ? " (you)" : ""}</span><span>💯 ${p.score}</span>`;
      finalScoreboardEl.appendChild(li);
    });
    leaderboardListEl.innerHTML = "";
    for (const entry of payload.leaderboard) {
      const li = document.createElement("li");
      li.innerHTML = `<span>${escapeHtml(entry.username)}</span><span>best 💯 ${entry.bestScore} · ${entry.gamesPlayed} games</span>`;
      leaderboardListEl.appendChild(li);
    }
    const me = payload.players.find((p) => p.socketId === socket.id);
    playAgainBtn.classList.toggle("hidden", !(me && me.isHost));
    overHint.textContent = me && me.isHost ? "" : "Waiting for the host to start a new game...";
  });
})();
