# PROJECT — Staff Management Bot

## Goal

Build a small, polished, independent Discord bot for staff operations.

The bot is NOT a companion/integration bot for another Discord bot.

## Product principles

1. Discord-only. No dashboard.
2. Supabase is the persistent source of truth.
3. Staff-facing actions should be simple buttons/modals.
4. Management actions must be permission-protected.
5. Role changes must be narrow and reversible where appropriate.
6. Every important action should be auditable.
7. Keep the scope small and polished.

## Features

### Shifts
- Start Shift
- End Shift
- Start Break
- Resume Shift
- On Shift role
- Active duration
- Break duration
- Own history
- Management history
- Statistics
- Active-shift protection
- Restart recovery

### Leave
- Request Leave
- Management approval/rejection
- Leave role
- Save managed roles before removal
- DM with Came Back button
- Restore saved managed roles
- Expiry reminder
- Logs

### Resignation
- Submit resignation
- Management approval/rejection
- Remove configured staff role
- DM farewell
- Logs

### Reports
- Submit report (shift summary, incident, general)
- Report type selection
- DM copy sent to submitter
- Report sent to announcement channel
- Management review
- Review confirmation DM
- Report persistence
- Audit logs

### Logs
- Shift started/ended
- Break started/resumed
- Leave submitted/approved/rejected/returned
- Resignation submitted/accepted/rejected

## Explicitly out of scope

- Tickets
- Moderation
- AutoMod
- Security
- Dashboard
- Website
- Points
- Achievements
- Tasks
- Integration with another bot

## Quality expectations

- TypeScript strict mode
- No secrets committed
- Graceful errors
- Supabase persistence
- Discord API permission checks
- No destructive role operations outside configured roles
- Duplicate interaction protection
- Good embed/button UX
