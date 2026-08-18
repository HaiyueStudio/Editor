# Animation Editor project formats v1

## Designer golden path and product modes

The format boundary is derived from the minimum interview-style workflow a motion
designer must be able to finish without understanding engine internals:

1. **Create or import:** choose a 2D or native 3D project before authoring; import
   Lottie and SpriteSheet sources into 2D, and glTF/Animation3D sources into 3D.
2. **Organize:** keep stable assets, nodes, components, clips and reusable
   compositions while relinking sources without losing identity.
3. **Edit:** change static properties, keyframes, easing, paths, particles and 3D
   typed bindings through one undoable transaction per gesture.
4. **Preview:** compile, encode and parse the same HYA bytes used for delivery;
   scrubbing must not use an editor-only approximation.
5. **Author behavior:** bind named clips to a state machine while keeping transient
   preview parameters outside the saved project.
6. **Validate:** surface unsupported capabilities, broken references and resource
   or allocation failures with a stable code and JSON path before runtime creation.
7. **Deliver:** save the editable `.hya-project.json`, export `.hya`, or build a
   deterministic `.hya-package.zip` with explicit external dependencies.

There are exactly two first-release project families:

| Product mode | Editable format | Delivery contract |
| --- | --- | --- |
| 2D | `haiyue-animation-editor-project@1`, schema 1 | HYA 1.0 core, `screen-y-down` |
| Native 3D | `haiyue-animation-editor-project-3d@1`, schema 1 | required `org.haiyue.animation-3d@1` document extension |

A project chooses one family at creation/import time. A composition containing
both 2D core nodes/tracks and native 3D content is rejected as
`E_PROJECT_MIXED_DIMENSIONS` at `$.mode`; there is no implicit projection, overlay
or pseudo-3D fallback. A product that needs a 2D/3D composite must pre-render one
side to an ordinary asset until a future contract explicitly defines mixed space,
depth, camera and hit-testing semantics.

The product family router recognizes the format before replacing the active
workspace. 2D values stay in the shared shell; native 3D values are transferred
through session-scoped text into `native3d.html`, then parsed again by the 3D
codec. The six template ids (`tween-ui`, `spritesheet`, `path-vector`, `particle`,
`native3d-camera-object`, `gltf-character`) are UI factories, not new serialized
format values. Template output must pass the same codec as imported projects.

## 1. Purpose and boundary

The `haiyue-animation-editor-project@1` document is an editable source format for
the Haiyue Animation Editor. Its portable filename suffix is
`.hya-project.json`. It is deliberately separate from Haiyue Animation 1.0:

- the project stores stable editor ids, individual keyframes, graph layout and
  source-asset information;
- the compiler lowers the project into an `AnimationDocument`;
- `encodeAnimationBinary()` creates the delivery `.hya`;
- `parseAnimation()` is the final untrusted-input validation boundary;
- editor-only fields and authoring-source records never enter the HYA document;
  imported bytes may still be represented by an explicit runtime `data:` URI.

HYA v1 core remains a 2D format. The 2D project family therefore fixes the
coordinate system to `screen-y-down`. Native 3D uses the separate project/schema
and required versioned extension defined below; it never changes the meaning of a
2D core transform.

## 2. Top-level model

Every project contains:

| Field | Meaning |
| --- | --- |
| `format` | Must be `haiyue-animation-editor-project@1`. |
| `schemaVersion` | Must be `1`; used by deterministic migrations within this project major. |
| `id`, `name` | Stable project identity and display name. |
| `composition` | Canvas, duration, frame rate and end behavior. Time is always stored in seconds. |
| `assets` | Authoring sources plus their runtime delivery metadata. |
| `nodes` | Stable node hierarchy and static HYA-compatible component data. |
| `timeline` | The single source of truth for numeric keyframe animation and named clip ranges. |
| `stateMachine` | Optional HYA state-machine authoring graph. |
| `editor` | Optional editor-only viewport and panel state. |

Unknown top-level fields are rejected. Additive editor metadata belongs below
`editor`; runtime extensions belong in explicit component or node extension data.

## 3. Assets and delivery URIs

An asset has one stable id shared by authoring references and the generated HYA
resource table. Its `source` is either:

- `external`: an authoring URI; or
- `embedded`: base64 bytes retained only by the project for portable reopening.

