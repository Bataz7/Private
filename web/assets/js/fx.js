/* مؤثرات الأنميشن | Effects: aurora particles, ripple, spotlight, 3D tilt, confetti, splash */
(function () {
  const R = window.Revive, $ = R.$, root = document.documentElement;
  const reduce = matchMedia('(prefers-reduced-motion:reduce)').matches, coarse = matchMedia('(pointer:coarse)').matches;
  const enabled = () => !reduce && !root.classList.contains('fx-off');
  let rgb = '79,127,224';
  const readRgb = () => { rgb = getComputedStyle(root).getPropertyValue('--fxrgb').trim() || rgb; };

  /* ---------- جسيمات الخلفية ---------- */
  const cv = document.createElement('canvas'); cv.id = 'fx-canvas'; cv.setAttribute('aria-hidden', 'true');
  document.body.prepend(cv);
  const g = cv.getContext('2d'); let W = 0, H = 0, dpr = 1, P = [], mx = -999, my = -999, raf = 0;
  function size() {
    dpr = Math.min(devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight;
    cv.width = W * dpr; cv.height = H * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.min(coarse ? 28 : 70, Math.round(W * H / 20000));
    P = Array.from({ length: n }, () => ({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - .5) * .35, vy: (Math.random() - .5) * .35, r: 1 + Math.random() * 2 }));
  }
  function loop() {
    raf = 0; if (!enabled() || document.hidden) { g.clearRect(0, 0, W, H); return; }
    g.clearRect(0, 0, W, H);
    for (const p of P) {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > W) p.vx *= -1; if (p.y < 0 || p.y > H) p.vy *= -1;
      const dx = p.x - mx, dy = p.y - my, d = Math.hypot(dx, dy);
      if (d < 140) { p.x += dx / d * .9; p.y += dy / d * .9; }
      g.beginPath(); g.arc(p.x, p.y, p.r, 0, 6.283); g.fillStyle = `rgba(${rgb},.55)`; g.fill();
    }
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
      const a = P[i], b = P[j], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < 120) { g.strokeStyle = `rgba(${rgb},${(1 - d / 120) * .22})`; g.lineWidth = 1; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
    }
    raf = requestAnimationFrame(loop);
  }
  const start = () => { if (!raf && enabled()) raf = requestAnimationFrame(loop); };
  addEventListener('resize', () => { size(); start(); });
  document.addEventListener('visibilitychange', start);
  addEventListener('pointermove', e => { mx = e.clientX; my = e.clientY; }, { passive: true });
  document.addEventListener('revive:theme', () => { readRgb(); });
  document.addEventListener('revive:fx', () => { if (enabled()) start(); else g.clearRect(0, 0, W, H); });

  /* ---------- تتبّع المؤشر: إضاءة + ميلان 3D ---------- */
  const SPOT = '.card,.tile,.quick a,.l-card,.tm-card,.theme-card,.sc-group,.lg-row,.sec-row,.hello';
  let last = null;
  addEventListener('pointermove', e => {
    if (!enabled() || coarse) return;
    const el = e.target.closest && e.target.closest(SPOT);
    if (el) { const r = el.getBoundingClientRect(); el.style.setProperty('--mx', e.clientX - r.left + 'px'); el.style.setProperty('--my', e.clientY - r.top + 'px'); }
    const tl = e.target.closest && e.target.closest('[data-tilt]');
    if (last && last !== tl) last.style.transform = '';
    if (tl) {
      const r = tl.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5, k = +(tl.dataset.tilt || 8);
      tl.style.transform = `perspective(800px) rotateX(${(-y * k).toFixed(2)}deg) rotateY(${(x * k).toFixed(2)}deg) translateY(-4px)`;
    }
    last = tl;
  }, { passive: true });
  document.addEventListener('pointerleave', () => { if (last) { last.style.transform = ''; last = null; } });

  /* ---------- Ripple ---------- */
  document.addEventListener('pointerdown', e => {
    const el = e.target.closest('.btn,.pk,.tabs button,.lang-btn,.quick a,.tb-link,nav a,.theme-card,.l-btn');
    if (!el || reduce) return;
    const r = el.getBoundingClientRect(), s = Math.max(r.width, r.height) * 2, sp = document.createElement('span');
    sp.className = 'ripple'; sp.style.cssText = `width:${s}px;height:${s}px;left:${e.clientX - r.left - s / 2}px;top:${e.clientY - r.top - s / 2}px`;
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    el.style.overflow = el.style.overflow || 'hidden';
    el.appendChild(sp); setTimeout(() => sp.remove(), 700);
  });

  /* ---------- Confetti ---------- */
  function burst(x = innerWidth / 2, y = innerHeight - 90, n = 70) {
    if (!enabled()) return;
    const c = document.createElement('canvas'); c.className = 'confetti'; c.width = innerWidth; c.height = innerHeight; document.body.appendChild(c);
    const k = c.getContext('2d'), cs = getComputedStyle(root);
    const cols = ['--n3', '--accent', '--g3', '--n2'].map(v => cs.getPropertyValue(v).trim()).concat(['#ffd166', '#ffffff']);
    const ps = Array.from({ length: n }, () => { const a = -Math.PI / 2 + (Math.random() - .5) * 1.8, v = 6 + Math.random() * 9; return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, s: 4 + Math.random() * 6, c: cols[Math.random() * cols.length | 0], rot: Math.random() * 6, vr: (Math.random() - .5) * .4, life: 0 }; });
    (function f() {
      k.clearRect(0, 0, c.width, c.height); let alive = 0;
      for (const p of ps) { p.vy += .32; p.vx *= .985; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life++; if (p.y < c.height + 20 && p.life < 140) { alive++; k.save(); k.translate(p.x, p.y); k.rotate(p.rot); k.globalAlpha = Math.max(0, 1 - p.life / 140); k.fillStyle = p.c; k.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); k.restore(); } }
      alive ? requestAnimationFrame(f) : c.remove();
    })();
  }

  /* ---------- شاشة الافتتاح ---------- */
  function splash() {
    const s = $('#splash'); if (!s) return;
    let seen = false; try { seen = sessionStorage.getItem('revive_splash'); sessionStorage.setItem('revive_splash', '1'); } catch { /* ignore */ }
    if (seen || reduce) { s.remove(); return; }
    document.body.classList.add('splashing');
    setTimeout(() => { s.classList.add('out'); document.body.classList.remove('splashing'); setTimeout(() => s.remove(), 900); }, 1500);
  }

  readRgb(); size(); start(); splash();
  R.fx = { burst, enabled, toggle(on) { root.classList.toggle('fx-off', !on); R.LS.set('revive_fx', on ? '1' : '0'); document.dispatchEvent(new Event('revive:fx')); } };
})();
