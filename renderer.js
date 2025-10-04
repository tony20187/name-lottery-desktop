// renderer.js（分組穩定高效版 — 位置用 left/top，避免白屏與溢出）
// ✅ 只抽「有勾選」的組別
// ✅ 洗球：先量後定位 + left/top 更新 + 邊界反彈（不會白屏也不會溢出）
// ✅ 空白鍵抽獎（設定/預覽/得獎畫面可再次抽）
// ✅ 一次最多抽 5 人；字體依人數自動縮放
// ✅ 煙花在 overlay 背後；關閉即停音

const $ = (s) => document.querySelector(s);

// ----- setup -----
const excludeWinners = $("#excludeWinners");
const durationInput = $("#duration");
const durationVal = $("#durationVal");

const chkPreview = $("#chkPreview");
const chkMulti = $("#chkMulti");
const multiCount = $("#multiCount");
const chkSpaceStart = $("#chkSpaceStart");
if (chkSpaceStart) chkSpaceStart.checked = true;

const btnStart = $("#btnStart");
const btnClear = $("#btnClear");
const btnClearHistory = $("#btnClearHistory");
const errorEl = $("#error");

// views
const viewSetup = $("#viewSetup");
const viewPreview = $("#viewPreview");
const viewDraw = $("#viewDraw");

// 預覽
const previewCount = $("#previewCount");
const previewList = $("#previewList");
const btnBackToSetup = $("#btnBackToSetup");
const btnConfirmStart = $("#btnConfirmStart");

// 抽獎
const stage = $("#stage");
const leftSec = $("#leftSec");
const progressBar = $("#progressBar");
const winnerOverlay = $("#winnerOverlay");
const winnerNameEl = $("#winnerName");
const btnCloseOverlay = $("#btnCloseOverlay");
const historyList = $("#historyList");

// 音效
const sfxWash = $("#sfxWash");
const sfxWin  = $("#sfxWin");

// ----- state -----
let winners = [];
let countdown = 0;
let tmr = null;
let rafId = null;

const MAX_SHOW = 80;  // 同時顯示的球數
const MIN_V = 0.7;
const MAX_V = 1.5;

let dots = []; // { el, x, y, vx, vy, w, h }

// ====== 分組設定（若沒有這些節點，會自動退回單一輸入框 #inputNames）======
const groups = [
  { toggle: '#g1', box: '#g1Names' },
  { toggle: '#g2', box: '#g2Names' },
  { toggle: '#g3', box: '#g3Names' },
  { toggle: '#g4', box: '#g4Names' },
];

function initGroupToggles() {
  groups.forEach(g => {
    const t = document.querySelector(g.toggle);
    const body = document.querySelector(g.box)?.closest('.group');
    if (!t || !body) return;
    const update = () => { body.classList.toggle("open", !!t.checked); };
    t.addEventListener("change", update);
    update();
  });
}
document.addEventListener('DOMContentLoaded', initGroupToggles);

// ✅ 名字輸入框（單欄版本）自動撐高（若存在）
(function initAutoGrow(){
  const ta = document.querySelector("#inputNames");
  if (!ta) return;
  const autoGrow = () => {
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
  };
  ta.addEventListener("input", autoGrow);
  requestAnimationFrame(autoGrow);
})();

// 取得「有勾選」的所有組別名單（若頁面只有 #inputNames，仍支援）
function getAvailableNames() {
  const hasGroups = groups.some(g => document.querySelector(g.box));
  let rawText = "";

  if (hasGroups) {
    rawText = groups
      .filter(g => document.querySelector(g.toggle)?.checked)
      .map(g => document.querySelector(g.box)?.value || '')
      .join('\n');
  } else {
    rawText = (document.querySelector("#inputNames")?.value || "");
  }

  let names = rawText.split(/[\n,，]+/).map(s => s.trim()).filter(Boolean);
  if (excludeWinners?.checked) names = names.filter(n => !winners.includes(n));
  return Array.from(new Set(names)).sort((a,b)=>a.localeCompare(b,'zh-Hant'));
}

// ====== 綁定 ======
durationInput?.addEventListener("input", () => {
  durationVal.textContent = durationInput.value + "s";
});

chkMulti?.addEventListener("change", () => {
  if (multiCount) multiCount.disabled = !chkMulti.checked;
});

btnClear?.addEventListener("click", () => {
  const hasGroups = groups.some(g => document.querySelector(g.box));
  if (hasGroups) {
    groups.forEach(g => {
      const box = document.querySelector(g.box);
      if (box) box.value = "";
    });
  } else {
    const ta = document.querySelector("#inputNames");
    if (ta) { ta.value = ""; ta.dispatchEvent(new Event("input")); }
  }
});

