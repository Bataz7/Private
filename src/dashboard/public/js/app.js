import { api, toast, $, esc, avatar, date, stars, average } from './ui.js';
import { ic } from './icon.js';
import './icon.js';
import { localize } from './i18n.js';
import { transition, reveal } from './transition.js';
import { confirmAction } from './confirm.js';
import { enhanceList } from './list-tools.js';
import { initPalette } from './palette.js';

const pageLoaders = {
  overview: () => import('./pages/overview.js'),
  staff: () => import('./pages/staff.js'),
  shifts: () => import('./pages/shifts.js'),
  points: () => import('./pages/points.js'),
  reports: () => import('./pages/reports.js'),
  grades: () => import('./pages/grades.js'),
  statusposts: () => import('./pages/statusposts.js'),
  commands: () => import('./pages/commands.js'),
  studio: () => import('./pages/studio.js'),
  complaints: () => import('./pages/complaints.js'),
  status: () => import('./pages/status.js'),
  health: () => import('./pages/health.js'),
  audit: () => import('./pages/audit.js'),
  settings: () => import('./pages/setup.js'),
  notifications: () => import('./pages/notifications.js'),
  leaves: () => import('./pages/leaves.js'),
  resignations: () => import('./pages/resignations.js'),
  requests: () => import('./pages/requests.js'),
  applications: () => import('./pages/applications.js'),
  modreports: () => import('./pages/modreports.js'),
};

const pageData = {};
let currentView = 'overview';
let currentParam = '';
let selectedStaff = null;
let bootSlowTimer;

// Routes: /dashboard/<page> and /p/<username> (a staff profile).
function parseRoute(pathname) {
  const page = pathname.match(/^\/dashboard\/?([^/]*)/i)?.[1]?.toLowerCase() || 'overview';
  return { view: pageLoaders[page] ? page : 'overview', param: '' };
}
const pathFor = view => `/dashboard/${view}`;
({ view: currentView, param: currentParam } = parseRoute(location.pathname));

// Start the network work before the rest of init runs: identity and the first page's data in parallel.
const meRequest = api('/api/me');
meRequest.catch(() => {});
const earlyData = pageLoaders[currentView] && currentView !== 'notifications' ? fetchData(currentView).catch(() => null) : Promise.resolve(null);

async function init() {
  try {
    const me = await meRequest;
    if (!me?.user) {
      window.location.href = '/login';
      return;
    }
    me.user = normalizeUser(me.user);
    window.me = me;
    const boot = document.getElementById('bootScreen');
    updateIdentity(me.user);
    ensureInbox();
    setupPickers();
    refreshNotifications();
    if (me.user.isOwner || me.user.isAdministrator) {
      document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
    }
    document.getElementById('app').classList.remove('hidden');
    clearTimeout(bootSlowTimer);
    document.body.classList.add('loaded');
    setupNavigation();
    setupGlobalActions();
    setupPalette();
    history.replaceState({ view: currentView }, '', pathFor(currentView, currentParam) + (currentView === 'applications' ? location.search : ''));
    const early = await earlyData;
    if (early && !early.degraded) storeSet(currentView, early);
    await Promise.race([loadView(currentView), new Promise(resolve => window.setTimeout(resolve, 10000))]);
    const viewEl = document.getElementById('view');
    const finish = () => { if (boot) { boot.style.transition = 'none'; boot.classList.add('is-hidden'); } viewEl?.classList.add('enter'); window.setTimeout(() => viewEl?.classList.remove('enter'), 700); };
    // Fast loads (cached data) skip the loader entirely; slow ones leave it with the same wipe as page changes.
    if (performance.now() > 450) await reveal(finish); else finish();
    updateStaffCount();
    updateComplaintCount();
    startLiveUpdates();
  } catch (error) {
    console.error('Init failed:', error);
    const boot = document.getElementById('bootScreen');
    if (boot) {
      boot.classList.add('boot-error');
      const message = boot.querySelector('p');
      if (message) message.innerHTML = 'Could not open the workspace. <button type="button" data-boot-retry>Retry</button>';
      boot.querySelector('[data-boot-retry]')?.addEventListener('click', () => window.location.reload(), { once: true });
    }
  }
}

function updateIdentity(user) {
  const identity = document.querySelector('.identity');
  if (identity && !identity.dataset.profile) { identity.dataset.profile = 'me'; identity.setAttribute('role', 'link'); identity.setAttribute('tabindex', '0'); identity.title = 'My profile'; }
  const userNameEl = document.getElementById('userName');
  const userAvatarEl = document.getElementById('userAvatar');
  if (userNameEl) userNameEl.textContent = user.username;
  if (userAvatarEl) {
    userAvatarEl.textContent = '';
    userAvatarEl.style.backgroundImage = '';
    userAvatarEl.classList.remove('initial');
    if (user.avatar) {
      userAvatarEl.style.backgroundImage = `url(${user.avatar})`;
    } else {
      userAvatarEl.textContent = user.username?.[0]?.toUpperCase() || 'M';
      userAvatarEl.classList.add('initial');
    }
  }
}

