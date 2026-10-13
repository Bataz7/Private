// الدرجات: كيف تنحسب درجة الأسبوع، وين أنت هذا الأسبوع، وش تحتاج عشان ترتفع، وترتيب الفريق (للإدارة).
import { mount } from '#jsx/jsx-runtime';
import { api, errorText } from '../lib/api';
import { num } from '../lib/format';
import type { PageCtx } from '../shell/types';
import { Ring } from '../ui/chart';
import { Icon } from '../ui/Icon';
import { Avatar, Badge, Card, Empty, ErrorState, Notice, PageHeader, PageSkeleton, Progress } from '../ui/kit';
import { createList } from '../ui/list';

const PART: Record<string, [string, string, string, string]> = {
  shift: ['وقت الشفت', 'ساعات الشفت (البريك ما ينحسب)', 'ساعة', 'clock'],
  activeDays: ['أيام النشاط', 'أيام فيها شفت أو رسالة أو فويس', 'يوم', 'calendar-tick'],
  voice: ['وقت الفويس', 'ساعات الفويس وأنت في الدوام', 'ساعة', 'activity'],
  messages: ['الرسائل', 'رسائلك في السيرفر', 'رسالة', 'message-text'],
  rating: ['تقييم الأعضاء', 'متوسط تقييمك من الأعضاء', '', 'star'],
  clean: ['سجل نظيف', 'مكافأة لأسبوع بدون شكوى معتمدة', '', 'shield-tick'],
};
const TARGET: Record<string, string> = { shift: 'shiftHours', activeDays: 'activeDays', voice: 'voiceHours', messages: 'messages' };
const MEANING: Record<string, [string, string]> = {
  S: ['استثنائي', 'تخطيت الأهداف في كل شي تقريبًا.'], A: ['ممتاز', 'فوق المتوقع بكثير.'], B: ['جيد', 'أسبوع قوي وأغلب الأهداف تحققت.'], C: ['يحتاج شغل', 'تحت الأهداف. كم شفت ورسائل زيادة تصلحها.'], D: ['منخفض', 'نشاط أقل بكثير من المتوقع هذا الأسبوع.'],
};