btnClearHistory?.addEventListener("click", () => {
  winners = [];
  historyList.innerHTML = "";
});

btnStart?.addEventListener("click", () => {
  const names = getAvailableNames();
  if (!names.length) return showError("請輸入至少一個名字（在勾選的組別中）");
  showError("");
  if (chkPreview?.checked) { renderPreview(names); switchView("preview"); }
  else { switchView("draw"); startDraw(names); }
});

btnBackToSetup?.addEventListener("click", () => switchView("setup"));

btnConfirmStart?.addEventListener("click", () => {
  const names = getAvailableNames();
  switchView("draw");
  startDraw(names);
});

btnCloseOverlay?.addEventListener("click", closeOverlayToSetup);
winnerOverlay?.addEventListener("click", (e) => {
  const m = winnerOverlay.querySelector(".modal");
  if (m && !m.contains(e.target)) closeOverlayToSetup();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && winnerOverlay.classList.contains("show")) closeOverlayToSetup();
});

// 空白鍵：設定/預覽（勾預覽→先進預覽；得獎畫面可再抽）
(function () {
  const isTyping = (el) => {
    if (!el) return false;
    if (el.getAttribute?.("contenteditable") === "true") return true;
    const tag = el.tagName?.toLowerCase();
    if (tag === "textarea") return true;
    if (tag === "input") {
      const t = (el.type || "").toLowerCase();
      return ["text","search","email","url","tel","password","number"].includes(t);
    }
    return false;
  };

  document.addEventListener("keydown", (e) => {
    if (!(e.code === "Space" || e.key === " ")) return;
    if (!chkSpaceStart?.checked) return;

    // 得獎畫面：直接再抽一次
    if (winnerOverlay?.classList.contains("show")) {
      e.preventDefault();
      e.stopImmediatePropagation();
      safeStop(sfxWin);
      let names = getAvailableNames();
      if (!names.length) {
        winnerOverlay.classList.remove('show');
        switchView('setup');
        return;
      }
      winnerOverlay.classList.remove('show');
      switchView('draw');
      startDraw(names);
      return;
    }

    if (isTyping(document.activeElement)) return;

    const onSetup   = !viewSetup?.classList.contains("hidden");
    const onPreview = !viewPreview?.classList.contains("hidden");

    e.preventDefault();
    e.stopImmediatePropagation();

    if (onSetup && chkPreview?.checked) {
      const names = getAvailableNames();
      if (!names.length) return showError("請輸入至少一個名字（在勾選的組別中）");
      renderPreview(names);
      switchView("preview");
      return;
    }
    if (onPreview) { btnConfirmStart?.click(); return; }
    if (onSetup)   { btnStart?.click(); }
  }, true);
})();

// ====== 工具 ======
function showError(msg) {
  errorEl.textContent = msg || "";
  errorEl.hidden = !msg;
}
function switchView(v) {
  viewSetup.classList.add("hidden");
  viewPreview.classList.add("hidden");
  viewDraw.classList.add("hidden");
  ({ setup: viewSetup, preview: viewPreview, draw: viewDraw }[v]).classList.remove("hidden");
}

// 預覽（每排 10 個）
function renderPreview(names) {
  previewCount.textContent = String(names.length);
  previewList.innerHTML = "";
  previewList.style.display = "flex";
  previewList.style.flexWrap = "wrap";
  names.forEach((name) => {
    const span = document.createElement("span");
    span.textContent = name;
    span.style.width = "10%";
    span.style.textAlign = "center";
    span.style.whiteSpace = "nowrap";
    span.style.boxSizing = "border-box";
    span.style.padding = "4px 0";
    previewList.appendChild(span);
  });
}

// ====== 舞台保護 ======
function prepareStage() {
  if (!stage) return;
  const st = stage.style;
  if (getComputedStyle(stage).position === "static") st.position = "relative";
  st.overflow = "hidden";
  if (stage.clientHeight < 120) st.minHeight = "60vh";
}
function getStageRect() {
  let r = stage?.getBoundingClientRect?.();
  if (!r || r.width < 10 || r.height < 10) {
    const w = stage?.clientWidth || 0, h = stage?.clientHeight || 0;
    if (w >= 10 && h >= 10) r = { width: w, height: h, left: 0, top: 0 };
  }
  if (!r || r.width < 10 || r.height < 10) {
    r = { width: Math.floor(window.innerWidth * 0.8), height: Math.floor(window.innerHeight * 0.6), left: 0, top: 0 };
  }
  return r;
}
function withReadyStage(cb) {
  prepareStage();
  let tries = 0;
  const MAX_TRIES = 60; // 約 1 秒
  function check() {
    const r = getStageRect();
    if (r && r.width > 30 && r.height > 30) cb();
    else if (tries++ < MAX_TRIES) requestAnimationFrame(check);
    else cb(); // 兜底
  }
  requestAnimationFrame(check);
}

