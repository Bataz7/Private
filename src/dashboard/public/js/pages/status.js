import { api, esc, toast } from '../ui.js';
import { ic } from '../icon.js';

// Bot presence: Discord state, rotating activity lines (each with its own type), live variables and a profile preview.
const STATES = [['online', 'Online', 'Green dot, fully available'], ['idle', 'Idle', 'Moon, away but visible'], ['dnd', 'Do not disturb', 'Red dot, busy'], ['invisible', 'Invisible', 'Looks offline, still working']];
const TYPES = [['custom', 'Custom', ''], ['playing', 'Playing', 'Playing'], ['watching', 'Watching', 'Watching'], ['listening', 'Listening', 'Listening to'], ['competing', 'Competing', 'Competing in'], ['streaming', 'Streaming', 'Streaming']];
const VARIABLES = [['servers', 'Servers the bot is in'], ['members', 'Members across servers'], ['staff', 'Active staff'], ['onshift', 'Staff on shift now'], ['server', 'Main server name']];
const PRESETS = [
  { type: 'watching', text: '{onshift} staff on shift' },
  { type: 'watching', text: 'over {members} members' },
  { type: 'playing', text: 'with {staff} staff members' },
  { type: 'custom', text: 'Keeping {server} running smoothly' },
  { type: 'listening', text: 'your reports' },
  { type: 'competing', text: 'staff of the week' },
];
const MAX = 128;
const DEFAULT = { status: 'idle', entries: [{ text: 'Rift Staff Operations', type: 'playing' }], interval: 30, mode: 'sequence', url: '' };

const fill = (text, vars) => String(text || '').replace(/\{(servers|members|staff|onshift|server)\}/g, (_, key) => vars?.[key] ?? '');
const verb = type => (TYPES.find(item => item[0] === type) || TYPES[1])[2];

function lineRow(entry, index, count) {
  return `<div class="bp-line" data-line="${index}">
    <span class="bp-grip">${index + 1}</span>
    <select data-field="type" aria-label="Activity type">${TYPES.map(([value, label]) => `<option value="${value}" ${entry.type === value ? 'selected' : ''}>${label}</option>`).join('')}</select>
    <div class="bp-input"><input data-field="text" value="${esc(entry.text)}" maxlength="${MAX}" dir="auto" placeholder="What should the bot show?"><small data-count>${entry.text.length}/${MAX}</small></div>
    <div class="bp-line-tools">
      <button type="button" class="icon-btn" data-move="-1" ${index === 0 ? 'disabled' : ''} aria-label="Move up">${ic('arrow-up-04', { size: 14 })}</button>
      <button type="button" class="icon-btn" data-move="1" ${index === count - 1 ? 'disabled' : ''} aria-label="Move down"><span class="bp-flip">${ic('arrow-up-04', { size: 14 })}</span></button>
      <button type="button" class="icon-btn danger" data-remove ${count === 1 ? 'disabled' : ''} aria-label="Remove">${ic('trash', { size: 14 })}</button>
    </div>
  </div>`;
}

