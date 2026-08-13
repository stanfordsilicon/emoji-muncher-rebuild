(function () {
  "use strict";

  // No more persistent Socket.IO connection -- every action is a plain HTTP
  // request, and room updates arrive via polling instead of a push
  // broadcast. See server/app.js's top comment for why (Vercel serverless
  // has no long-lived process to hold a WebSocket open, and no shared
  // memory between invocations to broadcast from anyway).

  // Player identity is a persistent id kept in sessionStorage (not a
  // connection id) -- a page refresh gets a brand new HTTP session but
  // keeps the same device id. sessionStorage rather than localStorage is
  // deliberate: localStorage is shared by every tab on the same origin, so
  // two tabs of this game open in one browser would silently collapse into
  // a single player identity. sessionStorage is scoped to one tab.
  function getDeviceId() {
    let id = sessionStorage.getItem("munchers_device_id");
    if (!id) {
      id = window.crypto && window.crypto.randomUUID
        ? window.crypto.randomUUID()
        : `p_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem("munchers_device_id", id);
    }
    return id;
  }
  const myId = getDeviceId();

  let currentRoomCode = null;

  async function api(action, payload) {
    const body = Object.assign({}, payload);
    body.playerId = myId;
    if (currentRoomCode && !body.code) body.code = currentRoomCode;
    try {
      const res = await fetch(`/api/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return await res.json();
    } catch (e) {
      return { ok: false, error: "Connection error — please try again." };
    }
  }

  const COLORS = ["#ffca28", "#29b6f6", "#ef5350", "#ab47bc", "#66bb6a", "#ff7043"];
  const colorByPlayer = new Map();
  function colorFor(playerId) {
    if (!colorByPlayer.has(playerId)) colorByPlayer.set(playerId, COLORS[colorByPlayer.size % COLORS.length]);
    return colorByPlayer.get(playerId);
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

  function enterRoom(view) {
    currentRoomCode = view.code;
    applySnapshotIfFresh(view);
    startPolling();
    startHeartbeat();
  }

  document.getElementById("createRoomBtn").addEventListener("click", async () => {
    const username = getUsername();
    if (!username) return;
    const res = await api("create-room", { username, token: sessionToken });
    if (!res.ok) return showError(lobbyError, res.error);
    enterRoom(res.room);
  });

  document.getElementById("joinRoomBtn").addEventListener("click", async () => {
    const username = getUsername();
    if (!username) return;
    const code = roomCodeInput.value.trim().toUpperCase();
    if (!code) return showError(lobbyError, "Enter a room code.");
    const res = await api("join-room", { username, code, token: sessionToken });
    if (!res.ok) return showError(lobbyError, res.error);
    enterRoom(res.room);
  });

  // Skips the waiting-room/share-code step entirely -- a private room,
  // started immediately with just this player. Deliberately never carries
  // an arcade room code even when one is present: choosing solo means
  // opting out of the shared party for this game, not joining it solo.
  document.getElementById("playSoloBtn").addEventListener("click", async () => {
    const username = getUsername();
    if (!username) return;
    const res = await api("create-room", { username, solo: true, token: sessionToken });
    if (!res.ok) return showError(lobbyError, res.error);
    enterRoom(res.room);
  });

  // ---- accounts: sign in / sign up / My Stats ----
  // Guest play (just typing a username) still works exactly as before --
  // an account is only needed to protect a name and look up personal stats
  // later, never required to play.
  const SESSION_TOKEN_KEY = "emojimunchers_session_token";
  let sessionToken = localStorage.getItem(SESSION_TOKEN_KEY) || null;

  const accountToggleBtn = document.getElementById("accountToggleBtn");
  const authForm = document.getElementById("authForm");
  const authUsernameInput = document.getElementById("authUsername");
  const authPasswordInput = document.getElementById("authPassword");
  const authErrorEl = document.getElementById("authError");
  const accountSignedOut = document.getElementById("accountSignedOut");
  const accountSignedIn = document.getElementById("accountSignedIn");
  const accountWhoami = document.getElementById("accountWhoami");
  const statsModalBackdrop = document.getElementById("statsModalBackdrop");
  const statsList = document.getElementById("statsList");

  accountToggleBtn.addEventListener("click", () => authForm.classList.toggle("hidden"));

  function applySignedIn(name) {
    accountSignedOut.classList.add("hidden");
    accountSignedIn.classList.remove("hidden");
    accountWhoami.textContent = `Signed in as ${name}`;
    // The account becomes the identity used to create/join rooms too, so
    // its stats are the ones actually being played for -- still editable
    // if they'd rather play under a different name (only the account's own
    // name is protected; see the server's ownership guard).
    if (!usernameInput.value.trim()) usernameInput.value = name;
  }

  function applySignedOut() {
    accountSignedOut.classList.remove("hidden");
    accountSignedIn.classList.add("hidden");
  }

  function handleAuthResponse(res) {
    if (!res.ok) { authErrorEl.textContent = res.error; return; }
    authErrorEl.textContent = "";
    sessionToken = res.token;
    localStorage.setItem(SESSION_TOKEN_KEY, res.token);
    authForm.classList.add("hidden");
    applySignedIn(res.username);
  }

  document.getElementById("signUpBtn").addEventListener("click", async () => {
    const res = await api("sign-up", { username: authUsernameInput.value.trim(), password: authPasswordInput.value });
    handleAuthResponse(res);
  });
  document.getElementById("signInBtn").addEventListener("click", async () => {
    const res = await api("sign-in", { username: authUsernameInput.value.trim(), password: authPasswordInput.value });
    handleAuthResponse(res);
  });
  document.getElementById("signOutBtn").addEventListener("click", async () => {
    await api("sign-out", { token: sessionToken });
    sessionToken = null;
    localStorage.removeItem(SESSION_TOKEN_KEY);
    applySignedOut();
  });

  document.getElementById("myStatsBtn").addEventListener("click", async () => {
    const res = await api("get-my-stats", { token: sessionToken });
    if (!res.ok) return;
    const s = res.stats;
    statsList.innerHTML = `
      <li><span>Games played</span><span>${s.gamesPlayed}</span></li>
      <li><span>Best score</span><span>💯 ${s.bestScore}</span></li>
      <li><span>Total score</span><span>💯 ${s.totalScore}</span></li>
      <li><span>Last played</span><span>${s.lastPlayedAt ? new Date(s.lastPlayedAt).toLocaleString() : "—"}</span></li>`;
    statsModalBackdrop.classList.remove("hidden");
  });
  document.getElementById("statsCloseBtn").addEventListener("click", () => statsModalBackdrop.classList.add("hidden"));
  statsModalBackdrop.addEventListener("click", (e) => {
    if (e.target === statsModalBackdrop) statsModalBackdrop.classList.add("hidden");
  });

  // Silent restore from a saved session token on page load.
  (async function restoreSession() {
    if (!sessionToken) return;
    const res = await api("sign-in-with-token", { token: sessionToken });
    if (res && res.ok) applySignedIn(res.username);
    else { sessionToken = null; localStorage.removeItem(SESSION_TOKEN_KEY); }
  })();

  // ---- QMoji Arcade: party continuity from the homescreen ----
  // Enhancement only — if there's no ?room= or the lookup fails, none of
  // this runs and the lobby above behaves exactly as it does standalone.
  const backToLaunchpadBtn = document.getElementById("backToLaunchpadBtn");
  let arcadeRoomCode = null;
  let arcadeLang = null;
  let arcadePlayerId = null;

  backToLaunchpadBtn.addEventListener("click", () => {
    window.location.href = QMojiArcade.backToHomescreenUrl(arcadeRoomCode, arcadeLang, arcadePlayerId);
  });

  (async function initArcadeLink() {
    const arcade = await QMojiArcade.initArcade();
    if (!arcade) return;
    arcadeRoomCode = arcade.roomCode;
    arcadeLang = arcade.lang;
    arcadePlayerId = arcade.playerId;

    // The room code is fixed by the party the player already formed on the
    // homescreen — one code, sourced from the URL, not a second manual entry.
    roomCodeInput.value = arcadeRoomCode;
    roomCodeInput.disabled = true;
    document.querySelector(".divider").textContent = "Joining party " + arcadeRoomCode + "…";
    document.getElementById("createRoomBtn").classList.add("hidden");

    const me = (arcade.room.players || []).find((p) => p.playerId === arcadePlayerId);

    if (me) {
      // Known party member — skip the manual entry screen entirely.
      usernameInput.value = me.name;
      const res = await api("join-room", { username: me.name, code: arcadeRoomCode, token: sessionToken });
      if (res.ok) {
        enterRoom(res.room);
        return;
      }
      if (res.error === "Room not found") {
        // First arcade player to reach this game — seed a room under the
        // party's own code instead of letting the server generate one.
        const created = await api("create-room", { username: me.name, code: arcadeRoomCode, token: sessionToken });
        if (created.ok) enterRoom(created.room);
      }
    } else {
      // A raw game link was opened directly (not routed through the
      // homescreen) — let them type a name as usual, but also enroll them
      // in the arcade party so it carries forward from here too.
      const joinBtn = document.getElementById("joinRoomBtn");
      joinBtn.textContent = "Join Party";
      joinBtn.addEventListener("click", () => {
        const name = usernameInput.value.trim();
        if (name) QMojiArcade.joinRoom(arcadeRoomCode, name).catch(() => {});
      });
    }
  })();

  // ---- waiting room ----
  const waitingCode = document.getElementById("waitingCode");
  const waitingPlayers = document.getElementById("waitingPlayers");
  const waitingHint = document.getElementById("waitingHint");
  const startGameBtn = document.getElementById("startGameBtn");

  startGameBtn.addEventListener("click", async () => {
    const res = await api("start-game", {});
    if (!res.ok) return showError(waitingHint, res.error);
    applySnapshotIfFresh(res.room);
  });

  function renderWaitingRoom(view) {
    showScreen("waiting");
    waitingCode.textContent = view.code;
    waitingPlayers.innerHTML = "";
    let amHost = false;
    for (const p of view.players) {
      if (p.playerId === myId && p.isHost) amHost = true;
      const li = document.createElement("li");
      li.innerHTML = `<span><span class="swatch" style="background:${colorFor(p.playerId)}"></span>${escapeHtml(p.username)}${p.isHost ? " (host)" : ""}</span>`;
      waitingPlayers.appendChild(li);
    }
    startGameBtn.classList.toggle("hidden", !amHost);
    waitingHint.textContent = amHost ? "" : "Waiting for the host to start the game...";
    lastPlayers = view.players;
  }

  // ---- game screen ----
  const boardEl = document.getElementById("board");
  const gameEl = document.getElementById("game");
  const keywordEl = document.getElementById("keywordName");
  const roundNumEl = document.getElementById("roundNum");
  const roundTotalEl = document.getElementById("roundTotal");
  const timerFillEl = document.getElementById("timerFill");
  const nextRoundNoteEl = document.getElementById("nextRoundNote");
  const firstToFlagNoteEl = document.getElementById("firstToFlagNote");
  const roundOneBannerEl = document.getElementById("roundOneBanner");
  const myScoreValEl = document.getElementById("myScoreVal");
  const myLivesEl = document.getElementById("myLives");
  const scoreboardListEl = document.getElementById("scoreboardList");

  let cellSize = 58;
  let cols = 9, rows = 7;
  let startingLives = 3;
  let cellEls = new Map(); // "col,row" -> el
  let muncherEls = new Map(); // playerId -> el
  let myPrev = null; // { score, lives, eaten: Set }
  const animatingKeys = new Set();
  const appliedSlimeKeys = new Set(); // "col,row" already given their permanent slime tint this round
  let lastPlayers = [];

  // Keeps the board from ever overflowing the viewport -- shrinks the cell
  // size to fit both axes rather than letting the grid's fixed pixel size
  // run off the edge (width) or bottom (height) of the screen. Only width
  // used to be considered here; on a short viewport that let a tall board
  // (e.g. 7+ rows) run past the bottom with no way to see or reach the
  // last row(s). chromeBudgetPx is a deliberately conservative estimate of
  // everything else stacked above/below the board (top bar, keyword
  // banner, timer, stats/hint/touchpad), not a live measurement.
  function computeCellSize(colsArg, rowsArg) {
    const availableWidth = Math.min(window.innerWidth - 24, 480);
    const rawByWidth = Math.floor(availableWidth / colsArg);

    const chromeBudgetPx = 360;
    const availableHeight = Math.max(0, window.innerHeight - chromeBudgetPx);
    const rawByHeight = Math.floor(availableHeight / rowsArg);

    return Math.max(30, Math.min(58, rawByWidth, rawByHeight));
  }

  function applyCellSize(size) {
    cellSize = size;
    document.documentElement.style.setProperty("--cell", cellSize + "px");
    boardEl.style.width = (cellSize * cols) + "px";
    boardEl.style.height = (cellSize * rows) + "px";
    // #game's own max-width used to be a CSS constant sized for a
    // different (smaller) column count, which silently clipped whatever
    // didn't fit -- including, once the flag started always spawning in
    // the rightmost column, the flag itself. Deriving it here instead
    // keeps it correct for whatever the board's actual size is.
    gameEl.style.maxWidth = (cellSize * cols + 20) + "px";
  }

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (screens.game.classList.contains("hidden") || cellEls.size === 0) return;
      const newSize = computeCellSize(cols, rows);
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
  async function goHome() {
    await api("leave-room", {});
    stopPolling();
    stopHeartbeat();
    currentRoomCode = null;
    lastRoomView = null;
    colorByPlayer.clear();
    cellEls.clear();
    muncherEls.clear();
    animatingKeys.clear();
    myPrev = null;
    roomCodeInput.value = "";
    showScreen("lobby");
  }
  document.getElementById("homeBtnGame").addEventListener("click", goHome);
  document.getElementById("homeBtnOver").addEventListener("click", goHome);

  // Explicit "leaving right now" signal for the common case (closing the
  // tab) — sendBeacon is used because a plain fetch can get cancelled
  // mid-flight when the page unloads. The heartbeat timeout on the server
  // is the fallback for real drops (crash, network loss) where this never
  // fires.
  window.addEventListener("pagehide", () => {
    if (!currentRoomCode || !navigator.sendBeacon) return;
    try {
      const blob = new Blob([JSON.stringify({ code: currentRoomCode, playerId: myId })], { type: "application/json" });
      navigator.sendBeacon("/api/leave-room", blob);
    } catch (e) {
      // best-effort only
    }
  });

  function renderGrid(view) {
    cols = view.cols; rows = view.rows;
    startingLives = view.startingLives || startingLives;
    applyCellSize(computeCellSize(cols, rows));
    boardEl.innerHTML = "";
    cellEls.clear();
    muncherEls.clear();
    animatingKeys.clear();
    appliedSlimeKeys.clear();
    myPrev = null;
    for (const cell of view.grid) {
      const el = document.createElement("div");
      el.className = "cell";
      el.textContent = cell.symbol;
      el.style.left = (cell.col * cellSize) + "px";
      el.style.top = (cell.row * cellSize) + "px";
      boardEl.appendChild(el);
      cellEls.set(`${cell.col},${cell.row}`, el);
    }
    if (view.destination) {
      const destEl = cellEls.get(`${view.destination.col},${view.destination.row}`);
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

  // Freezes the bar wherever it currently sits instead of letting the CSS
  // transition keep draining it toward 0 after the round has already ended.
  function freezeTimer() {
    const currentWidth = getComputedStyle(timerFillEl).width;
    timerFillEl.style.transition = "none";
    timerFillEl.style.width = currentWidth;
  }

  // Recomputed directly from the room's absolute nextRoundAt on every poll
  // (rather than a local setInterval counting down on its own) so it stays
  // correct regardless of poll timing/drift, a backgrounded tab, etc.
  function updateNextRoundCountdown(view) {
    if (!view.nextRoundAt) { hideNextRoundCountdown(); return; }
    const remaining = Math.max(0, Math.ceil((view.nextRoundAt - Date.now()) / 1000));
    nextRoundNoteEl.textContent = remaining > 0 ? `Next round in ${remaining}…` : "Next round…";
    nextRoundNoteEl.classList.remove("hidden");
  }
  function hideNextRoundCountdown() {
    nextRoundNoteEl.classList.add("hidden");
  }

  function renderMunchers(players) {
    const seen = new Set();
    for (const p of players) {
      seen.add(p.playerId);
      let el = muncherEls.get(p.playerId);
      if (!el) {
        el = document.createElement("div");
        el.className = "muncher";
        boardEl.appendChild(el);
        muncherEls.set(p.playerId, el);
      }
      el.style.background = colorFor(p.playerId);
      el.style.left = (p.muncherCol * cellSize) + "px";
      el.style.top = (p.muncherRow * cellSize) + "px";
      el.style.opacity = p.eliminated ? "0.35" : "1";
      el.textContent = (p.username || "?").slice(0, 1).toUpperCase();
    }
    for (const [playerId, el] of muncherEls) {
      if (!seen.has(playerId)) { el.remove(); muncherEls.delete(playerId); }
    }
  }

  function hexToRgba(hex, alpha) {
    const h = String(hex).replace("#", "");
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function markSlimed(cellEl, color) {
    cellEl.classList.add("slimed");
    cellEl.style.background = hexToRgba(color, 0.35);
  }

  // Cells are shared across the whole room (GameRoom's resolveMunch) -- once
  // anyone eats one it's gone for everyone, tinted in whichever player's
  // color ate it first. Cells mid-way through *my own* correct/wrong
  // animation are skipped here; that animation's own callback (see
  // syncMyBoard) applies the slime tint once it finishes instead, so the
  // permanent mark doesn't pop in before the transient pop/shake plays.
  function applySharedEaten(sharedEaten) {
    for (const entry of sharedEaten) {
      const key = `${entry.col},${entry.row}`;
      if (appliedSlimeKeys.has(key) || animatingKeys.has(key)) continue;
      const cellEl = cellEls.get(key);
      if (!cellEl) continue;
      markSlimed(cellEl, colorFor(entry.by));
      appliedSlimeKeys.add(key);
    }
  }

  let announcedFirstToFlag = null;
  function announceFirstToFlag(username) {
    if (!username || username === announcedFirstToFlag) return;
    announcedFirstToFlag = username;
    const mine = lastPlayers.find((p) => p.playerId === myId)?.username === username;
    firstToFlagNoteEl.textContent = `🏆 ${mine ? "You" : username} reached the flag first! +50`;
    firstToFlagNoteEl.classList.remove("hidden");
    firstToFlagNoteEl.style.animation = "none";
    void firstToFlagNoteEl.offsetWidth;
    firstToFlagNoteEl.style.animation = "";
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
  // per-cell animation + sound (correct pop, or wrong-shake + fly-to-shield)
  // for cells *I* resolved. Cells someone else already emptied before I
  // stepped on them get no animation of mine -- applySharedEaten tints
  // those in the other player's color instead.
  function syncMyBoard(players) {
    const me = players.find((p) => p.playerId === myId);
    if (!me) return;
    const eatenSet = new Set(me.eatenCells);
    myScoreValEl.textContent = me.score;
    const myColor = colorFor(myId);

    let shieldsRendered = false;
    if (myPrev) {
      const newKeys = [...eatenSet].filter((k) => !myPrev.eaten.has(k));
      const correct = me.score > myPrev.score;
      const livesLost = myPrev.lives > me.lives;

      if (livesLost) { renderMyShields(me.lives); shieldsRendered = true; }

      for (const key of newKeys) {
        const cellEl = cellEls.get(key);
        if (!cellEl) continue;
        if (appliedSlimeKeys.has(key)) continue; // someone else already resolved this one
        animatingKeys.add(key);
        if (correct) {
          cellEl.classList.add("correct-flash");
          window.SFX.correct();
          setTimeout(() => {
            markSlimed(cellEl, myColor);
            appliedSlimeKeys.add(key);
            animatingKeys.delete(key);
          }, 260);
        } else if (livesLost) {
          cellEl.classList.add("wrong-flash");
          const shieldEl = myLivesEl.querySelectorAll(".shield-icon")[me.lives];
          flyToShield(cellEl, shieldEl);
          setTimeout(() => {
            markSlimed(cellEl, myColor);
            appliedSlimeKeys.add(key);
            animatingKeys.delete(key);
          }, 340);
        } else {
          // Visited a cell someone else already emptied -- no animation,
          // applySharedEaten will tint it in their color.
          animatingKeys.delete(key);
        }
      }
    }

    if (!shieldsRendered) renderMyShields(me.lives);

    myPrev = { score: me.score, lives: me.lives, eaten: eatenSet };
  }

  function renderScoreboard(players) {
    const sorted = [...players].sort((a, b) => b.score - a.score);
    scoreboardListEl.innerHTML = "";
    for (const p of sorted) {
      const li = document.createElement("li");
      if (p.eliminated) li.classList.add("eliminated");
      li.innerHTML = `
        <span class="name"><span class="dot" style="background:${colorFor(p.playerId)}"></span>${escapeHtml(p.username)}${p.playerId === myId ? " (you)" : ""}</span>
        <span>💯 ${p.score}${p.eliminated ? "" : " &nbsp; " + shieldRow(p.lives, startingLives, true)}</span>`;
      scoreboardListEl.appendChild(li);
    }
  }

  function applyRoundStart(view) {
    showScreen("game");
    hideNextRoundCountdown();
    firstToFlagNoteEl.classList.add("hidden");
    announcedFirstToFlag = null;
    roundNumEl.textContent = view.round;
    roundTotalEl.textContent = view.totalRounds;
    keywordEl.textContent = view.keyword;
    renderGrid(view);
    lastPlayers = view.players;
    renderMunchers(view.players);
    syncMyBoard(view.players);
    applySharedEaten(view.sharedEaten || []);
    renderScoreboard(view.players);
    startTimer(view.timeLimitMs);
    window.SFX.roundStart();

    if (view.round === 1) {
      roundOneBannerEl.classList.remove("hidden");
      // Re-trigger the CSS fade-out animation on every fresh round 1 (a
      // "Play Again" restart reuses the same element).
      roundOneBannerEl.style.animation = "none";
      void roundOneBannerEl.offsetWidth;
      roundOneBannerEl.style.animation = "";
      setTimeout(() => roundOneBannerEl.classList.add("hidden"), 3500);
    } else {
      roundOneBannerEl.classList.add("hidden");
    }
  }

  function applyStateUpdate(view) {
    lastPlayers = view.players;
    renderMunchers(view.players);
    syncMyBoard(view.players);
    applySharedEaten(view.sharedEaten || []);
    renderScoreboard(view.players);
    announceFirstToFlag(view.firstToFlag);
  }

  function applyRoundEnd(view) {
    lastPlayers = view.players;
    applySharedEaten(view.sharedEaten || []);
    renderScoreboard(view.players);
    announceFirstToFlag(view.firstToFlag);
    freezeTimer();
    updateNextRoundCountdown(view);
  }

  const finalScoreboardEl = document.getElementById("finalScoreboard");
  const leaderboardListEl = document.getElementById("leaderboardList");
  const playAgainBtn = document.getElementById("playAgainBtn");
  const overHint = document.getElementById("overHint");

  playAgainBtn.addEventListener("click", async () => {
    const res = await api("restart-game", {});
    if (res.ok) applySnapshotIfFresh(res.room);
  });

  function loadAllTimeLeaderboard() {
    fetch("/api/leaderboard")
      .then((res) => res.json())
      .then((data) => {
        leaderboardListEl.innerHTML = "";
        for (const entry of data.leaderboard || []) {
          const li = document.createElement("li");
          li.innerHTML = `<span>${escapeHtml(entry.username)}</span><span>best 💯 ${entry.bestScore} · ${entry.gamesPlayed} games</span>`;
          leaderboardListEl.appendChild(li);
        }
      })
      .catch(() => { leaderboardListEl.innerHTML = ""; });
  }

  function applyGameOver(view) {
    showScreen("over");
    window.SFX.gameOver();
    lastPlayers = view.players;
    const sorted = [...view.players].sort((a, b) => b.score - a.score);
    finalScoreboardEl.innerHTML = "";
    sorted.forEach((p, i) => {
      const li = document.createElement("li");
      li.innerHTML = `<span><span class="swatch" style="background:${colorFor(p.playerId)}"></span>#${i + 1} ${escapeHtml(p.username)}${p.playerId === myId ? " (you)" : ""}</span><span>💯 ${p.score}</span>`;
      finalScoreboardEl.appendChild(li);
    });
    loadAllTimeLeaderboard();
    const me = view.players.find((p) => p.playerId === myId);
    playAgainBtn.classList.toggle("hidden", !(me && me.isHost));
    overHint.textContent = me && me.isHost ? "" : "Waiting for the host to start a new game...";
  }

  // A move's own POST response and the background poller both resolve
  // asynchronously and can arrive out of order -- e.g. a poll fired just
  // before a move can still resolve *after* that move's own (faster)
  // response, carrying the pre-move position. Without a guard, applying it
  // snaps the muncher back a step right after it moved, then forward again
  // on the next poll -- which reads as "the arrow keys are laggy," not as
  // the harmless race it actually is.
  //
  // This used to be guarded by a client-side counter stamped at request
  // *send* time, on the assumption that whichever request was sent last
  // would also be the one to arrive with the freshest data. That holds on
  // a near-zero-latency localhost, but not against real network jitter: a
  // poll and a move fired moments apart can still reach the server, and
  // get processed, in a different order than they were sent -- so the
  // "later" request's response could actually carry *older* state, and the
  // guard would then refuse every subsequent (genuinely fresher) response
  // forever, since its own send-order stamp could never be lower again.
  // That's the actual "gets stuck after a while" bug. version comes from
  // the server instead (GameRoom.js, bumped once per store.saveRoom() call)
  // -- it reflects the true order mutations happened in, regardless of
  // which request happened to arrive first.
  let appliedVersion = -1;
  function applySnapshotIfFresh(view) {
    if (typeof view.version === "number" && view.version < appliedVersion) return;
    appliedVersion = view.version;
    applyRoomSnapshot(view);
  }

  // ---- room snapshot dispatch ----
  // Every poll tick and every action response hands over a full room
  // snapshot; this decides which screen it implies and whether it's a
  // meaningfully new state (a fresh round, fresh results) or just the same
  // one with a minor change (a move, a reveal, a roster update) so the game
  // screen doesn't reset the grid/timer/animations on every poll.
  let lastRoomView = null;
  function applyRoomSnapshot(view) {
    const prev = lastRoomView;
    lastRoomView = view;

    if (view.status === "lobby") {
      renderWaitingRoom(view);
      return;
    }
    if (view.status === "playing") {
      const isNewRound = !prev || prev.status !== "playing" || prev.round !== view.round;
      if (isNewRound) applyRoundStart(view);
      else applyStateUpdate(view);
      return;
    }
    if (view.status === "roundEnd") {
      applyRoundEnd(view);
      return;
    }
    if (view.status === "gameOver") {
      if (!prev || prev.status !== "gameOver") applyGameOver(view);
      return;
    }
  }

  function amRoundDone() {
    const me = lastPlayers.find((p) => p.playerId === myId);
    return !!(me && me.roundDone);
  }

  // Mirrors (and is deliberately a hair above) the server's own
  // MOVE_COOLDOWN_MS -- purely a client-side request-rate throttle so
  // holding a key down doesn't fire a POST for every OS key-repeat tick;
  // the server remains the sole authority on whether a move is accepted.
  const CLIENT_MOVE_THROTTLE_MS = 180;
  let lastMoveSentAt = 0;
  function sendMove(dir) {
    if (amRoundDone()) return;
    const now = Date.now();
    if (now - lastMoveSentAt < CLIENT_MOVE_THROTTLE_MS) return;
    lastMoveSentAt = now;
    api("move", { dir }).then((res) => {
      if (res.ok) applySnapshotIfFresh(res.room);
    });
  }

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
    sendMove(dir);
  });
  document.getElementById("touchpad").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-dir]");
    if (!btn) return;
    sendMove(btn.dataset.dir);
  });

  // ---- polling + presence ----
  // Two speeds: a slow roster-only poll in the lobby/waiting room, and a
  // fast one during active play so opponent movement stays close to the
  // old instant-broadcast feel -- helped along by .muncher's existing CSS
  // position transition (style.css), which smooths out the gap between
  // polls rather than snapping.
  let pollTimer = null;
  function pollIntervalFor(status) {
    return status === "playing" || status === "roundEnd" ? 280 : 2000;
  }
  async function pollRoom() {
    if (!currentRoomCode) return;
    let nextStatus = lastRoomView ? lastRoomView.status : "lobby";
    try {
      const res = await fetch(`/api/room?code=${encodeURIComponent(currentRoomCode)}`);
      const data = await res.json();
      if (data.ok && data.room) {
        applySnapshotIfFresh(data.room);
        nextStatus = data.room.status;
      }
    } catch (e) {
      // transient network hiccup — the next tick retries
    }
    if (currentRoomCode) pollTimer = setTimeout(pollRoom, pollIntervalFor(nextStatus));
  }
  function startPolling() {
    stopPolling();
    pollRoom();
  }
  function stopPolling() {
    clearTimeout(pollTimer);
    pollTimer = null;
  }

  // Replaces Socket.IO's automatic disconnect detection — there's no
  // persistent connection left for the server to notice a drop with.
  let heartbeatTimer = null;
  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      if (currentRoomCode) api("heartbeat", {});
    }, 4000);
  }
  function stopHeartbeat() {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
})();