// ====== 洗球（使用 left/top，最穩定，不會白屏，也不會溢出） ======
function clearDots() {
  cancelAnimationFrame(rafId);
  dots.forEach(d => d.el.remove());
  dots = [];
}
function spawnDots(names) {
  clearDots();
  const r = getStageRect();
  const W = Math.max(r.width, 200);
  const H = Math.max(r.height, 150);
  if (!names || !names.length) return;

  const list = shuffle(names).slice(0, Math.min(names.length, MAX_SHOW));
  const frag = document.createDocumentFragment();

  list.forEach((n) => {
    const el = document.createElement("span");
    el.textContent = n;

    // 只保留必要樣式；用 left/top 來定位
    Object.assign(el.style, {
      position: "absolute",
      left: "0px",
      top: "0px",
      visibility: "hidden",   // 先隱藏量尺寸，避免閃爍
      pointerEvents: "none",
      userSelect: "none",
      zIndex: "1",
      background: "#FFF3CD",
      border: "1px solid #F9C74F",
      color: "#7A5200",
      padding: "6px 12px",
      borderRadius: "9999px",
      boxShadow: "0 2px 8px rgba(0,0,0,.06)",
      fontWeight: "600",
      fontSize: "16px",
      lineHeight: "1",
      whiteSpace: "nowrap",
    });

    frag.appendChild(el);
    dots.push({ el, x: 0, y: 0, vx: 0, vy: 0, w: 0, h: 0 });
  });

  stage.appendChild(frag);

  // 量尺寸、定位、速度（左上角座標）
  dots.forEach((d) => {
    d.w = d.el.offsetWidth || 64;
    d.h = d.el.offsetHeight || 30;

    d.x = clamp(rand(0, W - d.w), 0, W - d.w);
    d.y = clamp(rand(0, H - d.h), 0, H - d.h);

    const rnd = () => {
      let v = rand(MIN_V, MAX_V) * (Math.random() < 0.5 ? -1 : 1);
      if (Math.abs(v) < MIN_V * 0.6) v = (v < 0 ? -1 : 1) * MIN_V * 0.8;
      return v;
    };
    d.vx = rnd();
    d.vy = rnd();

    d.el.style.left = d.x + "px";
    d.el.style.top  = d.y + "px";
    d.el.style.visibility = "visible";
  });
}
function animateDots() {
  const r = getStageRect();
  const W = Math.max(r.width, 200);
  const H = Math.max(r.height, 150);

  for (let b of dots) {
    b.x += b.vx;
    b.y += b.vy;

    // 左上角邊界反彈（不會溢出）
    if (b.x < 0)        { b.x = 0;        b.vx = -b.vx; }
    if (b.x > W - b.w)  { b.x = W - b.w;  b.vx = -b.vx; }
    if (b.y < 0)        { b.y = 0;        b.vy = -b.vy; }
    if (b.y > H - b.h)  { b.y = H - b.h;  b.vy = -b.vy; }

    // 直接用 left/top 更新
    b.el.style.left = b.x + "px";
    b.el.style.top  = b.y + "px";
  }

  rafId = requestAnimationFrame(animateDots);
}

// 標籤切背景時暫停 rAF（省資源）
document.addEventListener("visibilitychange", () => {
  if (document.hidden) cancelAnimationFrame(rafId);
  else rafId = requestAnimationFrame(animateDots);
});

// ====== 主流程 ======
function startDraw(names) {
  safeStop(sfxWash);
  safeStop(sfxWin);

  const sec = Math.max(5, Math.min(10, parseInt(durationInput.value) || 7));
  countdown = sec;
  leftSec.textContent = countdown;
  progressBar.style.width = "100%";

  withReadyStage(() => {
    spawnDots(names);
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(animateDots);
  });

  if (sfxWash) {
    sfxWash.loop = true;
    sfxWash.volume = 1;
    sfxWash.muted = false;
    sfxWash.play().catch(()=>{});
  }

  clearInterval(tmr);
  tmr = setInterval(() => {
    countdown--;
    leftSec.textContent = countdown;
    progressBar.style.width = (countdown / sec) * 100 + "%";
    if (countdown <= 0) {
      clearInterval(tmr);
      cancelAnimationFrame(rafId);
      prePlayWinMusic();
      finishDraw(names);
    }
  }, 1000);
}

