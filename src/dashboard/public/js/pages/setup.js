import { $, api, toast } from '../ui.js';

function select(id, label, items, placeholder = 'Select from Discord', value = '') {
  const optional = ['Optional'].includes(placeholder);
  const channelSelect = id.endsWith('ChannelId');
  return `<label class="setup-field"><span>${label}${optional ? ' <em class="setup-optional">optional</em>' : ''}</span><select id="${id}" name="${id}" data-resource-select="${channelSelect ? 'channel' : 'role'}" ${optional ? '' : 'required'}><option value="">${placeholder}</option>${items.map(item => `<option value="${item.id}" ${value === item.id ? 'selected' : ''}>${item.name}</option>`).join('')}</select></label>`;
}

export async function render(settings = {}) {
  const options = await api('/api/setup/options');
  const configured = Boolean(settings.guildId);
  return `<div class="setup-shell">
    <div class="setup-intro">
      <h1>${configured ? 'Configure your server.' : 'Set up Rift for this server.'}</h1>
      <p>Choose the Discord roles and channels Rift should use. Every selection is saved for the selected server only.</p>
      <div class="setup-help"><b>Before you save</b><span>Bot role must be above Staff, On Shift, and On Leave roles.</span><span>Staff Role = who can use staff tools.</span><span>On Shift Role = temporary role while a shift is active.</span><span>On Leave Role = temporary role while leave is approved.</span></div>
    </div>
    <section class="panel setup-panel">
      <div class="panel-head"><div><h3>Server configuration</h3><p>All fields below are Discord resources from this server.</p></div></div>
      <form id="setupForm" class="setup-form">
        <label class="setup-field setup-resource-search"><span>Search server roles</span><input id="roleSearch" type="search" placeholder="Type Staff, Management, or another role..."></label>
        ${select('staffRoleId', 'Staff role', options.roles, 'Select a role', settings.staffRoleId)}
        ${select('onShiftRoleId', 'On Shift role', options.roles, 'Select a role', settings.onShiftRoleId)}
        ${select('leaveRoleId', 'On Leave role', options.roles, 'Select a role', settings.leaveRoleId)}
        ${select('managementRoleId', 'Management role', options.roles, 'Select a role', settings.managementRoleId)}
        <label class="setup-field setup-channel-search"><span>Search server channels</span><input id="channelSearch" type="search" placeholder="Type a channel name..."></label>
        ${select('shiftChannelId', 'Shift panel channel', options.channels, 'Select a channel', settings.shiftChannelId)}
        ${select('leaveChannelId', 'Leave requests channel', options.channels, 'Select a channel', settings.leaveChannelId)}
        ${select('resignationChannelId', 'Resignation requests channel', options.channels, 'Select a channel', settings.resignationChannelId)}
        ${select('logsChannelId', 'Audit log channel', options.channels, 'Select a channel', settings.logsChannelId)}
        ${select('reportChannelId', 'Reports channel', options.channels, 'Optional', settings.reportChannelId)}
        ${select('complaintChannelId', 'Complaints channel', options.channels, 'Optional', settings.complaintChannelId)}
        <button class="primary wide" type="submit">Save server settings</button>
      </form>
      <div class="message-template">
        <h3>Points message text</h3>
        <p>This text is editable by the owner only. Buttons and logic are protected and cannot be disabled.</p>
        <form id="messageForm">
          <input name="title" placeholder="💙 Rift • Greetings ${settings.language === 'ar' ? 'مرحبًا' : 'Hello'}" value="${(settings.pointsMessageTitle || '').replace(/"/g, '&quot;')}">
          <input name="description" placeholder="Personal report visible only to the staff member." value="${(settings.pointsMessageDescription || '').replace(/"/g, '&quot;')}">
          <input name="footer" placeholder="Rift Staff Operations" value="${(settings.pointsMessageFooter || '').replace(/"/g, '&quot;')}">
          <button class="secondary" type="submit">Save message text</button>
        </form>
      </div>
    </section>
  </div>`;
}

