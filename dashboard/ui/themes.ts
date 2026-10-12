/** الثيمات — كل ثيم = قيم متغيّرات CSS، و /assets/css/themes.css يتولّد منها. royal هو الأساس. */
export const ORDER = ["royal", "midnight", "aurora", "emerald", "violet", "crimson", "sunset"];

export const SWATCH: Record<string, string[]> = {
 "royal": [
  "#0b1d3f",
  "#21478a",
  "#4f7fe0"
 ],
 "midnight": [
  "#070d1f",
  "#1d3a8a",
  "#6ea2ff"
 ],
 "aurora": [
  "#04121a",
  "#0f766e",
  "#2dd4bf"
 ],
 "emerald": [
  "#052e26",
  "#14805f",
  "#2fd0a0"
 ],
 "violet": [
  "#1e0b45",
  "#6d3fd1",
  "#a78bfa"
 ],
 "crimson": [
  "#3b0a1c",
  "#b3254f",
  "#ff5c8a"
 ],
 "sunset": [
  "#3b1a05",
  "#d9731a",
  "#ffa94d"
 ]
};

export const TOKENS: Record<string, Record<string, string>> = {
 "royal": {
  "g0": "#050f26",
  "g1": "#0b1d3f",
  "g2": "#16305f",
  "g3": "#21478a",
  "n": "#0b1d3f",
  "n2": "#16305f",
  "n3": "#1a428f",
  "accent": "#4f7fe0",
  "card": "#fff",
  "soft": "#f4f7fc",
  "soft2": "#eaf0fb",
  "bd": "#dde4f0",
  "bd2": "#d3dbea",
  "tx": "#0b1d3f",
  "tx2": "#33415f",
  "muted": "#5b6b88",
  "muted0": "#4b5f88",
  "bg-a": "#fff",
  "bg-b": "#e3e8f1",
  "sky0": "#dbe5f7",
  "blob": "rgba(112,128,160,.26)",
  "wave": "rgba(11,29,63,.07)",
  "glass": "rgba(255,255,255,.76)",
  "glassb": "rgba(255,255,255,.92)",
  "lineA": "rgba(10,31,77,.10)",
  "ringc": "rgba(10,31,77,.22)",
  "ringc2": "rgba(10,31,77,.12)",
  "danger-bg": "#f3dde1",
  "ok": "#1f9d55",
  "er": "#a12b3a",
  "sl": "#7f8ca8",
  "line": "#d3dbea",
  "fxrgb": "79,127,224"
 },
 "emerald": {
  "g0": "#021a14",
  "g1": "#052e26",
  "g2": "#0b4a3c",
  "g3": "#14805f",
  "n": "#064e3b",
  "n2": "#0b6b52",
  "n3": "#0f9b72",
  "accent": "#2fd0a0",
  "soft": "#f0faf6",
  "soft2": "#e1f5ed",
  "bd": "#d3ece3",
  "bd2": "#c3e3d7",
  "tx": "#052e26",
  "tx2": "#25463d",
  "muted": "#4f7165",
  "muted0": "#4a6b60",
  "bg-b": "#dcf0e8",
  "sky0": "#d3efe4",
  "blob": "rgba(47,160,120,.22)",
  "wave": "rgba(5,60,45,.08)",
  "lineA": "rgba(5,60,45,.12)",
  "ringc": "rgba(5,60,45,.24)",
  "ringc2": "rgba(5,60,45,.12)",
  "line": "#c3e3d7",
  "fxrgb": "47,208,160"
 },
 "crimson": {
  "g0": "#240510",
  "g1": "#3b0a1c",
  "g2": "#6b1530",
  "g3": "#b3254f",
  "n": "#5c1230",
  "n2": "#8a1c43",
  "n3": "#c92a5e",
  "accent": "#ff5c8a",
  "soft": "#fdf2f5",
  "soft2": "#fbe4eb",
  "bd": "#f0d6de",
  "bd2": "#e8c6d1",
  "tx": "#3b0a1c",
  "tx2": "#5e2a3a",
  "muted": "#8a5566",
  "muted0": "#80505f",
  "bg-b": "#f6dfe5",
  "sky0": "#f8d9e2",
  "blob": "rgba(200,60,100,.2)",
  "wave": "rgba(92,18,48,.07)",
  "lineA": "rgba(92,18,48,.12)",
  "ringc": "rgba(92,18,48,.24)",
  "ringc2": "rgba(92,18,48,.12)",
  "line": "#e8c6d1",
  "fxrgb": "255,92,138"
 },
 "violet": {
  "g0": "#120528",
  "g1": "#1e0b45",
  "g2": "#3b1a85",
  "g3": "#6d3fd1",
  "n": "#2d1166",
  "n2": "#4a23a8",
  "n3": "#7c4dff",
  "accent": "#a78bfa",
  "soft": "#f6f2ff",
  "soft2": "#ece4ff",
  "bd": "#e2d9f7",
  "bd2": "#d6caf2",
  "tx": "#1e0b45",
  "tx2": "#44306f",
  "muted": "#6e5d99",
  "muted0": "#65558f",
  "bg-b": "#e8e0f8",
  "sky0": "#e4daf9",
  "blob": "rgba(124,77,255,.2)",
  "wave": "rgba(45,17,102,.07)",
  "lineA": "rgba(45,17,102,.12)",
  "ringc": "rgba(45,17,102,.24)",
  "ringc2": "rgba(45,17,102,.12)",
  "line": "#d6caf2",
  "fxrgb": "167,139,250"
 },
 "sunset": {
  "g0": "#240e02",
  "g1": "#3b1a05",
  "g2": "#7a3a0a",
  "g3": "#d9731a",
  "n": "#5c2a07",
  "n2": "#9a4a0e",
  "n3": "#e0791a",
  "accent": "#ffa94d",
  "soft": "#fff7ee",
  "soft2": "#ffedd9",
  "bd": "#f3dfc6",
  "bd2": "#ead0b0",
  "tx": "#3b1a05",
  "tx2": "#6a3f1c",
  "muted": "#94693f",
  "muted0": "#8a6038",
  "bg-b": "#f8e6d0",
  "sky0": "#fbe3c8",
  "blob": "rgba(224,121,26,.2)",
  "wave": "rgba(92,42,7,.07)",
  "lineA": "rgba(92,42,7,.12)",
  "ringc": "rgba(92,42,7,.24)",
  "ringc2": "rgba(92,42,7,.12)",
  "line": "#ead0b0",
  "fxrgb": "255,169,77"
 },
 "midnight": {
  "g0": "#02060f",
  "g1": "#070d1f",
  "g2": "#0f1b3d",
  "g3": "#1d3a8a",
  "n": "#16264f",
  "n2": "#1e3a8a",
  "n3": "#4f8cff",
  "accent": "#6ea2ff",
  "card": "#0f1830",
  "soft": "#162244",
  "soft2": "#1b2b55",
  "bd": "#24345f",
  "bd2": "#2c3f70",
  "tx": "#e8eefc",
  "tx2": "#b4c2e4",
  "muted": "#8ea0c8",
  "muted0": "#9fb1d8",
  "bg-a": "#0d1730",
  "bg-b": "#050a18",
  "sky0": "#1b2b55",
  "blob": "rgba(79,140,255,.16)",
  "wave": "rgba(79,140,255,.08)",
  "glass": "rgba(15,24,48,.72)",
  "glassb": "rgba(70,100,170,.35)",
  "lineA": "rgba(255,255,255,.1)",
  "ringc": "rgba(150,180,255,.3)",
  "ringc2": "rgba(150,180,255,.15)",
  "danger-bg": "#3a1822",
  "line": "#2c3f70",
  "fxrgb": "110,162,255",
  "color-scheme": "dark"
 },
 "aurora": {
  "g0": "#020c10",
  "g1": "#04121a",
  "g2": "#0a2a36",
  "g3": "#0f766e",
  "n": "#0b3a44",
  "n2": "#0f766e",
  "n3": "#14b8a6",
  "accent": "#2dd4bf",
  "card": "#0b1c24",
  "soft": "#10262f",
  "soft2": "#14313c",
  "bd": "#1b3a46",
  "bd2": "#24505e",
  "tx": "#e0fbf6",
  "tx2": "#a9d8d0",
  "muted": "#7fb0a8",
  "muted0": "#8fc0b8",
  "bg-a": "#0a1b22",
  "bg-b": "#03090d",
  "sky0": "#14313c",
  "blob": "rgba(45,212,191,.15)",
  "wave": "rgba(45,212,191,.07)",
  "glass": "rgba(11,28,36,.72)",
  "glassb": "rgba(45,212,191,.22)",
  "lineA": "rgba(255,255,255,.1)",
  "ringc": "rgba(94,234,212,.3)",
  "ringc2": "rgba(94,234,212,.15)",
  "danger-bg": "#3a1822",
  "line": "#24505e",
  "fxrgb": "45,212,191",
  "color-scheme": "dark"
 }
};

let cssCache = "";
export function css(): string {
  if (cssCache) return cssCache;
  const base = TOKENS.royal!;
  const out = [":root,[data-theme]{" + Object.entries(base).map(([k, v]) => `--${k}:${v}`).join(";") + ";color-scheme:light}"];
  for (const name of ORDER) {
    if (name === "royal") continue;
    const d = TOKENS[name]!;
    out.push(`[data-theme=${name}]{` + Object.entries(d).map(([k, v]) => (k !== "color-scheme" ? `--${k}:${v}` : `${k}:${v}`)).join(";") + "}");
  }
  out.push("::view-transition-old(root),::view-transition-new(root){animation:none;mix-blend-mode:normal}");
  out.push("::view-transition-new(root){z-index:9999}");
  return (cssCache = out.join("\n"));
}