`delivery.uri` is always required because HYA1 has no separate resource-payload
section. Stage 5 imports local files as bounded `data:` delivery URIs, making the
bare HYA immediately portable while retaining the original bytes in the editable
project source. Stage 9 can instead produce a deterministic `.hya-package.zip`:
embedded sources and `data:` delivery values are emitted below `assets/`, their
HYA resource URIs are rewritten to package-relative paths, and SHA-256 integrity
values are generated from the delivered bytes. The package also contains a
timestamp-free `manifest.json` that distinguishes bundled resources from explicit
external dependencies. Creating it operates on a detached project and never
changes authoring source records or dirty state.

Bare HYA export retains the project's delivery URI exactly. Package export retains
non-data external delivery URIs and reports them in its manifest instead of fetching
mutable network content during export. Both paths reject temporary `blob:` URLs;
an external dependency must remain deployable by the host application. Runtime
loaders resolve package-relative resource URIs against the fetched HYA URL, not the
HTML document URL.

## 4. Nodes and static component payloads

Nodes use stable string ids and form a cycle-free tree through `parent`. Node
`start` and `duration`, when present, must fit inside the composition. Components
and effects are wrapped in editor records with stable ids so Timeline targets do
not depend on array positions.

`node.editor.locked` blocks authoring transactions and hierarchy gestures.
`node.editor.hidden` is an authored preview/delivery visibility switch: compilation
forces the lowered node opacity to zero while preserving hierarchy and IDs. Both
flags remain editor metadata and do not add fields to HYA.

`component` and `effect` contain the static, source-neutral HYA property payload.
Keys ending in `Track` are forbidden in those payloads: the normalized editor
project stores animation only in `timeline.tracks`. During compilation, the target
registry lowers tracks into either:

- top-level HYA node tracks (`position`, `rotation`, `scale`, `opacity`); or
- the appropriate component, paint, modifier, selector, effect or composite
  inline `AnimationVectorValueTrack`.

Extension component payloads remain possible, but an editor/compiler plugin must
register their validation and typed track targets. An unknown required extension
cannot be exported.

## 5. Timeline and typed bindings

The Timeline contains property tracks, not video-editor media lanes. Concurrent
tracks animate distinct HYA bindings in the same composition. A project may not
contain two enabled tracks targeting the same binding.

Every track has a discriminated target:

- `node-transform`: core node position, rotation, scale or opacity;
- `component-property`: a registered animatable component property;
- `effect-property`: a registered property on a stable effect id;
- `composite-property`: expansion on a stable composite layer id.

Component properties use a finite vocabulary from the JSON Schema. Nested items
such as vector modifiers and text animators use `partId`; their authoring payload
must expose the same stable part id for compiler lookup. This is a symbolic typed
binding, not a JSON path.

A keyframe owns the interpolation and easing for the segment that starts at that
keyframe. `easing` stores temporal cubic Bézier `[x1,y1,x2,y2]`; `x1` and `x2`
must be in `[0,1]`. A two-dimensional position keyframe may additionally store
`spatialIn` and `spatialOut`. For the segment A -> B, the HYA compiler writes
`A.spatialOut` followed by `B.spatialIn` into `spatialTangents`.

Keyframe times are strictly increasing, in seconds, and inside the composition.
`frameRate` is used by UI snapping only and never changes persisted time semantics.
Stage 6 snaps ruler scrubbing, inserted keys and dragged keys to that frame grid;
when inserting between authored keys, the initial value is sampled from the existing
Step/Linear/Cubic and optional spatial curve before the new key is committed.

## 6. Named clips and state machines

`timeline.clips` are named ranges over the one composition. They share the same
node, track and resource tables; they are not imported source assets and are never
duplicated during export.

The optional state machine mirrors `org.haiyue.animation-state-machine@1`:

- parameter types are float, integer, boolean and one-shot trigger;
- a state motion references a named clip or a recursive 1D/2D Blend Tree;
- layers support override/additive blending, weight and binding masks;
- transition declaration order is priority order;
- graph positions are editor-only and are stripped during compilation.

The compiler writes named clips and the stripped state-machine definition into
the built-in HYA extension and declares it in both `extensionsUsed` and
`extensionsRequired`.

Stage 7 requires at least one named clip before creating a state machine because
every initial state needs a valid runtime motion. Graph positions remain on
`state.editorPosition` in the project and are removed during compilation. Runtime
parameter values used for preview are transient session state: only typed parameter
defaults, conditions and graph definitions are saved. Parameter and clip deletion
is blocked while a state, Blend Tree, speed binding or condition still references
the item; deleting a state removes its incoming and outgoing transitions.

State-machine export must diagnose content the current mixer cannot blend,
including timeline audio, particles, animated path morphs, advanced inline property
tracks and unknown extension components. Core transform tracks remain supported.
The compiler must not silently drop advanced animation or create two complete
visual hierarchies.

