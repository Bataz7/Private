import { newId, type StudioDoc } from './schema.js';

const PURPLE = '#8175f5';

// Starting points shown when creating a Studio message. They go through sanitizeDoc like any other input.
export const STUDIO_TEMPLATES: Record<string, { name: string; doc: StudioDoc }> = {
  blank: { name: 'رسالة بدون عنوان', doc: { mode: 'v2', content: '', embeds: [], components: [{ id: newId(), type: 'container', color: PURPLE, spoiler: false, children: [{ id: newId(), type: 'text', content: '## رسالة جديدة\nاكتب أي شي هنا.' }] }] } },
  announcement: {
    name: 'إعلان',
    doc: { mode: 'v2', content: '', embeds: [], components: [{ id: newId(), type: 'container', color: PURPLE, spoiler: false, children: [
      { id: newId(), type: 'text', content: '# 📢 إعلان\nهلا {server}! عندنا أخبار نبي نشاركها معكم.' },
      { id: newId(), type: 'separator', divider: true, spacing: 'small' },
      { id: newId(), type: 'text', content: '### وش الجديد\n- التحديث الأول\n- التحديث الثاني\n- التحديث الثالث' },
      { id: newId(), type: 'separator', divider: true, spacing: 'small' },
      { id: newId(), type: 'text', content: '-# من فريق {server}' },
    ] }] },
  },
  rules: {
    name: 'قوانين السيرفر',
    doc: { mode: 'v2', content: '', embeds: [], components: [{ id: newId(), type: 'container', color: '#e9697b', spoiler: false, children: [
      { id: newId(), type: 'text', content: '# 📜 قوانين السيرفر' },
      { id: newId(), type: 'separator', divider: true, spacing: 'small' },
      { id: newId(), type: 'text', content: '**1.** احترم كل الأعضاء\n**2.** ممنوع السبام والإعلانات\n**3.** استخدم الروم المناسب\n**4.** ممنوع المحتوى غير اللائق' },
      { id: newId(), type: 'separator', divider: true, spacing: 'large' },
      { id: newId(), type: 'text', content: '-# مخالفة القوانين تعرّضك لإجراء إداري' },
      { id: newId(), type: 'buttons', buttons: [{ id: newId(), label: 'أوافق', emoji: '✅', style: 'success', url: '', disabled: false, actions: [{ type: 'reply', content: 'شكرًا على موافقتك على القوانين!', ephemeral: true, messageId: '' }] }] },
    ] }] },
  },
  roles: {
    name: 'اختيار الرتب',
    doc: { mode: 'v2', content: '', embeds: [], components: [{ id: newId(), type: 'container', color: '#4fc08d', spoiler: false, children: [
      { id: newId(), type: 'text', content: '# 🎭 اختر رتبك\nاختر الرتب اللي تبيها من القائمة تحت. اخترها مرة ثانية عشان تشيلها.' },
      { id: newId(), type: 'select', select: { id: newId(), placeholder: 'اختر الرتب...', min: 1, max: 1, disabled: false, options: [
        { id: newId(), label: 'الإعلانات', description: 'منشن لما تنزل أخبار', emoji: '📢', actions: [{ type: 'toggleRoles', roleIds: [] }] },
        { id: newId(), label: 'الفعاليات', description: 'منشن لما تبدأ فعالية', emoji: '🎉', actions: [{ type: 'toggleRoles', roleIds: [] }] },
      ] } },
    ] }] },
  },
  form: {
    name: 'نموذج تواصل',
    doc: { mode: 'v2', content: '', embeds: [], components: [{ id: newId(), type: 'container', color: '#e0b04f', spoiler: false, children: [
      { id: newId(), type: 'text', content: '# 📨 تواصل مع الفريق\nاضغط الزر تحت وعبّ النموذج. إجاباتك توصل للفريق على طول.' },
      { id: newId(), type: 'buttons', buttons: [{ id: newId(), label: 'افتح النموذج', emoji: '📝', style: 'primary', url: '', disabled: false, actions: [{ type: 'form', title: 'تواصل مع الفريق', fields: [
        { id: newId(), label: 'الموضوع', description: '', style: 'short', required: true, placeholder: 'عن وش الموضوع؟', min: null, max: 100 },
        { id: newId(), label: 'الرسالة', description: '', style: 'paragraph', required: true, placeholder: '', min: 10, max: 1500 },
      ], submit: [{ type: 'reply', content: '✅ شكرًا {user.name}، وصلت رسالتك للفريق.', ephemeral: true, messageId: '' }, { type: 'channel', channelId: '', content: '📨 رسالة جديدة من {user}', format: 'answers' }] }] }] },
    ] }] },
  },
  embed: {
    name: 'إمبد كلاسيكي',
    doc: { mode: 'embed', content: '', components: [], embeds: [{ title: 'إمبد كلاسيكي', url: '', description: 'إمبد ديسكورد عادي. تقدر تحوّله لـ Components V2 بأي وقت.', color: PURPLE, timestamp: true, author: { name: '', url: '', icon: '' }, footer: { text: '{server}', icon: '' }, thumbnail: '', image: '', fields: [{ name: 'حقل', value: 'قيمة', inline: true }] }] },
  },
};