function updateServerIdentity(data) {
  const guild = data?.guild || pageData.overview?.guild;
  if (!guild) return;
  const name = document.getElementById('serverName');
  const icon = document.getElementById('serverIcon');
  if (name) name.textContent = guild.name || 'Rift';
  if (icon) icon.innerHTML = guild.icon ? `<img src="${esc(guild.icon)}" alt="">` : esc((guild.name || 'M')[0].toUpperCase());
}

function normalizeUser(user) {
  if (!user) return user;
  const avatar = user.avatar && !String(user.avatar).startsWith('http')
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
    : user.avatar;
  return { ...user, avatar };
}

function setupNavigation() {
  document.querySelectorAll('.sidebar [data-view]').forEach(btn => {
    const view = btn.getAttribute('data-view');
    btn.addEventListener('click', () => navigate(view));
    // Warm the page module before the click lands.
    const warm = () => pageLoaders[view]?.();
    btn.addEventListener('pointerenter', warm, { once: true });
    btn.addEventListener('focus', warm, { once: true });
  });
  window.addEventListener('popstate', () => {
    const route = parseRoute(location.pathname);
    navigate(route.view, { push: false, param: route.param });
  });
  // Anything with data-profile opens that staff member's profile page.
  document.addEventListener('click', event => {
    const target = event.target.closest('[data-profile]');
    if (!target || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.button) return;
    event.preventDefault();
    location.assign(`/p/${encodeURIComponent(target.dataset.profile)}`);
  });
}


function markNav(view) {
  currentView = view;
  document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
  const activeBtn = document.querySelector(`.sidebar [data-view="${view}"]`);
  if (activeBtn) activeBtn.classList.add('active');
  document.querySelectorAll('.nav-item mx-i').forEach(icon => icon.setAttribute('type', icon.closest('.nav-item') === activeBtn ? 'bold' : 'linear'));
  const pageNameEl = document.getElementById('pageName');
  const pageTitleEl = document.getElementById('pageTitle');
  if (pageNameEl) pageNameEl.textContent = view.charAt(0).toUpperCase() + view.slice(1);
  if (pageTitleEl) pageTitleEl.textContent = activeBtn?.querySelector('span')?.textContent || view;
}

// Page change with the wipe: load in the background, swap while the wipe covers the screen.
// A click during a running wipe is queued (latest wins) so the URL and the page never disagree.
let navigating = false;
let queuedNav = null;
export async function navigate(view, { push = true, param = '' } = {}) {
  if (!pageLoaders[view]) return;
  if (navigating) { queuedNav = { view, push, param }; return; }
  if (view === currentView && param === currentParam) return;
  navigating = true;
  try {
    window.clearTimeout(window.riftShiftRefresh);
    currentParam = param;
    if (push) history.pushState({ view }, '', pathFor(view, param));
    markNav(view);
    await transition(
      () => prepareView(view).catch(error => ({ view, error })),
      prepared => (prepared.error ? handleViewError(view, prepared.error) : commitView(prepared))
    );
  } finally {
    navigating = false;
    if (queuedNav) { const next = queuedNav; queuedNav = null; navigate(next.view, { push: next.push, param: next.param }); }
  }
}

function setupGlobalActions() {
  $('#logout')?.addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    sessionStorage.clear();
    window.location.replace('/login');
  });

  $('#refresh')?.addEventListener('click', () => {
    delete pageData[currentView];
    loadView(currentView, true);
  });
}

// Data store: pages that read /api/bootstrap share one entry. Cached data renders at once and is
// refreshed in the background (stale-while-revalidate), so navigation never waits on the network.
const SHARED = new Set(['overview', 'staff', 'commands', 'complaints', 'requests', 'settings']);
const store = {};
const STALE_MS = 8000;
const storeKey = view => (SHARED.has(view) ? 'bootstrap' : view);
function storeGet(view) {
  const key = storeKey(view);
  if (store[key]) return store[key];
  try { const raw = sessionStorage.getItem(`rift-data:${key}`); if (raw) return (store[key] = JSON.parse(raw)); } catch {}
  return null;
}
function storeSet(view, data) {
  const key = storeKey(view);
  store[key] = { data, at: Date.now() };
  try { sessionStorage.setItem(`rift-data:${key}`, JSON.stringify(store[key])); } catch {}
}
const fingerprint = data => JSON.stringify(data, (key, value) => (key === 'user' ? undefined : value));
const normalizeDashboardData = data => {
  const result = data && typeof data === 'object' ? data : {};
  for (const key of ['staff', 'shifts', 'complaints', 'leaves', 'resignations', 'ratings']) if (!Array.isArray(result[key])) result[key] = [];
  return result;
};

