# Staff Management Bot

Independent Discord Staff Management Bot.

## Current scope

- Staff shifts
- Start / end shift
- Break / resume
- On Shift role
- Shift history and statistics
- Leave requests
- Leave approval / rejection
- Leave role + restoration of previous staff roles
- Came Back button
- Resignation requests
- Resignation approval / rejection
- Staff role removal
- Staff logs
- Report submission (DM + announcement channel)
- Report review by management
- Discord-only configuration
- Supabase persistence
- No dashboard
- No ticket system
- No connection to another bot

## Requirements

- Node.js 20+ (Node 24 recommended)
- Supabase project with the migration in `supabase/migrations/001_initial.sql` applied
- A Discord application/bot
- Bot invited with the required permissions

## Setup

1. Copy `.env.example` to `.env`.
2. Fill in `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`, `SUPABASE_URL`, and `SUPABASE_KEY`.
3. Install dependencies:

```bash
npm install
```

4. Register slash commands:

```bash
npm run register
```

5. Start:

```bash
npm run start
```

For development:

```bash
npm run dev
```

## Required Discord permissions

The bot needs enough permissions to:
- Manage Roles
- Send Messages
- Embed Links
- Read Message History
- Use Application Commands

The bot's highest role must be above:
- Staff role(s) managed by the bot
- On Shift role
- Leave role

## Initial configuration

Run `/staff setup` in the server. The command opens a Discord-only setup flow.

Configure:
- Staff role
- On Shift role
- Leave role
- Management role
- Shift channel
- Leave request channel
- Resignation channel
- Logs channel
- Report channel (optional)

Then use:
- `/shift panel`
- `/leave panel`
- `/resignation panel`
- `/report panel`

## Important behavior

### Leave role restoration
When leave is approved, the bot records the managed staff roles it removes. When the employee presses `Came Back`, those roles are restored.

### Resignation
When a resignation is accepted, the bot removes only the configured staff role, not every role the user owns.

### Restart recovery
Active shifts remain in Supabase. On startup, the bot attempts to restore the On Shift role for users whose shift is still active.

### Reports
Staff can submit reports (shift summaries, incidents, or general). Each report is:
- Saved in Supabase
- Sent to the submitter in DMs
- Sent to the configured report channel (announcement channel)
- Auditable in logs

Management can review pending reports via `/report review`.

## Notes for future AIs

The project is intentionally modular. Before changing architecture, read:
- `PROJECT.md`
- `ARCHITECTURE.md`
- `TODO.md`

Do not add a dashboard, ticket system, or external bot integration unless the project requirements are explicitly changed.
