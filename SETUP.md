# Quick Setup

## 1. Create the bot
Create a Discord application and bot, then copy the token.

## 2. Create roles
Recommended:
- Staff
- Staff On Shift
- On Leave
- Staff Management

Make sure the bot's highest role is above the roles it must add/remove.

## 3. Create channels
Recommended:
- `staff-shifts`
- `request-leave`
- `request-resignation`
- `staff-logs`
- `staff-reports`

Make sure the bot has permission to read/send messages in all of these channels.

## 4. Environment
Copy `.env.example` to `.env`.

Set:
- DISCORD_TOKEN
- CLIENT_ID
- GUILD_ID (optional; recommended during development)
- SUPABASE_URL
- SUPABASE_KEY (server-side key)

## 5. Apply the database migration

Run `supabase/migrations/001_initial.sql`, `002_staff_ratings.sql`, `003_complaints.sql`, `004_staff_points.sql`, and `005_bot_status.sql` in the Supabase SQL Editor before starting the bot. Use the same Supabase project URL and server-side key configured in `.env`.

## 6. Install and register

npm install
npm run register
npm run start

## 7. Configure
Run:

/staff setup

Enter role IDs and channel IDs in this order:

shift,leave,resignation,logs,reports

Then publish panels:

/shift panel
/leave panel
/resignation panel

## Troubleshooting

### Role does not change
Check:
1. Bot has Manage Roles.
2. Bot role is higher than the target role.
3. Target role is not managed/integration-owned.

### DMs fail
Discord users can disable server DMs. The request is still stored; the bot logs the action.

### Supabase connection fails
Check SUPABASE_URL, SUPABASE_KEY, and that the initial SQL migration has been applied.

## For future development
Read PROJECT.md, ARCHITECTURE.md and TODO.md before making changes.
