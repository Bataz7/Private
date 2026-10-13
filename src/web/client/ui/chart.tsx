// رسوم بيانية خفيفة بـ SVG مباشرة (بدون مكتبات): أعمدة مع تلميح عند المرور، خط صغير، وخريطة نشاط.
import type { Child } from '#jsx/jsx-runtime';
import { cx } from '../lib/dom';
import { num } from '../lib/format';

export type BarDatum = { label: string; value: number; tip?: string };

/** أرقام مقرّبة لخطوط الشبكة (1، 2، 5 × 10ⁿ). */
function niceMax(max: number): number {
  if (max <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].find(item => item * power >= max) ?? 10;
  return step * power;
}

type BarChartProps = { data: BarDatum[]; height?: number; format?: (value: number) => string; label: string; every?: number; highlightLast?: boolean };

export function BarChart({ data, height = 220, format = value => num(value, 1), label, every, highlightLast = true }: BarChartProps) {
  const W = 640;
  const H = height;
  const pad = { top: 14, right: 8, bottom: 26, left: 40 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const max = niceMax(Math.max(0, ...data.map(item => item.value)));
  const band = innerW / Math.max(1, data.length);
  const barW = Math.max(4, Math.min(28, band - 6));
  const step = every ?? Math.max(1, Math.ceil(data.length / 7));
  const y = (value: number) => pad.top + innerH - (value / max) * innerH;
  const grid = [0, 0.5, 1].map(ratio => max * ratio);
  let tip: HTMLElement | null = null;
  const show = (event: Event, item: BarDatum) => {
    if (!tip) return;
    const target = event.currentTarget as SVGGraphicsElement;
    const box = target.getBoundingClientRect();
    const host = tip.parentElement!.getBoundingClientRect();
    tip.textContent = '';
    tip.append(Object.assign(document.createElement('b'), { textContent: format(item.value) }), Object.assign(document.createElement('span'), { textContent: item.tip ?? item.label }));
    tip.style.left = `${box.left - host.left + box.width / 2}px`;
    tip.style.top = `${Math.max(0, box.top - host.top)}px`;
    tip.hidden = false;
  };
  const hide = () => { if (tip) tip.hidden = true; };
  const radius = Math.min(4, barW / 2);
  const bar = (x: number, top: number, bottom: number) => {
    const h = bottom - top;
    if (h <= 0.5) return `M${x} ${bottom}h${barW}`;
    const r = Math.min(radius, h);
    return `M${x} ${bottom}V${top + r}q0 -${r} ${r} -${r}h${barW - 2 * r}q${r} 0 ${r} ${r}V${bottom}Z`;
  };
  return (
    <div class="chart" dir="ltr">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} preserveAspectRatio="xMidYMid meet">
        {grid.map(value => [
          <line class="chart-grid" x1={pad.left} x2={W - pad.right} y1={y(value)} y2={y(value)} />,
          <text class="chart-axis" x={pad.left - 8} y={y(value) + 4} text-anchor="end">{format(value)}</text>,
        ])}
        {data.map((item, index) => {
          const x = pad.left + index * band + (band - barW) / 2;
          const last = highlightLast && index === data.length - 1;
          return (
            <g class={cx('chart-col', last && 'is-last')} tabindex="0" aria-label={`${item.tip ?? item.label}: ${format(item.value)}`}
              onPointerEnter={(event: Event) => show(event, item)} onPointerLeave={hide} onFocus={(event: Event) => show(event, item)} onBlur={hide}>
              <rect class="chart-hit" x={pad.left + index * band} y={pad.top} width={band} height={innerH} />
              <path class="chart-bar" d={bar(x, y(item.value), y(0))} />
              {index % step === 0 || index === data.length - 1 ? <text class="chart-axis" x={x + barW / 2} y={H - 8} text-anchor="middle">{item.label}</text> : null}
            </g>
          );
        })}
      </svg>
      <div class="chart-tip" hidden ref={(el: HTMLElement) => { tip = el; }} />
    </div>
  );
}

/** خط صغير مع تعبئة خفيفة. */
export function Sparkline({ values, height = 64, class: cls }: { values: number[]; height?: number; class?: string }) {
  const clean = values.filter(Number.isFinite);
  if (clean.length < 2) return null;
  const W = 320;
  const H = height;
  const pad = 4;
  const lo = Math.min(...clean);
  const hi = Math.max(...clean);
  const range = hi - lo || 1;
  const x = (index: number) => pad + (index / (clean.length - 1)) * (W - pad * 2);
  const y = (value: number) => H - pad - ((value - lo) / range) * (H - pad * 2);
  const line = clean.map((value, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)} ${y(value).toFixed(1)}`).join(' ');
  return (
    <svg class={cx('spark', cls)} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <path class="spark-area" d={`${line} L${x(clean.length - 1).toFixed(1)} ${H} L${x(0).toFixed(1)} ${H} Z`} />
      <path class="spark-line" d={line} />
    </svg>
  );
}

/** أعمدة صغيرة جدًا (بدون محاور). */
export const MiniBars = ({ values, label }: { values: number[]; label?: string }) => {
  const max = Math.max(1, ...values);
  return <div class="mini-bars" dir="ltr" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : 'true'}>{values.map(value => <i class={value ? '' : 'zero'} style={{ height: `${Math.max(6, Math.round((value / max) * 100))}%` }} />)}</div>;
};

/** خريطة نشاط (أسابيع × أيام). */
export function Heatmap({ days, value, tip }: { days: Array<{ date: string }>; value: (day: any) => number; tip: (day: any) => string }) {
  if (!days.length) return null;
  const max = Math.max(0, ...days.map(value));
  const level = (amount: number) => (!amount || !max ? 0 : Math.min(4, Math.ceil((amount / max) * 4)));
  const pad = new Date(`${days[0]!.date}T00:00:00Z`).getUTCDay();
  const cells: Array<Child> = [...Array.from({ length: pad }, () => <i class="pad" />), ...days.map(day => <i class={`l${level(value(day))}`} title={tip(day)} />)];
  return (
    <div class="heat-wrap" dir="ltr">
      <div class="heat" role="img" aria-label="خريطة النشاط">{cells}</div>
      <div class="heat-legend"><span>أقل</span>{[0, 1, 2, 3, 4].map(n => <i class={`l${n}`} />)}<span>أكثر</span></div>
    </div>
  );
}

/** حلقة نسبة (للدرجة من 100). */
export function Ring({ value, size = 96, stroke = 9, children, tone }: { value: number; size?: number; stroke?: number; children?: Child; tone?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  return (
    <div class={cx('ring', tone)} style={{ width: `${size}px`, height: `${size}px` }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
        <circle class="ring-track" cx={size / 2} cy={size / 2} r={r} stroke-width={stroke} fill="none" />
        <circle class="ring-value" cx={size / 2} cy={size / 2} r={r} stroke-width={stroke} fill="none" stroke-dasharray={`${(v / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} stroke-linecap="round" />
      </svg>
      <div class="ring-label">{children}</div>
    </div>
  );
}