async function prepareView(view, force = false) {
  const modPromise = pageLoaders[view]();
  let entry = force ? null : storeGet(view);
  if (!entry) {
    const data = await fetchData(view);
    if (!data?.degraded) storeSet(view, data);
    entry = data?.degraded ? { data, at: 0 } : store[storeKey(view)];
  }
  const mod = await modPromise;
  pageData[view] = SHARED.has(view) ? normalizeDashboardData(entry?.data) : (entry?.data || {});
  if (pageData[view] && typeof pageData[view] === 'object') pageData[view].user = window.me?.user;
  const html = typeof mod.render === 'function' ? await mod.render(pageData[view], selectedStaff) : '';
  return { view, mod, html, stale: Date.now() - entry.at > STALE_MS };
}

function commitView(prepared) {
  const { view, mod, html } = prepared;
  const viewEl = $('#view');
  if (!viewEl) return;
  viewEl.innerHTML = html;
  if (mod.bind) mod.bind(pageData[view], () => { delete pageData[view]; return loadView(view, true); });
  attachView(view, pageData[view]);
  updateIdentity(window.me?.user);
  updateServerIdentity(pageData[view]);
  updateCounts(pageData[view]);
  localize(viewEl, localStorage.getItem('rift-language') || 'en');
  document.title = 'Rift | Staff Control';
  enhanceLists(view);
  if (prepared.stale) revalidate(view);
}

async function revalidate(view) {
  try {
    const before = fingerprint(storeGet(view)?.data);
    const fresh = await fetchData(view);
    if (!fresh || fresh.degraded) return;
    storeSet(view, fresh);
    // Only repaint when something changed and the user is not mid-edit.
    if (view !== currentView || fingerprint(fresh) === before) return;
    if (document.activeElement?.closest('#view input, #view textarea, #view select') || document.querySelector('.modal-backdrop:not(.hidden)')) return;
    const prepared = await prepareView(view);
    if (view === currentView) commitView({ ...prepared, stale: false });
  } catch {}
}

function updateCounts(data) {
  if (!data?.staff || !data.complaints) return;
  const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = String(value); };
  const pending = rows => (rows || []).filter(row => row.status === 'pending').length;
  set('staffCount', data.staff.length);
  set('complaintCount', pending(data.complaints));
  set('resignationCount', pending(data.resignations));
  set('leaveCount', pending(data.leaves));
}

function handleViewError(view, error) {
  console.error('View load error:', error);
  if (view !== 'settings' && String(error.message || '').includes('Guild not configured')) {
    delete pageData.settings;
    history.replaceState({ view: 'settings' }, '', '/dashboard/settings');
    return loadView('settings', true);
  }
  const viewEl = $('#view');
  if (viewEl) viewEl.innerHTML = `<div class="error-state">${ic('danger', { size: 28 })}<h3>Failed to load ${esc(view)}</h3><p>${esc(error.message || error)}</p><button class="secondary" onclick="location.reload()">Retry</button></div>`;
}

// In-place load or refresh, no wipe.
async function loadView(view, force = false) {
  const viewEl = $('#view');
  if (!viewEl) return;
  markNav(view);
  if (!viewEl.innerHTML.trim()) viewEl.innerHTML = '<div class="page-loading"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div>';
  try {
    commitView(await prepareView(view, force));
  } catch (error) {
    handleViewError(view, error);
  }
}

async function fetchData(view) {
  switch (view) {
    case 'overview':
    case 'staff':
    case 'commands':
    case 'complaints':
    case 'requests':
    case 'settings':
      return await api('/api/bootstrap');
    case 'points':
      return await api('/api/points');
    case 'notifications': {
      const [notifications, management] = await Promise.all([api('/api/notifications'), api('/api/management-users').catch(() => ({ users: [] }))]);
      const users = management.users || [];
      const current = normalizeUser(window.me?.user);
      if (current && (current.isOwner || current.isAdministrator) && !users.some(user => user.userId === current.id)) users.unshift({ userId: current.id, displayName: current.username, username: current.username, avatar: current.avatar });
      return { notifications, managementUsers: users, user: current };
    }
    case 'shifts':
      return await Promise.race([
        api('/api/shifts').catch(() => ({ shifts: [], staff: [], summary: {}, degraded: true })),
        new Promise(resolve => window.setTimeout(() => resolve({ shifts: [], staff: [], summary: {}, degraded: true }), 1200))
      ]);
    case 'reports': // the page loads its own data (settings, staff, history)
    case 'grades':
    case 'statusposts':
      return {};
    case 'health':
      return await api('/api/health');
    case 'audit':
      return {};
    case 'status':
      return await api('/api/bot/status').catch(() => ({ botStatus: 'idle', settings: {}, degraded: true }));
    default:
      return {};
  }
}

