import { newId, type StudioDoc } from './schema.js';

const PURPLE = '#8175f5';

// Starting points shown when creating a Studio message. They go through sanitizeDoc like any other input.
export const STUDIO_TEMPLATES: Record<string, { name: string; doc: StudioDoc }> = {
  blank: { name: 'Untitled message', doc: { mode: 'v2', content: '', embeds: [], components: [{ id: newId(), type: 'container', color: PURPLE, spoiler: false, children: [{ id: newId(), type: 'text', content: '## New message\nWrite something here.' }] }] } },
  announcement: {
    name: 'Announcement',
    doc: { mode: 'v2', content: '', embeds: [], components: [{ id: newId(), type: 'container', color: PURPLE, spoiler: false, children: [
      { id: newId(), type: 'text', content: '# 📢 Announcement\nHello {server}! We have some news to share with everyone.' },
      { id: newId(), type: 'separator', divider: true, spacing: 'small' },
      { id: newId(), type: 'text', content: '### What is new\n- First update\n- Second update\n- Third update' },
      { id: newId(), type: 'separator', divider: true, spacing: 'small' },
      { id: newId(), type: 'text', content: '-# Posted by the {server} team' },
    ] }] },
  },
  rules: {
    name: 'Server rules',
    doc: { mode: 'v2', content: '', embeds: [], components: [{ id: newId(), type: 'container', color: '#e9697b', spoiler: false, children: [
      { id: newId(), type: 'text', content: '# 📜 Server rules' },
      { id: newId(), type: 'separator', divider: true, spacing: 'small' },
      { id: newId(), type: 'text', content: '**1.** Respect every member\n**2.** No spam or advertising\n**3.** Use the right channels\n**4.** No NSFW content' },
      { id: newId(), type: 'separator', divider: true, spacing: 'large' },
      { id: newId(), type: 'text', content: '-# Breaking the rules leads to moderation action' },
      { id: newId(), type: 'buttons', buttons: [{ id: newId(), label: 'I agree', emoji: '✅', style: 'success', url: '', disabled: false, actions: [{ type: 'reply', content: 'Thanks for accepting the rules!', ephemeral: true, messageId: '' }] }] },
    ] }] },
  },
  roles: {
    name: 'Role picker',
    doc: { mode: 'v2', content: '', embeds: [], components: [{ id: newId(), type: 'container', color: '#4fc08d', spoiler: false, children: [
      { id: newId(), type: 'text', content: '# 🎭 Pick your roles\nChoose the roles you want from the menu below. Pick again to remove them.' },
      { id: newId(), type: 'select', select: { id: newId(), placeholder: 'Choose roles...', min: 1, max: 1, disabled: false, options: [
        { id: newId(), label: 'Announcements', description: 'Get pinged for news', emoji: '📢', actions: [{ type: 'toggleRoles', roleIds: [] }] },
        { id: newId(), label: 'Events', description: 'Get pinged for events', emoji: '🎉', actions: [{ type: 'toggleRoles', roleIds: [] }] },
      ] } },
    ] }] },
  },
  form: {
    name: 'Contact form',
    doc: { mode: 'v2', content: '', embeds: [], components: [{ id: newId(), type: 'container', color: '#e0b04f', spoiler: false, children: [
      { id: newId(), type: 'text', content: '# 📨 Contact the team\nPress the button below and fill in the form. The team gets your answers right away.' },
      { id: newId(), type: 'buttons', buttons: [{ id: newId(), label: 'Open form', emoji: '📝', style: 'primary', url: '', disabled: false, actions: [{ type: 'form', title: 'Contact the team', fields: [
        { id: newId(), label: 'Subject', description: '', style: 'short', required: true, placeholder: 'What is it about?', min: null, max: 100 },
        { id: newId(), label: 'Message', description: '', style: 'paragraph', required: true, placeholder: '', min: 10, max: 1500 },
      ], submit: [{ type: 'reply', content: '✅ Thanks {user.name}, the team received your message.', ephemeral: true, messageId: '' }, { type: 'channel', channelId: '', content: '📨 New message from {user}', format: 'answers' }] }] }] },
    ] }] },
  },
  embed: {
    name: 'Classic embed',
    doc: { mode: 'embed', content: '', components: [], embeds: [{ title: 'Classic embed', url: '', description: 'A regular Discord embed. Switch to Components V2 any time.', color: PURPLE, timestamp: true, author: { name: '', url: '', icon: '' }, footer: { text: '{server}', icon: '' }, thumbnail: '', image: '', fields: [{ name: 'Field', value: 'Value', inline: true }] }] },
  },
};
