/* صفحة الفريق | Team page: filters, count-up, copy (الصفحة نفسها يبنيها Python) */
(function () {
  const { $, $$, t, toast, countUp } = Revive;
  let filter = 'all';
  $$('[data-n]').forEach(el => countUp(el, +el.dataset.n));
  document.addEventListener('click', e => {
    const f = e.target.closest('#tm-filters button');
    if (f) { filter = f.dataset.f; $$('#tm-filters button').forEach(b => b.classList.toggle('on', b === f)); $$('#tm-grid .tm-card').forEach(c => c.classList.toggle('hide', filter !== 'all' && c.dataset.role !== filter)); return; }
    const c = e.target.closest('[data-copy]');
    if (c && navigator.clipboard) navigator.clipboard.writeText(c.dataset.copy).then(() => { toast(t('team.copy')); Revive.fx && Revive.fx.burst(e.clientX, e.clientY, 30); }).catch(() => {});
  });
})();