export function bind() {
  const panel = document.querySelector('.setup-panel');
  const setupForm = document.querySelector('#setupForm');
  const channelSearch = document.querySelector('#channelSearch');
  const roleSearch = document.querySelector('#roleSearch');
  const filterResources = (input, kind) => {
    const query = String(input?.value || '').trim().toLowerCase();
    document.querySelectorAll(`[data-resource-select="${kind}"]`).forEach(selectElement => Array.from(selectElement.options).forEach((option, index) => {
      option.hidden = index > 0 && query.length > 0 && !option.textContent.toLowerCase().includes(query);
    }));
  };
  channelSearch?.addEventListener('input', () => filterResources(channelSearch, 'channel'));
  roleSearch?.addEventListener('input', () => filterResources(roleSearch, 'role'));
  if (panel && !document.querySelector('#setupQuickGuide')) {
    const guide = document.createElement('div');
    guide.id = 'setupQuickGuide';
    guide.className = 'message-template';
    guide.innerHTML = '<h3>Quick and clear setup</h3><p>Choose the roles and channels here and save. From Discord you can also use <strong>/staff panel</strong> to manage the team, and the panels are published from the Channels tools after saving.</p><div class="setup-help"><span>1. Save the Staff and On Shift roles.</span><span>2. Choose the shift, logs, complaint, and rating channels.</span><span>3. Send the panels from the panel tools after saving.</span></div>';
    document.querySelector('.setup-intro')?.appendChild(guide);
  }
  if (setupForm && !document.querySelector('#ratingChannelId')) {
    const source = document.querySelector('#complaintChannelId');
    if (source) {
      const field = source.closest('.setup-field').cloneNode(true);
      field.querySelector('span').textContent = 'Rating channel';
      const selectElement = field.querySelector('select');
      selectElement.id = 'ratingChannelId';
      selectElement.name = 'ratingChannelId';
      setupForm.insertBefore(field, setupForm.querySelector('button[type="submit"]'));
    }
  }
  if (panel && !$('#languageForm')) {
    const languageBox = document.createElement('div');
    languageBox.className = 'message-template';
    languageBox.innerHTML = '<h3>Bot language</h3><p>Choose the language used by new Rift panels and messages.</p><form id="languageForm"><select name="language"><option value="en">English</option><option value="ar">العربية</option></select><button class="secondary" type="submit">Save language</button></form>';
    panel.appendChild(languageBox);
    const complaintBox = document.createElement('div');
    complaintBox.className = 'message-template';
    complaintBox.innerHTML = '<h3>Complaint panel</h3><p>Publish one official panel. Existing duplicate panels in the selected channel are cleaned automatically.</p><form id="complaintPanelForm"><select name="channelId"><option value="">Select a channel...</option></select><button class="secondary" type="submit">Update complaint panel</button></form>';
    panel.appendChild(complaintBox);
    const ratingBox = document.createElement('div');
    ratingBox.className = 'message-template';
    ratingBox.innerHTML = '<h3>Rating panel</h3><p>Choose the rating channel and send the panel to it. New ratings will appear in the same channel.</p><form id="ratingPanelForm"><select name="channelId"><option value="">Select a rating channel...</option></select><button class="secondary" type="submit">Send rating panel</button></form>';
    panel.appendChild(ratingBox);
    api('/api/panel/options').then(result => { const complaintSelect = document.querySelector('#complaintPanelForm select'); const ratingSelect = document.querySelector('#ratingPanelForm select'); const options = result.channels.map(channel => `<option value="${channel.id}">${channel.name}</option>`).join(''); if (complaintSelect) complaintSelect.innerHTML = '<option value="">Select a channel...</option>' + options; if (ratingSelect) ratingSelect.innerHTML = '<option value="">Select a rating channel...</option>' + options; }).catch(() => undefined);
  }
  $('#setupForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget));
    try { await api('/api/setup', { method: 'POST', body: JSON.stringify(body) }); toast('Rift server configured successfully'); location.reload(); } catch (error) { toast(error.message); }
  });
  $('#messageForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    try { await api('/api/settings/messages', { method: 'PATCH', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); toast('Points message text saved'); } catch (error) { toast(error.message); }
  });
  $('#languageForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    try { await api('/api/settings/language', { method: 'PATCH', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); toast('Bot language saved'); } catch (error) { toast(error.message); }
  });
  $('#complaintPanelForm')?.addEventListener('submit', async event => { event.preventDefault(); const button = event.currentTarget.querySelector('button[type="submit"]'); if (button.disabled) return; button.disabled = true; button.textContent = 'Updating...'; try { const result = await api('/api/complaints/panel', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); toast(result.removedDuplicates ? `Panel updated; removed ${result.removedDuplicates} duplicates` : 'Complaint panel updated'); } catch (error) { toast(error.message); } finally { button.disabled = false; button.textContent = 'Update complaint panel'; } });
  $('#ratingPanelForm')?.addEventListener('submit', async event => { event.preventDefault(); try { const result = await api('/api/ratings/panel', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); toast(result.updated ? 'Rating panel updated' : 'Rating panel published'); } catch (error) { toast(error.message); } });
}
