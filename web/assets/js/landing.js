/* الصفحة الرئيسية | Landing page: i18n, cards, reveal-on-scroll, parallax */
(function () {
  const { $, $$, t, api, esc, onLang, init } = Revive;
  const ICONS = ['shield', 'bolt', 'sliders', 'smile', 'ticket', 'logs'];
  const DIRS = ['right', '', 'left', 'right', '', 'left'];

  function render(again) {
    $('#marquee').innerHTML = [...t('land.marquee'), ...t('land.marquee')].map(x => `<span>${esc(x)}</span>`).join('');
    $('#cards').innerHTML = t('land.cards').map(([h, p], i) =>
      `<article class="l-card l-reveal${again ? ' in done' : ''}" ${DIRS[i] ? `data-d="${DIRS[i]}"` : ''} style="--i:${i % 3}"><div class="l-ico">${ic(ICONS[i], 'l-i')}</div><h3>${esc(h)}</h3><p>${esc(p)}</p></article>`).join('');
    bindCards();
  }

  /* تأثير ميلان البطاقات */
  const coarse = matchMedia('(pointer:coarse)').matches, reduce = matchMedia('(prefers-reduced-motion:reduce)').matches;
  function bindCards() {
    if (coarse || reduce) return;
    $$('.l-card').forEach(c => {
      let raf = 0, ex = 0, ey = 0;
      c.addEventListener('pointermove', e => {
        ex = e.clientX; ey = e.clientY; if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0; const r = c.getBoundingClientRect(), x = (ex - r.left) / r.width - .5, y = (ey - r.top) / r.height - .5;
          c.style.transform = `perspective(900px) rotateX(${(-y * 10).toFixed(2)}deg) rotateY(${(x * 10).toFixed(2)}deg) translate3d(0,-6px,0)`;
        });
      });
      c.addEventListener('pointerleave', () => { c.style.transform = ''; });
    });
  }

  function effects() {
    const root = $('.rl'); root.classList.add('l-js');
    $$('.l-stats').forEach(g => [...g.children].forEach((c, i) => c.style.setProperty('--i', i)));
    const count = scope => scope.querySelectorAll('[data-count]').forEach(n => {
      const to = parseFloat(n.dataset.count), dec = (n.dataset.count.split('.')[1] || '').length, suf = n.dataset.suffix || ''; let t0 = null;
      const step = ts => { if (!t0) t0 = ts; const p = Math.min((ts - t0) / 1600, 1), e = 1 - Math.pow(1 - p, 4); n.textContent = (to * e).toFixed(dec) + suf; if (p < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
    const show = el => { el.classList.add('in'); if (el.querySelector('[data-count]')) count(el); if (el.classList.contains('l-card')) setTimeout(() => el.classList.add('done'), 1300); };
    const els = $$('.l-reveal:not(.in)');
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { show(e.target); io.unobserve(e.target); } }), { threshold: .12, rootMargin: '0px 0px -5% 0px' });
      els.forEach(el => io.observe(el));
    } else els.forEach(show);

    const sw = $$('.l-swirl').map(e => ({ e, s: parseFloat(e.dataset.s || 0), r: parseFloat(e.dataset.r || 0) }));
    const bar = $('.l-progress'), stage = $('.l-stage'), glow = $('.l-glow');
    let lastY = -1, busy = false, gx = innerWidth / 2, gy = innerHeight / 3, tx = gx, ty = gy, maxScroll = 1;
    const measure = () => { maxScroll = Math.max(document.documentElement.scrollHeight - innerHeight, 1); };
    measure(); addEventListener('resize', measure); addEventListener('load', measure);
    const req = () => { if (!busy) { busy = true; requestAnimationFrame(frame); } };
    function frame() {
      busy = false; const y = window.pageYOffset;
      if (y !== lastY) {
        lastY = y;
        if (!reduce) {
          sw.forEach(o => { o.e.style.transform = `translate3d(0,${(y * o.s).toFixed(1)}px,0) rotate(${(y * o.r).toFixed(2)}deg)`; });
          if (stage && y < innerHeight * 1.2) { const p = Math.min(y / (innerHeight * .9), 1); stage.style.transform = `translate3d(0,${(y * .28).toFixed(1)}px,0) scale(${(1 - p * .14).toFixed(3)})`; stage.style.opacity = (1 - p * .85).toFixed(3); }
        }
        bar.style.transform = `scaleX(${Math.min(y / maxScroll, 1).toFixed(4)})`;
      }
      if (glow) { gx += (tx - gx) * .14; gy += (ty - gy) * .14; glow.style.transform = `translate3d(${gx.toFixed(1)}px,${gy.toFixed(1)}px,0)`; if (Math.abs(tx - gx) > .6 || Math.abs(ty - gy) > .6) req(); }
    }
    addEventListener('scroll', req, { passive: true });
    if (!coarse && !reduce) addEventListener('pointermove', e => { tx = e.clientX; ty = e.clientY; req(); }, { passive: true });
    req();
    const box = $('.l-particles');
    if (box && !reduce && !coarse) for (let i = 0; i < 4; i++) {
      const s = document.createElement('span');
      s.style.setProperty('--x', Math.random() * 100 + '%'); s.style.setProperty('--s', 3 + Math.random() * 6 + 'px');
      s.style.setProperty('--d', 12 + Math.random() * 14 + 's'); s.style.setProperty('--dl', -Math.random() * 20 + 's');
      box.appendChild(s);
    }
  }

  /* هل المستخدم مسجّل؟ نعرض صورته بدل «تسجيل الدخول» */
  async function whoami() {
    try {
      const me = await api('/api/me', { quiet: true });
      const b = $('#tb-cta');
      b.classList.add('avatar');
      b.innerHTML = `<img src="${esc(me.avatar)}" alt=""><span data-i18n="land.dashboard"></span>`;
      Revive.applyStatic(b);
    } catch { /* زائر */ }
  }

  $('#to-features').addEventListener('click', e => { e.preventDefault(); $('#l-features').scrollIntoView({ behavior: 'smooth' }); });
  init(); render(false); onLang(() => render(true)); effects(); whoami();
})();
