# Haiyue Animation Editor

`AnimationEditor` is the browser-first authoring application for producing Haiyue
Animation (`.hya`) assets. The implementation is staged so the editable project,
authoring shell and runtime compiler each keep a clear validation boundary.

## Stage 1 contract

- Project format: `haiyue-animation-editor-project@1`
- Portable project suffix: `.hya-project.json`
- Runtime output: `.hya`
- Runtime target: Haiyue Animation 1.0, 2D, `screen-y-down`

The editor project is the source of truth. A `.hya` file is compiled delivery data,
not an editor project and not a container for editor layout or source asset bytes.

## Stage 2 workspace

The independent `@haiyue/animation-editor` workspace now provides:

- a browser shell with project/assets, hierarchy, WebGPU preview, inspector,
  Timeline and State Machine regions;
- an immutable project Store and content-aware dirty tracking;
- bounded undo/redo command history;
- stable multi-kind selection state;
- Rollup build, typecheck, Node unit tests and a local watch server.

## Stage 3 project lifecycle

The editor can now own a project from browser startup through a portable save:

- new, open, save, save-as and close actions, plus drag-and-drop project opening;
- strict runtime validation with diagnostic code and JSON path before an imported
  value can replace the active project;
- a detached schema-version migration boundary (v1 is the first published schema,
  so older versions are currently rejected instead of guessed);
- deterministic `.hya-project.json` serialization with stable key order;
- IndexedDB current-session, debounced recovery and eight-entry recent-project
  storage, with explicit restore/discard UI;
- dirty-state protection for destructive project actions and browser unload;
- keyboard shortcuts for save (`⌘/Ctrl+S`) and save-as (`⌘/Ctrl+Shift+S`).

The editor reuses `ge-button`, `ge-dropdown` and `ge-tabs` from `@haiyue/ui`.
Stage 3 also adds the generic accessible `ge-dialog` component to that library;
project validation, recovery and file logic remain editor-owned.

## Stage 4 HYA compiler and exact runtime preview

The project now has one production path from editable JSON to browser runtime:

```text
.hya-project.json -> validated editor project -> AnimationDocument
                  -> HYA binary -> binary parser -> WebGPU runtime
```

- `compileAnimationEditorProject` lowers canvas, resources, node hierarchy,
  static component/effect/composite payloads and the four core transform tracks;
- every successful compilation is encoded and parsed again before it can be
  previewed or downloaded, so export and preview consume the same validated bytes;
- mixed per-keyframe interpolation is deterministically baked at the project frame
  rate because HYA 1.0 stores interpolation per track; step boundaries receive a
  pre-boundary sample so they remain discontinuous after baking;
- named clips and the state-machine definition are emitted through the HYA state
  machine extension when a state machine exists, while editor-only graph positions
  are stripped from runtime output;
- non-deployable `blob:` delivery URIs, unknown extension components, unsupported
  property-target adapters and state-machine side effects fail with code/path
  diagnostics instead of producing incomplete animation data;
- **Export HYA** downloads the exact compiled binary, and the central canvas
  hot-swaps that same parsed animation into `Animation2DComponent` for play, pause
  and seek when WebGPU is available;
- browsers without WebGPU can still compile, validate and export HYA.

The runtime preview is editor-specific orchestration, so stage 4 does not add a
new generic UI component. The editor continues to use `ge-button`, `ge-dropdown`,
`ge-tabs` and `ge-dialog` from `@haiyue/ui`.

## Stage 5 assets and basic scene authoring

The editor can now create and edit the static scene consumed by the stage-4
compiler and preview:

- import image, audio and binary files by picker or drag-and-drop; imports are
  retained in the project and use bounded `data:` delivery URIs so the bare HYA
  remains immediately portable;
- select and inspect assets, preserve image dimensions, and safely reject deletion
  while a component still references the asset;
- create Group, Rectangle, Ellipse, Path, Text and image-backed Sprite nodes;
- use the shared `ge-tree` for multi-selection, keyboard copy/paste/delete and
  drag-and-drop reparenting/reordering;
- edit node name, parent, local time range, position, rotation, scale, anchor,
  opacity and lock state through the inspector;
- edit shape size/fill, path fill, text content/layout/font and sprite resource,
  size and tint; unsupported extension components remain read-only;
- route every scene mutation through the bounded undo/redo history and immediately
  recompile the exact HYA runtime preview.

