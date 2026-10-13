import { initTheme } from '../lib/theme';
import { startStatusPage } from '../public/status-page';

initTheme();
startStatusPage(document.getElementById('root') ?? document.body);
