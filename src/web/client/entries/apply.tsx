import { initTheme } from '../lib/theme';
import { startApplyPage } from '../public/apply-page';

initTheme();
void startApplyPage(document.getElementById('root') ?? document.body);
