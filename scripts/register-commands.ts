import { REST, Routes } from '../src/lib/djs/index.js';
import { env } from '../src/config/env.js';
import { allCommands } from '../src/commands/definitions.js';

const commands = allCommands();
const rest = new REST({ version: '10' }).setToken(env.token);
if (env.guildId) {
  await rest.put(Routes.applicationGuildCommands(env.clientId, env.guildId), { body: commands });
  console.log(`Registered ${commands.length} guild commands.`);
} else {
  await rest.put(Routes.applicationCommands(env.clientId), { body: commands });
  console.log(`Registered ${commands.length} global commands.`);
}
