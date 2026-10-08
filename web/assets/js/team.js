/* صفحة الفريق | Team page: renders cards from team-data.js, filters, copy-to-clipboard */
(function () {
  const { $, $$, t, esc, toast, onLang, init, numberFmt, lang } = Revive;
  const ROLE_ICON = { owner: 'crown', dev: 'code', support: 'support', design: 'palette', mod: 'shield' };
  let filter = 'all';
  const L = () => Revive.lang;
  const initials = n => (n.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2) || '?').toUpperCase();
  const avatar = m => `<div class="tm-av">${m.avatar ? `<img src="${esc(m.avatar)}" alt="">` : esc(initials(m.name))}</div>`;

  function card(m, i, big) {
    const roleName = m.title[L()] || m.title.ar;
    return `<article class="tm-card ${big ? 'founder' : ''}" data-role="${m.role}" ${big ? 'data-tilt="3"' : 'data-tilt="9"'} style="--i:${i}">
      ${m.sample ? `<span class="tm-tag">${esc(t('team.sample'))}</span>` : ''}
      ${avatar(m)}
      <div>
        <h3 class="tm-name">${esc(m.name)}</h3>
        <span class="tm-role">${m.role === 'owner' ? `<span class="tm-crown">${ic('crown')}</span>` : ic(ROLE_ICON[m.role])}${esc(roleName)}</span>
        <p class="tm-bio">${esc(m.bio[L()] || m.bio.ar)}</p>
        <div class="tm-foot">${m.since ? `<span>${ic('calendar')} ${esc(t('team.since', { y: m.since }))}</span>` : ''}${m.discord ? `<button type="button" class="tm-chip" data-copy="${esc(m.discord)}">${ic('discord')}${esc(m.discord)}</button>` : ''}</div>
      </div></article>`;
  }

  function render() {
    const all = window.TEAM, founder = all.find(m => m.role === 'owner'), rest = all.filter(m => m !== founder);
    const roles = [...new Set(all.map(m => m.role))];
    $('#tm-stats').innerHTML = [[all.length, t('team.members')], [roles.length, t('team.roles')], ['24/7', t('land.always')]].map(([n, l], i) =>
      `<div class="tm-stat" style="--i:${i}"><b ${typeof n === 'number' ? `data-n="${n}"` : 'dir="ltr"'}>${typeof n === 'number' ? 0 : n}</b><span>${esc(l)}</span></div>`).join('');
    $$('#tm-stats [data-n]').forEach(el => { let t0 = null; const to = +el.dataset.n; const step = ts => { if (!t0) t0 = ts; const p = Math.min((ts - t0) / 1200, 1); el.textContent = numberFmt(Math.round(to * (1 - Math.pow(1 - p, 3)))); if (p < 1) requestAnimationFrame(step); }; requestAnimationFrame(step); });
    $('#tm-founder').innerHTML = founder ? card(founder, 0, true) : '';
    const rr = [...new Set(rest.map(m => m.role))];
    $('#tm-filters').innerHTML = ['all', ...rr].map(r => `<button type="button" data-f="${r}" class="${r === filter ? 'on' : ''}">${esc(r === 'all' ? t('team.all') : t('team.roleNames.' + r))}</button>`).join('');
    $('#tm-grid').innerHTML = rest.map((m, i) => card(m, i + 1)).join('');
    apply();
  }
  function apply() { $$('#tm-grid .tm-card').forEach(c => c.classList.toggle('hide', filter !== 'all' && c.dataset.role !== filter)); $$('#tm-filters button').forEach(b => b.classList.toggle('on', b.dataset.f === filter)); }

  document.addEventListener('click', e => {
    const f = e.target.closest('#tm-filters button'); if (f) { filter = f.dataset.f; apply(); return; }
    const c = e.target.closest('[data-copy]');
    if (c) { (navigator.clipboard ? navigator.clipboard.writeText(c.dataset.copy) : Promise.reject()).then(() => { toast(t('team.copy')); Revive.fx && Revive.fx.burst(e.clientX, e.clientY, 30); }).catch(() => {}); }
  });
  init(); render(); onLang(render);
})();
