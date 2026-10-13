// صفحة التقديم العامة (/apply/:formId): تسجيل دخول بديسكورد، صفحات النموذج، حفظ مسودة تلقائي، وإرسال.
import type { Child } from '#jsx/jsx-runtime';
import { mount } from '#jsx/jsx-runtime';
import { api, ApiError } from '../lib/api';
import { safeColor, safeUrl } from '../lib/dom';
import { num } from '../lib/format';
import { DiscordLogo, Icon } from '../ui/Icon';
import { Button, Skeleton } from '../ui/kit';
import { toast } from '../ui/overlay';
import { FormPage, isVisible, pageErrors, pagesOf, syncVisibility, tr, type Answers, type FormDef } from './apply-form';

const UI = {
  ar: { login: 'سجّل دخولك بديسكورد عشان تقدّم', loginHint: 'نستخدم حسابك في ديسكورد بس عشان نتأكد منك ومن عضويتك في السيرفر.', switch: 'مو أنت؟ بدّل الحساب', signedIn: 'داخل باسم', closed: 'التقديم مقفل', notEligible: 'ما تقدر تقدّم حاليًا', pending: 'تقديمك تحت المراجعة', pendingHint: 'استلمنا تقديمك والإدارة بتراجعه. النتيجة توصلك في خاص ديسكورد.', accepted: 'انقبلت 🎉', acceptedHint: 'مبروك! انقبل تقديمك.', reason: 'السبب', done: 'انرسل تقديمك', doneHint: 'الإدارة بتراجع تقديمك والنتيجة توصلك في خاص ديسكورد. تأكد إن الخاص مفتوح.', reference: 'رقم التقديم', notFound: 'النموذج مو موجود', notFoundHint: 'يمكن الرابط غلط أو النموذج انحذف.', error: 'صار خطأ', retry: 'حاول مرة ثانية', sending: 'جار الإرسال…', draft: 'انحفظت مسودتك تلقائيًا', oauth: 'ما قدرنا ندخلك بديسكورد. جرّب مرة ثانية.', members: 'عضو', closes: 'يقفل التقديم', powered: 'مدعوم من Rift', questions: 'سؤال', noLogin: 'الدخول بديسكورد مو مفعّل في اللوحة.' },
  en: { login: 'Sign in with Discord to apply', loginHint: 'Your Discord account is only used to confirm who you are and that you are in the server.', switch: 'Not you? Switch account', signedIn: 'Signed in as', closed: 'Applications are closed', notEligible: 'You cannot apply right now', pending: 'Your application is under review', pendingHint: 'We received your application. You will get the result in your Discord DMs.', accepted: 'You were accepted 🎉', acceptedHint: 'Congratulations! Your application was accepted.', reason: 'Reason', done: 'Application submitted', doneHint: 'The team will review it and send you the result in Discord DMs. Make sure your DMs are open.', reference: 'Reference', notFound: 'Form not found', notFoundHint: 'The link may be wrong or the form was deleted.', error: 'Something went wrong', retry: 'Try again', sending: 'Sending…', draft: 'Draft saved automatically', oauth: 'Discord sign-in failed. Please try again.', members: 'members', closes: 'Closes', powered: 'Powered by Rift', questions: 'questions', noLogin: 'Discord login is not configured on this dashboard.' },
};

