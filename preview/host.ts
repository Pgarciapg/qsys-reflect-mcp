import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";

// A minimal stand-in for an MCP Apps host (Claude, ChatGPT, VS Code): it frames the card,
// sends it a tool result, and relays the card's own tool calls back to the server.

const params = new URLSearchParams(location.search);
const iframe = document.querySelector<HTMLIFrameElement>("#card")!;
const column = document.querySelector<HTMLElement>("#column")!;
const status = document.querySelector<HTMLElement>("#status")!;

let theme: "light" | "dark" = params.get("theme") === "dark" ? "dark" : "light";
let width = Number(params.get("width") ?? 520);
const tool = params.get("tool") ?? "get_fleet_health";
// ?bare hides the host chrome so screenshots show only the card.
if (params.has("bare")) document.body.dataset.bare = "true";
const toolArgs: Record<string, unknown> = params.get("system") ? { systemId: Number(params.get("system")) } : {};

const palette = (dark: boolean): Record<string, string> => ({
  "--color-background-primary": dark ? "#151719" : "#ffffff",
  "--color-background-secondary": dark ? "#1f2225" : "#f4f4f2",
  "--color-text-primary": dark ? "#eceeef" : "#16181a",
  "--color-text-secondary": dark ? "#a7adb3" : "#555b61",
  "--color-text-tertiary": dark ? "#7b8288" : "#80868c",
  "--color-border-primary": dark ? "#2e3236" : "#e3e3df",
  "--font-sans": "ui-sans-serif, system-ui, -apple-system, sans-serif",
});

const hostContext = () => ({
  theme,
  displayMode: "inline" as const,
  availableDisplayModes: ["inline" as const],
  platform: "web" as const,
  locale: "en-US",
  containerDimensions: { maxWidth: width },
  safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
  styles: { variables: palette(theme === "dark") },
});

const callTool = async (name: string, args: Record<string, unknown>) => {
  const response = await fetch("/call", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, arguments: args }) });
  return response.json();
};

const bridge = new AppBridge(null, { name: "qsys-reflect preview host", version: "0.1.0" }, { serverTools: {} }, { hostContext: hostContext() as any });

bridge.oncalltool = async (request) => callTool(request.name, request.arguments ?? {});

bridge.oninitialized = async () => {
  const result = await callTool(tool, toolArgs);
  await bridge.sendToolInput({ arguments: toolArgs });
  await bridge.sendToolResult(result);
  status.textContent = `${tool} · ${theme} · ${width}px`;
  document.body.dataset.ready = "true";
};

// addEventListener exists at runtime (ProtocolWithEvents) but is missing from the 1.7.5 typings.
(bridge as unknown as { addEventListener(type: "sizechange", handler: (size: { height?: number }) => void): void }).addEventListener("sizechange", (size) => {
  if (size?.height) iframe.style.height = `${Math.ceil(size.height)}px`;
});

const apply = () => {
  column.style.width = `${width}px`;
  document.body.dataset.theme = theme;
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-theme]")) button.setAttribute("aria-pressed", String(button.dataset.theme === theme));
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-width]")) button.setAttribute("aria-pressed", String(Number(button.dataset.width) === width));
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-tool]")) {
    button.setAttribute("aria-pressed", String(button.dataset.tool === tool && (button.dataset.system ?? "") === (params.get("system") ?? "")));
  }
};

const navigate = (changes: Record<string, string | null>) => {
  const next = new URLSearchParams(location.search);
  for (const [key, value] of Object.entries(changes)) value == null ? next.delete(key) : next.set(key, value);
  location.search = next.toString();
};

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-tool]")) {
  button.addEventListener("click", () => navigate({ tool: button.dataset.tool!, system: button.dataset.system ?? null }));
}
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-theme]")) {
  button.addEventListener("click", () => {
    theme = button.dataset.theme as "light" | "dark";
    apply();
    bridge.setHostContext(hostContext() as any);
  });
}
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-width]")) {
  button.addEventListener("click", () => {
    width = Number(button.dataset.width);
    apply();
    bridge.setHostContext(hostContext() as any);
  });
}

apply();
iframe.src = "/card.html";
bridge.connect(new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!)).catch((error: unknown) => {
  status.textContent = error instanceof Error ? error.message : "Could not connect to the card.";
});