function enhanceLists(view) {
  const root = $('#view');
  if (!root) return;
  if (view === 'staff') enhanceList(root.querySelector('.staff-grid'), { name: 'staff', input: '#staffSearch', min: 1 });
  if (['complaints', 'leaves', 'resignations', 'requests', 'reports'].includes(view)) root.querySelectorAll('.request-list').forEach(list => enhanceList(list, { name: view, min: 5 }));
}

function setupPalette() {
  const palette = initPalette({
    pages: () => [...document.querySelectorAll('.sidebar [data-view]')].filter(el => !el.classList.contains('hidden')).map(el => ({ label: el.querySelector('span')?.textContent || el.dataset.view, icon: el.querySelector('mx-i')?.getAttribute('name'), hint: 'Page', run: () => navigate(el.dataset.view) })),
    staff: () => (storeGet('overview')?.data?.staff || []).map(member => ({ label: member.displayName, hint: member.rank || `@${member.username}`, avatar: member.avatar, run: () => location.assign(`/p/${encodeURIComponent(member.userId)}`) })),
    actions: () => {
      const admin = window.me?.user?.isOwner || window.me?.user?.isAdministrator;
      return [
        { label: 'Refresh this page', icon: 'refresh-arrow-01', run: () => { delete pageData[currentView]; loadView(currentView, true); } },
        { label: 'Edit my profile', icon: 'edit-2', run: () => location.assign('/p/me') },
        ...(admin ? [{ label: 'Add a staff member', icon: 'user-add', run: () => showAddStaffModal() }] : []),
        ...dashboardThemes.map(([value, name]) => ({ label: `Theme: ${name}`, icon: 'category', hint: 'Appearance', run: () => document.querySelector(`#themeMenu [data-theme="${value}"]`)?.click() })),
        { label: 'Log out', icon: 'logout-01', run: () => document.getElementById('logout')?.click() },
      ];
    },
  });
  document.getElementById('paletteButton')?.addEventListener('click', () => palette.open());
}