export async function startApplyPage(host: HTMLElement) {
  const formId = location.pathname.split('/')[2] ?? '';
  let data: any = null;
  let lang: 'ar' | 'en' = 'ar';
  let page = 0;
  let answers: Answers = {};
  let draftTimer: ReturnType<typeof setTimeout> | undefined;
  const u = (key: keyof typeof UI.ar) => UI[lang][key];
  const draftKey = () => `rift-apply:${formId}:${data?.viewer?.id || 'anon'}`;
  const saveDraft = () => { try { localStorage.setItem(draftKey(), JSON.stringify(answers)); } catch { /* ignore */ } };
  const loadDraft = (): Answers => { try { return JSON.parse(localStorage.getItem(draftKey()) || '{}') || {}; } catch { return {}; } };
  const clearDraft = () => { try { localStorage.removeItem(draftKey()); } catch { /* ignore */ } };
  const form = (): FormDef => ({ ...data.form, language: lang });

  const header = (): Child => {
    const f = data.form;
    const guild = data.guild;
    const banner = safeUrl(f.bannerUrl);
    const questions = f.questions.filter((q: any) => q.type !== 'section').length;
    return (
      <header class="af-card af-head">
        {banner ? <div class="af-banner"><img src={banner} alt="" onError={(event: Event) => (event.currentTarget as HTMLElement).parentElement?.remove()} /></div> : <div class="af-stripe" />}
        <div class="af-head-body">
          {guild ? <div class="af-guild">{guild.icon ? <img src={guild.icon} alt="" /> : <span>{String(guild.name || 'R')[0]}</span>}<div><b>{guild.name}</b><small>{num(guild.members)} {u('members')} · {num(questions)} {u('questions')}</small></div></div> : null}
          <h1 dir="auto">{f.title}</h1>
          {f.description ? <p class="af-lead" dir="auto">{f.description}</p> : null}
          {f.closesAt && f.open ? <p class="af-meta"><Icon name="calendar" size={16} /> {u('closes')} {new Date(f.closesAt).toLocaleString(lang === 'ar' ? 'ar-SA-u-nu-latn-ca-gregory' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' })}</p> : null}
        </div>
      </header>
    );
  };
  const account = (): Child => data.viewer ? (
    <div class="af-card af-account"><img src={safeUrl(data.viewer.avatar) || '/a/s/logo-mark.svg'} alt="" /><div><small>{u('signedIn')}</small><b>{data.viewer.username}</b></div><button type="button" class="af-link" onClick={switchAccount}>{u('switch')}</button></div>
  ) : null;
  const notice = (kind: 'good' | 'bad' | 'warn' | 'wait', title: string, text?: string, extra?: Child): Child => (
    <section class={`af-card af-notice af-${kind}`}><span class="af-notice-icon"><Icon name={{ good: 'tick-circle', bad: 'close-circle', warn: 'info-circle', wait: 'clock' }[kind]} size={30} /></span><h2>{title}</h2>{text ? <p>{text}</p> : null}{extra}</section>
  );
  const footer = (): Child => <footer class="af-foot"><img src="/a/s/logo-mark.svg" width="18" height="18" alt="" /> {u('powered')}</footer>;
  const show = (...parts: Child[]) => mount(host, <main class="af-shell" dir={lang === 'ar' ? 'rtl' : 'ltr'}>{parts}</main>);

  async function switchAccount() {
    await api('/apply-api/logout', { method: 'POST', noRedirect: true }).catch(() => undefined);
    location.href = `/apply/${encodeURIComponent(formId)}/login`;
  }

  function renderForm(errors: Record<string, string> = {}) {
    const pages = pagesOf(data.form.questions);
    const total = pages.length;
    const last = page >= total - 1;
    let pageEl: HTMLElement | null = null;
    let draftEl: HTMLElement | null = null;
    const onChange = () => {
      if (pageEl) syncVisibility(pageEl, form(), answers);
      clearTimeout(draftTimer);
      draftTimer = setTimeout(() => { saveDraft(); if (draftEl) draftEl.hidden = false; }, 400);
    };
    const move = (step: number) => {
      if (step > 0) {
        const found = pageErrors(form(), page, answers);
        if (Object.keys(found).length) return showErrors(found);
      }
      let next = page + step;
      while (next > 0 && next < total - 1 && pages[next]!.items.length && !pages[next]!.items.some(question => isVisible(question, answers))) next += step;
      page = Math.max(0, Math.min(total - 1, next));
      saveDraft();
      renderForm();
      host.querySelector('.af-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    show(
      header(),
      account(),
      <form class="af-card af-form" novalidate onSubmit={(event: Event) => { event.preventDefault(); void submit(); }}
        onKeyDown={(event: KeyboardEvent) => { const target = event.target as HTMLElement; if (event.key === 'Enter' && target.tagName === 'INPUT' && !['radio', 'checkbox'].includes((target as HTMLInputElement).type)) { event.preventDefault(); if (last) void submit(); else move(1); } }}>
        {total > 1 ? <div class="af-progress"><div class="progress"><i style={{ width: `${Math.round(((page + 1) / total) * 100)}%` }} /></div><span>{tr(lang, 'page', { n: page + 1, total })}</span></div> : null}
        {page === 0 ? <p class="af-note">{tr(lang, 'requiredNote')}</p> : null}
        <div class="af-page" ref={(el: HTMLElement) => { pageEl = el; }}><FormPage form={form()} page={page} answers={answers} errors={errors} onChange={onChange} /></div>
        <div class="af-actions">
          {page > 0 ? <Button variant="secondary" icon="arrow-right-01" onClick={() => move(-1)}>{tr(lang, 'back')}</Button> : <span />}
          {last ? <Button type="submit" variant="primary" icon="send-2" data-submit>{tr(lang, 'submit')}</Button> : <Button variant="primary" iconEnd="arrow-right-01" flipIcon={lang === 'ar'} onClick={() => move(1)}>{tr(lang, 'next')}</Button>}
        </div>
        <p class="af-draft" hidden ref={(el: HTMLElement) => { draftEl = el; }}><Icon name="save-2" size={14} /> {u('draft')}</p>
      </form>,
      footer(),
    );
  }

  function showErrors(errors: Record<string, string>) {
    renderForm(errors);
    const first = host.querySelector<HTMLElement>('.af-q.has-error');
    first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    first?.querySelector<HTMLElement>('input, textarea, select')?.focus({ preventScroll: true });
  }

  async function submit() {
    const pages = pagesOf(data.form.questions);
    for (let index = 0; index < pages.length; index += 1) {
      const found = pageErrors(form(), index, answers);
      if (Object.keys(found).length) { page = index; return showErrors(found); }
    }
    const button = host.querySelector<HTMLButtonElement>('[data-submit]');
    if (button) { button.disabled = true; button.classList.add('is-busy'); }
    const payload: Answers = {};
    for (const question of data.form.questions) if (question.type !== 'section' && isVisible(question, answers) && answers[question.id] !== undefined) payload[question.id] = answers[question.id]!;
    try {
      const result = await api<{ reference: string }>(`/apply-api/forms/${encodeURIComponent(formId)}/submit`, { method: 'POST', body: { answers: payload }, noRedirect: true });
      clearTimeout(draftTimer);
      clearDraft();
      show(header(), notice('good', u('done'), u('doneHint'), <div class="af-ref"><small>{u('reference')}</small><b class="ltr">#{result.reference}</b></div>), footer());
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      const fieldErrors = error instanceof ApiError ? error.body?.fieldErrors : null;
      if (fieldErrors && Object.keys(fieldErrors).length) {
        page = Math.max(0, pages.findIndex(item => item.items.some(question => fieldErrors[question.id])));
        return showErrors(fieldErrors);
      }
      if (error instanceof ApiError && (error.status === 403 || error.status === 409)) return void load();
      if (button) { button.disabled = false; button.classList.remove('is-busy'); }
      toast(error instanceof Error ? error.message : u('error'), 'error');
    }
  }

  function renderState() {
    const { form: f, viewer, eligibility, latest } = data;
    if (!f.open) return show(header(), notice('bad', u('closed'), f.closedReason), footer());
    if (!viewer) {
      return show(header(), (
        <section class="af-card af-login">
          <span class="af-discord"><DiscordLogo size={30} /></span>
          <h2>{u('login')}</h2><p>{u('loginHint')}</p>
          {data.loginReady ? <a class="btn btn-primary btn-lg af-login-btn" href={`/apply/${encodeURIComponent(formId)}/login`}><DiscordLogo size={20} /><span>{u('login')}</span></a> : <p class="field-error">{u('noLogin')}</p>}
        </section>
      ), footer());
    }
    if (!eligibility?.ok) {
      if (latest?.status === 'pending') return show(header(), account(), notice('wait', u('pending'), u('pendingHint')), footer());
      if (latest?.status === 'accepted') return show(header(), account(), notice('good', u('accepted'), u('acceptedHint')), footer());
      return show(header(), account(), notice('warn', u('notEligible'), eligibility?.reason, latest?.status === 'rejected' && latest.reason ? <blockquote class="af-reason"><small>{u('reason')}</small><span dir="auto">{latest.reason}</span></blockquote> : null), footer());
    }
    answers = loadDraft();
    page = 0;
    renderForm();
  }

  async function load() {
    mount(host, <main class="af-shell"><div class="af-card af-loading"><Skeleton lines={4} height={18} /></div></main>);
    try {
      data = await api(`/apply-api/forms/${encodeURIComponent(formId)}`, { noRedirect: true });
      lang = data.form.language === 'en' ? 'en' : 'ar';
      document.documentElement.lang = lang;
      document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
      document.title = `${data.form.title} · ${data.guild?.name || 'Rift'}`;
      const color = safeColor(data.form.color);
      if (color) document.documentElement.style.setProperty('--brand', color);
      renderState();
      if (new URLSearchParams(location.search).get('error')) { toast(u('oauth'), 'error'); history.replaceState(null, '', location.pathname); }
    } catch (error) {
      const missing = error instanceof ApiError && error.status === 404;
      show(notice('bad', missing ? u('notFound') : u('error'), missing ? u('notFoundHint') : error instanceof Error ? error.message : '', missing ? null : <Button icon="refresh-arrow-01" onClick={() => void load()}>{u('retry')}</Button>), footer());
    }
  }

  await load();
}
