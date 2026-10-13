import { studioDashboard } from './studio.js';
import { modReportsDashboard } from './modreports.js';
import { applicationsDashboard } from '../applications/dashboard.js';
import { coreDashboard } from '../core/dashboard.js';
import { leaveDashboard } from '../leave/dashboard.js';
import { reportsDashboard } from '../reports/dashboard.js';
import { statusDashboard } from '../status/dashboard.js';

export type { DashboardContext, DashboardExtension } from './context.js';

// وحدات اللوحة: كل وحدة تسجّل مساراتها العامة (mountPublic) ومسارات /api للستاف (mountApi).
// الترتيب مهم: أول مسار يطابق هو اللي يرد، ووحدات الميزات تسبق المسارات الأساسية في staff-routes.ts.
export const dashboard = [studioDashboard, modReportsDashboard, applicationsDashboard, coreDashboard, leaveDashboard, reportsDashboard, statusDashboard];