## 6A. Native 3D project and extension contract

Native 3D does not introduce HYA core 2.0. A normal `haiyue-animation` `1.0`
document carries the required `org.haiyue.animation-3d@1` extension. Its core
`canvas` is only the pixel output viewport; core `nodes` and `tracks` must both be
empty. The same identifier appears in `extensionsUsed` and `extensionsRequired`.
This preserves JSON HYA 1.0 and binary-container v1/v2 decode while making a
missing or unknown 3D runtime fail through the existing required-extension gate.

The extension payload format is `haiyue-animation-3d@1`. It fixes:

- a right-handed world with +Y up, -Z forward, meters, seconds and radians;
- normalized XYZW quaternions as persisted/runtime rotation; Euler values are UI
  input only and are converted before a transaction is committed;
- perspective cameras with vertical FOV radians plus near/far, and orthographic
  cameras with world-space height plus near/far;
- canonical TRS on every node, with primitive, model, camera and Particle3D
  components using stable ids;
- model resources as core HYA `binary` resources with `model/gltf-binary` or
  `model/gltf+json`; a model component references the core resource id;
- source-neutral `haiyue-animation3d-clip@1` clips and
  `haiyue-animation3d-state-machine@1` behavior definitions.

The runtime owner is the focused `@haiyue/extensions/animation3d` entrypoint. It
must reuse `Animation3DBindingResolver`, pose buffers, `Animation3DMixer` and the
glTF adapter; it does not add an engine-root export or a second animation mixer.
Particle nodes lower to the existing engine `ParticleEmitter3D` descriptor and
simulation. Preview-only grid, light, orbit/fly camera, gizmo and selection state
remain editor metadata and are never delivery nodes.

### 3D clips and typed bindings

The editable 3D project stores stable keyframe ids and values. Compilation flattens
them into the existing Animation3D ABI:

- Step/Linear: `times` has one entry per key and `values` has
  `keyCount * valueSize` numbers;
- Cubic Spline: every key requires equal-width `inTangent`, `value` and
  `outTangent`, flattened in that order;
- key times are strictly increasing, finite, in seconds and no later than both the
  clip and composition duration;
- transform translation/scale are vec3, rotation is a normalized quaternion,
  Morph uses a positive target-count width, and property tracks use the fixed
  component/property width in `animation-3d.contract.json`.

Joint animation is ordinary transform animation whose target is the imported
joint's stable `node-id` or `node-path`. Morph animation uses `morph.weights` and a
stable mesh slot. Material and camera animation use `path: property` with
`component: material3d|camera3d`; they do not use arbitrary JSON paths. State
machine layer masks contain Animation3D **binding ids**, so object TRS, joints,
Morph, camera and material channels all pass through the same pose/mixer history.

### 3D assets, package and particle descriptors

Editable assets retain source provenance separately from delivery metadata. glTF
sidecars are independent assets named by `dependencyAssetIds`; all references are
stable asset ids rather than source-relative array offsets. Bare HYA retains the
delivery URI. Package export rewrites bundled assets to collision-safe,
deterministic `assets/<name>[-n].<ext>` paths, emits a timestamp-free
`manifest.json` with SHA-256 integrity, and leaves HTTPS
external dependencies explicit. Delivery rejects `blob:`, `file:` and
`javascript:`. Runtime resolution is relative to the fetched HYA URL.

The serialized Particle3D descriptor is the data-only counterpart of
`ParticleEmitter3DOptions`: capacity, emission/burst/duration/loop/seed, scalar
ranges, direction/spread/gravity, size/rotation/angular velocity, colors, emitter
shape, texture resource id, blend/depth/sort and opacity fields. GPU textures,
owner handles, simulation state and transient `playing`/`emitting` state are never
serialized. G05 owns authoring curves and deterministic seek; G08 owns state-entry
and transition side effects.

### Compiler degradation and diagnostics

Compilation never silently converts native 3D to projected 2D. Editor-only state
is stripped with an informational diagnostic. Recognized delivery content is
preserved exactly; unsupported renderables, channels, material properties,
particle side effects, broken references, value widths or allocation budgets stop
preview/export before runtime creation.

