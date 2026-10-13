/** node:url — fileURLToPath/pathToFileURL فقط. */
export const fileURLToPath = (u: string | URL) => decodeURIComponent(new URL(String(u)).pathname);
export const pathToFileURL = (p: string) => new URL(`file://${encodeURI(p)}`);
export default { fileURLToPath, pathToFileURL };