function finishDraw(names) {
  safeStop(sfxWash);

  let k = 1;
  if (chkMulti?.checked) {
    let n = parseInt(multiCount.value) || 1;
    if (n > 5) n = 5;
    k = Math.max(1, Math.min(n, names.length));
  }

  const pool = [...names];
  const picked = [];
  for (let i = 0; i < k; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    picked.push(pool[idx]);
    pool.splice(idx, 1);
  }

  picked.forEach((name) => {
    winners.unshift(name);
    const li = document.createElement("li");
    li.textContent = name;
    historyList.prepend(li);
  });

  // 顯示中獎（字體自適應）
  winnerNameEl.innerHTML = picked.join("<br>");
  winnerNameEl.style.fontSize =
    (picked.length === 1) ? "6rem" :
    (picked.length <= 3) ? "4rem" : "3rem";

  winnerOverlay.classList.add("show");

  if (sfxWin) {
    sfxWin.volume = 1;
    sfxWin.muted = false;
    if (sfxWin.paused) { sfxWin.currentTime = 0; sfxWin.play().catch(()=>{}); }
  }
}

function closeOverlayToSetup() {
  safeStop(sfxWash);
  safeStop(sfxWin);
  winnerOverlay.classList.remove("show");
  switchView("setup");
}

// ====== 煙花（overlay 背景） ======
(function () {
  const overlay = $("#winnerOverlay");
  if (!overlay) return;

  let canvas, ctx, rafRef, particles = [], running = false, lastSpawn = 0;

  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement("canvas");
    canvas.id = "fireworksCanvas";
    Object.assign(canvas.style, { position: "absolute", inset: "0", zIndex: "0", pointerEvents: "none" });
    overlay.prepend(canvas);
    ctx = canvas.getContext("2d");
    onResize();
    window.addEventListener("resize", onResize);
  }
  function onResize() {
    const r = overlay.getBoundingClientRect();
    canvas.width  = Math.max(1, r.width);
    canvas.height = Math.max(1, r.height);
  }
  function spawnBurst(x, y) {
    const count = 48 + Math.floor(Math.random()*24);
    const hue = Math.floor(Math.random()*360);
    for (let i = 0; i < count; i++) {
      const ang = (Math.PI*2*i)/count + Math.random()*0.1;
      const spd = 2 + Math.random()*4;
      particles.push({x, y, vx: Math.cos(ang)*spd, vy: Math.sin(ang)*spd, life: 60+Math.random()*30, size: 2+Math.random()*2, hue});
    }
  }
  function tick(ts) {
    if (!running) return;
    rafRef = requestAnimationFrame(tick);

    if (!lastSpawn) lastSpawn = ts;
    if (ts - lastSpawn > 350) {
      lastSpawn = ts;
      const r = canvas.getBoundingClientRect();
      spawnBurst(Math.random()*r.width, Math.random()*r.height*0.7);
    }

    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.fillRect(0,0,canvas.width,canvas.height);

    for (let i=particles.length-1;i>=0;i--){
      const p = particles[i];
      p.vy += 0.03; p.vx *= 0.99; p.vy *= 0.99;
      p.x += p.vx;  p.y += p.vy;  p.life--;
      ctx.beginPath(); ctx.arc(p.x,p.y,p.size,0,Math.PI*2);
      ctx.fillStyle = `hsla(${p.hue},100%,60%,${p.life/60})`;
      ctx.fill();
      if (p.life <= 0) particles.splice(i,1);
    }
  }
  function start(){ ensureCanvas(); running = true; particles = []; lastSpawn = 0; ctx.clearRect(0,0,canvas.width,canvas.height); rafRef = requestAnimationFrame(tick); }
  function stop(){ running = false; cancelAnimationFrame(rafRef); particles = []; ctx && ctx.clearRect(0,0,canvas.width,canvas.height); }

  new MutationObserver(()=>{ overlay.classList.contains("show") ? start() : stop(); })
    .observe(overlay, { attributes: true, attributeFilter: ["class"] });
})();

// ====== 音效工具 / 預播 ======
function prePlayWinMusic() {
  try { sfxWin.volume = 1; sfxWin.muted = false; sfxWin.currentTime = 0; sfxWin.play().catch(()=>{}); } catch {}
}
function safeStop(aud){
  try { aud?.pause(); aud.currentTime = 0; } catch {}
}

// ====== 小工具 ======
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function rand(min, max) { return Math.random() * (max - min) + min; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// 版本顯示（可忽略例外）
try { document.getElementById("version").textContent = "v" + process.versions.electron; } catch {}
