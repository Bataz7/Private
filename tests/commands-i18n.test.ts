import { expect, test } from 'bun:test';

// definitions.ts يقرأ الإعدادات وقت الاستيراد، فنحط قيم وهمية قبل الاستيراد.
for (const [key, value] of Object.entries({ DISCORD_TOKEN: 'test.token', CLIENT_ID: '1', SUPABASE_URL: 'http://127.0.0.1:1', SUPABASE_SECRET_KEY: 'k' })) process.env[key] ||= value;

const { allCommands } = await import('../src/commands/definitions.ts');
const { localizeCommands, delocalizeInteractionData, commandLocalization } = await import('../src/lib/djs/localization.ts');
const { ApplicationCommandOptionType: T, InteractionType } = await import('../src/lib/djs/enums.ts');
const { slashName } = await import('../src/i18n/commands.ts');

const NAME_RX = /^[-_\p{L}\p{N}]{1,32}$/u;
const ARABIC = /[؀-ۿ]/;

type Node = { name: string; description?: string; type?: number; options?: Node[]; choices?: Array<{ name: string; value: unknown }> };

function checkLevel(nodes: Node[], path: string, problems: string[]) {
  const seen = new Set<string>();
  for (const node of nodes) {
    const at = `${path}/${node.name}`;
    if (!NAME_RX.test(node.name) || node.name !== node.name.toLowerCase()) problems.push(`invalid name ${at}`);
    if (!ARABIC.test(node.name)) problems.push(`not Arabic: ${at}`);
    if (seen.has(node.name)) problems.push(`duplicate name ${at}`);
    seen.add(node.name);
    const description = node.description ?? '';
    if (!description || description.length > 100) problems.push(`bad description length ${at} (${description.length})`);
    if (!ARABIC.test(description)) problems.push(`description not Arabic: ${at}`);
    for (const choice of node.choices ?? []) {
      if (!choice.name || choice.name.length > 100 || !ARABIC.test(choice.name)) problems.push(`bad choice ${at}=${String(choice.value)}`);
    }
    if (node.options?.length) checkLevel(node.options, at, problems);
  }
}

test('every command, subcommand, option and choice has a valid unique Arabic name', () => {
  const localized = localizeCommands(allCommands() as Node[]) as Node[];
  expect(localized.length).toBeGreaterThan(10);
  const problems: string[] = [];
  checkLevel(localized, '', problems);
  expect(problems).toEqual([]);
});

test('Arabic names map back to the internal names on incoming interactions', () => {
  const dict = commandLocalization();
  const shift = dict.shift!;
  const history = shift.options!.history!;
  const incoming = { name: shift.name, type: 1, options: [{ name: history.name, type: T.Subcommand, options: [{ name: history.options!.user!.name, type: T.User, value: '123456789012345678' }] }] };
  const data = delocalizeInteractionData(InteractionType.ApplicationCommand, incoming);
  expect(data.name).toBe('shift');
  expect(data.options[0].name).toBe('history');
  expect(data.options[0].options[0].name).toBe('user');
  expect(data.options[0].options[0].value).toBe('123456789012345678');

  const rate = dict.rate!;
  const stars = rate.options!.stars!;
  const rated = delocalizeInteractionData(InteractionType.ApplicationCommand, { name: rate.name, type: 1, options: [{ name: stars.name, type: T.Integer, value: 5 }] });
  expect(rated).toEqual({ name: 'rate', type: 1, options: [{ name: 'stars', type: T.Integer, value: 5 }] });

  // Internal names (older registrations, the mock) pass through untouched.
  const plain = { name: 'shift', type: 1, options: [{ name: 'status', type: T.Subcommand }] };
  expect(delocalizeInteractionData(InteractionType.ApplicationCommand, plain)).toEqual(plain);
  // Components are never touched.
  expect(delocalizeInteractionData(InteractionType.MessageComponent, { custom_id: 'x' })).toEqual({ custom_id: 'x' });
});

test('every localized command round-trips back to its internal tree', () => {
  const internal = allCommands() as Node[];
  const localized = localizeCommands(internal) as Node[];
  const strip = (nodes: Node[] | undefined): any[] | undefined => nodes?.map(node => ({ name: node.name, type: node.type, ...(node.options ? { options: strip(node.options) } : {}) }));
  for (let index = 0; index < internal.length; index++) {
    const back = delocalizeInteractionData(InteractionType.ApplicationCommand, { name: localized[index]!.name, options: strip(localized[index]!.options) });
    expect({ name: back.name, options: back.options }).toEqual({ name: internal[index]!.name, options: strip(internal[index]!.options) });
  }
});

test('slashName shows the Arabic path', () => {
  expect(slashName('shift status')).toBe(`/${commandLocalization().shift!.name} ${commandLocalization().shift!.options!.status!.name}`);
});
