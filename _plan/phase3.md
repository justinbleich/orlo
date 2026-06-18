# phase3.md — Behavior, Data & Device Layer

> The authoring tools beyond a static tree: interaction & navigation, data binding & lists,
> device/responsive realities, theming/modes, and icons. Pair with `BUILD.md` (foundation),
> `phase2.md` (static authoring tools), and `PRD.md` (rationale).

**Relationship & prerequisites:** this track depends on `BUILD.md` Phases 1–3 **and** `phase2.md`.
Specifically it needs `phase2.md` 2C (components/instances) for state-as-variant authoring and 2D
(tokens) for theming. Do not start a sub-phase until its prerequisites pass.

## Core principle

Everything in this layer exports as **real React Native code**, never as design-only fiction.
Figma prototypes die at handoff; here an interaction is an `onPress` handler, a flow is a
React Navigation graph, a list is a `FlatList`, a theme is `useColorScheme`. If a tool can only
produce a mockup of behavior rather than the behavior itself, it does not belong in this layer.

## Invariants (in addition to BUILD.md + phase2.md)

1. **Interactions and navigation export as runtime code** — `onPress`, `navigation.navigate`,
   `Modal`, real component states. No throwaway prototype links.
2. **The flow graph is the single source of truth for navigation.** It generates the navigator;
   navigation structure is never maintained in two places.
3. **Component states are real RN states** — `Pressable` `pressed`, `disabled`, `TextInput` focus
   — or variant props, mapped to actual runtime behavior, not just alternate visuals.
4. **Sample data is authoring scaffolding only.** A bound template must export to a real
   `FlatList`/`renderItem` with a typed data shape. Live external data is deferred and, when
   added, must route through a defined data-source abstraction (not ad-hoc fetches in components).
5. **Device previews run per-device and respect safe areas.** Codegen wires
   `react-native-safe-area-context`; canvas shows a safe-area overlay, simulator shows real insets.
6. **Deferred (not this layer):** animations/transitions (later Reanimated pass), gestures beyond
   press (swipe/drag), and live external data sources (Paper-style API/Notion/DB binding). Sample
   data now; the data-source layer later.

## New dependencies introduced here
`@react-navigation/*`, `react-native-safe-area-context`, an icon set
(`@expo/vector-icons` or equivalent). Reserved for later: `react-native-reanimated` (animations),
a data-source layer (live data).

---

## Capability inventory

### Interaction & navigation
| Tool | Authors | RN mapping |
|---|---|---|
| Component states | default / pressed / disabled / focused looks | `Pressable` render-prop `{pressed}`, `disabled`, `TextInput` focus, or variant props |
| Tap actions | what a press does | `onPress` handler |
| Navigate action | tap → go to screen | `navigation.navigate('Screen', params?)` |
| Overlay / modal | sheet, dialog, menu | `Modal` or a navigation modal screen |
| Flow connections | screen → screen arrows | React Navigation graph |

### Screens & navigation structure
| Tool | Authors | RN mapping |
|---|---|---|
| Screen management | name/organize many screens | navigator screens |
| Navigator type | stack / tab / drawer | `createNativeStackNavigator` / tab / drawer |
| Route params | data passed on navigate | typed route params |
| Flow graph view | the app's navigation map | navigator config (source of truth, invariant 2) |

### Data & lists
| Tool | Authors | RN mapping |
|---|---|---|
| Sample data sets | realistic content for authoring | local fixtures |
| List binding | repeated item from data | `FlatList` `data` + `renderItem` + `keyExtractor` |
| Item template | the cell design | component used as `renderItem` |
| Prop/data binding | bind a node value to a field | prop expression in JSX |
| (later) Live source | API/DB/Notion | data-source abstraction |

### Device, safe areas & responsive
| Tool | Authors | RN mapping |
|---|---|---|
| Device presets | iPhone / Pixel / tablet sizes | canvas frame size + matching simulator |
| Safe-area insets | notch / home-indicator aware layout | `SafeAreaProvider` / `useSafeAreaInsets` / `SafeAreaView` |
| Orientation | portrait / landscape | dimension-aware layout |
| Responsive sizing | adapt across sizes | `flex`, `%`, `useWindowDimensions` |

### Theming & icons
| Tool | Authors | RN mapping |
|---|---|---|
| Mode axis on tokens | light / dark token values | theme context + `useColorScheme` |
| Themed styles | style bound to a token that resolves per mode | runtime theme lookup |
| Icon insertion | place an icon from a set | icon-set component (font or SVG), props for size/color |

---

