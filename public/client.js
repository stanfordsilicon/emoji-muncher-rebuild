// Gated on initI18n(): the string table now arrives over the network, so
// nothing here may run until it has loaded -- the very first statement
// below paints UI text. initI18n() never rejects, so this always runs.
initI18n().then(function () {
  "use strict";

  // Static (non-templated) UI text is data-i18n-driven -- see public/i18n.js.
  // Anything with dynamic content (a score, a room code) is set directly
  // below via t() instead, since data-i18n has no way to carry variables.
  applyStaticTranslations();

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
      return { ok: false, error: t("connection_error") };
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
  const lobbyError = document.getElementById("lobbyError");

  function getUsername() {
    const name = usernameInput.value.trim();
    if (!name) showError(lobbyError, t("username_required_error"));
    return name;
  }

  function enterRoom(view) {
    currentRoomCode = view.code;
    applySnapshotIfFresh(view);
    startPolling();
    startHeartbeat();
  }

  document.getElementById("playSoloBtn").addEventListener("click", async () => {
    const username = getUsername();
    if (!username) return;
    const res = await api("create-room", { username });
    if (!res.ok) return showError(lobbyError, res.error);
    enterRoom(res.room);
  });

  // ---- QMoji Arcade: return-to-launchpad continuity ----
  // Enhancement only — if there's no ?room= or the lookup fails, none of
  // this runs and the lobby above behaves exactly as it does standalone.
  // Munchers itself is single-player, so arriving via a shared arcade party
  // doesn't join a shared game here -- it just prefills the player's name
  // (if the arcade already knows it) and preserves the room/lang/player
  // params so "Return to Launch Pad" lands them back in the same party.
  const backToLaunchpadBtn = document.getElementById("backToLaunchpadBtn");
  let arcadeRoomCode = null;
  let arcadeLang = null;
  let arcadePlayerId = null;

  // Mirrors qmoji/app.js's own launchGame() transition (fade in "LOADING…"
  // with a bar-fill, then navigate after a beat) so leaving a game feels
  // like the same continuous arcade as entering one, instead of an instant
  // jump cut.
  function navigateWithLoadingScreen(href) {
    const loadingScreen = document.getElementById("loadingScreen");
    const fill = document.getElementById("loadingBarFill");
    if (!loadingScreen || !fill) {
      window.location.href = href;
      return;
    }
    loadingScreen.classList.add("is-visible");
    loadingScreen.setAttribute("aria-hidden", "false");
    fill.style.width = "0%";
    requestAnimationFrame(() => { fill.style.width = "100%"; });
    setTimeout(() => { window.location.href = href; }, 650);
  }

  backToLaunchpadBtn.addEventListener("click", () => {
    navigateWithLoadingScreen(QMojiArcade.backToHomescreenUrl(arcadeRoomCode, arcadeLang, arcadePlayerId));
  });

  (async function initArcadeLink() {
    const arcade = await QMojiArcade.initArcade();
    if (!arcade) return;
    arcadeRoomCode = arcade.roomCode;
    arcadeLang = arcade.lang;
    arcadePlayerId = arcade.playerId;

    const me = (arcade.room.players || []).find((p) => p.playerId === arcadePlayerId);
    if (me) usernameInput.value = me.name;
  })();

  // ---- game screen ----
  const boardEl = document.getElementById("board");
  const gameEl = document.getElementById("game");
  const keywordEl = document.getElementById("keywordName");
  const roundInfoEl = document.getElementById("roundInfo");
  const timerFillEl = document.getElementById("timerFill");
  const nextRoundNoteEl = document.getElementById("nextRoundNote");
  const roundOneBannerEl = document.getElementById("roundOneBanner");
  const myScoreValEl = document.getElementById("myScoreVal");
  const myLivesEl = document.getElementById("myLives");

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

  // ---- go home (available in-game and post-game) ----
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
    nextRoundNoteEl.textContent = remaining > 0 ? t("next_round_in", { seconds: remaining }) : t("next_round_now");
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
    // The eaten emoji disappears rather than sitting there tinted -- a
    // munched cell reads more clearly as "empty, already handled" than as
    // "still has an emoji in it, just recolored."
    cellEl.textContent = "";
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
          window.SFX.munch();
          window.SFX.correct();
          setTimeout(() => {
            markSlimed(cellEl, myColor);
            appliedSlimeKeys.add(key);
            animatingKeys.delete(key);
          }, 260);
        } else if (livesLost) {
          cellEl.classList.add("wrong-flash");
          window.SFX.munch();
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

  function applyRoundStart(view) {
    showScreen("game");
    hideNextRoundCountdown();
    roundInfoEl.textContent = t("round_progress", { round: view.round, total: view.totalRounds });
    keywordEl.textContent = view.keywordLabel || view.keyword;
    renderGrid(view);
    lastPlayers = view.players;
    renderMunchers(view.players);
    syncMyBoard(view.players);
    applySharedEaten(view.sharedEaten || []);
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
  }

  function applyRoundEnd(view) {
    lastPlayers = view.players;
    applySharedEaten(view.sharedEaten || []);
    freezeTimer();
    updateNextRoundCountdown(view);
  }

  const finalScoreEl = document.getElementById("finalScore");
  const leaderboardListEl = document.getElementById("leaderboardList");
  const playAgainBtn = document.getElementById("playAgainBtn");

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
          li.innerHTML = `<span>${escapeHtml(entry.username)}</span><span>${t("all_time_score_summary", { score: entry.bestScore, games: entry.gamesPlayed })}</span>`;
          leaderboardListEl.appendChild(li);
        }
      })
      .catch(() => { leaderboardListEl.innerHTML = ""; });
  }

  function applyGameOver(view) {
    showScreen("over");
    window.SFX.gameOver();
    lastPlayers = view.players;
    const me = view.players.find((p) => p.playerId === myId);
    finalScoreEl.textContent = t("final_score", { score: me ? me.score : 0 });
    loadAllTimeLeaderboard();
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

    // An in-flight optimistic move (see predictMove below) can race against
    // the independent poll loop: a poll response can land *between* the
    // optimistic prediction and that move's own response, still carrying
    // the pre-move position, and would otherwise visibly snap the muncher
    // back for a moment. While a move is unconfirmed and we're still in the
    // same round it was made in, pin our own position to the latest local
    // prediction instead of whatever the snapshot says -- the move's own
    // response (or a later poll, once pendingMoveCount drops to 0) is what
    // actually reconciles it. A round transition invalidates any pending
    // prediction outright (a fresh round respawns everyone server-side).
    const isSameRoundInProgress =
      view.status === "playing" && lastRoomView && lastRoomView.status === "playing" && lastRoomView.round === view.round;
    if (pendingMoveCount > 0 && optimisticPos && isSameRoundInProgress && Array.isArray(view.players)) {
      const me = view.players.find((p) => p.playerId === myId);
      if (me && !me.eliminated && !me.roundDone) {
        me.muncherCol = optimisticPos.col;
        me.muncherRow = optimisticPos.row;
      }
    } else {
      pendingMoveCount = 0;
      optimisticPos = null;
    }

    applyRoomSnapshot(view);
  }

  // ---- room snapshot dispatch ----
  // Every poll tick and every action response hands over a full snapshot of
  // this player's game; this decides which screen it implies and whether
  // it's a meaningfully new state (a fresh round, fresh results) or just the
  // same one with a minor change (a move, a reveal) so the game screen
  // doesn't reset the grid/timer/animations on every poll. Games always
  // start already "playing" (see LobbyManager.createGame) -- there's no
  // "lobby" status the client ever needs to render.
  let lastRoomView = null;
  function applyRoomSnapshot(view) {
    const prev = lastRoomView;
    lastRoomView = view;

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

  // Purely a client-side request-rate throttle so holding a key down
  // doesn't fire a POST for every OS key-repeat tick (which can be much
  // faster than any real human tap) -- the server remains the sole
  // authority on whether a move is accepted, and no longer paces moves on
  // its own (MOVE_COOLDOWN_MS defaults to 0), so this stays well under any
  // real tap cadence rather than mirroring a server-side cooldown.
  const CLIENT_MOVE_THROTTLE_MS = 40;
  let lastMoveSentAt = 0;

  // A move can come back !ok for a purely transient reason -- e.g. a cold
  // serverless instance's Mongo connection momentarily missing a room that
  // genuinely exists (see server/game/LobbyManager.js's mutateRoom retry
  // comment). Previously a failed move just silently did nothing, which is
  // exactly what "I pressed the arrow and the game stopped responding"
  // looks like from the player's side -- they can't tell a real freeze from
  // one dropped request, so they're stuck until they happen to try again.
  // Retrying here invisibly is what actually fixes that: almost every
  // failure clears on the very next attempt a few hundred ms later.
  // Counts unconfirmed optimistic moves (see predictMove) so applySnapshotIfFresh
  // knows whether to trust an incoming snapshot's position for our own player yet.
  let pendingMoveCount = 0;
  let optimisticPos = null; // { col, row }, or null once every predicted move is confirmed
  function settleOneMove() {
    pendingMoveCount = Math.max(0, pendingMoveCount - 1);
    if (pendingMoveCount === 0) optimisticPos = null;
  }

  // Move requests are serialized -- only one /api/move is ever in flight at
  // a time, with the rest queued in press order -- rather than each keydown
  // firing its own independent fetch(). Two (or more) moves genuinely can be
  // in flight together whenever keys are pressed faster than a round trip
  // (routine, not an edge case: a cold serverless instance alone can take
  // 100-400ms+ per the comment below), and nothing tied their *resolution*
  // order to the order they were sent in -- LobbyManager's mutateRoom retries
  // each one against "whatever the room looks like right now" on a save-race
  // loss, with no sequence number to say which move was actually pressed
  // first. Two overlapping requests could therefore get applied in swapped
  // order: e.g. press right then down, but "down" resolves at the server
  // first and "right" second. munch resolution happens at whatever cell the
  // *server* occupies at the moment each request is actually applied, so the
  // swap doesn't just reorder two moves that land on the same square either
  // way -- it can walk the muncher over an entirely different pair of cells
  // than the ones it visually passed through, silently skipping a poison
  // tile the player clearly saw themselves cross. That tile then reads as
  // "already eaten" the next time it's genuinely visited (since the earlier
  // pass, the one that seemed to do nothing, was the one that never actually
  // reached the server as that step), which is exactly the "off and back on"
  // workaround this was producing -- and the next real move, computed from
  // the server's true (still one step behind) position, visibly snaps the
  // muncher to a different cell than the one it looked like it was
  // standing on. Queuing removes the race outright: every move is applied
  // in the same order it was pressed, so the server's position can never
  // diverge from what was drawn.
  let moveInFlight = false;
  const moveQueue = [];

  function pumpMoveQueue() {
    if (moveInFlight || moveQueue.length === 0) return;
    moveInFlight = true;
    attemptMove(moveQueue.shift(), 0);
  }

  const MOVE_RETRY_DELAYS_MS = [120, 250, 400];
  function attemptMove(dir, attempt) {
    api("move", { dir }).then((res) => {
      if (res.ok) {
        settleOneMove();
        applySnapshotIfFresh(res.room);
        moveInFlight = false;
        pumpMoveQueue();
        return;
      }
      if (attempt < MOVE_RETRY_DELAYS_MS.length) {
        setTimeout(() => attemptMove(dir, attempt + 1), MOVE_RETRY_DELAYS_MS[attempt]);
      } else {
        // Every retry failed -- the move never actually landed server-side,
        // so the optimistic prediction (predictMove) is now showing a
        // position/munch that never happened. Previously this just gave up
        // silently and let the *next* poll (up to 280ms later) or move
        // response correct it, which is what "sent back to an earlier
        // square" a moment later actually was. Resyncing immediately here
        // instead means the correction happens right away, in the same
        // instant the dropped keypress is given up on, rather than as a
        // delayed, unexplained snap-back.
        settleOneMove();
        moveInFlight = false;
        fetch(`/api/room?code=${encodeURIComponent(currentRoomCode)}`)
          .then((r) => r.json())
          .then((data) => {
            if (data.ok && data.room) applySnapshotIfFresh(data.room);
          })
          .catch(() => {})
          .finally(pumpMoveQueue);
      }
    });
  }

  // Movement here is only ever clamped at the grid edge -- no walls, no
  // hidden server-only data -- so the client can predict the exact same
  // result the server will compute, instead of waiting a full round-trip
  // (100-400ms+ on a cold serverless instance) before the muncher visibly
  // moves. This is what actually fixes "arrow keys feel laggy": the token
  // now moves the instant you press a key, and the network request behind
  // it just confirms (or, on a real rejection like round-done, corrects)
  // that a moment later via the normal applySnapshotIfFresh path.
  const MOVE_DELTAS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  function predictMove(dir) {
    const delta = MOVE_DELTAS[dir];
    const me = lastPlayers.find((p) => p.playerId === myId);
    if (!me || !delta) return;
    const col = Math.max(0, Math.min(cols - 1, me.muncherCol + delta[0]));
    const row = Math.max(0, Math.min(rows - 1, me.muncherRow + delta[1]));
    optimisticPos = { col, row };
    me.muncherCol = col;
    me.muncherRow = row;
    renderMunchers(lastPlayers);
  }

  function sendMove(dir) {
    if (amRoundDone()) return;
    const now = Date.now();
    if (now - lastMoveSentAt < CLIENT_MOVE_THROTTLE_MS) return;
    lastMoveSentAt = now;
    predictMove(dir);
    pendingMoveCount += 1;
    moveQueue.push(dir);
    pumpMoveQueue();
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
});
