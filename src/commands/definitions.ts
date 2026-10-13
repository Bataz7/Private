// قاموس الأسماء العربية لازم ينحمّل قبل تسجيل الأوامر وقبل وصول أي تفاعل.
import '../i18n/commands.js';
import { SlashCommandBuilder } from '../lib/djs/index.js';
import { extensionCommands } from '../extensions/index.js';

// Built-in commands. Feature modules add theirs through src/extensions (a module command replaces a built-in one with the same name).
const builtIn = [
  new SlashCommandBuilder()
    .setName('staff').setDescription('Staff ranking and server setup')
    .addSubcommand(s => s.setName('leaderboard').setDescription('The staff ranking by points'))
    .addSubcommand(s => s.setName('setup').setDescription('Administrators: set the Rift roles and channels for this server')),
  new SlashCommandBuilder()
    .setName('shift').setDescription('Your shift and the team\'s shifts')
    .addSubcommand(s => s.setName('status').setDescription('Your current shift, breaks and time so far'))
    .addSubcommand(s => s.setName('break').setDescription('Start or end a break (an auto-ending 30 minute pause)'))
    .addSubcommand(s => s.setName('history').setDescription('Your last 10 shifts (administrators can look up others)').addUserOption(o => o.setName('user').setDescription('Administrators: whose shifts to show')))
    .addSubcommand(s => s.setName('stats').setDescription('Who is on shift right now'))
    .addSubcommand(s => s.setName('panel').setDescription('Post the shift panel here')),
  new SlashCommandBuilder()
    .setName('rating').setDescription('Rate staff members')
    .addSubcommand(s => s.setName('panel').setDescription('Administrators: post the staff rating panel'))
    .addSubcommand(s => s.setName('submit').setDescription('Rate a staff member from 1 to 5 stars').addUserOption(o => o.setName('staff').setDescription('The staff member').setRequired(true)).addIntegerOption(o => o.setName('score').setDescription('Stars, from 1 to 5').setMinValue(1).setMaxValue(5).setRequired(true)).addStringOption(o => o.setName('comment').setDescription('An optional private comment').setMaxLength(1000)))
    .addSubcommand(s => s.setName('stats').setDescription('A staff member\'s rating summary').addUserOption(o => o.setName('staff').setDescription('The staff member').setRequired(true))),
  new SlashCommandBuilder()
    .setName('complaint').setDescription('Complaints about staff')
    .addSubcommand(s => s.setName('panel').setDescription('Administrators: post the complaint panel'))
    .addSubcommand(s => s.setName('submit').setDescription('File a private complaint about a staff member').addUserOption(o => o.setName('staff').setDescription('The staff member').setRequired(true))),
  new SlashCommandBuilder().setName('points').setDescription('Your points and where they came from'),
  new SlashCommandBuilder()
    .setName('report').setDescription('Staff reports')
    .addSubcommand(s => s.setName('submit').setDescription('Write a shift summary, incident or general report'))
    .addSubcommand(s => s.setName('history').setDescription('Your submitted reports'))
    .addSubcommand(s => s.setName('stats').setDescription('A performance card with hours, voice, messages and rating').addUserOption(o => o.setName('user').setDescription('Administrators: whose card to show').setRequired(false)))
    .addSubcommand(s => s.setName('review').setDescription('Administrators: reports waiting for review'))
    .addSubcommand(s => s.setName('panel').setDescription('Administrators: post the report panel here')),
].map(command => command.toJSON());

/** Every command to register: built-in ones, with module commands replacing same-named built-ins. */
export function allCommands() {
  const modules = extensionCommands().map(command => command.json);
  const names = new Set(modules.map(command => command.name));
  return [...builtIn.filter(command => !names.has(command.name)), ...modules];
}
