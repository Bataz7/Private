import { api, esc, toast } from '../ui.js';
import { ic } from '../icon.js';
import { confirmAction } from '../confirm.js';

// Admin page: write updates ("tweets") that appear on the public status page, optionally posted to Discord too.
const KINDS = [['update', 'Update', 'notification'], ['announcement', 'Announcement', 'flash'], ['incident', 'Incident', 'danger'], ['resolved', 'Resolved', 'tick-circle'], ['maintenance', 'Maintenance', 'setting-2']];
const ago = value => { const s = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000)); if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return new Date(value).toLocaleDateString('en-US', { dateStyle: 'medium' }); };
let state = null;

export function render() { return '<div class="sx-page" id="stp"><div class="page-loading"><span class="skeleton"></span></div></div>'; }

export async function bind() {
  state = { el: document.getElementById('stp'), posts: [], channels: [], editing: null };
  try {
    const [posts, options] = await Promise.all([api('/api/status-posts'), api('/api/panel/options').catch(() => ({ channels: [] }))]);
    state.posts = posts.posts; state.channels = options.channels || [];
  } catch (error) { state.el.innerHTML = `<div class="error-state"><h3>Could not load status updates</h3><p>${esc(error.message)}</p></div>`; return; }
  paint();
}

function paint() {
  const editing = state.posts.find(post => post.id === state.editing) || null;
  state.el.innerHTML = `<div class="section-head"><div><h1>Status updates</h1><p>Short posts shown on the public status page: announcements, incident notes and fixes. Only administrators of the main server can post.</p></div><div class="sx-head-actions"><a class="secondary" href="/status" target="_blank" rel="noopener">${ic('arrow-up-04', { size: 15 })} View status page</a></div></div>
    <div class="sx-cols">
    <section class="panel"><div class="panel-head"><div><h3>${editing ? 'Edit update' : 'New update'}</h3><p>Links and **bold** work in the text.</p></div></div><form class="rx-body" data-compose>
      <div class="sx-kinds">${KINDS.map(([key, label, icon]) => `<label class="sx-kind"><input type="radio" name="kind" value="${key}" ${(editing?.kind || 'update') === key ? 'checked' : ''}><span>${ic(icon, { size: 16 })}<b>${label}</b></span></label>`).join('')}</div>
      <label class="rx-field"><span>Title</span><input dir="auto" name="title" maxlength="120" required value="${esc(editing?.title || '')}" placeholder="e.g. Weekly reports now include voice hours"></label>
      <label class="rx-field"><span>Text <small class="rx-hint">Optional</small></span><textarea dir="auto" name="body" rows="5" maxlength="2000" placeholder="What changed, who is affected, what to do.">${esc(editing?.body || '')}</textarea></label>
      <label class="rx-toggle"><span class="rx-switch"><input type="checkbox" name="pinned" ${editing?.pinned ? 'checked' : ''}><i></i></span><span><b>Pin to the top</b><small>Pinned updates stay first on the status page.</small></span></label>
      ${editing ? '' : `<label class="rx-field"><span>Also post in Discord <small class="rx-hint">Optional</small></span><select name="channelId"><option value="">Do not post in Discord</option>${state.channels.map(channel => `<option value="${esc(channel.id)}">#${esc(channel.name)}</option>`).join('')}</select></label>`}
      <div class="rx-actions">${editing ? '<button type="button" class="secondary" data-cancel>Cancel</button>' : ''}<button type="submit" class="primary">${ic('send-2', { size: 15 })} ${editing ? 'Save changes' : 'Publish update'}</button></div>
    </form></section>
    <section class="panel"><div class="panel-head"><div><h3>Published</h3><p>${state.posts.length} update(s)</p></div></div><div class="rx-body sx-list">${state.posts.map(post => `<article class="sx-post k-${esc(post.kind)}"><header><b dir="auto">${esc(post.title)}</b><span class="rx-chip">${esc(KINDS.find(kind => kind[0] === post.kind)?.[1] || post.kind)}</span>${post.pinned ? `<span class="rx-chip">${ic('flag', { size: 11 })} Pinned</span>` : ''}</header>${post.body ? `<p dir="auto">${esc(post.body)}</p>` : ''}<footer><small>${esc(post.authorName)} · ${ago(post.createdAt)}</small><button type="button" class="rx-link" data-pin="${esc(post.id)}">${post.pinned ? 'Unpin' : 'Pin'}</button><button type="button" class="rx-link" data-edit="${esc(post.id)}">Edit</button><button type="button" class="rx-link danger" data-delete="${esc(post.id)}">Delete</button></footer></article>`).join('') || '<p class="rx-empty">Nothing published yet.</p>'}</div></section></div>`;
  const el = state.el;
  const form = el.querySelector('[data-compose]');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    const body = { title: values.title, body: values.body, kind: values.kind, pinned: form.elements.pinned.checked, channelId: values.channelId || '' };
    try {
      if (editing) await api(`/api/status-posts/${editing.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      else { const result = await api('/api/status-posts', { method: 'POST', body: JSON.stringify(body) }); toast(result.announced ? 'Published and also posted in Discord' : 'Published on the status page'); }
      state.editing = null; state.posts = (await api('/api/status-posts')).posts; paint();
    } catch (error) { toast(error.message); }
  });
  el.querySelector('[data-cancel]')?.addEventListener('click', () => { state.editing = null; paint(); });
  el.querySelectorAll('[data-edit]').forEach(button => button.addEventListener('click', () => { state.editing = button.dataset.edit; paint(); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
  el.querySelectorAll('[data-pin]').forEach(button => button.addEventListener('click', async () => {
    const post = state.posts.find(item => item.id === button.dataset.pin);
    try { await api(`/api/status-posts/${post.id}`, { method: 'PATCH', body: JSON.stringify({ title: post.title, body: post.body, kind: post.kind, pinned: !post.pinned }) }); state.posts = (await api('/api/status-posts')).posts; paint(); } catch (error) { toast(error.message); }
  }));
  el.querySelectorAll('[data-delete]').forEach(button => button.addEventListener('click', async () => {
    if (!await confirmAction({ title: 'Delete this update?', message: 'It disappears from the public status page. A copy already posted in Discord stays there.', confirmText: 'Delete update' })) return;
    try { await api(`/api/status-posts/${button.dataset.delete}`, { method: 'DELETE' }); state.posts = state.posts.filter(post => post.id !== button.dataset.delete); paint(); } catch (error) { toast(error.message); }
  }));
}
