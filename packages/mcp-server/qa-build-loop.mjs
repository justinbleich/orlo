/**
 * MCP build orchestrator: builds the three-screen "Loop" habit app through the
 * real MCP server, exactly as an external agent would. Temporary QA tooling.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "pnpm",
  args: ["--filter", "@rn-canvas/mcp-server", "exec", "tsx", "src/server.ts"],
  cwd: "/Users/justinbleich/react-canvas",
  env: { ...process.env, RN_CANVAS_STUDIO_URL: "http://127.0.0.1:5180" },
});
const client = new Client({ name: "qa-build", version: "0.0.1" });
await client.connect(transport);

let calls = 0;
async function call(tool, args) {
  calls += 1;
  const res = await client.callTool({ name: tool, arguments: args });
  const text = (res.content ?? []).find((c) => c.type === "text")?.text ?? "";
  if (res.isError) throw new Error(`${tool} failed: ${text.slice(0, 400)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ---- design constants -------------------------------------------------------
const C = {
  canvas: "#FAF7F0",
  surface: "#FFFFFF",
  ink: "#1C1B17",
  sub: "#6E6A5E",
  faint: "#A6A192",
  line: "#E8E3D6",
  track: "#EFEAE0",
  accent: "#2F6B4F",
  accentSoft: "#E3EEE6",
  amber: "#C77B27",
  amberSoft: "#F6EBDC",
  danger: "#B4472E",
  white: "#FFFFFF",
};
const F = "Inter";
const eyebrow = (text) => ({
  type: "Text",
  props: { text },
  design: { name: "Eyebrow" },
  style: { fontFamily: F, fontSize: 12, fontWeight: "700", letterSpacing: 1.2, color: C.sub },
});
const title = (text) => ({
  type: "Text",
  props: { text },
  design: { name: "Title" },
  style: { fontFamily: F, fontSize: 32, fontWeight: "800", color: C.ink },
});

const rootStyle = {
  width: 390,
  height: 844,
  backgroundColor: C.canvas,
  flexDirection: "column",
  padding: 24,
  paddingTop: 64,
  gap: 20,
};

// ---- screens ---------------------------------------------------------------
async function makeScreen(name) {
  const screen = await call("create_screen", {});
  const renamed = await call("rename_screen", { rootId: screen.rootId, name });
  await call("set_style", { rootId: screen.rootId, nodeId: screen.rootId, style: rootStyle });
  console.log(`screen ${name}: root=${screen.rootId} path=${renamed.path ?? screen.path}`);
  return screen.rootId;
}

// ============================== TODAY =========================================
const today = await makeScreen("Today");

await call("insert_node", {
  rootId: today,
  parentId: today,
  node: {
    type: "View",
    design: { name: "Header" },
    style: { gap: 4 },
    children: [eyebrow("TUESDAY · JULY 8"), title("Today")],
  },
});

await call("insert_node", {
  rootId: today,
  parentId: today,
  node: {
    type: "View",
    design: { name: "Progress card" },
    style: {
      backgroundColor: C.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: C.line,
      padding: 20,
      gap: 12,
    },
    children: [
      {
        type: "View",
        design: { name: "Progress header" },
        style: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
        children: [
          { type: "Text", props: { text: "Daily progress" }, design: { name: "Progress label" }, style: { fontFamily: F, fontSize: 13, fontWeight: "600", color: C.sub } },
          { type: "Text", props: { text: "3 of 5" }, design: { name: "Progress count" }, style: { fontFamily: F, fontSize: 13, fontWeight: "700", color: C.accent } },
        ],
      },
      {
        type: "View",
        design: { name: "Progress track" },
        style: { height: 8, backgroundColor: C.track, borderRadius: 4 },
        children: [
          { type: "View", design: { name: "Progress fill" }, style: { width: 181, height: 8, backgroundColor: C.accent, borderRadius: 4 } },
        ],
      },
    ],
  },
});

// The first habit row is authored in full, then promoted to the HabitRow component.
const habitList = await call("insert_node", {
  rootId: today,
  parentId: today,
  node: { type: "View", design: { name: "Habit list" }, style: { gap: 10 } },
});

const row0 = await call("insert_node", {
  rootId: today,
  parentId: habitList.id,
  node: {
    type: "View",
    design: { name: "Habit row" },
    style: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      backgroundColor: C.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: C.line,
      padding: 16,
    },
    children: [
      { type: "View", design: { name: "Check" }, style: { width: 24, height: 24, borderRadius: 12, backgroundColor: C.accent } },
      {
        type: "View",
        design: { name: "Habit copy" },
        style: { flex: 1, gap: 2 },
        children: [
          { type: "Text", props: { text: "Meditate" }, design: { name: "Habit name" }, style: { fontFamily: F, fontSize: 15, fontWeight: "600", color: C.ink } },
          { type: "Text", props: { text: "Morning · 10 min" }, design: { name: "Habit meta" }, style: { fontFamily: F, fontSize: 12, color: C.sub } },
        ],
      },
      {
        type: "View",
        design: { name: "Streak chip" },
        style: { backgroundColor: C.amberSoft, borderRadius: 8, paddingTop: 4, paddingBottom: 4, paddingLeft: 8, paddingRight: 8 },
        children: [
          { type: "Text", props: { text: "12" }, design: { name: "Streak count" }, style: { fontFamily: F, fontSize: 12, fontWeight: "700", color: C.amber } },
        ],
      },
    ],
  },
});

const ids = {};
const walk = (node, out) => {
  out[node.design?.name ?? node.id] = node.id;
  for (const child of node.children ?? []) walk(child, out);
};
walk(row0, ids);

const habitRow = await call("create_component", {
  rootId: today,
  nodeId: row0.id,
  name: "Row/Habit",
  props: [
    { name: "name", kind: "text", nodeId: ids["Habit name"] },
    { name: "meta", kind: "text", nodeId: ids["Habit meta"] },
    { name: "streak", kind: "text", nodeId: ids["Streak count"] },
    { name: "done", kind: "color", nodeId: ids["Check"], styleKey: "backgroundColor" },
  ],
});
console.log("HabitRow component:", habitRow.componentId, JSON.stringify(habitRow.props));

const habits = [
  { name: "Read 20 pages", meta: "Evening · nonfiction", streak: "8", done: C.accent },
  { name: "Morning run", meta: "6:30 AM · 5 km", streak: "21", done: C.accent },
  { name: "Drink water", meta: "8 glasses · 5 left", streak: "3", done: C.track },
  { name: "Journal", meta: "Before bed · 1 page", streak: "5", done: C.track },
];
for (const habit of habits) {
  const placed = await call("place_instance", {
    rootId: today,
    parentId: habitList.id,
    componentId: habitRow.componentId,
  });
  await call("set_instance", { rootId: today, instanceId: placed.instanceId, overrides: habit });
}

// Primary button, promoted for reuse on Settings.
const btn = await call("insert_node", {
  rootId: today,
  parentId: today,
  node: {
    type: "Pressable",
    design: { name: "Primary button" },
    style: { backgroundColor: C.accent, borderRadius: 14, height: 52, alignItems: "center", justifyContent: "center" },
    children: [
      { type: "Text", props: { text: "New habit" }, design: { name: "Label" }, style: { fontFamily: F, fontSize: 15, fontWeight: "700", color: C.white } },
    ],
  },
});
const btnIds = {};
walk(btn, btnIds);
const primaryButton = await call("create_component", {
  rootId: today,
  nodeId: btn.id,
  name: "Button/Primary",
  props: [{ name: "label", kind: "text", nodeId: btnIds["Label"] }],
});
console.log("PrimaryButton component:", primaryButton.componentId);

// ============================== STATS =========================================
const stats = await makeScreen("Stats");

await call("insert_node", {
  rootId: stats,
  parentId: stats,
  node: {
    type: "View",
    design: { name: "Header" },
    style: { gap: 4 },
    children: [eyebrow("THIS WEEK"), title("Progress")],
  },
});

const statValue = (value, label) => ({
  type: "View",
  design: { name: "Stat card" },
  style: {
    flex: 1,
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.line,
    padding: 18,
    gap: 4,
  },
  children: [
    { type: "Text", props: { text: value }, design: { name: "Stat value" }, style: { fontFamily: F, fontSize: 28, fontWeight: "800", color: C.ink } },
    { type: "Text", props: { text: label }, design: { name: "Stat label" }, style: { fontFamily: F, fontSize: 12, fontWeight: "600", color: C.sub } },
  ],
});

const gridTop = await call("insert_node", {
  rootId: stats,
  parentId: stats,
  node: { type: "View", design: { name: "Stat grid top" }, style: { flexDirection: "row", gap: 12 }, children: [statValue("86%", "COMPLETION")] },
});
const card0 = gridTop.children[0];
const cardIds = {};
walk(card0, cardIds);
const statCard = await call("create_component", {
  rootId: stats,
  nodeId: card0.id,
  name: "Card/Stat",
  props: [
    { name: "value", kind: "text", nodeId: cardIds["Stat value"] },
    { name: "label", kind: "text", nodeId: cardIds["Stat label"] },
  ],
});
console.log("StatCard component:", statCard.componentId);

const p1 = await call("place_instance", { rootId: stats, parentId: gridTop.id, componentId: statCard.componentId });
await call("set_instance", { rootId: stats, instanceId: p1.instanceId, overrides: { value: "21", label: "BEST STREAK" } });

const gridBottom = await call("insert_node", {
  rootId: stats,
  parentId: stats,
  node: { type: "View", design: { name: "Stat grid bottom" }, style: { flexDirection: "row", gap: 12 } },
});
const p2 = await call("place_instance", { rootId: stats, parentId: gridBottom.id, componentId: statCard.componentId });
await call("set_instance", { rootId: stats, instanceId: p2.instanceId, overrides: { value: "23", label: "HABITS DONE" } });
const p3 = await call("place_instance", { rootId: stats, parentId: gridBottom.id, componentId: statCard.componentId });
await call("set_instance", { rootId: stats, instanceId: p3.instanceId, overrides: { value: "4", label: "PERFECT DAYS" } });

const bar = (height, color) => ({
  type: "View",
  design: { name: "Bar" },
  style: { width: 30, height, backgroundColor: color, borderRadius: 6 },
});
const dayLabel = (text) => ({
  type: "Text",
  props: { text },
  design: { name: "Day" },
  style: { fontFamily: F, fontSize: 11, fontWeight: "600", color: C.faint, width: 30, textAlign: "center" },
});
await call("insert_node", {
  rootId: stats,
  parentId: stats,
  node: {
    type: "View",
    design: { name: "Chart card" },
    style: {
      backgroundColor: C.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: C.line,
      padding: 20,
      gap: 14,
    },
    children: [
      { type: "Text", props: { text: "Last 7 days" }, design: { name: "Chart title" }, style: { fontFamily: F, fontSize: 13, fontWeight: "600", color: C.sub } },
      {
        type: "View",
        design: { name: "Bars" },
        style: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", height: 120 },
        children: [
          bar(64, C.accentSoft),
          bar(88, C.accentSoft),
          bar(48, C.accentSoft),
          bar(112, C.accentSoft),
          bar(72, C.accentSoft),
          bar(96, C.accentSoft),
          bar(120, C.accent),
        ],
      },
      {
        type: "View",
        design: { name: "Day labels" },
        style: { flexDirection: "row", justifyContent: "space-between" },
        children: ["M", "T", "W", "T", "F", "S", "S"].map(dayLabel),
      },
    ],
  },
});

await call("insert_node", {
  rootId: stats,
  parentId: stats,
  node: {
    type: "Text",
    props: { text: "You're 12% ahead of last week." },
    design: { name: "Footnote" },
    style: { fontFamily: F, fontSize: 13, color: C.sub, textAlign: "center" },
  },
});

// ============================== SETTINGS ======================================
const settings = await makeScreen("Settings");

await call("insert_node", {
  rootId: settings,
  parentId: settings,
  node: {
    type: "View",
    design: { name: "Header" },
    style: { gap: 4 },
    children: [eyebrow("YOUR ACCOUNT"), title("Settings")],
  },
});

await call("insert_node", {
  rootId: settings,
  parentId: settings,
  node: {
    type: "View",
    design: { name: "Profile card" },
    style: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      backgroundColor: C.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: C.line,
      padding: 20,
    },
    children: [
      {
        type: "View",
        design: { name: "Avatar" },
        style: { width: 48, height: 48, borderRadius: 24, backgroundColor: C.accentSoft, alignItems: "center", justifyContent: "center" },
        children: [
          { type: "Text", props: { text: "JB" }, design: { name: "Initials" }, style: { fontFamily: F, fontSize: 16, fontWeight: "700", color: C.accent } },
        ],
      },
      {
        type: "View",
        design: { name: "Profile copy" },
        style: { gap: 2 },
        children: [
          { type: "Text", props: { text: "Justin Bleich" }, design: { name: "Name" }, style: { fontFamily: F, fontSize: 16, fontWeight: "700", color: C.ink } },
          { type: "Text", props: { text: "justin@loop.app" }, design: { name: "Email" }, style: { fontFamily: F, fontSize: 13, color: C.sub } },
        ],
      },
    ],
  },
});

const prefsList = await call("insert_node", {
  rootId: settings,
  parentId: settings,
  node: {
    type: "View",
    design: { name: "Preferences" },
    style: { gap: 10 },
    children: [eyebrow("PREFERENCES")],
  },
});

const settingRow0 = await call("insert_node", {
  rootId: settings,
  parentId: prefsList.id,
  node: {
    type: "View",
    design: { name: "Setting row" },
    style: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: C.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: C.line,
      padding: 16,
    },
    children: [
      { type: "Text", props: { text: "Reminders" }, design: { name: "Setting label" }, style: { fontFamily: F, fontSize: 15, fontWeight: "600", color: C.ink } },
      { type: "Text", props: { text: "8:00 AM" }, design: { name: "Setting value" }, style: { fontFamily: F, fontSize: 14, color: C.sub } },
    ],
  },
});
const rowIds = {};
walk(settingRow0, rowIds);
const settingRow = await call("create_component", {
  rootId: settings,
  nodeId: settingRow0.id,
  name: "Row/Setting",
  props: [
    { name: "label", kind: "text", nodeId: rowIds["Setting label"] },
    { name: "value", kind: "text", nodeId: rowIds["Setting value"] },
  ],
});
console.log("SettingRow component:", settingRow.componentId);

const prefRows = [
  { label: "Week starts on", value: "Monday" },
  { label: "Appearance", value: "System" },
  { label: "iCloud sync", value: "On" },
];
for (const pref of prefRows) {
  const placed = await call("place_instance", { rootId: settings, parentId: prefsList.id, componentId: settingRow.componentId });
  await call("set_instance", { rootId: settings, instanceId: placed.instanceId, overrides: pref });
}

const aboutList = await call("insert_node", {
  rootId: settings,
  parentId: settings,
  node: { type: "View", design: { name: "About" }, style: { gap: 10 }, children: [eyebrow("ABOUT")] },
});
for (const about of [
  { label: "Version", value: "1.4.2" },
  { label: "Privacy policy", value: "View" },
]) {
  const placed = await call("place_instance", { rootId: settings, parentId: aboutList.id, componentId: settingRow.componentId });
  await call("set_instance", { rootId: settings, instanceId: placed.instanceId, overrides: about });
}

// Cross-screen reuse: the Today screen's PrimaryButton, relabeled.
const feedback = await call("place_instance", { rootId: settings, parentId: settings, componentId: primaryButton.componentId });
await call("set_instance", { rootId: settings, instanceId: feedback.instanceId, overrides: { label: "Send feedback" } });

await call("insert_node", {
  rootId: settings,
  parentId: settings,
  node: {
    type: "Text",
    props: { text: "Sign out" },
    design: { name: "Sign out" },
    style: { fontFamily: F, fontSize: 15, fontWeight: "600", color: C.danger, textAlign: "center" },
  },
});

const status = await call("get_status", {});
console.log(`\nDONE in ${calls} MCP calls. Document:`, JSON.stringify(status.document ?? status, null, 2));
await client.close();
