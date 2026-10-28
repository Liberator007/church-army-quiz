/*
 * Движок викторины: слайды, навигация, таймер.
 * Порядок: заставка → суть игры → вопросы (номер → вопрос с вариантами и таймером) → ответы,
 * по слайду на вопрос: клик открывает правильный ответ → конец. Всё переключается кликом или клавишей.
 * Содержимое берётся из js/data.js.
 */
(() => {
  "use strict";

  const Q = window.QUIZ;
  const Sound = window.Sound;
  const NUMBER_FIRST = Q.numberFirst !== false;

  /* ─────────────── Утилиты ─────────────── */
  const stage = document.getElementById("stage");
  const slidesRoot = stage.querySelector(".slides");
  const chrome = stage.querySelector(".chrome");
  const progress = stage.querySelector(".progress");

  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
  const el = (html) => {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  };
  const fmt = (s) => (s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : String(s));
  const pad = (n) => String(n).padStart(2, "0");
  const bold = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

  // Своя приставка: у файлов, открытых двойным кликом, localStorage общий с другими викторинами
  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem("army-quiz:" + k);
        return v == null ? d : JSON.parse(v);
      } catch {
        return d;
      }
    },
    set(k, v) {
      try { localStorage.setItem("army-quiz:" + k, JSON.stringify(v)); } catch { /* приватный режим */ }
    },
  };

  /* ─────────────── Таймер ─────────────── */
  class Timer {
    constructor(phases, opts = {}) {
      this.phases = phases;
      this.opts = opts;
      this.el = el(`
        <div class="timer">
          <svg viewBox="0 0 100 100">
            <circle class="ticks" cx="50" cy="50" r="41" fill="none" stroke-width="3" pathLength="600" stroke-dasharray="1.2 8.8"/>
            <circle class="track" cx="50" cy="50" r="47" fill="none" stroke-width="1"/>
            <circle class="bar" cx="50" cy="50" r="47" fill="none" stroke-width="3" pathLength="1000" stroke-dasharray="1000"/>
          </svg>
          <div class="digits"></div>
        </div>`);
      this.bar = this.el.querySelector(".bar");
      this.digits = this.el.querySelector(".digits");
      this.loop = this.loop.bind(this);
      this.reset();
    }
    get phase() { return this.phases[this.idx]; }
    reset() {
      cancelAnimationFrame(this.raf);
      this.idx = 0;
      this.remaining = this.phase.seconds * 1000;
      this.lastSecs = null;
      this.state = "idle";
      this.render();
      this.opts.onState && this.opts.onState(this);
    }
    start() {
      if (this.state === "running" || this.state === "destroyed") return;
      if (this.state === "done") this.reset();
      Sound.unlock();
      this.state = "running";
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.loop);
      this.render();
      this.opts.onState && this.opts.onState(this);
    }
    pause() {
      if (this.state !== "running") return;
      cancelAnimationFrame(this.raf);
      this.state = "paused";
      this.render();
      this.opts.onState && this.opts.onState(this);
    }
    toggle() {
      if (this.state === "running") this.pause();
      else this.start();
    }
    loop(now) {
      if (this.state !== "running") return;
      this.remaining -= now - this.last;
      this.last = now;
      const secs = Math.ceil(this.remaining / 1000);
      if (secs !== this.lastSecs) {
        if (secs > 0 && secs <= 3) Sound.tick();
        this.lastSecs = secs;
      }
      if (this.remaining <= 0) this.advance();
      this.render();
      if (this.state === "running") this.raf = requestAnimationFrame(this.loop);
    }
    advance() {
      Sound.end();
      if (this.idx < this.phases.length - 1) {
        this.idx++;
        this.remaining = this.phase.seconds * 1000;
        this.lastSecs = null;
      } else {
        this.remaining = 0;
        this.state = "done";
        this.opts.onEnd && this.opts.onEnd();
      }
      this.opts.onState && this.opts.onState(this);
    }
    render() {
      const full = this.phase.seconds * 1000;
      const secs = Math.max(0, Math.ceil(this.remaining / 1000));
      this.bar.style.strokeDashoffset = String(1000 * (1 - Math.max(0, this.remaining) / full));
      this.digits.textContent = fmt(secs);
      const cl = this.el.classList;
      ["idle", "running", "paused", "done"].forEach((c) => cl.toggle(c, this.state === c));
      cl.toggle("warn", this.state === "running" && secs <= (this.phase.seconds > 20 ? 10 : 3));
    }
    destroy() {
      cancelAnimationFrame(this.raf);
      this.state = "destroyed";
    }
  }

  /* ═══════════════ Сборка списка слайдов ═══════════════ */
  const slides = [];
  const add = (kind, data = {}) => slides.push({ kind, ...data });
  const spare = Q.spare || [];

  add("title");
  add("intro");
  Q.questions.forEach((q, i) => add("q", { q, i, total: Q.questions.length }));
  spare.forEach((q, i) => add("q", { q, i, spare: true, hidden: true, key: `spare-${i}` }));
  add("answersIntro");
  Q.questions.forEach((q, i) => add("answer", { q, i, total: Q.questions.length }));
  // ответ на запасной вопрос появляется, только если сам вопрос показывали
  spare.forEach((q, i) => add("answer", { q, i, spare: true, hidden: true, key: `spare-${i}` }));
  add("end");

  function slideLabel(s) {
    const cut = (t, n = 36) => (t.length > n ? t.slice(0, n - 1) + "…" : t);
    switch (s.kind) {
      case "title": return "Заставка";
      case "intro": return "Суть игры";
      case "q": return (s.spare ? "Запасной: " : `${s.i + 1}. `) + cut(s.q.short || s.q.text);
      case "answersIntro": return "Ответы";
      case "answer": return s.spare ? "Ответ на запасной" : `Ответ ${s.i + 1}`;
      case "end": return "Конец";
      default: return s.kind;
    }
  }

  /* ═══════════════ Макет вопроса: вопрос слева, время справа ═══════════════ */
  /*
   * opts.cover   — html заставки с номером (показывается до клика)
   * opts.body    — html самого вопроса
   * opts.phases  — фазы таймера [{label, seconds}]
   * opts.steps   — показывать список фаз под таймером
   */
  function questionSlide(s, n, opts) {
    n.classList.add("s-q");
    const covered = NUMBER_FIRST && opts.cover;
    if (covered) n.classList.add("covered");
    n.innerHTML = `
      <div class="q-main">
        ${covered ? `<div class="q-cover">${opts.cover}</div>` : ""}
        <div class="q-body">${opts.body}</div>
      </div>
      <aside class="q-side">
        <div class="side-label">Время</div>
        <div class="timer-slot"></div>
        ${opts.steps ? `<ul class="steps">${opts.steps.map((st) => `<li><span>${esc(st[0])}</span><b>${esc(st[1])}</b></li>`).join("")}</ul>` : ""}
        <div class="status"></div>
      </aside>`;
    const status = n.querySelector(".status");
    const stepEls = [...n.querySelectorAll(".steps li")];
    const markStep = (k) => stepEls.forEach((li, j) => {
      li.classList.toggle("active", j === k);
      li.classList.toggle("past", j < k);
    });
    const timer = new Timer(opts.phases, {
      onState: (t) => {
        markStep(t.state === "idle" ? -1 : t.state === "done" ? t.phases.length : t.idx);
        if (t.state === "paused") status.textContent = "Пауза";
        else if (t.state !== "done") status.textContent = "";
      },
      onEnd: () => { status.textContent = opts.endText || "Время вышло"; },
    });
    n.querySelector(".timer-slot").appendChild(timer.el);

    let revealed = !covered;
    if (!covered) timer.start();

    return {
      timer,
      next: () => {
        if (revealed) return false;
        n.classList.remove("covered");
        revealed = true;
        timer.start();
        return true;
      },
      destroy: () => timer.destroy(),
    };
  }

  // Варианты ответа: номер + текст
  const optionsHtml = (q) => (q.options
    ? `<ol class="options">${q.options.map((o, k) => `<li><span class="opt-n">${k + 1}</span><span>${esc(o)}</span></li>`).join("")}</ol>`
    : "");

  // Уменьшаем шрифт (переменная --k), если содержимое не помещается в свой блок
  function fitText(box, content) {
    const run = () => {
      if (!box.isConnected) return;
      let k = 1;
      content.style.setProperty("--k", k);
      while (content.offsetHeight > box.clientHeight + 1 && k > 0.6) {
        k -= 0.04;
        content.style.setProperty("--k", k.toFixed(2));
      }
    };
    requestAnimationFrame(run);
    document.fonts && document.fonts.ready.then(() => requestAnimationFrame(run));
  }

  /* ═══════════════ Отрисовка слайдов ═══════════════ */
  const RENDER = {
    title(s, n) {
      const secs = Q.phases.reduce((sum, p) => sum + p.seconds, 0);
      const count = Q.questions.length;
      n.classList.add("s-title");
      n.innerHTML = `
        ${Q.subtitle ? `<div class="label appear">${esc(Q.subtitle)}</div>` : ""}
        <h1 class="appear" style="--i:1">${esc(Q.title)}</h1>
        <div class="brief">
          <div class="appear" style="--i:2"><span>Формат</span>${esc(Q.format)}</div>
          <div class="appear" style="--i:3"><span>Вопросов</span>${count}</div>
          <div class="appear" style="--i:4"><span>Время</span>${fmt(secs)}${secs < 60 ? " сек" : ""} на вопрос</div>
        </div>`;
    },

    intro(s, n) {
      n.classList.add("s-intro");
      n.innerHTML = `
        <div class="label appear">Суть игры</div>
        <h1 class="appear" style="--i:1">${esc(Q.format)}</h1>
        <p class="about appear" style="--i:2">${bold(Q.about)}</p>`;
    },

    q(s, n) {
      // показали запасной вопрос — его ответ тоже попадёт в разбор
      if (s.spare) slides.forEach((x) => { if (x.kind === "answer" && x.key === s.key) x.hidden = false; });
      const what = s.spare ? "Запасной вопрос" : "Вопрос";
      const q = questionSlide(s, n, {
        cover: `<div class="what">${what}</div><div class="big">${pad(s.i + 1)}${s.spare ? "" : `<small>/ ${pad(s.total)}</small>`}</div>`,
        body: `<div class="q-count">${what} <b>${s.i + 1}</b>${s.spare ? "" : ` из ${s.total}`}</div>
               <div class="q-text">${esc(s.q.text)}</div>
               ${optionsHtml(s.q)}`,
        phases: Q.phases,
        steps: Q.phases.length > 1 ? Q.phases.map((p) => [p.label, fmt(p.seconds)]) : null,
      });
      fitText(n.querySelector(".q-main"), n.querySelector(".q-body"));
      return q;
    },

    answersIntro(s, n) {
      n.classList.add("s-intro");
      n.innerHTML = `
        <div class="label appear">Разбор</div>
        <h1 class="appear" style="--i:1">Ответы</h1>
        <p class="about appear" style="--i:2">Сверяем ответы по порядку. Считаем, сколько правильных.</p>`;
    },

    /* ── Ответ: сначала вопрос с вариантами, по клику — правильный ответ (и картинка) ── */
    answer(s, n) {
      const q = s.q;
      n.classList.add("s-answer");
      const plain = !q.options;
      const reveal = [
        plain ? `<div class="a-answer">${esc(q.answer)}</div>` : "",
        q.note ? `<div class="a-note">${esc(q.note)}</div>` : "",
      ].join("");
      n.innerHTML = `
        <div class="a-main">
          <div class="a-body">
            <div class="q-count">${s.spare ? "Запасной вопрос" : `Ответ <b>${s.i + 1}</b> из ${s.total}`}</div>
            <div class="a-q">${esc(q.text)}</div>
            ${optionsHtml(q)}
            ${reveal ? `<div class="a-reveal">${reveal}</div>` : ""}
          </div>
        </div>
        ${q.image ? `<div class="a-pic"><img src="${esc(q.image)}" alt=""></div>` : ""}`;
      if (q.options && q.correct) n.querySelector(`.options li:nth-child(${q.correct})`).classList.add("correct");
      fitText(n.querySelector(".a-main"), n.querySelector(".a-body"));
      let shown = false;
      const show = (v) => { shown = v; n.classList.toggle("revealed", v); };
      return {
        next: () => { if (shown) return false; show(true); return true; },
        prev: () => { if (!shown) return false; show(false); return true; },
      };
    },

    end(s, n) {
      n.classList.add("s-end");
      n.innerHTML = `
        ${Q.subtitle ? `<div class="label appear">${esc(Q.subtitle)}</div>` : ""}
        <h1 class="appear" style="--i:1">Спасибо за игру!</h1>
        <p class="appear" style="--i:2">Подводим итоги</p>`;
    },
  };

  /* ═══════════════ Навигация ═══════════════ */
  let cur = -1;
  let ctrl = {};
  const hudPos = document.querySelector("#hud .pos");
  // Деления прогресса: по одному на каждый вопрос и каждый ответ
  const segs = slides.map((x, i) => [x, i]).filter(([x]) => !x.hidden && (x.kind === "q" || x.kind === "answer"));

  function updateChrome(s) {
    const bare = s.kind === "title" || s.kind === "end";
    chrome.classList.toggle("hidden", bare);
    progress.classList.toggle("hidden", bare);
    chrome.innerHTML = `<span class="round">${esc(Q.format)}</span><span></span>`;
    const at = segs.filter(([, i]) => i <= cur).length - 1;
    progress.innerHTML = segs.map((_, k) => `<div class="seg ${k < at ? "past" : ""} ${k === at ? "cur" : ""}"></div>`).join("");
    hudPos.textContent = `${cur + 1}/${slides.length}`;
  }

  function go(i) {
    i = Math.max(0, Math.min(slides.length - 1, i));
    if (ctrl.destroy) ctrl.destroy();
    stage.querySelectorAll(".slide:not(.leave)").forEach((old) => {
      old.classList.add("leave");
      setTimeout(() => old.remove(), 320);
    });
    cur = i;
    const s = slides[i];
    const node = el(`<section class="slide enter"></section>`);
    ctrl = RENDER[s.kind](s, node) || {};
    slidesRoot.appendChild(node);
    setTimeout(() => node.classList.remove("enter"), 600);
    updateChrome(s);
    store.set("slide", i);
    history.replaceState(null, "", "#" + (i + 1));
    if (overlay && overlay.type === "slides") drawOverlay();
  }

  function next() {
    if (ctrl.next && ctrl.next()) return;
    let j = cur + 1;
    while (j < slides.length && slides[j].hidden) j++;
    if (j < slides.length) go(j);
  }

  function prev() {
    if (ctrl.prev && ctrl.prev()) return;
    let j = cur - 1;
    while (j >= 0 && slides[j].hidden) j--;
    if (j >= 0) go(j);
  }

  /* ═══════════════ Окна ведущего ═══════════════ */
  let overlay = null;

  function closeOverlay() {
    if (!overlay) return false;
    overlay.node.remove();
    overlay = null;
    return true;
  }
  function openOverlay(type) {
    if (overlay && overlay.type === type) { closeOverlay(); return; }
    closeOverlay();
    const node = el(`<div class="overlay"><div class="panel"></div></div>`);
    node.addEventListener("click", (e) => { if (e.target === node) closeOverlay(); });
    overlay = { type, node, panel: node.firstElementChild };
    drawOverlay();
    stage.appendChild(node);
  }

  function drawOverlay() {
    const { type, panel } = overlay;
    if (type === "slides") {
      const item = (s, i) => `<button class="ov-item ${i === cur ? "cur" : ""} ${s.spare ? "spare" : ""}" data-i="${i}">${esc(slideLabel(s))}</button>`;
      panel.innerHTML = `
        <h3>Все слайды</h3>
        <div class="sub">Нажмите, чтобы перейти. Пунктиром — запасные вопросы: в обычном показе они пропускаются.</div>
        <div class="ov-list">${slides.map(item).join("")}</div>`;
      panel.querySelectorAll(".ov-item").forEach((b) => b.addEventListener("click", () => {
        closeOverlay();
        go(Number(b.dataset.i));
      }));
    }
    if (type === "help") {
      const keys = [
        ["Клик · → · Пробел · PgDn", "Дальше: показать вопрос и запустить время, следующий вопрос, открыть следующий ответ"],
        ["Правый клик · ← · PgUp", "Назад (в списке ответов — скрыть последний)"],
        ["P", "Пауза / продолжить время"],
        ["R", "Запустить время заново"],
        ["O", "Все слайды и запасные вопросы"],
        ["F", "Полный экран"],
        ["T", "Светлая / тёмная тема"],
        ["B", "Чёрный экран"],
        ["M", "Выключить / включить сигналы таймера"],
        ["Esc", "Закрыть окно"],
      ];
      panel.innerHTML = `
        <h3>Управление</h3>
        <div class="sub">Пульт-презентер тоже работает: он нажимает PgUp / PgDn.</div>
        <dl class="keys">${keys.map(([k, d]) => `<dt>${k.split(" · ").map((x) => `<span class="key">${x}</span>`).join(" ")}</dt><dd>${d}</dd>`).join("")}</dl>
        <div class="sub" style="margin-top:30px">Сигналы таймера: ${Sound.muted ? "выключены" : "включены"}.</div>`;
    }
  }

  /* ═══════════════ Клавиатура, мышь, экран ═══════════════ */
  function toggleTheme() {
    const light = document.documentElement.dataset.theme !== "light";
    document.documentElement.dataset.theme = light ? "light" : "dark";
    store.set("theme", light ? "light" : "dark");
  }
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  }
  function toggleBlack() {
    const b = stage.querySelector(".blackout");
    if (b) b.remove();
    else stage.appendChild(el(`<div class="blackout"></div>`));
  }
  const timerToggle = () => ctrl.timer && ctrl.timer.toggle();
  const timerReset = () => { if (ctrl.timer) { ctrl.timer.reset(); ctrl.timer.start(); } };
  const removeBlackout = () => {
    const b = stage.querySelector(".blackout");
    if (b) { b.remove(); return true; }
    return false;
  };

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    Sound.unlock();
    if (removeBlackout() && !["KeyB", "Period"].includes(e.code)) { e.preventDefault(); return; }

    switch (e.code) {
      case "Escape": closeOverlay(); break;
      case "KeyO": openOverlay("slides"); break;
      case "KeyH": case "Slash": case "F1": e.preventDefault(); openOverlay("help"); break;
      case "KeyF": toggleFullscreen(); break;
      case "KeyT": toggleTheme(); break;
      case "KeyB": case "Period": toggleBlack(); break;
      case "KeyM": Sound.muted = !Sound.muted; if (overlay && overlay.type === "help") drawOverlay(); break;
      case "KeyP": timerToggle(); break;
      case "KeyR": timerReset(); break;
      case "Home": closeOverlay(); go(0); break;
      case "End": closeOverlay(); go(slides.length - 1); break;
      default:
        if (overlay) return;
        if (["ArrowRight", "ArrowDown", "PageDown", "Space", "Enter", "NumpadEnter"].includes(e.code)) {
          e.preventDefault();
          next();
        } else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.code)) {
          e.preventDefault();
          prev();
        }
    }
  });

  // Клик мышью по экрану — дальше, правый клик — назад
  stage.addEventListener("click", (e) => {
    if (e.button !== 0 || e.target.closest(".overlay")) return;
    Sound.unlock();
    if (removeBlackout()) return;
    next();
  });
  stage.addEventListener("contextmenu", (e) => {
    if (e.target.closest(".overlay")) return;
    e.preventDefault();
    if (removeBlackout()) return;
    prev();
  });

  // Масштаб сцены под экран
  function fit() {
    const k = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    stage.style.transform = `translate(-50%, -50%) scale(${k})`;
  }
  window.addEventListener("resize", fit);
  fit();
  // Фокус на кнопке не должен прокручивать сцену
  document.addEventListener("scroll", (e) => {
    const t = e.target === document ? document.scrollingElement : e.target;
    if (t && (t.scrollTop || t.scrollLeft) && !(t.closest && t.closest(".overlay"))) { t.scrollTop = 0; t.scrollLeft = 0; }
  }, true);

  // Кнопки ведущего и скрытие курсора
  const hud = document.getElementById("hud");
  let idleT;
  document.addEventListener("mousemove", () => {
    hud.classList.add("show");
    document.body.classList.remove("hide-cursor");
    clearTimeout(idleT);
    idleT = setTimeout(() => {
      if (hud.matches(":hover")) return;
      hud.classList.remove("show");
      if (!overlay) document.body.classList.add("hide-cursor");
    }, 2500);
  });
  const HUD_ACTIONS = {
    prev, next,
    timer: timerToggle,
    slides: () => openOverlay("slides"),
    full: toggleFullscreen,
    theme: toggleTheme,
    help: () => openOverlay("help"),
  };
  hud.querySelectorAll("[data-a]").forEach((b) => b.addEventListener("click", (e) => {
    e.currentTarget.blur();
    Sound.unlock();
    HUD_ACTIONS[b.dataset.a]();
  }));

  // Тема
  document.documentElement.dataset.theme = store.get("theme", "dark");

  // Старт: слайд из адреса (#12) или последний открытый
  const fromHash = parseInt(location.hash.slice(1), 10);
  const start = Number.isFinite(fromHash) ? fromHash - 1 : store.get("slide", 0);
  window.addEventListener("hashchange", () => {
    const k = parseInt(location.hash.slice(1), 10) - 1;
    if (Number.isFinite(k) && k !== cur) go(k);
  });
  go(Number.isFinite(start) && slides[start] ? start : 0);
})();