| Condition | Stable code | Canonical path |
| --- | --- | --- |
| Invalid/unknown binary container | `E_ANIMATION_INVALID_BINARY` | `$` |
| Unsupported HYA core version | `E_ANIMATION_UNSUPPORTED_VERSION` | `$.version` |
| Missing/unknown required extension major | `E_ANIMATION_MISSING_EXTENSION` | `$.extensionsRequired` |
| Invalid native 3D payload | `E_ANIMATION_3D_INVALID_PAYLOAD` | `$.extensions.org.haiyue.animation-3d@1` |
| 2D core nodes/tracks in a 3D carrier | `E_ANIMATION_3D_MIXED_DIMENSIONS` | `$.nodes` or `$.tracks` |
| Recognized but unsupported 3D feature | `E_ANIMATION_3D_UNSUPPORTED_FEATURE` | exact feature path |
| Missing model/material/texture | `E_ANIMATION_3D_UNKNOWN_RESOURCE` | exact reference path |
| Target/value width mismatch | `E_ANIMATION_3D_BINDING_MISMATCH` | exact clip track path |
| 3D allocation budget exceeded | `E_ANIMATION_3D_LIMIT_EXCEEDED` | offending array path |
| Unknown project family | `E_PROJECT_INVALID_FORMAT` | `$.format` |
| Unsupported project schema | `E_PROJECT_UNSUPPORTED_VERSION` | `$.schemaVersion` |
| Mixed project request | `E_PROJECT_MIXED_DIMENSIONS` | `$.mode` |

G06 implements the reserved native-3D diagnostic codes. Until that runtime is
registered, a conforming native-3D asset intentionally fails with the already
implemented `E_ANIMATION_MISSING_EXTENSION`; it must never partially instantiate
2D runtime state.

## 7. Cross-document invariants

The JSON Schema handles local shape. The project validator/compiler must also
enforce:

1. Project, asset, node, track, keyframe, clip, component, effect, layer, state and
   transition ids are unique in their declared scope.
2. All references exist; node parent and composite graphs are acyclic.
3. Node ranges, clip ranges and keyframes fit inside the composition.
4. Keyframe values match `valueSize`; times are strictly increasing.
5. Typed value sizes are validated against the binding registry: core position/scale
   = 2, rotation/opacity = 1, fixed advanced properties use their HYA ABI width,
   and Morph/gradient-stop tracks derive width from the bound payload.
6. Spatial handles are accepted only on 2D position tracks.
7. Exactly zero or one enabled track targets each binding.
8. Static component/effect payloads contain no inline `*Track` fields.
9. State, transition, Blend Tree and condition references match their parameter,
   clip and state types.
10. Sprite UV tracks use Step interpolation; changing atlas frames must never blend
    normalized source rectangles.
11. All numbers are finite and every HYA parser allocation budget is checked before
    preview or export.
12. A native 3D carrier has zero core nodes/tracks, declares the exact required
    extension major, and contains no 2D project or component records.
13. 3D parent graphs are acyclic; component/resource/material ids resolve; clip,
    event, track, binding, keyframe, state and transition ids are unique in scope.
14. Quaternion key values are normalized, property widths match the finite binding
    table, Cubic Spline tangents match their value width, and masks name bindings.

## 8. Deterministic compilation

Compilation is a pure operation:

```text
project JSON
  -> migrate and validate project
  -> normalize stable-id ordering without changing visual order
  -> lower typed tracks and state-machine editor data
  -> AnimationDocument (2D core or empty-core + required native-3D extension)
  -> encodeAnimationBinary()
  -> parseAnimation() + required extension parser
  -> downloadable .hya
  -> optional deterministic ZIP with rewritten asset URIs + manifest
```

The same normalized project and compiler version must produce byte-identical HYA.
Diagnostics carry a stable code and project path and must be linkable back to an
asset, node, track, keyframe, clip or state-machine element.

## 9. Versioning and migration

- `@1` is the project-format major. Incompatible semantic changes require `@2`.
- `schemaVersion` starts at 1. Additive fields with deterministic defaults may use
  a later schema version within the same major.
- Opening always migrates into a detached value and validates before replacing the
  active project.
- Saving writes only the current canonical schema; old representations are never
  preserved as permanent parser branches.
- HYA format/version changes are independent from editor project migrations.

The machine-readable structure is
[`schema/project.schema.json`](./schema/project.schema.json) for 2D and
[`schema/project-3d.schema.json`](./schema/project-3d.schema.json) for native 3D.
The canonical fixtures are
[`examples/state-machine-multitrack.hya-project.json`](./examples/state-machine-multitrack.hya-project.json)
and
[`schema/fixtures/native-3d-project-valid.json`](./schema/fixtures/native-3d-project-valid.json).
The shared version, ownership, binding, resource and diagnostic registry is
`@haiyue/animation-spec/schema/animation-3d.contract.json`.
