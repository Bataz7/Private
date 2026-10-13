import type { PageCtx } from '../shell/types';
import { requestsPage } from './requests';

export default (ctx: PageCtx) => requestsPage(ctx, 'resignations');