function attachView(view, data) {
  const viewEl = $('#view');
  if (!viewEl) return;

  viewEl.querySelectorAll('[data-action="refresh"]').forEach(btn => {
    btn.addEventListener('click', () => { delete pageData[view]; loadView(view, true); });
  });

  viewEl.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-view');
      if (target && pageLoaders[target]) navigate(target);
    });
  });

  viewEl.querySelectorAll('.staff-row[data-select], .staff-card[data-select]').forEach(row => {
    row.addEventListener('click', () => {
      selectedStaff = row.getAttribute('data-select');
      delete pageData.staff;
      loadView('staff');
    });
  });

  viewEl.querySelectorAll('[data-action="reset-all-staff"]').forEach(btn => btn.addEventListener('click', async () => {
    const ok = await confirmAction({ title: 'Reset every staff member?', message: 'This clears saved statistics for the whole team. It cannot be undone.', confirmText: 'Reset all staff', typeToConfirm: 'RESET ALL', details: ['Points, messages, voice time and shift history', 'For every staff member in this server'] });
    if (!ok) return;
    try { await api('/api/staff/reset-all', { method: 'POST' }); toast('All staff statistics were reset'); delete pageData.staff; await loadView('staff', true); }
    catch (error) { toast(error.message || 'Could not reset staff.'); }
  }));

  viewEl.querySelectorAll('[data-action="staff-add"]').forEach(btn => {
    btn.addEventListener('click', () => showAddStaffModal());
  });

  viewEl.querySelectorAll('[data-staff-menu]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      showStaffMenu(btn.getAttribute('data-staff-menu'));
    });
  });

  viewEl.querySelectorAll('[data-view="staff"] [data-action="close-profile"]').forEach(btn => {
    btn.addEventListener('click', () => { selectedStaff = null; delete pageData.staff; loadView('staff'); });
  });

  if (view === 'shifts') {
    const channelSelect = document.getElementById('shiftPanelChannel');
    if (channelSelect) {
      loadPanelOptions(channelSelect);
    }
    viewEl.querySelectorAll('[data-action="send-shift-panel"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const channelId = channelSelect?.value;
        if (!channelId) return toast('Please select a channel.');
        try {
          await api('/api/shifts/panel', { method: 'POST', body: JSON.stringify({ channelId }) });
          toast('Shift panel sent!');
        } catch (error) {
          toast(error.message || 'Failed to send panel.');
        }
      });
    });
    viewEl.querySelectorAll('[data-action="refresh"]').forEach(btn => {
      btn.addEventListener('click', () => { delete pageData.shifts; loadView('shifts', true); });
    });
  }

  if (view === 'status') {
    const intervalInput = viewEl.querySelector('#customStatusForm [name="interval"]');
    if (intervalInput) intervalInput.min = '5';
    viewEl.querySelectorAll('[data-bot-status]').forEach(button => button.addEventListener('click', async () => {
      try { await api('/api/bot/status', { method: 'PATCH', body: JSON.stringify({ status: button.dataset.botStatus }) }); toast('Bot status updated'); delete pageData.status; await loadView('status', true); }
      catch (error) { toast(error.message || 'Could not update bot status.'); }
    }));
    viewEl.querySelector('#customStatusForm')?.addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const body = Object.fromEntries(new FormData(form));
      body.statuses = String(body.statuses || '').split('\n').map(item => item.trim()).filter(Boolean);
      try { await api('/api/bot/custom-status', { method: 'PATCH', body: JSON.stringify(body) }); toast('Custom status saved'); delete pageData.status; await loadView('status', true); }
      catch (error) { toast(error.message || 'Could not save custom status.'); }
    });
    viewEl.querySelector('#devModeForm')?.addEventListener('submit', async event => {
      event.preventDefault();
      try { await api('/api/settings/dev-mode', { method: 'PATCH', body: JSON.stringify({ enabled: !Boolean(data.settings?.devMode) }) }); toast('Developer mode updated'); delete pageData.status; await loadView('status', true); }
      catch (error) { toast(error.message || 'Could not update developer mode.'); }
    });
  }

  if (view === 'shifts') {
    window.clearTimeout(window.riftShiftRefresh);
    window.riftShiftRefresh = window.setTimeout(() => { delete pageData.shifts; loadView('shifts', true); }, 30000);
  }
}

async function loadPanelOptions(selectEl) {
  try {
    const data = await api('/api/panel/options');
    selectEl.innerHTML = '<option value="">Select a channel...</option>';
    (data.channels || []).forEach(ch => {
      const opt = document.createElement('option');
      opt.value = ch.id;
      opt.textContent = ch.name;
      selectEl.appendChild(opt);
    });
  } catch (error) {
    selectEl.innerHTML = '<option value="">Failed to load channels</option>';
  }
}

function showAddStaffModal() {
  const modal = document.getElementById('staffModal');
  const form = document.getElementById('staffForm');
  if (modal && form) {
    modal.classList.remove('hidden');
    form.reset();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const formData = new FormData(form);
      const userId = formData.get('userId');
      const username = formData.get('username') || '';
      const rank = formData.get('rank') || '';
      const points = Number(formData.get('points') || 0);
      try {
        await api('/api/staff', { method: 'POST', body: JSON.stringify({ userId, username, rank, points }) });
        toast('Staff member added!');
        modal.classList.add('hidden');
        delete pageData.staff;
        delete pageData.overview;
        loadView(currentView, true);
      } catch (error) {
        toast(error.message || 'Failed to add staff.');
      }
    };
  }
  const closeBtn = modal?.querySelector('#staffModalClose');
  closeBtn?.addEventListener('click', () => modal.classList.add('hidden'), { once: true });
}

function showStaffMenu(userId) {
  if (!(window.me?.user?.isOwner || window.me?.user?.isAdministrator)) return;
  const menu = document.getElementById('manageStaffModal');
  if (!menu) return;
  menu.classList.remove('hidden');
  menu.querySelectorAll('.manage-option').forEach(opt => {
    opt.onclick = null;
    opt.addEventListener('click', () => {
      const action = opt.getAttribute('data-manage-action');
      menu.classList.add('hidden');
      handleStaffAction(userId, action);
    }, { once: true });
  });
  menu.querySelector('#manageModalClose')?.addEventListener('click', () => menu.classList.add('hidden'), { once: true });
}

