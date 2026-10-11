// مشغّل البوت: يتأكد من نسخة Node قبل التشغيل (البوت يشتغل بـ TypeScript مباشرة بدون بناء).
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  console.error(`❌ Mood Bot يحتاج Node.js 22.18 أو أحدث (عندك ${process.versions.node}).\n   نزّل آخر نسخة LTS من https://nodejs.org`);
  process.exit(1);
}
process.removeAllListeners("warning");
process.on("warning", (w) => { if (w.name !== "ExperimentalWarning") console.warn(w); });
await import("./src/index.ts");
