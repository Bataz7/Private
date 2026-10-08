/* يُحمَّل في <head> قبل الرسم حتى ما يومض الثيم | applies saved theme before first paint */
(function () {
  try {
    var t = localStorage.getItem('revive_theme');
    if (t) document.documentElement.setAttribute('data-theme', t);
    if (localStorage.getItem('revive_fx') === '0') document.documentElement.classList.add('fx-off');
  } catch (e) { /* storage blocked */ }
})();