export function render(data = {}) {
  const config = data.config || DEFAULT;
  const editable = data.editable !== false;
  const bot = data.bot || { username: 'Rift', avatar: '' };
  return `<div class="bp-page" data-editable="${editable}">
    <div class="section-head"><div><h1>Bot status</h1><p>How Rift appears in every server's member list. One presence is shared by all servers.</p></div></div>
    ${editable ? '' : `<div class="bp-note">${ic('lock', { size: 15 })} The presence can only be changed from the main server. You are viewing it read-only.</div>`}
    ${data.migrated === false && data.configured ? `<div class="bp-note warn">${ic('warning-2', { size: 15 })} Per-line types and random order need database migration <code>034_reports_status.sql</code>. Until it is run, all lines use the first line's type.</div>` : ''}
    <div class="bp-grid">
      <div class="bp-main">
        <section class="panel bp-card"><div class="panel-head"><div><h3>Online state</h3><p>The dot next to the bot's name.</p></div></div>
          <div class="bp-states">${STATES.map(([value, label, description]) => `<button type="button" class="bp-state ${config.status === value ? 'selected' : ''}" data-state="${value}" ${editable ? '' : 'disabled'}><span class="presence-dot presence-${value}"></span><span><b>${label}</b><small>${description}</small></span></button>`).join('')}</div>
        </section>

        <section class="panel bp-card"><div class="panel-head"><div><h3>Activity lines</h3><p>Each line can have its own type. With more than one line, the bot rotates through them.</p></div><button type="button" class="secondary" data-add ${editable ? '' : 'disabled'}>${ic('add', { size: 14 })} Add line</button></div>
          <div class="bp-lines" data-lines></div>
          <div class="bp-vars"><span>Insert a live value</span>${VARIABLES.map(([key, label]) => `<button type="button" class="bp-chip" data-var="${key}" title="${label}">{${key}}<em>${esc(data.vars?.[key] ?? '')}</em></button>`).join('')}</div>
          <div class="bp-presets"><span>Ideas</span>${PRESETS.map((preset, index) => `<button type="button" class="bp-chip ghost" data-preset="${index}">${verb(preset.type) ? `${verb(preset.type)} ` : ''}${esc(preset.text)}</button>`).join('')}</div>
        </section>

        <section class="panel bp-card"><div class="panel-head"><div><h3>Rotation</h3><p>How often and in what order the lines change.</p></div></div>
          <div class="bp-rotation">
            <label class="rx-field"><span>Change every</span><div class="bp-range"><input type="range" min="10" max="600" step="5" data-interval-range value="${Math.min(600, config.interval)}"><input type="number" min="10" max="3600" data-interval value="${config.interval}"><em>sec</em></div><small class="rx-hint">Discord rate-limits presence updates, so 15 seconds or more is recommended.</small></label>
            <div class="rx-field"><span>Order</span><div class="rx-seg" data-mode><button type="button" data-value="sequence" aria-pressed="${config.mode !== 'random'}">${ic('arrow-right-01', { size: 14 })} In order</button><button type="button" data-value="random" aria-pressed="${config.mode === 'random'}">${ic('refresh-arrow-01', { size: 14 })} Random</button></div></div>
            <label class="rx-field" data-stream hidden><span>Streaming link</span><input type="url" data-url value="${esc(config.url || '')}" placeholder="https://twitch.tv/yourchannel"><small class="rx-hint">Twitch or YouTube only. Without a link, streaming lines show as Playing.</small></label>
          </div>
        </section>
      </div>

      <aside class="bp-side">
        <div class="bp-profile">
          <div class="bp-banner"></div>
          <div class="bp-avatar">${bot.avatar ? `<img src="${esc(bot.avatar)}" alt="">` : `<span>${esc((bot.username || 'R')[0])}</span>`}<i class="presence-dot presence-${config.status}" data-preview-dot></i></div>
          <div class="bp-profile-body">
            <b>${esc(bot.username)}</b><span class="bp-badge">APP</span>
            <div class="bp-activity" data-preview-activity></div>
          </div>
        </div>
        <div class="bp-side-meta">
          <div><span>Showing</span><b data-preview-index>1 / 1</b></div>
          <div><span>Next change</span><b data-preview-next>-</b></div>
        </div>
        <p class="bp-hint">${ic('info-circle', { size: 14 })} Preview uses today's real numbers. The member list shows the same line.</p>
        <div class="bp-save" data-savebar><span data-dirty>All changes saved</span><button type="button" class="primary" data-save ${editable ? '' : 'disabled'}>${ic('tick-circle', { size: 15 })} Save & apply</button></div>
      </aside>
    </div>
  </div>`;
}

export function bind(data = {}, refresh) {
  const root = document.querySelector('.bp-page');
  if (!root) return;
  const editable = data.editable !== false;
  const config = data.config || DEFAULT;
  const state = { status: config.status, entries: (config.entries.length ? config.entries : DEFAULT.entries).map(entry => ({ ...entry })), interval: config.interval, mode: config.mode, url: config.url || '' };
  const initial = JSON.stringify(state);
  let focused = null; let showing = 0; let countdown = 0;
  const lines = root.querySelector('[data-lines]');

  const dirty = () => {
    const changed = JSON.stringify(state) !== initial;
    root.querySelector('[data-dirty]').textContent = changed ? 'Unsaved changes' : 'All changes saved';
    root.querySelector('[data-savebar]').classList.toggle('is-dirty', changed);
  };
  const drawPreview = () => {
    const entry = state.entries[showing % state.entries.length] || { text: '', type: 'playing' };
    const text = fill(entry.text, data.vars) || '...';
    const streaming = entry.type === 'streaming' && state.url;
    const label = entry.type === 'custom' ? '' : entry.type === 'streaming' && !state.url ? 'Playing' : verb(entry.type);
    root.querySelector('[data-preview-activity]').innerHTML = entry.type === 'custom'
      ? `<p class="bp-custom" dir="auto">${esc(text)}</p>`
      : `<small>${label}</small><p dir="auto" class="${streaming ? 'is-stream' : ''}">${esc(text)}</p>`;
    root.querySelector('[data-preview-dot]').className = `presence-dot presence-${streaming ? 'streaming' : state.status}`;
    root.querySelector('[data-preview-index]').textContent = `${(showing % state.entries.length) + 1} / ${state.entries.length}`;
    root.querySelector('[data-stream]').hidden = !state.entries.some(item => item.type === 'streaming');
  };
  const drawLines = () => {
    lines.innerHTML = state.entries.map((entry, index) => lineRow(entry, index, state.entries.length)).join('');
    if (!editable) lines.querySelectorAll('input,select,button').forEach(element => { element.disabled = true; });
    drawPreview();
  };

  lines.addEventListener('input', event => {
    const row = event.target.closest('[data-line]'); if (!row) return;
    const entry = state.entries[Number(row.dataset.line)];
    entry[event.target.dataset.field] = event.target.value;
    if (event.target.dataset.field === 'text') { focused = event.target; row.querySelector('[data-count]').textContent = `${event.target.value.length}/${MAX}`; }
    showing = Number(row.dataset.line); countdown = state.interval;
    drawPreview(); dirty();
  });
  lines.addEventListener('change', event => {
    if (event.target.dataset.field !== 'type') return;
    const index = Number(event.target.closest('[data-line]').dataset.line);
    state.entries[index].type = event.target.value; showing = index;
    drawPreview(); dirty();
  });
  lines.addEventListener('focusin', event => { if (event.target.dataset.field === 'text') focused = event.target; });
  lines.addEventListener('click', event => {
    const row = event.target.closest('[data-line]'); if (!row) return;
    const index = Number(row.dataset.line);
    const move = event.target.closest('[data-move]');
    if (move) { const to = index + Number(move.dataset.move); [state.entries[index], state.entries[to]] = [state.entries[to], state.entries[index]]; }
    else if (event.target.closest('[data-remove]')) { state.entries.splice(index, 1); showing = 0; }
    else return;
    drawLines(); dirty();
  });
  const addLine = entry => {
    if (state.entries.length >= 25) return toast('Up to 25 lines.');
    state.entries.push(entry); showing = state.entries.length - 1; countdown = state.interval;
    drawLines(); dirty();
    focused = lines.querySelector(`[data-line="${state.entries.length - 1}"] [data-field="text"]`); if (focused) { focused.focus(); focused.setSelectionRange(focused.value.length, focused.value.length); }
  };
  root.querySelector('[data-add]')?.addEventListener('click', () => addLine({ type: 'playing', text: '' }));
  root.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => { if (editable) addLine({ ...PRESETS[Number(button.dataset.preset)] }); }));
  root.querySelectorAll('[data-var]').forEach(button => button.addEventListener('mousedown', event => event.preventDefault()));
  root.querySelectorAll('[data-var]').forEach(button => button.addEventListener('click', () => {
    if (!editable) return;
    const active = document.activeElement?.dataset?.field === 'text' ? document.activeElement : null;
    const input = active || (focused && document.body.contains(focused) ? focused : lines.querySelector('[data-field="text"]'));
    if (!input) return;
    const token = `{${button.dataset.var}}`;
    const start = input.selectionStart ?? input.value.length; const end = input.selectionEnd ?? start;
    input.value = (input.value.slice(0, start) + token + input.value.slice(end)).slice(0, MAX);
    input.setSelectionRange(start + token.length, start + token.length); input.focus();
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }));
  root.querySelectorAll('[data-state]').forEach(button => button.addEventListener('click', () => {
    state.status = button.dataset.state;
    root.querySelectorAll('[data-state]').forEach(item => item.classList.toggle('selected', item === button));
    drawPreview(); dirty();
  }));
  const range = root.querySelector('[data-interval-range]'); const number = root.querySelector('[data-interval]');
  range.addEventListener('input', () => { number.value = range.value; state.interval = Number(range.value); countdown = state.interval; dirty(); });
  number.addEventListener('input', () => { const value = Math.max(10, Math.min(3600, Number(number.value) || 30)); range.value = String(Math.min(600, value)); state.interval = value; dirty(); });
  root.querySelectorAll('[data-mode] button').forEach(button => button.addEventListener('click', () => {
    state.mode = button.dataset.value;
    root.querySelectorAll('[data-mode] button').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    dirty();
  }));
  root.querySelector('[data-url]').addEventListener('input', event => { state.url = event.target.value.trim(); drawPreview(); dirty(); });
  if (!editable) root.querySelectorAll('.bp-rotation input, .bp-rotation button').forEach(element => { element.disabled = true; });

  root.querySelector('[data-save]')?.addEventListener('click', async event => {
    const entries = state.entries.map(entry => ({ type: entry.type, text: entry.text.trim() })).filter(entry => entry.text);
    if (!entries.length) return toast('Add at least one activity line.');
    // currentTarget is gone after an await, so keep the button itself.
    const button = event.currentTarget;
    button.disabled = true;
    const streaming = entries.some(entry => entry.type === 'streaming');
    try {
      const result = await api('/api/bot/custom-status', { method: 'PATCH', body: JSON.stringify({ status: state.status, entries, interval: state.interval, mode: state.mode, ...(streaming ? { streamUrl: state.url } : {}) }) });
      toast(result.warning || 'Presence saved and applied');
      await refresh();
    } catch (error) { toast(error.message || 'Could not save the presence.'); button.disabled = false; }
  });

  // Live preview rotation, stopped automatically once the page is left.
  countdown = state.interval;
  const timer = setInterval(() => {
    if (!document.body.contains(root)) return clearInterval(timer);
    countdown -= 1;
    if (countdown <= 0) {
      countdown = state.interval;
      if (state.entries.length > 1) { showing = state.mode === 'random' ? (showing + 1 + Math.floor(Math.random() * (state.entries.length - 1))) % state.entries.length : (showing + 1) % state.entries.length; drawPreview(); }
    }
    root.querySelector('[data-preview-next]').textContent = state.entries.length > 1 ? `in ${countdown}s` : 'Stays fixed';
  }, 1000);
  drawLines(); dirty();
}
