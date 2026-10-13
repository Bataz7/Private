# Architecture

## Flow

Discord Interaction
-> command/button/modal handler
-> service
-> Supabase model adapter
-> Supabase
-> Discord response/log

## Directories

src/
  commands/
  interactions/
  models/
  services/
  config/
  utils/

scripts/
  register-commands.ts

## Models

### GuildSettings
Per-server configuration:
- guildId
- staffRoleId
- onShiftRoleId
- leaveRoleId
- managementRoleId
- shiftChannelId
- leaveChannelId
- resignationChannelId
- logsChannelId
- reportChannelId (optional)

### Staff
Per-server staff membership metadata.

### Shift
One document per shift:
- guildId
- userId
- startedAt
- endedAt
- breaks[]
- status

### LeaveRequest
- guildId
- userId
- startDate
- endDate
- reason
- status
- previousRoleIds[]
- leaveRoleId
- reviewedBy
- reviewedAt
- returnedAt

### ResignationRequest
- guildId
- userId
- lastWorkingDay
- reason
- notes
- status
- reviewedBy
- reviewedAt

### Report
Per-server staff reports:
- guildId
- userId
- title
- content
- type ('shift_summary' | 'incident' | 'general')
- shiftId (optional link to Shift)
- status ('submitted' | 'reviewed')
- reviewedBy
- reviewedAt

### StaffLog
Append-only audit-style events. Actions include:
- SHIFT_STARTED, SHIFT_ENDED
- BREAK_STARTED, BREAK_RESUMED
- LEAVE_REQUESTED, LEAVE_APPROVED, LEAVE_REJECTED, LEAVE_RETURNED
- RESIGNATION_REQUESTED, RESIGNATION_ACCEPTED, RESIGNATION_REJECTED
- REPORT_SUBMITTED, REPORT_REVIEWED

## Role safety

Only configured Staff Role and On Shift/Leave roles are manipulated.

The bot does not remove all roles from a member.

## Time handling

Store timestamps as Date values in Supabase. Display dates/times using Discord timestamps where practical.
