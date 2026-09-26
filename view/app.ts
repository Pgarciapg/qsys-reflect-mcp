import { App, applyDocumentTheme } from "@modelcontextprotocol/ext-apps";
import { cardModel, errorModel, type CardModel, type Level, type Schematic, type SchemNode } from "./model.ts";
import { SERVER_VERSION } from "../src/version.ts";

const root = document.querySelector<HTMLElement>("#card")!;
const app = new App({ name: "Q-SYS Reflect status card", version: SERVER_VERSION }, {}, { autoResize: true });

const SVG = "http://www.w3.org/2000/svg";
const LED: Record<Level, string> = { ok: "var(--ok)", warning: "var(--warn)", fault: "var(--fault)", unknown: "var(--tx3)" };
let gradientSeq = 0;

// Every string from the tool lands in textContent or an attribute, never in markup.
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

const svg = (tag: string, attrs: Record<string, string | number>, text?: string) => {
  const node = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  if (text != null) node.textContent = text;
  return node;
};

// The card keeps its own Q-SYS palette; from the host it takes only light/dark and safe-area insets.
const applyHost = (context: ReturnType<App["getHostContext"]>) => {
  if (!context) return;
  if (context.theme) applyDocumentTheme(context.theme);
  const insets = context.safeAreaInsets;
  if (insets) document.documentElement.style.padding = `${insets.top}px ${insets.right}px ${insets.bottom}px ${insets.left}px`;
};

let busy = false;

const run = async (name: string, args: Record<string, unknown>, button: HTMLButtonElement) => {
  if (busy) return;
  busy = true;
  button.disabled = true;
  root.setAttribute("aria-busy", "true");
  try {
    const result = await app.callServerTool({ name, arguments: args });
    paint(result.structuredContent ? cardModel(result.structuredContent) : errorModel("The tool returned no structured result."));
  } catch (error) {
    paint(errorModel(error instanceof Error ? error.message : "The request failed."));
  } finally {
    busy = false;
    root.removeAttribute("aria-busy");
  }
};

const gauge = (percent: number, label: string) => {
  const circumference = 2 * Math.PI * 46;
  const box = svg("svg", { class: "gauge", viewBox: "0 0 112 112", role: "img", "aria-label": `${label}, ${percent} percent` });
  box.append(
    svg("circle", { cx: 56, cy: 56, r: 46, class: "gauge-track" }),
    svg("circle", {
      cx: 56,
      cy: 56,
      r: 46,
      class: "gauge-arc",
      transform: "rotate(-90 56 56)",
      "stroke-dasharray": circumference.toFixed(1),
      style: `--from:${circumference.toFixed(1)};--to:${(circumference * (1 - percent / 100)).toFixed(1)}`,
    }),
    svg("text", { x: 56, y: 57, class: "gauge-value", "text-anchor": "middle" }, `${percent}%`),
    svg("text", { x: 56, y: 73, class: "gauge-label", "text-anchor": "middle" }, label.toUpperCase()),
  );
  return box;
};

const statusDot = (node: SchemNode, cx: number, cy: number, r: number) => {
  const group = svg("g", {});
  const level = node.level === "source" ? "ok" : node.level;
  if (level === "fault") group.append(svg("circle", { cx, cy, r, class: "ring" }));
  group.append(svg("circle", { cx, cy, r, fill: LED[level] }));
  return group;
};

const drawNode = (node: SchemNode) => {
  const group = svg("g", { class: `node node-${node.kind}` });
  const levelClass = node.level === "source" ? "src" : node.level === "fault" ? "f" : node.level === "warning" ? "w" : "";
  group.append(svg("rect", { x: node.x, y: node.y, width: node.w, height: node.h, rx: node.kind === "source" || node.kind === "hub" ? 8 : 5, class: `n ${levelClass}` }));
  const cy = node.y + node.h / 2;
  const strong = node.level === "fault" || node.level === "warning";

  if (node.kind === "source") {
    group.append(
      svg("text", { x: node.x + node.w / 2, y: cy - 2, class: "tc", "font-size": 9, "font-weight": 600, "text-anchor": "middle" }, node.title),
      svg("text", { x: node.x + node.w / 2, y: cy + 10, class: "t3", "font-size": 7.5, "text-anchor": "middle" }, node.sub ?? ""),
    );
    return group;
  }
  if (node.kind === "hub") {
    group.append(statusDot(node, node.x + 14, node.y + 16, 3.2));
    group.append(svg("text", { x: node.x + 24, y: node.y + 19, class: "t1", "font-size": 9, "font-weight": 600 }, node.title));
    if (node.sub) group.append(svg("text", { x: node.x + 10, y: node.y + 33, class: "t3", "font-size": 7 }, node.sub));
    group.append(svg("text", { x: node.x + 10, y: node.y + 42, class: "t3", "font-size": 7 }, "BY LOCATION →"));
    return group;
  }

  group.append(statusDot(node, node.x + 10, cy, node.kind === "system" ? 3.2 : 3));
  const titleY = node.sub ? cy - 1 : cy + 3;
  group.append(svg("text", { x: node.x + 19, y: titleY, class: "t1", "font-size": 8.5, ...(strong ? { "font-weight": 600 } : {}) }, node.title));
  if (node.sub) group.append(svg("text", { x: node.x + 19, y: cy + 8, class: "t3", "font-size": 6.5 }, node.sub));
  if (node.note) group.append(svg("text", { x: node.x + 88, y: cy + 3, class: node.level === "fault" ? "tf" : "tw", "font-size": 7 }, node.note));
  if (node.leds?.length) {
    const right = node.x + node.w - 10;
    const offset = node.right ? 18 : 0;
    node.leds.forEach((level, index) => {
      const led = svg("circle", { cx: right - offset - index * 9, cy, r: 3, fill: LED[level] });
      if (level === "fault" || level === "warning") led.setAttribute("class", level === "fault" ? "blink-fast" : "blink-slow");
      group.append(led);
    });
    if (node.right) group.append(svg("text", { x: right, y: cy + 3, class: "t3", "font-size": 7, "text-anchor": "end" }, node.right));
  } else if (node.right) {
    const cls = node.kind === "system" && node.level === "fault" ? "tf" : node.kind === "system" && node.level === "warning" ? "tw" : "t3";
    group.append(svg("text", { x: node.x + node.w - 7, y: cy + 3, class: cls, "font-size": node.kind === "core" ? 7 : 7.5, "text-anchor": "end" }, node.right));
  }
  return group;
};

