/*
 * Звук: сигналы таймера (тик в последние секунды и сигнал «время вышло»).
 */
window.Sound = (() => {
  let ctx = null;
  let master = null;
  let muted = false;

  function audio() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function tone(dest, f, t, dur, { type = "square", vol = 0.1, release = 0.03 } = {}) {
    const c = audio();
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.value = f;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.setValueAtTime(vol, Math.max(t + 0.01, t + dur - release));
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  // Сигналы таймера
  function tick() {
    if (muted) return;
    const c = audio();
    tone(master, 740, c.currentTime + 0.01, 0.09, { type: "sine", vol: 0.25 });
  }
  // «Время вышло»: три восходящих сигнала
  function end() {
    if (muted) return;
    const c = audio();
    const t = c.currentTime + 0.01;
    tone(master, 523.25, t, 0.16, { type: "triangle", vol: 0.35 });
    tone(master, 659.25, t + 0.14, 0.16, { type: "triangle", vol: 0.35 });
    tone(master, 783.99, t + 0.28, 0.5, { type: "triangle", vol: 0.35, release: 0.3 });
  }
  return {
    tick, end,
    unlock: audio,
    get muted() { return muted; },
    set muted(v) { muted = v; },
  };
})();