Stage 5 adds the generic `ge-input` text/number/color Web Component to `@haiyue/ui`.
Hierarchy, menus, selects and checkboxes reuse the existing shared components;
asset decoding and animation property forms remain editor-owned.

## Stage 6 timeline and keyframe authoring

The Timeline is now a production authoring surface for HYA core animation:

- add Position, Rotation, Scale and Opacity tracks to the selected unlocked node;
- add keyframes at the playhead, sample a newly inserted key from the existing
  curve, and snap all authored times to the composition frame rate;
- scrub the ruler, zoom between 40–800 px/s, drag keyframes along their lane and
  reject same-track frame collisions;
- select tracks, keyframes and named clips with shared inspector/history semantics,
  including keyboard deletion and bounded undo/redo;
- edit keyframe time and scalar/vector values, Step/Linear/Cubic Bézier temporal
  interpolation, easing controls and Position spatial in/out handles;
- create, inspect and edit bounded named clip ranges for later state-machine use;
- hot-recompile the same HYA bytes after every timeline content mutation, so
  playback, seek and export immediately consume the authored tracks.

Timeline lanes, keyframe diamonds and range bars are animation-domain controls,
so this stage does not add another generic component to `@haiyue/ui`. The editor
continues to reuse `ge-dropdown`, `ge-input`, `ge-select` and the existing shared
form primitives.

## Stage 7 state-machine graph and runtime preview

Named Timeline clips can now drive an authored HYA state machine:

- create a controller after at least one named clip exists, then add, rename and
  inspect Float, Integer, Boolean and Trigger parameters while atomically updating references;
- add override/additive layers, edit weights, initial states and include/exclude
  node binding masks;
- create, select, delete and drag graph states while retaining editor-only graph
  positions outside the generated HYA payload;
- bind states to clips or configurable 1D/2D Blend Trees, including numeric driver
  parameters, thresholds, Cartesian/directional positions, speed and loop modes;
- connect two selected states, author Any State/source/destination, typed conditions,
  exit time, cross-fade duration, destination offset and interruption behavior;
- protect referenced parameters and clips from deletion and clean dependent
  transitions when a state is removed;
- hot-swap the central preview from the Timeline player to the production
  `Animation2DStateMachineComponent/System`, with live parameter controls, Trigger,
  reset, active-state highlighting and transition highlighting;
- emit clips and the editor-stripped controller through
  `org.haiyue.animation-state-machine@1`, then binary-parse the exact exported HYA.

The graph, transition paths and runtime parameter rows are animation-specific, so
stage 7 continues to compose the existing shared form and dropdown components
instead of moving domain behavior into `@haiyue/ui`.

## Stage 8 advanced content and typed property lowering

The editor now produces the advanced HYA 1.0 content model instead of merely
preserving imported payloads:

- create Vector Shape nodes with solid fill, stroke, dash, Trim Path and Round
  Corners records whose nested parts retain stable authoring ids;
- author Sprite atlas UV animation, vector morph/paint/stroke/modifier tracks and
  text range-selector/character-animator tracks from the same Timeline surface;
- create step-keyed text documents and edit the default selector and character
  position/rotation controls;
- add, order, edit and remove Tint, Fill, Opacity, Color Matrix, Blur and Drop
  Shadow effects, then animate each supported typed property;
- create ordered Mask/Matte layers with source, mode, operation, feather and
  expansion, including an animated expansion binding;
- create static Particle2D and Timeline Audio components with explicit state-machine
  side-effect diagnostics;
- lower every advanced project track into its exact component/effect/composite
  `AnimationVectorValueTrack`, then encode and parse the resulting HYA binary before
  preview or export;
- enforce dynamic vector sizes, fixed effect sizes and Step-only Sprite UV semantics
  in the project/compiler boundary; because the current state-machine mixer exposes
  core Transform pose channels only, projects combining a controller with an
  advanced inline track receive an explicit diagnostic instead of a silently
  static preview.

The advanced inspector remains animation-domain UI and is composed from existing
`ge-input`, `ge-select`, `ge-checkbox` and dropdown primitives. No new generally
reusable Web Component was needed for this step.

## Stage 9 deterministic delivery packaging

The editor now closes the authoring-to-delivery path without changing project
format v1:

- **Export HYA** remains the exact bare binary path and keeps authored delivery
  URIs, including portable `data:` resources;
