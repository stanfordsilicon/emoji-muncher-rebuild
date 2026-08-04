// Tiny synthesized sound-effects module (no audio assets to fetch/host).
// Lazily creates an AudioContext on first use since browsers block audio
// until a user gesture has happened.
(function () {
  "use strict";

  let ctx = null;
  let muted = false;

  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function tone({ freq, duration = 0.12, type = "sine", startFreq, gain = 0.18, delay = 0 }) {
    if (muted) return;
    const audioCtx = getCtx();
    const t0 = audioCtx.currentTime + delay;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(startFreq || freq, t0);
    if (startFreq) osc.frequency.linearRampToValueAtTime(freq, t0 + duration);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(g);
    g.connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  window.SFX = {
    setMuted(v) { muted = v; },
    isMuted() { return muted; },
    correct() {
      tone({ freq: 880, duration: 0.09, type: "triangle" });
      tone({ freq: 1320, duration: 0.12, type: "triangle", delay: 0.06 });
    },
    wrong() {
      tone({ freq: 160, startFreq: 260, duration: 0.22, type: "sawtooth", gain: 0.16 });
    },
    roundStart() {
      tone({ freq: 660, duration: 0.1, type: "sine" });
      tone({ freq: 990, duration: 0.14, type: "sine", delay: 0.08 });
    },
    gameOver() {
      tone({ freq: 440, duration: 0.16, type: "triangle" });
      tone({ freq: 330, duration: 0.16, type: "triangle", delay: 0.14 });
      tone({ freq: 220, duration: 0.28, type: "triangle", delay: 0.28 });
    },
  };
})();
