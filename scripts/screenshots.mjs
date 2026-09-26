// Captures README screenshots of the card from `npm run preview` using headless Chrome over CDP.
// Usage: node preview/serve.mjs & node scripts/screenshots.mjs
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.PREVIEW_URL ?? "http://127.0.0.1:4747/";
const OUT = join(import.meta.dirname, "..", "docs");
const SHOTS = [
  ["card-fleet.png", "?bare&width=552&tool=get_fleet_health"],
  ["card-system.png", "?bare&width=552&tool=get_system&system=202"],
  ["card-fleet-dark.png", "?bare&width=552&theme=dark&tool=get_fleet_health"],
];

const profile = await mkdtemp(join(tmpdir(), "qsys-shots-"));
const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=9333", `--user-data-dir=${profile}`, "--no-first-run", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  let target;
  for (let i = 0; i < 50 && !target; i += 1) {
    await sleep(200);
    target = await fetch("http://127.0.0.1:9333/json/list").then((r) => r.json()).then((list) => list.find((t) => t.type === "page")).catch(() => undefined);
  }
  if (!target) throw new Error("Chrome did not start.");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, (message) => (message.error ? reject(new Error(message.error.message)) : resolve(message.result)));
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true })).result.value;

  await send("Emulation.setDeviceMetricsOverride", { width: 600, height: 1400, deviceScaleFactor: 2, mobile: false });
  for (const [file, query] of SHOTS) {
    await send("Page.navigate", { url: BASE + query });
    // The host sets data-ready when the tool result is sent; the card resizes a frame or two later.
    for (let i = 0; i < 40 && !(await evaluate("document.body.dataset.ready === 'true'")); i += 1) await sleep(150);
    await sleep(900);
    let last = -1;
    let stable = 0;
    for (let i = 0; i < 60 && stable < 3; i += 1) {
      await sleep(150);
      const height = await evaluate(`document.body.dataset.ready ? document.querySelector("#card").getBoundingClientRect().height : -1`);
      stable = height > 0 && height === last ? stable + 1 : 0;
      last = height;
    }
    const box = await evaluate(`(() => { const r = document.querySelector("#column").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
    const pad = 24;
    const { data } = await send("Page.captureScreenshot", {
      format: "png",
      clip: { x: box.x - pad, y: box.y - pad, width: box.w + pad * 2, height: box.h + pad * 2, scale: 1 },
    });
    await writeFile(join(OUT, file), Buffer.from(data, "base64"));
    console.log(`${file}: card ${Math.round(box.w)}x${Math.round(box.h)}`);
  }
  ws.close();
} finally {
  chrome.kill();
  await sleep(300);
  await rm(profile, { recursive: true, force: true });
}