- **Export Delivery Package** creates a `.hya-package.zip` containing the parsed
  and validated HYA, an `assets/` directory, and `manifest.json`;
- embedded project sources and `data:` delivery URIs are decoded into external
  files, and the packaged HYA is recompiled with matching relative resource URIs;
- every bundled resource and the HYA receive a SHA-256 integrity value; existing
  network or relative delivery URIs remain explicit external dependencies in the
  manifest and are never fetched during a deterministic export;
- ZIP paths are traversal-safe and collision-safe, entry ordering and timestamps
  are fixed, and identical project content produces byte-identical archives;
- package construction uses a detached project, so exporting never rewrites the
  editable source, changes the save baseline, or affects runtime preview;
- bounded resource/archive sizes and ZIP32 limits fail with stable package error
  codes instead of allowing unbounded browser allocations.

The package root is self-contained for bundled resources: host the extracted HYA
and `assets/` directory together. Haiyue's standard `createAnimationAssetLoader`
resolves relative resources against the fetched HYA URL (including redirects), so
the package can be hosted below any deployment base path.

## M01 designer integration and acceptance

G02–G08 are now wired into two explicit product workspaces instead of remaining
isolated fixtures:

- the shared 2D shell offers six new-project choices (four 2D authoring templates
  plus native-3D camera/object and glTF routes), capability/limit help, cancellable
  source import/package tasks, stable-id asset relink, lock/hide, zoom/pan/guides,
  accessible split panels, Timeline double-click insertion and exact state preview;
- opening a native-3D project automatically routes to `native3d.html`, which owns
  Camera/Primitive/glTF hierarchy, TRS Inspector, Undo/Redo, Timeline, exact HYA
  WebGPU play, project save/reopen, bare HYA and deterministic 3D package export;
- Lottie and bare HYA enter through `SourceImportCoordinator`; HYA recovery is
  deliberately limited and diagnostic. glTF remains in the native-3D family;
- close, replacement and preview hot-swap destroy session, task, import, viewport,
  state-machine/action/binding, scene and GPU owners. Delegated G02–G08 browser
  fixtures assert their residual counters at zero;
- `test:browser` now runs the product golden path and all focused Headless
  Chrome/WebGPU fixtures. `test:candidate` checks 10k-key interaction/compile/heap
  and built bundle budgets without updating a formal release baseline.

See [DESIGNER_GUIDE.md](./DESIGNER_GUIDE.md) for the Chinese-first workflow,
shortcuts, diagnostics, current limits and candidate budgets. The current G09
candidate decision and exact gate evidence are recorded in
[acceptance/G09_CANDIDATE_STATUS.md](./acceptance/G09_CANDIDATE_STATUS.md).

```sh
npm run dev -w ./AnimationEditor
# http://127.0.0.1:4175

npm run typecheck -w ./AnimationEditor
npm test -w ./AnimationEditor
npm run build -w ./AnimationEditor
npm run test:browser -w ./AnimationEditor
```

Set `ANIMATION_EDITOR_PORT` to change the development server port. The central
canvas is an exact runtime preview of the current compiled project when the browser
supports WebGPU.

Files in this stage:

- [`PROJECT_FORMAT.md`](./PROJECT_FORMAT.md): normative authoring and compiler contract.
- [`schema/project.schema.json`](./schema/project.schema.json): machine-readable structural schema.
- [`CAPABILITY_MATRIX.md`](./CAPABILITY_MATRIX.md): HYA feature coverage and delivery milestones.
- [`DESIGNER_GUIDE.md`](./DESIGNER_GUIDE.md): 2D/3D designer workflows, shortcuts, delivery, limits and budgets.
- [`samples/README.md`](./samples/README.md): executable template/sample ownership and the real glTF fixture.
- [`examples/state-machine-multitrack.hya-project.json`](./examples/state-machine-multitrack.hya-project.json): complete multi-node, multi-track state-machine project.
- [`scripts/verify-project-contract.mjs`](./scripts/verify-project-contract.mjs): dependency-free structural and semantic contract verification.

Verify the stage-1 artifacts from the repository root:

```sh
node AnimationEditor/scripts/verify-project-contract.mjs
```

The editor, exact runtime preview, bare HYA compiler and delivery packager all
consume this one project contract; all nine implementation stages are complete.
