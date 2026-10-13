import type { Express, Request, Response } from 'express';
import type { Client } from 'discord.js';
import type { supabase as SupabaseClient } from '../supabase/client.js';
import { studioDashboard } from './studio.js';
import { modReportsDashboard } from './modreports.js';
import { applicationsDashboard } from '../applications/dashboard.js';
import { coreDashboard } from '../core/dashboard.js';
import { reportsDashboard } from '../reports/dashboard.js';
import { statusDashboard } from '../status/dashboard.js';

/** What the dashboard core hands to feature modules. */
export interface DashboardContext {
  app: Express;
  discord: Client;
  supabase: typeof SupabaseClient;
  /** The server the signed-in user selected. Throws when none is selected. */
  selectedGuildId: (req: Request) => string;
  /** Staff-level check is already applied to every /api route. These send the 403 themselves and return false when refused. */
  requireManagement: (req: Request, res: Response) => Promise<boolean>;
  requireAdministrator: (req: Request, res: Response) => Promise<boolean>;
  sessionUser: (req: Request) => { id: string; username: string; avatar: string | null; isOwner: boolean; isAdministrator: boolean; isManagement: boolean; isStaff: boolean } | null;
  getGuild: (guildId: string) => Promise<import('discord.js').Guild>;
  publicDir: string;
}

export interface DashboardExtension {
  name: string;
  /** Public routes (no login): mounted before authentication, for example a public web form. */
  mountPublic?: (context: DashboardContext) => void;
  /** Routes under /api: the signed-in staff check has already run. */
  mountApi?: (context: DashboardContext) => void;
  /** Extra stylesheet names (files in public/, without .css) appended to /app.css. */
  styles?: string[];
}

import { leaveDashboard } from '../leave/dashboard.js';
// Register feature modules here, one import and one array entry each.
export const dashboard: DashboardExtension[] = [studioDashboard, modReportsDashboard, applicationsDashboard, coreDashboard, leaveDashboard, reportsDashboard, statusDashboard];
