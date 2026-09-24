import { App, applyDocumentTheme, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";
import { cardModel, errorModel, LEVEL_LABEL, type CardModel, type Row } from "./model.ts";

const root = document.querySelector<HTMLElement>("#card")!;
const app = new App({ name: "Q-SYS Reflect status card", version: "0.1.0" }, {}, { autoResize: true });

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

const applyHost = (context: ReturnType<App["getHostContext"]>) => {
  if (!context) return;
  if (context.theme) applyDocumentTheme(context.theme);
  if (context.styles?.variables) applyHostStyleVariables(context.styles.variables);
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

const levelTag = (level: Row["level"]) => el("span", `tag tag-${level}`, LEVEL_LABEL[level]);

const paint = (model: CardModel) => {
  root.replaceChildren();
  root.dataset.level = model.level;
  root.dataset.kind = model.kind;

  const header = el("header", "head");
  const top = el("div", "eyebrow-row");
  top.append(el("p", "eyebrow", model.eyebrow));
  if (model.source) top.append(el("span", `source source-${model.source === "Demo data" ? "demo" : "live"}`, model.source));
  const title = el("h1", "headline");
  title.append(el("span", `dot dot-${model.level}`), document.createTextNode(model.headline));
  header.append(top, title);
  if (model.subhead) header.append(el("p", "subhead", model.subhead));
  root.append(header);

  if (model.tiles.length) {
    const tiles = el("div", "tiles");
    for (const tile of model.tiles) {
      const box = el("div", "tile");
      box.append(el("p", "tile-label", tile.label), el("p", "tile-value", tile.value));
      if (tile.segments.length) {
        const bar = el("div", "bar");
        bar.setAttribute("role", "img");
        bar.setAttribute("aria-label", tile.segments.map((segment) => `${segment.count} ${LEVEL_LABEL[segment.level]}`).join(", "));
        for (const segment of tile.segments) {
          const part = el("span", `seg seg-${segment.level}`);
          part.style.flexGrow = String(segment.count);
          bar.append(part);
        }
        box.append(bar);
      }
      if (tile.note) box.append(el("p", "tile-note", tile.note));
      tiles.append(box);
    }
    root.append(tiles);
  }

  if (model.sectionTitle) {
    const section = el("section", "section");
    section.append(el("h2", "section-title", model.sectionTitle));
    if (model.rows.length) {
      const list = el("ul", "rows");
      for (const row of model.rows) {
        const item = el("li", `row row-${row.level}`);
        const body = el("div", "row-body");
        const line = el("p", "row-title");
        line.append(levelTag(row.level), document.createTextNode(row.title));
        body.append(line, el("p", "row-detail", row.detail));
        if (row.meta) body.append(el("p", "row-meta", row.meta));
        item.append(body);
        if (row.action) {
          const action = row.action;
          const button = el("button", "row-action", "Open");
          button.type = "button";
          button.setAttribute("aria-label", action.label);
          button.addEventListener("click", () => run(action.name, action.arguments, button));
          item.append(button);
        }
        list.append(item);
      }
      section.append(list);
    }
    if (model.more) section.append(el("p", "more", model.more));
    root.append(section);
  }

  const footer = el("footer", "foot");
  footer.append(el("p", "foot-note", "Read-only. Nothing on the Core changes from this card."));
  if (model.back) {
    const back = model.back;
    const button = el("button", "back", back.label);
    button.type = "button";
    button.addEventListener("click", () => run(back.name, back.arguments, button));
    footer.append(button);
  }
  root.append(footer);
};

app.ontoolresult = (result) => {
  paint(result.structuredContent ? cardModel(result.structuredContent) : errorModel(result.isError ? "The tool reported an error." : "No status to show."));
};
app.onhostcontextchanged = applyHost;
app
  .connect()
  .then(() => applyHost(app.getHostContext()))
  .catch((error: unknown) => paint(errorModel(error instanceof Error ? error.message : "The card could not connect to the host.")));