function handleStaffAction(userId, action) {
  if (!(window.me?.user?.isOwner || window.me?.user?.isAdministrator)) return toast('Administrator permission is required.');
  if (action === 'note') return openStaffActionModal('Add private staff note', 'This note is saved on the staff profile.', `<label class="modal-field full"><span>Note</span><textarea name="text" rows="5" maxlength="1000" required placeholder="Write a private note..."></textarea></label>`, async body => {
    await api(`/api/staff/${userId}/notes`, { method: 'POST', body: JSON.stringify({ text: body.text }) });
    toast('Note added');
  });
  if (action === 'profile') return openStaffActionModal('Edit staff profile', 'Update the rank and status shown on the staff profile.', `<label class="modal-field full"><span>Rank</span><input name="rank" placeholder="e.g. Moderator"></label><label class="modal-field full"><span>Status</span><select name="status"><option value="active">Active</option><option value="on_leave">On leave</option><option value="retired">Retired</option><option value="suspended">Suspended</option></select></label>`, async body => {
    await api(`/api/staff/${userId}`, { method: 'PATCH', body: JSON.stringify(body) });
    toast('Profile updated');
  });
  if (action === 'adjust') return openStaffActionModal('Adjust staff metrics', 'Set the saved points and shift hours.', `<label class="modal-field full"><span>Points</span><input name="points" type="number" min="0" value="0"></label><label class="modal-field full"><span>Shift hours</span><input name="shiftHours" type="number" min="0" step="0.1" value="0"></label>`, async body => {
    await api(`/api/staff/${userId}`, { method: 'PATCH', body: JSON.stringify(body) });
    toast('Metrics updated');
  });
  if (action === 'reset-shift-hours') return openStaffActionModal('Reset shift hours', 'This permanently removes the saved shift history for this staff member.', '', async () => {
    await api(`/api/staff/${userId}/reset-shift-hours`, { method: 'POST' });
    toast('Shift hours reset');
  });
  if (action === 'remove') {
    confirmAction({ title: 'Remove from staff?', message: 'This removes the staff role in Discord and deactivates the profile.', confirmText: 'Remove staff member', details: ['Their history, ratings and points are kept.', 'You can add them again later.'] }).then(ok => { if (!ok) return;
    api(`/api/staff/${userId}`, { method: 'DELETE' })
      .then(() => { toast('Staff member removed.'); delete pageData.staff; delete pageData.overview; loadView('staff', true); })
      .catch(err => toast(err.message || 'Failed to remove staff.')); });
  } else if (action === 'reset') {
    confirmAction({ title: 'Reset all data for this member?', message: 'This permanently clears their saved statistics. It cannot be undone.', confirmText: 'Reset data', typeToConfirm: 'RESET', details: ['Points and staff activity', 'Messages, voice time and shift history', 'Complaints and ratings'] }).then(ok => { if (!ok) return;
    api(`/api/staff/${userId}/reset`, { method: 'POST' })
      .then(() => { toast('Stats reset.'); delete pageData.staff; loadView('staff', true); })
      .catch(err => toast(err.message || 'Failed to reset.')); });
  }
}

function openStaffActionModal(title, description, fields, submit) {
  const modal = document.getElementById('actionModal');
  const form = document.getElementById('actionModalForm');
  if (!modal || !form) return;
  document.getElementById('actionModalTitle').textContent = title;
  document.getElementById('actionModalDescription').textContent = description;
  form.innerHTML = `${fields}<div class="modal-actions full"><button class="secondary" type="button" data-action-cancel>Cancel</button><button class="primary" type="submit">Save</button></div>`;
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  const close = () => { modal.classList.add('hidden'); modal.setAttribute('aria-hidden', 'true'); };
  modal.querySelector('[data-action-cancel]')?.addEventListener('click', close, { once: true });
  modal.querySelector('.modal-close')?.addEventListener('click', close, { once: true });
  form.onsubmit = async event => {
    event.preventDefault();
    try { await submit(Object.fromEntries(new FormData(form))); close(); delete pageData.staff; delete pageData.overview; await loadView('staff', true); }
    catch (error) { toast(error.message || 'Could not save staff changes.'); }
  };
}

function updateStaffCount() {
  const data = pageData.overview || pageData.staff;
  if (data?.staff) {
    const countEl = document.getElementById('staffCount');
    if (countEl) countEl.textContent = String(data.staff.length);
  }
}

function updateComplaintCount() {
  const data = pageData.overview;
  if (data?.complaints) {
    const countEl = document.getElementById('complaintCount');
    if (countEl) countEl.textContent = String(data.complaints.filter(c => c.status === 'pending').length);
  }
}

function ensureInbox() {
  const topActions = document.querySelector('.top-actions');
  if (!topActions || document.getElementById('notificationButton')) return;
  topActions.insertAdjacentHTML('afterbegin', '<button class="icon-btn" id="paletteButton" title="Search (Ctrl K)" aria-label="Search"><mx-i name="search-normal"></mx-i></button><button class="icon-btn notification-button" id="notificationButton" title="Inbox" aria-label="Inbox"><mx-i name="notification"></mx-i><b id="notificationCount" class="notification-count hidden">0</b></button>');
  document.getElementById('notificationButton')?.addEventListener('click', openInbox);
}

