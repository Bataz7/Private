import { mount } from '#jsx/jsx-runtime';
import type { PageCtx } from '../shell/types';
import { Empty } from '../ui/kit';

export default function page(ctx: PageCtx) {
  mount(ctx.root, <Empty title="قيد الإنشاء" />);
}