const schematic = (model: Schematic) => {
  const wrap = el("div", "schem");
  const gradient = `sig${(gradientSeq += 1)}`;
  const canvas = svg("svg", { viewBox: `0 0 ${model.width} ${model.height}`, role: "img", "aria-label": model.label });
  const defs = svg("defs", {});
  const linear = svg("linearGradient", { id: gradient, x1: 0, x2: 1 });
  linear.append(svg("stop", { offset: 0, "stop-color": "#0166FF" }), svg("stop", { offset: 1, "stop-color": "#1BD4DB" }));
  defs.append(linear);
  canvas.append(defs);
  for (const wire of model.wires) {
    const stroke = wire.style === "flow" ? `url(#${gradient})` : wire.style === "slow" ? "var(--warn)" : wire.style === "broken" ? "var(--fault)" : "";
    canvas.append(svg("path", { d: wire.d, class: wire.style === "idle" ? "idle" : `wire ${wire.style}`, ...(stroke ? { stroke } : {}) }));
  }
  for (const brace of model.braces) canvas.append(svg("path", { d: `M${brace.x} ${brace.y1} h-4 v${brace.y2 - brace.y1} h4`, class: "brace" }));
  for (const node of model.nodes) canvas.append(drawNode(node));
  wrap.append(canvas);
  if (model.more) wrap.append(el("p", "schem-more", model.more));
  return wrap;
};

const paint = (model: CardModel) => {
  root.replaceChildren();
  root.dataset.level = model.level;
  root.dataset.kind = model.kind;

  const band = el("header", "band");
  const text = el("div", "band-text");
  text.append(el("p", "eyebrow", model.eyebrow));
  const title = el("h1", "headline");
  if (model.headlineStrong) title.append(el("b", "num", model.headlineStrong), document.createTextNode(" "));
  title.append(document.createTextNode(model.headline));
  text.append(title);
  if (model.subhead) text.append(el("p", "subhead", model.subhead));
  if (model.source) text.append(el("span", "pill", model.source));
  band.append(text);
  if (model.gauge) band.append(gauge(model.gauge.percent, model.gauge.label));
  root.append(band);

  const inner = el("div", "inner");
  if (model.schematic) inner.append(schematic(model.schematic));
  if (model.rows.length) {
    const list = el("ul", "rows");
    for (const row of model.rows) {
      const item = el("li", `row lvl-${row.level}`);
      const body = el("div", "row-body");
      const line = el("p", "row-title");
      line.append(el("span", `tag tag-${row.level}`, row.tag), document.createTextNode(row.title));
      body.append(line, el("p", "row-detail", row.detail));
      if (row.meta) body.append(el("p", "row-meta", row.meta));
      item.append(body);
      if (row.action) {
        const action = row.action;
        const button = el("button", "btn", "Open");
        button.type = "button";
        button.setAttribute("aria-label", action.label);
        button.addEventListener("click", () => run(action.name, action.arguments, button));
        item.append(button);
      }
      list.append(item);
    }
    inner.append(list);
  }
  const footer = el("footer", "foot");
  footer.append(el("p", "foot-note", model.footnote));
  if (model.back) {
    const back = model.back;
    const button = el("button", "btn btn-primary", back.label);
    button.type = "button";
    button.addEventListener("click", () => run(back.name, back.arguments, button));
    footer.append(button);
  }
  inner.append(footer);
  root.append(inner);
};

app.ontoolresult = (result) => {
  paint(result.structuredContent ? cardModel(result.structuredContent) : errorModel(result.isError ? "The tool reported an error." : "No status to show."));
};
app.onhostcontextchanged = applyHost;
app
  .connect()
  .then(() => applyHost(app.getHostContext()))
  .catch((error: unknown) => paint(errorModel(error instanceof Error ? error.message : "The card could not connect to the host.")));