async function refreshNotifications() {
  try {
    const data = await api('/api/notifications');
    const count = document.getElementById('notificationCount');
    const navCount = document.getElementById('notificationNavCount');
    [count, navCount].forEach(element => { if (element) { element.textContent = String(data.unread || 0); element.classList.toggle('hidden', !data.unread); } });
    renderInbox(data);
  } catch {}
}

function openInbox() {
  const panel = document.getElementById('inboxPanel');
  if (!panel) return;
  panel.classList.toggle('open');
  panel.setAttribute('aria-hidden', panel.classList.contains('open') ? 'false' : 'true');
}

function renderInbox(data) {
  const panel = document.getElementById('inboxPanel');
  const list = panel?.querySelector('[data-inbox-list]');
  const count = panel?.querySelector('[data-inbox-count]');
  if (!panel || !list) return;
  if (count) count.textContent = `${data.unread || 0} unread`;
  list.innerHTML = data.notifications?.length ? data.notifications.slice(0, 8).map(item => { const sender = item.senderAvatar ? `<img src="${esc(item.senderAvatar)}" alt="" loading="lazy">` : `<span>${esc((item.senderName || 'M')[0])}</span>`; return `<button class="inbox-item ${item.readBy?.some(read => read.userId === window.me?.user?.id) ? '' : 'unread'}" data-inbox-id="${esc(item.id)}"><span class="inbox-item-icon">${sender}</span><span><b>${esc(item.title)}</b><small>${esc(item.senderName || 'Rift')} · ${date(item.createdAt)}</small><em>${esc(item.message).slice(0, 110)}</em></span></button>`; }).join('') : '<div class="inbox-empty"><mx-i name="tick-circle"></mx-i><b>All caught up</b><span>No new private notifications.</span></div>';
  list.querySelectorAll('[data-inbox-id]').forEach(item => item.addEventListener('click', async () => { await api(`/api/notifications/${item.dataset.inboxId}/read`, { method: 'PATCH' }).catch(() => {}); openInbox(); await refreshNotifications(); loadView('notifications', true); }));
}

function createInboxPanel() {
  if (document.getElementById('inboxPanel')) return;
  document.body.insertAdjacentHTML('beforeend', '<aside class="inbox-panel" id="inboxPanel" aria-hidden="true"><div class="inbox-head"><div><span class="inbox-kicker">RIFT / PRIVATE</span><h3>Inbox</h3><small data-inbox-count>0 unread</small></div><div><button class="inbox-read-all" type="button">Mark all read</button><button class="icon-btn" type="button" data-inbox-close aria-label="Close"><mx-i name="close-circle"></mx-i></button></div></div><div class="inbox-list" data-inbox-list></div><div class="inbox-foot"><span>Private staff workspace</span><button type="button" data-inbox-open-page>Open inbox <mx-i name="arrow-up-04"></mx-i></button></div></aside>');
  document.querySelector('[data-inbox-close]')?.addEventListener('click', openInbox);
  document.querySelector('[data-inbox-open-page]')?.addEventListener('click', () => { openInbox(); loadView('notifications'); });
  document.querySelector('.inbox-read-all')?.addEventListener('click', async () => { const data = await api('/api/notifications').catch(() => null); if (!data) return; await Promise.all((data.notifications || []).filter(item => !item.readBy?.some(read => read.userId === window.me?.user?.id)).map(item => api(`/api/notifications/${item.id}/read`, { method: 'PATCH' }).catch(() => {}))); await refreshNotifications(); });
}

const dashboardLanguages = [['en', 'EN', 'English'], ['ar', 'AR', 'العربية']];
const dashboardThemes = [
  ['rift', 'Rift Purple', 'Rift violet on deep charcoal'],
  ['void-dark', 'Void Dark Theme', 'Pure black and white for maximum focus'],
  ['amethyst', 'Amethyst', 'Deep violet with a bright lilac accent'],
  ['aurora', 'Aurora', 'Teal light on midnight green'],
  ['crimson', 'Crimson', 'Red accent on black cherry'],
  ['frost', 'Frost', 'Clean light workspace with violet controls'],
  ['obsidian', 'Obsidian', 'High-contrast black with orchid accent'],
  ['graphite', 'Graphite', 'Classic charcoal with gold controls'],
  ['slate', 'Slate', 'Classic blue-grey workspace'],
  ['midnight', 'Midnight', 'Classic deep-night blue'],
  ['ocean', 'Ocean', 'Dark teal workspace'],
  ['forest', 'Forest', 'Dark green workspace'],
  ['sunset', 'Sunset', 'Warm dusk workspace'],
  ['orange', 'Orange', 'Dark workspace with orange controls']
];

