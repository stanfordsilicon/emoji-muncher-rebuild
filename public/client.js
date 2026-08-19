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

  const playSoloBtn = document.getElementById("playSoloBtn");
  const playSoloBtnLabel = playSoloBtn.textContent;
  playSoloBtn.addEventListener("click", async () => {
    const username = getUsername();
    if (!username) return;
    // create-room has no client-side timeout or retry of its own -- it's a
    // single request that simply takes as long as it takes (a cold
    // serverless/database connection can add several real seconds; see
    // server/game/LobbyManager.js's mutateRoom comment). Previously the
    // button just sat there doing nothing for however long that took, with
    // no visual acknowledgment of the click at all -- read as "the play
    // button doesn't work" rather than "the button worked, the server is
    // just slow to answer." Disabling it and swapping its label is enough
    // to turn that silence into visible, honest feedback.
    playSoloBtn.disabled = true;
    playSoloBtn.textContent = t("loading");
    try {
      // arcadeLang is set moments after page load by initArcadeLink() below,
      // well before a real click can happen -- null/undefined here just
      // means "no arcade party" or "no concept data for that language yet",
      // and the server falls back to English either way.
      const res = await api("create-room", { username, language: arcadeLang });
      if (!res.ok) return showError(lobbyError, res.error);
      enterRoom(res.room);
    } finally {
      playSoloBtn.disabled = false;
      playSoloBtn.textContent = playSoloBtnLabel;
    }
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
  const connectingNoteEl = document.getElementById("connectingNote");

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
    hideConnectingNote();
    currentRoomCode = null;
    lastRoomView = null;
    colorByPlayer.clear();
    cellEls.clear();
    muncherEls.clear();
    animatingKeys.clear();
    myPrev = null;
    showScreen("lobby");
  }
  document.getElementById("homeBtnOver").addEventListener("click", goHome);

  // There used to be a `pagehide` listener here that sent an immediate
  // sendBeacon leave-room, on the theory that pagehide meant "the tab is
  // really closing." It doesn't, reliably: a plain page refresh fires
  // pagehide on the outgoing document too (confirmed directly -- reload
  // mid-game and the room is gone server-side a moment later), which
  // directly contradicted getDeviceId()'s own stated intent of surviving a
  // refresh. Worse, mobile Safari fires pagehide whenever it backgrounds a
  // tab at all -- switching apps, a notification, the screen locking --
  // none of which mean the player is actually leaving. On a phone passed
  // around at a party, that's routine, and each time it happened the
  // player's game was silently deleted out from under them: every move
  // after coming back failed with "Room not found," which is exactly what
  // "the player doesn't get processed" looks like from their side.
  //
  // The heartbeat system already handles "player went away" correctly and
  // gracefully: a missed heartbeat marks them disconnected after
  // HEARTBEAT_TIMEOUT_MS, the room itself stays alive for DISCONNECT_GRACE_MS
  // in case they come back (heartbeat/rejoin flips connected back to true),
  // and only actual prolonged absence cleans it up. An explicit "Go Home"
  // click (goHome() above) is still an immediate, deliberate leave -- this
  // is only about not treating an ambiguous, frequently-spurious browser
  // event as an irreversible one.

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
    // appliedVersion only advances *after* a successful render, not before
    // -- this used to be the other way around, which meant a rendering
    // exception (a bug, not a network hiccup) still marked that version as
    // "handled." Every future poll for the same still-current version then
    // saw nothing new to do and silently kept the screen exactly as it was
    // at the moment of the crash forever: the round timer visibly hits
    // zero, a round-end/game-over/next-round transition is sitting right
    // there in the response, and nothing on screen ever moves again. Not
    // advancing until render() actually returns means a poll that fails
    // this way keeps retrying the *same* transition on every subsequent
    // tick instead of giving up on it -- self-healing if whatever caused
    // the throw was transient, and logged (see catch below) instead of
    // silently swallowed either way.
    try {
      applyRoomSnapshot(view);
      appliedVersion = view.version;
    } catch (err) {
      console.error("Failed to render room update -- will retry next poll:", err);
    }
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

  // Movement is one tile at a time, strictly serialized: a keypress is
  // simply ignored while the previous move is still resolving, instead of
  // predicting the result locally and queueing further presses to fire as
  // the network allows (as this used to). That prediction/queueing
  // machinery was the actual source of "choppy, buggy, superdelayed
  // collision": a move rendered before it was confirmed, a poll landing
  // between the prediction and its real response, several requests
  // resolving out of the order they were sent -- each patchable in
  // isolation, but adding up to a game that could visibly walk the muncher
  // over a square whose outcome the server never actually computed.
  // Locking input to one move at a time removes the whole class of races
  // outright: there is never more than one /api/move in flight, so nothing
  // can land out of order, and the muncher's position on screen always
  // comes directly from a confirmed server response -- never a guess.
  //
  // The tradeoff is deliberate: movement is a slower, one-press-at-a-time
  // cadence rather than a fluid real-time glide -- which is also just the
  // classic grid-arcade feel (Pac-Man, Snake) rather than trying to hide an
  // HTTP round trip behind a smooth animation.
  let moveBusy = false;

  // Floors how soon the *next* press can register, even after a fast
  // response, so the pace stays the same regardless of the network -- a
  // near-instant localhost and a slow cold serverless start should feel
  // like the same deliberate rhythm, not "sometimes snappy, sometimes not."
  const MIN_STEP_MS = 160;

  // A move can come back !ok for a purely transient reason -- e.g. a cold
  // serverless instance's Mongo connection momentarily missing a room that
  // genuinely exists (see server/game/LobbyManager.js's mutateRoom retry
  // comment). Previously a failed move just silently did nothing, which is
  // exactly what "I pressed the arrow and the game stopped responding"
  // looks like from the player's side -- they can't tell a real freeze from
  // one dropped request, so they're stuck until they happen to try again.
  // Retrying here invisibly is what actually fixes that: almost every
  // failure clears on the very next attempt a few hundred ms later.
  const MOVE_RETRY_DELAYS_MS = [120, 250, 400];

  // Disabling the touchpad's buttons while a move is in flight (rather than
  // just relying on sendMove's moveBusy no-op) gives a click during that
  // window real visual feedback -- "registered, briefly waiting" instead of
  // looking like the click did nothing, which is exactly the "unresponsive"
  // read this whole change is meant to avoid.
  const touchpadButtons = Array.from(document.querySelectorAll("#touchpad button[data-dir]"));
  function setTouchpadBusy(busy) {
    touchpadButtons.forEach((b) => { b.disabled = busy; });
  }

  // unlock() is the only thing standing between "one move resolved" and the
  // player being able to press another key or click the pad at all --
  // moveBusy gates *both* input paths (sendMove's own early-return, and
  // setTouchpadBusy's disabled attribute). It has to run unconditionally
  // once a move is done resolving, no matter what else happens in the same
  // tick, or input locks up permanently: not "briefly unresponsive," but
  // genuinely stuck until a full page reload. A hard ceiling timeout is a
  // second, independent path to the same unlock -- if literally anything
  // else goes wrong (a render throws, a promise chain never settles, a bug
  // neither of us has thought of yet), this fires anyway. Cleared on every
  // real unlock so it doesn't also fire pointlessly later.
  const MOVE_SAFETY_NET_MS = 3000;
  let moveSafetyNetTimer = null;

  // A move can genuinely take a few seconds to confirm -- not from network
  // jitter, but from the server's own room lookup retrying through a cold
  // serverless/database connection warming up (see server/game/
  // LobbyManager.js's mutateRoom comment: measured at up to ~8s on a cold
  // start, one-time per warm-up, then fast). Without this note, that wait
  // was entirely silent -- the touchpad just re-enables after
  // MOVE_SAFETY_NET_MS with nothing having visibly happened, which reads
  // exactly like the game having frozen. Delayed rather than shown
  // immediately so the overwhelmingly common fast case never flickers it.
  const CONNECTING_NOTE_DELAY_MS = 1200;
  let connectingNoteTimer = null;

  function showConnectingNote() {
    connectingNoteEl.classList.remove("hidden");
  }
  function hideConnectingNote() {
    clearTimeout(connectingNoteTimer);
    connectingNoteTimer = null;
    connectingNoteEl.classList.add("hidden");
  }

  function unlock() {
    clearTimeout(moveSafetyNetTimer);
    moveSafetyNetTimer = null;
    hideConnectingNote();
    moveBusy = false;
    setTouchpadBusy(false);
  }

  function unlockAfter(startedAt) {
    const remaining = Math.max(0, MIN_STEP_MS - (Date.now() - startedAt));
    setTimeout(unlock, remaining);
  }

  function attemptMove(dir, attempt, startedAt) {
    api("move", { dir }).then((res) => {
      if (res.ok) {
        // Rendering the response is exactly the kind of "should never fail,
        // but might" step a lockup like this comes from -- try/finally means
        // even a rendering bug here still lets the next move through, rather
        // than also taking input down with it.
        try {
          applySnapshotIfFresh(res.room);
        } finally {
          unlockAfter(startedAt);
        }
        return;
      }
      if (attempt < MOVE_RETRY_DELAYS_MS.length) {
        setTimeout(() => attemptMove(dir, attempt + 1, startedAt), MOVE_RETRY_DELAYS_MS[attempt]);
      } else {
        // Every retry failed -- resync directly from the room instead of
        // leaving the player stuck not knowing whether the press landed.
        fetch(`/api/room?code=${encodeURIComponent(currentRoomCode)}`)
          .then((r) => r.json())
          .then((data) => {
            if (data.ok && data.room) applySnapshotIfFresh(data.room);
          })
          .catch(() => {})
          .finally(() => unlockAfter(startedAt));
      }
    });
  }

  // Flashes the matching on-screen button for a keyboard-triggered move too
  // (not just an actual click), so the touchpad reads as "the same input,
  // shown on screen" rather than a separate, disconnected control -- makes
  // it obvious at a glance that clicking it does exactly what the arrow
  // keys do.
  function flashTouchpadButton(dir) {
    const btn = touchpadButtons.find((b) => b.dataset.dir === dir);
    if (!btn) return;
    btn.classList.add("is-pressed");
    setTimeout(() => btn.classList.remove("is-pressed"), 120);
  }

  function sendMove(dir) {
    if (amRoundDone() || moveBusy) return;
    moveBusy = true;
    setTouchpadBusy(true);
    flashTouchpadButton(dir);
    moveSafetyNetTimer = setTimeout(unlock, MOVE_SAFETY_NET_MS);
    connectingNoteTimer = setTimeout(showConnectingNote, CONNECTING_NOTE_DELAY_MS);
    attemptMove(dir, 0, Date.now());
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