export default async function grades(ctx: PageCtx) {
  mount(ctx.root, <PageSkeleton cards={0} />);
  let data: any;
  try { data = await api('/api/grades', { signal: ctx.signal }); } catch (error) { mount(ctx.root, <ErrorState message={errorText(error)} onRetry={ctx.refresh} />); return; }
  const me = data.me;
  const gap = me ? me.parts.filter((part: any) => !['rating', 'clean'].includes(part.key)).map((part: any) => ({ part, left: part.max - part.earned })).sort((a: any, b: any) => b.left - a.left)[0] : null;
  const team = data.team ? createList<any>({
    rows: data.team,
    search: row => row.displayName,
    searchPlaceholder: 'ابحث عن عضو…',
    defaultSort: { key: 'rank', dir: 1 },
    columns: [
      { key: 'rank', label: '#', class: 'num', sort: row => row.rank, render: row => row.rank },
      { key: 'name', label: 'العضو', sort: row => row.displayName, render: row => <a class="who" href={`/p/${encodeURIComponent(row.userId)}`}><Avatar src={row.avatar} name={row.displayName} size={30} /><span class="who-text"><b>{row.displayName}</b></span></a> },
      { key: 'score', label: 'الدرجة', sort: row => row.score, render: row => <span class="lb-score"><span class={`grade-pill g-${row.grade}`}>{row.grade}</span><b class="num">{row.score}</b></span> },
      { key: 'next', label: 'الدرجة التالية', render: row => (row.next ? `باقي ${row.next.need} لـ ${row.next.letter}` : 'أعلى درجة') },
      { key: 'shift', label: 'الشفت', class: 'num', sort: row => row.shiftHours, render: row => `${num(row.shiftHours, 1)}س` },
      { key: 'voice', label: 'الفويس', class: 'num', hideSm: true, sort: row => row.voiceHours, render: row => `${num(row.voiceHours, 1)}س` },
      { key: 'messages', label: 'الرسائل', class: 'num', hideSm: true, sort: row => row.messages, render: row => num(row.messages) },
      { key: 'days', label: 'أيام النشاط', class: 'num', hideSm: true, sort: row => row.activeDays, render: row => row.activeDays },
    ],
    csv: { name: 'grades', header: ['الترتيب', 'الاسم', 'الدرجة', 'النتيجة', 'الشفت', 'الفويس', 'الرسائل', 'أيام النشاط'], row: row => [row.rank, row.displayName, row.grade, row.score, row.shiftHours, row.voiceHours, row.messages, row.activeDays] },
    empty: <Empty icon="people" title="ما فيه ستاف نشطين بعد" />,
  }) : null;

  mount(ctx.root, [
    <PageHeader title="الدرجات" subtitle="كل اثنين ريفت يقيس أسبوعك (الاثنين للأحد، UTC) ويعطيك درجة من 100. كل جزء من شغلك له نصيب، وتاخذه كامل لما توصل هدفه." />,
    me ? (
      <Card title="أسبوعك لين الحين" subtitle="كل أسبوع يبدأ من صفر." icon="award" actions={me.last ? <Badge tone="brand">الأسبوع الماضي: {me.last.grade} · {me.last.score}</Badge> : null}>
        <div class="grade-hero">
          <Ring value={me.score} size={150} stroke={12} tone={`g-${me.grade}`}><b class="ring-big">{me.grade}</b><small>{me.score} من 100</small></Ring>
          <div class="grade-text">
            <b class="grade-line">{me.next ? `تحتاج ${num(me.next.need)} نقطة زيادة عشان توصل ${me.next.letter} (${me.next.min}).` : 'أنت في أعلى درجة، كمّل كذا 👏'}</b>
            {me.next && gap && gap.left >= 1 ? <p>أسرع طريق: <b>{PART[gap.part.key]?.[0]}</b> — يعطيك لين {num(gap.left, 1)} نقطة زيادة.</p> : null}
            {me.ratingIsDefault ? <p>ما عندك تقييمات بعد، فينحسب هذا الجزء كأنه {data.noRatingDefault} نجوم لين يقيّمونك.</p> : null}
            {me.penalty ? <p class="neg">الشكاوى المعتمدة خصمت {me.penalty} نقطة هذا الأسبوع.</p> : null}
            {me.of > 1 ? <p>ترتيبك <b>#{me.rank}</b> من {me.of} هذا الأسبوع.</p> : null}
          </div>
        </div>
        <ul class="grade-parts">{me.parts.map((part: any) => {
          const [title, , , icon] = PART[part.key] ?? [part.key, '', '', 'star'];
          const progress = part.key === 'rating' ? `${num(part.value, 1)} / 5` : part.key === 'clean' ? (part.value ? `${part.value} شكوى` : 'بدون شكاوى') : `${num(part.value, 1)} من ${num(part.target, 1)}`;
          return <li><span class="part-ico"><Icon name={icon} size={16} /></span><span class="gp-name"><b>{title}</b><small>{progress}</small></span><Progress value={(part.earned / part.max) * 100} /><em class="num">{num(part.earned, 1)}/{part.max}</em></li>;
        })}</ul>
      </Card>
    ) : <Notice tone="info" title="أسبوعك">بس الستاف النشطين ياخذون درجة شخصية.</Notice>,
    <div class="grid-2 align-start mt">
      <Card title="الدرجات" subtitle="الحرف يطلع من النتيجة من 100." icon="ranking">
        <ul class="ladder">{data.grades.map((step: any, index: number) => (
          <li class={`g-${step.letter} ${me?.grade === step.letter ? 'is-me' : ''}`}><span class="grade-pill big">{step.letter}</span><span class="row-main"><b>{MEANING[step.letter]?.[0]}</b><small>{MEANING[step.letter]?.[1]}</small></span><span class="muted nowrap">{step.min === 0 ? `أقل من ${data.grades[index - 1]?.min}` : `${step.min} وفوق`}</span>{me?.grade === step.letter ? <Badge tone="brand">أنت</Badge> : null}</li>
        ))}</ul>
      </Card>
      <Card title="كيف تنحسب الـ100" subtitle="كل جزء يكبر كل ما قربت من هدفه، ويوقف لما توصله." icon="chart-2">
        <ul class="build">{['shift', 'activeDays', 'voice', 'messages', 'rating', 'clean'].map(key => {
          const [title, what, unit, icon] = PART[key]!;
          const target = TARGET[key] ? data.targets[TARGET[key]!] : null;
          return <li><span class="part-ico"><Icon name={icon} size={16} /></span><span class="row-main"><b>{title}</b><small>{what}</small><small class="muted">{key === 'rating' ? 'متوسط تقييمك من 5' : key === 'clean' ? 'أسبوع بدون شكوى معتمدة' : `الهدف: ${num(target)} ${unit} في الأسبوع`}</small></span><Badge tone="brand">{data.weights[key]} نقطة</Badge></li>;
        })}</ul>
        <Notice tone="warning">كل شكوى معتمدة تخصم {data.penalty.each} نقاط (لين {data.penalty.max}) وتخسر مكافأة السجل النظيف ({data.weights.clean}) ذاك الأسبوع. الأهداف تحددها الإدارة من صفحة التقارير.</Notice>
      </Card>
    </div>,
    team ? <><h3 class="section-title">الفريق هذا الأسبوع</h3>{team.node}</> : null,
  ]);
}
