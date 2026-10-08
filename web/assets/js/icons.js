/* مكتبة الأيقونات | Icon set — inline SVG sprite (24x24, stroke). استخدم: Revive.ic('home') */
(function () {
  const I = {
    home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
    chart: '<path d="M5 20v-8M12 20V5M19 20V9"/><path d="M3 20h18"/>',
    trending: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    'user-plus': '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-3.9 3.1-7 7-7s7 3.1 7 7"/><path d="M19 8v6M16 11h6"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.6a3.5 3.5 0 010 6.8M18 14.3c2.3.7 3.5 2.6 3.5 5.7"/>',
    'user-x': '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-3.9 3.1-7 7-7s7 3.1 7 7"/><path d="M17 9l5 5M22 9l-5 5"/>',
    ticket: '<path d="M4 7h16v3a2 2 0 000 4v3H4v-3a2 2 0 000-4z"/><path d="M14 7v2M14 11v2M14 15v2"/>',
    clipboard: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1M9 11h6M9 15h6"/>',
    activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    'id-card': '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M6 16c.5-1.5 1.7-2 3-2s2.5.5 3 2M14 10h4M14 14h4"/>',
    crosshair: '<circle cx="12" cy="12" r="8"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>',
    traffic: '<rect x="8" y="2" width="8" height="20" rx="3"/><circle cx="12" cy="7" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="17" r="1.2"/>',
    landmark: '<path d="M3 10l9-6 9 6"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18M4 18h16"/>',
    building: '<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-3h4v3"/>',
    'check-circle': '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>',
    'alert-circle': '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5M12 16h.01"/>',
    message: '<path d="M4 5a1 1 0 011-1h14a1 1 0 011 1v10a1 1 0 01-1 1H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
    'message-x': '<path d="M4 5a1 1 0 011-1h14a1 1 0 011 1v10a1 1 0 01-1 1H9l-5 4z"/><path d="M10 8l4 4M14 8l-4 4"/>',
    tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/>',
    'tag-plus': '<path d="M3 12V4h8l10 10-8 8z"/><path d="M9 7.5v4M7 9.5h4"/>',
    'tag-off': '<path d="M3 12V4h8l10 10-8 8z"/><path d="M4 20L20 4"/>',
    bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-4.5"/>',
    ban: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
    moon: '<path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z"/>',
    send: '<path d="M21 3L3 10.5l7 2.5 2.5 7z"/><path d="M10 13l5-5"/>',
    logs: '<path d="M7 3h8l4 4v14H7z"/><path d="M15 3v4h4M10 12h6M10 16h6"/>',
    smile: '<circle cx="12" cy="12" r="9"/><path d="M8 14c1 1.5 2.4 2.2 4 2.2s3-.7 4-2.2M9 9.5h.01M15 9.5h.01"/>',
    sliders: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
    'log-in': '<path d="M15 4h4v16h-4M8 8l4 4-4 4M12 12H3"/>',
    logout: '<path d="M9 4H5v16h4M16 8l4 4-4 4M20 12H9"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    server: '<rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M7 7h.01M7 17h.01"/>',
    save: '<path d="M5 3h11l4 4v14H5z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    pencil: '<path d="M15 5l4 4M4 20l1-5L16.5 3.5a2.1 2.1 0 013 3L8 18z"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9 17h6"/><circle cx="12" cy="3.5" r="1"/>',
    support: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="M5.6 5.6l3.9 3.9M14.5 14.5l3.9 3.9M18.4 5.6l-3.9 3.9M9.5 14.5l-3.9 3.9"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    hammer: '<path d="M13 6l5 5M3 21l8-8M9.5 7.5l4-4 7 7-4 4z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    'timer-off': '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6M3 3l18 18"/>',
    folder: '<path d="M3 6a1 1 0 011-1h5l2 2h9a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1z"/>',
    'folder-plus': '<path d="M3 6a1 1 0 011-1h5l2 2h9a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1z"/><path d="M12 11v6M9 14h6"/>',
    'folder-x': '<path d="M3 6a1 1 0 011-1h5l2 2h9a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1z"/><path d="M10 12l4 4M14 12l-4 4"/>',
    'folder-edit': '<path d="M3 6a1 1 0 011-1h5l2 2h9a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1z"/><path d="M8 15.5h8M8 12.5h5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
    crown: '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/>',
    link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3A4 4 0 0011 18.7l1-1"/>',
    warn: '<path d="M12 3L2 20h20z"/><path d="M12 9v5M12 17h.01"/>',
    unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 017.5-2"/>',
    pointer: '<path d="M5 3l14 7-6 2-2 6z"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    calendar: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
    spinner: '<path d="M12 3a9 9 0 019 9"/>',
    code: '<path d="M9 8l-5 4 5 4M15 8l5 4-5 4"/>'
  };

  /* شعار الغصن — emblem (filled) */
  const EMBLEM = '<g fill="currentColor"><path d="M58 52h5l1 34h-7z"/><path d="M60 50c-6-14-20-18-32-13 10 0 18 4 24 12-10-6-22-4-28 4 10-4 18-2 26 4-8 0-14 4-17 10 8-5 15-5 22-1l5-16zM60 50c6-14 20-18 32-13-10 0-18 4-24 12 10-6 22-4 28 4-10-4-18-2-26 4 8 0 14 4 17 10-8-5-15-5-22-1l-5-16zM60 48c-3-8-2-16 0-22 2 6 3 14 0 22z"/></g><g fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"><path d="M14 78c24 4 50 12 78 30"/><path d="M106 78c-24 4-50 12-78 30"/></g><circle cx="94" cy="106" r="3.5" fill="currentColor"/><circle cx="26" cy="106" r="3.5" fill="currentColor"/>';

  function sprite() {
    if (document.getElementById('icon-sprite')) return;
    const s = '<svg id="icon-sprite" width="0" height="0" style="position:absolute" aria-hidden="true"><defs>' +
      Object.entries(I).map(([k, v]) => `<symbol id="i-${k}" viewBox="0 0 24 24">${v}</symbol>`).join('') +
      `<symbol id="i-emblem" viewBox="0 0 120 110">${EMBLEM}</symbol></defs></svg>`;
    document.body.insertAdjacentHTML('afterbegin', s);
  }
  window.ICON_NAMES = Object.keys(I);
  window.ic = (name, cls = '') => `<svg class="i${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  if (document.body) sprite(); else document.addEventListener('DOMContentLoaded', sprite);
})();