## Sub-phases

### Phase 3A — Screens & navigation graph
**Goal:** a navigable multi-screen structure that is the navigator.
- [ ] Screen management: create/name/organize multiple screens (frames) on the canvas.
- [ ] Flow graph view: draw connections between screens; pick navigator type (stack/tab/drawer).
- [ ] Route params: declare typed params passed on navigate.
- [ ] Codegen: graph → React Navigation navigator(s) + screen registration + typed params.

**Done when:** a 3-screen flow authored on the canvas exports to a working navigator that runs on
the simulator, and the graph is the only place navigation is defined.

### Phase 3B — Interaction & component states
**Goal:** real behavior on a screen.
- [ ] State authoring: define default / pressed / disabled / focused appearance per interactive node.
- [ ] Tap actions: assign `onPress` behavior, including a Navigate action (uses 3A graph).
- [ ] Overlays/modals: author sheets/dialogs/menus.
- [ ] Canvas previews a chosen state; simulator shows live interaction via Fast Refresh.
- [ ] Codegen: states → `Pressable`/`disabled`/focus logic or variant props; actions → handlers;
      overlays → `Modal` or modal screens.

**Done when:** a button with pressed + disabled states that navigates on tap exports to RN that
behaves correctly on device with no manual wiring.

### Phase 3C — Data binding & lists
**Goal:** data-driven content, authored with realistic data.
- [ ] Sample data sets usable while authoring (no lorem).
- [ ] List binding: turn a container + item template into a `FlatList` bound to sample data.
- [ ] Prop/data binding: bind node values (text, image source, visibility) to data fields.
- [ ] Canvas renders with sample data; harness/simulator confirms.
- [ ] Codegen: `FlatList` with `data`/`renderItem`/`keyExtractor`; item template → component;
      a typed data shape for the list.

**Done when:** a list authored from one item template + sample data exports to a real `FlatList`
that renders the dataset on device.

### Phase 3D — Device presets, safe areas & responsive
**Goal:** RN device realities are first-class.
- [ ] Device-size presets for frames (iPhone / Pixel / tablet), matched to simulator targets.
- [ ] Safe-area overlay on canvas; `SafeAreaProvider`/insets wired in codegen.
- [ ] Orientation toggle (portrait/landscape).
- [ ] Responsive sizing via `flex`/`%`/`useWindowDimensions`.

**Done when:** a screen authored against a device preset shows correct safe areas on canvas and
on the matching simulator, and exports with safe-area handling wired.

### Phase 3E — Theming & modes
**Goal:** light/dark as a real, exported theme.
- [ ] Add a mode axis (light/dark) to tokens from `phase2.md` 2D.
- [ ] Bind styles to tokens that resolve per mode.
- [ ] Canvas mode toggle; codegen emits a theme context + `useColorScheme` wiring.

**Done when:** toggling light/dark on the canvas re-themes every bound node, and exported code
switches with the OS appearance.

### Phase 3F — Icons
**Goal:** icon insertion without a vector pen tool.
- [ ] Integrate an icon set (font or SVG); searchable insertion.
- [ ] Icon node with size/color props (color theme-bindable via 3E).
- [ ] Codegen: icon-set component usage with the chosen dependency.

**Done when:** an icon placed and recolored on the canvas exports to the icon component and
renders on device.

> 3D, 3E, and 3F are largely independent of each other and of 3A–3C; they can be parallelized.
> 3A → 3B is a hard order (interactions navigate using the graph). 3C is independent of 3A/3B.

---

## Codegen & render summary
- **Navigation:** flow graph → React Navigation (stack/tab/drawer), screens, typed params.
- **Behavior:** states → `Pressable`/`disabled`/focus or variants; actions → handlers; overlays
  → `Modal`/modal screens.
- **Data:** `FlatList` (`data`/`renderItem`/`keyExtractor`); typed data shapes; sample fixtures.
- **Device:** `react-native-safe-area-context`; per-device simulator targets.
- **Theme:** theme context + `useColorScheme`; tokens resolve per mode.
- **Icons:** icon-set component via the chosen dep.
- **Render split:** canvas previews states/modes/sample-data and a safe-area overlay; the
  simulator is truth for live interaction, real navigation transitions, and real insets.

## Definition of done (this layer)
An author (or agent) can build a multi-screen, navigable app — with real component states,
data-driven lists, correct per-device safe areas, light/dark theming, and icons — and export RN
(including React Navigation) that runs on device with those behaviors working, and no manual
wiring. Animations, gestures beyond press, and live external data remain deliberately deferred.