function setupPickers() {
  const themeMenu = document.getElementById('themeMenu');
  const languageMenu = document.getElementById('languageMenu');
  if (!themeMenu || !languageMenu || themeMenu.dataset.bound) return;
  themeMenu.dataset.bound = 'true';
  const savedLanguage = localStorage.getItem('rift-language') || 'en';
  themeMenu.innerHTML = `<div class="picker-menu-title"><b>THEME</b><small>${dashboardThemes.length} available</small></div>${dashboardThemes.map(([value, name, description]) => `<button class="picker-option" type="button" data-theme="${value}"><i class="swatch swatch-${value}"></i><span><b>${name}</b><small>${description}</small></span><em>${ic('tick-circle', { size: 16 })}</em></button>`).join('')}`;
  languageMenu.innerHTML = dashboardLanguages.map(([value, flag, name]) => `<button class="picker-option" type="button" data-language="${value}"><i class="flag">${flag}</i><span><b>${name}</b><small>${value === 'en' ? 'English interface' : 'واجهة عربية'}</small></span><em>${ic('tick-circle', { size: 16 })}</em></button>`).join('');
  const setTheme = value => { if (!dashboardThemes.some(item => item[0] === value)) value = 'rift'; document.body.className = document.body.className.replace(/theme-[\w-]+/g, '').trim(); document.body.classList.add(`theme-${value}`); localStorage.setItem('rift-theme', value); themeMenu.querySelectorAll('[data-theme]').forEach(item => item.dataset.selected = item.dataset.theme === value ? 'true' : 'false'); const current = dashboardThemes.find(item => item[0] === value); const label = document.querySelector('#themeButton span'); if (label) label.textContent = current?.[1] || value; const swatch = document.querySelector('#themeButton .swatch'); if (swatch) swatch.className = `swatch swatch-${value}`; themeMenu.classList.remove('open'); };
  const setLanguage = value => { document.documentElement.lang = value; document.documentElement.dir = value === 'ar' ? 'rtl' : 'ltr'; localStorage.setItem('rift-language', value); languageMenu.querySelectorAll('[data-language]').forEach(item => item.dataset.selected = item.dataset.language === value ? 'true' : 'false'); const current = dashboardLanguages.find(item => item[0] === value); const label = document.querySelector('#languageButton span'); if (label) label.textContent = current?.[2] || value; const code = document.querySelector('#languageButton .lang-code'); if (code) code.textContent = current?.[1] || value.toUpperCase(); languageMenu.classList.remove('open'); if (value !== savedLanguage) { window.location.reload(); return; } localize(document.querySelector('.sidebar'), value); localize(document.querySelector('.topbar'), value); loadView(currentView, true); };
  document.getElementById('themeButton')?.addEventListener('click', () => themeMenu.classList.toggle('open'));
  document.getElementById('languageButton')?.addEventListener('click', () => languageMenu.classList.toggle('open'));
  themeMenu.addEventListener('click', event => { const value = event.target.closest('[data-theme]')?.dataset.theme; if (value) setTheme(value); });
  languageMenu.addEventListener('click', event => { const value = event.target.closest('[data-language]')?.dataset.language; if (value) setLanguage(value); });
  document.addEventListener('click', event => { if (!event.target.closest('.picker')) document.querySelectorAll('.picker-menu').forEach(menu => menu.classList.remove('open')); });
  setTheme(localStorage.getItem('rift-theme') || 'rift');
  setLanguage(localStorage.getItem('rift-language') || 'en');
}

function startLiveUpdates() {
  setInterval(async () => {
    try {
      const me = await api('/api/me');
      if (me?.user) {
        me.user = normalizeUser(me.user);
        window.me = me;
        updateIdentity(me.user);
      }
    } catch {}
  }, 30000);
  setInterval(refreshNotifications, 30000);
}

window.addEventListener('rift:navigate', event => navigate(event.detail));

window.addEventListener('message', (event) => {
  if (event.data?.action === 'navigate') {
    delete pageData[event.data.view];
    loadView(event.data.view, true);
  }
});

if (typeof window !== 'undefined') {
  createInboxPanel();
  bootSlowTimer = setTimeout(() => document.getElementById('bootScreen')?.classList.add('boot-slow'), 7000);
  window.addEventListener('load', init);
}

export { init, loadView };
