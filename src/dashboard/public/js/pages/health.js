import { api, esc, toast } from '../ui.js';
import { ic } from '../icon.js';

const WATCHDOGS = [
  ['shifts', 'Shift watchdog', 60],
  ['roles', 'Role sync', 300],
  ['weekly', 'Weekly reports', 900],
];
const pingSamples = [];
let timer;

const ago = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
const span = (sec) => {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return sec % 60 ? `${Math.floor(sec / 60)}m ${sec % 60}s` : `${sec / 60}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  return `${Math.floor(sec / 86400)}d ${Math.floor((sec % 86400) / 3600)}h`;
};
const action = (value) => String(value || '').toLowerCase().replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

// Each check resolves to ok | warn | bad plus a plain-text detail.
function checks(data) {
  const now = data.now;
  const list = [];
  const beat = data.bot;
  const beatAge = beat ? now - new Date(beat.updatedAt).getTime() : Infinity;
  if (!beat) list.push({ name: 'Bot process', icon: 'cpu', state: 'bad', detail: 'No heartbeat recorded yet. Start the bot with npm run start:all.' });
  else if (beatAge > 120000) list.push({ name: 'Bot process', icon: 'cpu', state: 'bad', detail: `Offline. Last heartbeat ${ago(beatAge)}.` });
  else if (beatAge > 45000) list.push({ name: 'Bot process', icon: 'cpu', state: 'warn', detail: `Heartbeat delayed. Last seen ${ago(beatAge)}.` });
  else list.push({ name: 'Bot process', icon: 'cpu', state: 'ok', detail: `Running for ${span(Math.round((new Date(beat.updatedAt) - new Date(beat.startedAt)) / 1000))}, Node ${esc(beat.nodeVersion)}` });

  const ping = beat?.pingMs ?? 0;
  list.push(!beat || beatAge > 120000
    ? { name: 'Discord gateway', icon: 'global', state: 'bad', detail: 'Unknown while the bot is offline.' }
    : { name: 'Discord gateway', icon: 'global', state: ping > 400 ? 'warn' : 'ok', detail: `${ping} ms round trip, ${beat.guilds} server${beat.guilds === 1 ? '' : 's'}` });

  const db = data.database;
  list.push({ name: 'Database', icon: 'category', state: !db.connected ? 'bad' : db.latencyMs > 300 ? 'warn' : 'ok', detail: db.connected ? `Connected, query took ${db.latencyMs} ms` : 'Connection lost' });

  const dash = data.dashboard;
  list.push({ name: 'Dashboard', icon: 'monitor', state: dash.gatewayReady ? 'ok' : 'warn', detail: `Up ${span(dash.uptimeSec)}, ${dash.memoryMb} MB, gateway ${dash.gatewayReady ? `${dash.gatewayPingMs} ms` : 'connecting'}` });

  for (const [key, label, every] of WATCHDOGS) {
    const last = beat?.watchdogs?.[key];
    if (!last) list.push({ name: label, icon: 'timer-start', state: beat && beatAge < 120000 ? 'warn' : 'bad', detail: beat && beatAge < 120000 ? `Has not completed a run yet, expected every ${span(every)}.` : 'Not running.' });
    else {
      const age = now - last;
      list.push({ name: label, icon: 'timer-start', state: age > every * 2500 ? 'bad' : age > every * 1500 ? 'warn' : 'ok', detail: `Last run ${ago(age)}, every ${span(every)}` });
    }
  }
  return list;
}

const STATE_TEXT = { ok: 'Operational', warn: 'Degraded', bad: 'Down' };

function summary(list) {
  const bad = list.filter(item => item.state === 'bad');
  const warn = list.filter(item => item.state === 'warn');
  if (list[0].state === 'bad') return { state: 'bad', text: 'The bot is offline' };
  if (bad.length) return { state: 'bad', text: bad.length === list.length ? 'Everything is down' : `${bad.map(item => item.name).join(', ')} down` };
  if (warn.length) return { state: 'warn', text: `${warn.map(item => item.name).join(', ')} degraded` };
  return { state: 'ok', text: 'All systems operational' };
}

function pingBars() {
  if (!pingSamples.length) return '<div class="hl-empty">Collecting samples</div>';
  const max = Math.max(150, ...pingSamples);
  return `<div class="hl-bars" role="img" aria-label="Gateway latency, last ${pingSamples.length} samples">${pingSamples.map(value => `<i style="height:${Math.max(6, Math.round((value / max) * 100))}%" title="${value} ms"></i>`).join('')}</div><div class="hl-scale"><span>${pingSamples.length} samples</span><span>peak ${Math.max(...pingSamples)} ms</span></div>`;
}

const pctText = value => (value === null || value === undefined ? 'No data' : `${value.toFixed(value === 100 ? 0 : 2)}%`);
const tone = pct => (pct === null ? 'nodata' : pct >= 99.9 ? 'up' : pct >= 95 ? 'part' : 'down');
const long = ms => { const m = Math.round(ms / 60000); if (m < 1) return 'under a minute'; if (m < 60) return `${m} min`; if (m < 1440) return `${Math.floor(m / 60)}h ${m % 60}m`; return `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`; };

function uptimePanel(data) {
  const u = data.uptime;
  if (!u) return '';
  const day = item => `<i class="ut-${tone(item.pct)}" title="${esc(item.date)}: ${item.pct === null ? 'no data' : `${pctText(item.pct)} up${item.downMs ? `, down ${long(item.downMs)}` : ''}`}"></i>`;
  const half = item => `<i class="ut-${tone(item.pct)}" title="${esc(new Date(item.start).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }))}: ${item.pct === null ? 'no data' : `${pctText(item.pct)} up`}"></i>`;
  const incidents = u.incidents.length ? u.incidents.map(item => {
    const end = item.endedAt ? new Date(item.endedAt).getTime() : data.now;
    const isDown = item.kind === 'downtime';
    return `<div class="ut-incident ${isDown ? 'is-down' : 'is-restart'}"><span class="hl-ico">${ic(isDown ? 'close-circle' : 'refresh-arrow-01', { size: 20 })}</span><div><b>${item.ongoing ? 'Bot is down' : isDown ? 'Downtime' : 'Restart'}</b><small>${esc(item.note || '')}${item.note && !/[.!?]$/.test(item.note) ? '.' : ''}${isDown ? ` Lasted ${long(end - new Date(item.startedAt).getTime())}${item.ongoing ? ' so far' : ''}.` : ''}</small></div><time title="${esc(new Date(item.startedAt).toLocaleString())}">${ago(data.now - new Date(item.startedAt).getTime())}</time></div>`;
  }).join('') : '<div class="hl-empty">No restarts or downtime recorded yet. They are added here automatically.</div>';
  return `<section class="panel ut-panel"><div class="panel-head"><div><h3>Bot uptime</h3><p>Recorded automatically from the bot heartbeat</p></div><div class="ut-figures"><div><strong>${pctText(u.uptime24h)}</strong><span>24 hours</span></div><div><strong>${pctText(u.uptime30)}</strong><span>30 days</span></div></div></div>
    <div class="panel-body"><div class="ut-label"><span>Last 30 days</span><span>${u.days.filter(item => item.pct !== null && item.pct < 100).length} day(s) with downtime</span></div><div class="ut-bar ut-days" role="img" aria-label="Daily uptime, last 30 days">${u.days.map(day).join('')}</div><div class="hl-scale"><span>30 days ago</span><span>Today</span></div>
    <div class="ut-label ut-gap"><span>Last 24 hours</span><span>30 minute blocks</span></div><div class="ut-bar ut-hours" role="img" aria-label="Uptime by 30 minute block, last 24 hours">${u.halfHours.map(half).join('')}</div><div class="hl-scale"><span>24 hours ago</span><span>Now</span></div>
    <div class="ut-legend"><span><i class="ut-up"></i> Fully up</span><span><i class="ut-part"></i> Partial</span><span><i class="ut-down"></i> Mostly down</span><span><i class="ut-nodata"></i> Not monitored</span></div></div>
    <div class="ut-events-head">Restarts and downtime</div><div class="ut-events">${incidents}</div></section>`;
}

function body(data) {
  const list = checks(data);
  const sum = summary(list);
  const beat = data.bot;
  const beatAge = beat ? data.now - new Date(beat.updatedAt).getTime() : Infinity;
  const online = beat && beatAge < 120000;
  const uptime = online ? span(Math.round((new Date(beat.updatedAt) - new Date(beat.startedAt)) / 1000)) : 'Offline';
  const q = data.queue;
  const stats = [
    ['timer-start', 'Bot uptime', uptime, online ? `since ${new Date(beat.startedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}` : 'no live heartbeat'],
    ['flash', 'Gateway ping', online ? `${beat.pingMs} ms` : '-', online ? 'bot to Discord' : 'bot offline'],
    ['category', 'Database', data.database.connected ? `${data.database.latencyMs} ms` : 'Down', data.database.connected ? 'query latency' : 'not connected'],
    ['cpu', 'Bot memory', online ? `${beat.memoryMb} MB` : '-', online ? 'resident set' : 'bot offline'],
  ];
  const queue = [
    ['Active staff', q.staff, 'staff'], ['Live shifts', beat?.activeShifts ?? 0, 'shifts'],
    ['Pending complaints', q.pendingComplaints, 'complaints'], ['Pending leaves', q.pendingLeaves, 'leaves'], ['Pending resignations', q.pendingResignations, 'resignations'],
  ];
  return `
    <div class="hl-summary hl-${sum.state}"><span class="hl-mark">${ic(sum.state === 'ok' ? 'tick-circle' : sum.state === 'warn' ? 'warning-2' : 'close-circle', { size: 26 })}</span><div><b>${esc(sum.text)}</b><small>Updated ${ago(Date.now() - data.now)}. Refreshes every 5 seconds.</small></div></div>
    <div class="stats-grid">${stats.map(([icon, label, value, note]) => `<div class="stat"><span class="stat-icon">${ic(icon, { size: 24 })}</span><strong>${esc(value)}</strong><span>${label}</span><small>${esc(note)}</small></div>`).join('')}</div>
    ${uptimePanel(data)}
    <div class="hl-grid">
      <section class="panel"><div class="panel-head"><div><h3>Services</h3><p>${list.filter(item => item.state === 'ok').length} of ${list.length} healthy</p></div></div>
        <div class="hl-checks">${list.map(item => `<div class="hl-check hl-${item.state}"><span class="hl-ico">${ic(item.icon, { size: 20 })}</span><div><b>${item.name}</b><small>${item.detail}</small></div><em>${STATE_TEXT[item.state]}</em></div>`).join('')}</div></section>
      <div class="hl-side">
        <section class="panel"><div class="panel-head"><div><h3>Gateway latency</h3><p>Bot to Discord, live samples</p></div></div><div class="panel-body">${pingBars()}</div></section>
        <section class="panel"><div class="panel-head"><div><h3>Workload</h3><p>Open items for this server</p></div></div>
          <div class="hl-queue">${queue.map(([label, value, view]) => `<button type="button" data-go="${view}"><span>${label}</span><b>${value}</b>${ic('arrow-right-01', { size: 16 })}</button>`).join('')}</div></section>
      </div>
    </div>
    <section class="panel"><div class="panel-head"><div><h3>Recent activity</h3><p>Latest audit log entries</p></div></div>
      <div class="hl-log">${data.logs.length ? data.logs.map(log => `<div><span>${esc(action(log.action))}</span><b>${esc(log.name || `User ${String(log.userId).slice(-4)}`)}</b><time>${ago(data.now - new Date(log.createdAt).getTime())}</time></div>`).join('') : '<div class="hl-empty">No activity recorded yet.</div>'}</div></section>`;
}

export function render(data) {
  if (data?.bot && !pingSamples.length) pingSamples.push(data.bot.pingMs);
  return `<div class="section-head"><div><h1>System health</h1><p>Live status of the bot, the database and the dashboard.</p></div><div class="actions"><a class="secondary" href="/status" target="_blank" rel="noopener">${ic('global', { size: 18 })} Public status page</a><button class="secondary" data-action="refresh">${ic('refresh-arrow-01', { size: 18 })} Refresh</button></div></div><div id="healthRoot">${body(data)}</div>
  <section class="panel mt-panel" id="maintPanel"><div class="panel-head"><div><h3>Maintenance</h3><p>Planned work shown on the public status page. Affected services are marked as under maintenance while it runs.</p></div></div>
    <form class="mt-form" id="maintForm"><label class="modal-field"><span>Title</span><input name="title" maxlength="90" required placeholder="Bot host migration"></label>
      <label class="modal-field"><span>Description <em>optional</em></span><textarea name="description" rows="2" maxlength="600" placeholder="What is changing and what users may notice"></textarea></label>
      <div class="mt-times"><label class="modal-field"><span>Starts</span><input name="startsAt" type="datetime-local" required></label><label class="modal-field"><span>Ends</span><input name="endsAt" type="datetime-local" required></label></div>
      <fieldset class="mt-affects"><legend>Affects</legend>${[['bot', 'Discord bot'], ['jobs', 'Background jobs'], ['database', 'Database'], ['dashboard', 'Dashboard']].map(([key, name]) => `<label><input type="checkbox" name="affects" value="${key}"> ${name}</label>`).join('')}</fieldset>
      <p class="pf-error" role="alert" hidden></p><div class="mt-actions"><button class="primary" type="submit">${ic('add', { size: 18 })} Schedule maintenance</button></div></form>
    <div class="mt-list" id="maintList"><div class="hl-empty">Loading maintenance</div></div></section>`;
}

async function loadMaintenance() {
  const box = document.getElementById('maintList');
  if (!box) return;
  try {
    const status = await api('/api/status');
    const rows = [...status.maintenances.ongoing, ...status.maintenances.upcoming, ...status.maintenances.completed.slice(0, 5)];
    const label = { in_progress: 'In progress', scheduled: 'Scheduled', completed: 'Completed' };
    box.innerHTML = rows.length ? rows.map(item => `<div class="mt-row"><div><b>${esc(item.title)}</b><small>${esc(new Date(item.startsAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }))} to ${esc(new Date(item.endsAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }))}${item.affects.length ? `, affects ${esc(item.affects.join(', '))}` : ''}</small></div><em class="mt-${item.status}">${label[item.status]}</em>${item.status !== 'completed' ? `<button class="secondary" type="button" data-mt-end="${esc(item.id)}">${item.status === 'in_progress' ? 'End now' : 'Cancel'}</button>` : ''}<button class="danger" type="button" data-mt-delete="${esc(item.id)}" aria-label="Delete">${ic('trash', { size: 16 })}</button></div>`).join('') : '<div class="hl-empty">No maintenance scheduled.</div>';
  } catch { box.innerHTML = '<div class="hl-empty">Could not load maintenance.</div>'; }
}

export function bind() {
  clearInterval(timer);
  const form = document.getElementById('maintForm');
  if (form) {
    const local = date => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    form.startsAt.value = local(new Date(Date.now() + 15 * 60000));
    form.endsAt.value = local(new Date(Date.now() + 75 * 60000));
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const error = form.querySelector('.pf-error'); error.hidden = true;
      const submit = form.querySelector('[type="submit"]'); submit.disabled = true;
      try {
        await api('/api/maintenances', { method: 'POST', body: JSON.stringify({ title: form.title.value, description: form.description.value, startsAt: new Date(form.startsAt.value).toISOString(), endsAt: new Date(form.endsAt.value).toISOString(), affects: [...form.querySelectorAll('[name="affects"]:checked')].map(box => box.value) }) });
        toast('Maintenance scheduled'); form.title.value = ''; form.description.value = ''; await loadMaintenance();
      } catch (failure) { error.textContent = failure.message || 'Could not schedule maintenance.'; error.hidden = false; }
      submit.disabled = false;
    });
    document.getElementById('maintList').addEventListener('click', async event => {
      const end = event.target.closest('[data-mt-end]'); const del = event.target.closest('[data-mt-delete]');
      try {
        if (end) await api(`/api/maintenances/${end.dataset.mtEnd}/end`, { method: 'POST' });
        else if (del) await api(`/api/maintenances/${del.dataset.mtDelete}`, { method: 'DELETE' });
        else return;
        toast('Maintenance updated'); await loadMaintenance();
      } catch (failure) { toast(failure.message || 'Could not update maintenance'); }
    });
    loadMaintenance();
  }
  // The health block is re-rendered every few seconds, so navigation is delegated from the stable root.
  document.getElementById('healthRoot')?.addEventListener('click', event => {
    const view = event.target.closest('[data-go]')?.dataset.go;
    if (view) window.dispatchEvent(new CustomEvent('rift:navigate', { detail: view }));
  });
  timer = setInterval(async () => {
    const root = document.getElementById('healthRoot');
    if (!root) return clearInterval(timer);
    try {
      const data = await api('/api/health');
      if (data.bot && data.now - new Date(data.bot.updatedAt).getTime() < 120000) { pingSamples.push(data.bot.pingMs); if (pingSamples.length > 40) pingSamples.shift(); }
      if (document.getElementById('healthRoot')) document.getElementById('healthRoot').innerHTML = body(data);
    } catch { /* keep the last good view */ }
  }, 5000);
}
