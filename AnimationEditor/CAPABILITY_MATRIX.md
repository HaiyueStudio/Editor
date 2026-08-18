# Animation Editor capability matrix

Status describes the current implementation boundary. A feature can already pass
through the compiler even when its dedicated authoring UI belongs to a later step.

- **Compiled**: stage 4 lowers and validates the feature into HYA runtime data.
- **Authored**: the editor UI can create and modify the feature with undo/redo.
- **Modelled**: the project schema and semantic contract can represent the feature;
  a typed compiler adapter or authoring UI is still pending.
- **Payload**: static HYA data is retained in a component/effect payload; a typed
  compiler adapter is still required.
- **Contract frozen**: a versioned schema, fixture, diagnostic and runtime owner
  are fixed; implementation belongs to the listed delivery goal.
- **Rejected**: the mode is deliberately invalid and must produce the listed
  stable diagnostic instead of degrading.
- **Future format**: intentionally outside project format v1.

| HYA capability | Project representation | Status | Delivery step |
| --- | --- | --- | --- |
| Canvas, duration, frame rate, end behavior | `composition` | Compiled | 4 |
| External/embedded source assets and delivery URI | `assets` | Authored + compiled; stable-id relink; deterministic external-resource package | 3/5/9/G09 |
| Node tree, local range, transform | `nodes` | Authored + compiled; lock/hide and viewport direct interaction | 4/5/G09 |
| Rect, ellipse, sprite, text, path | Stable component + HYA static payload | Authored + compiled, including advanced vector/text controls | 5/8 |
| Position, rotation, scale, opacity tracks | `node-transform` binding | Authored + compiled | 4/6 |
| Step, linear, cubic temporal easing | Per-keyframe interpolation/easing | Authored + compiled, including deterministic mixed-mode bake | 4/6 |
| Spatial Bézier position | `spatialIn` / `spatialOut` | Authored + compiled | 4/6 |
| Sprite-sheet UV track | `sprite.uv-rect` binding | Authored + compiled with Step-only validation | 8 |
| Vector morph, solid/gradient paint and stroke | Typed component property binding | Authored + compiled | 8 |
| Trim path and round corners | Stable `partId` + typed modifier binding | Authored + compiled | 8 |
| Text documents | Static/step document data in text payload | Authored + compiled | 8 |
| Text selector and character animator tracks | Stable `partId` + typed binding | Authored + compiled | 8 |
| Ordered mask/matte composite stack | Stable composite layer records | Authored + compiled | 8 |
| Composite expansion track | `composite-property` binding | Authored + compiled | 8 |
| Tint/fill/opacity/matrix/blur/shadow effects | Stable effect + typed effect binding | Authored + compiled | 8 |
| Particle2D | HYA static component payload | Authored + compiled | 8 |
| Timeline audio | HYA static component payload | Authored + compiled | 8 |
| Named animation clips | `timeline.clips` composition ranges | Authored + compiled with state-machine extension | 4/6/7 |
| Float/integer/boolean/trigger parameters | `stateMachine.parameters` | Authored + runtime-controlled | 7 |
| Layers, states, Any State and transitions | `stateMachine.layers` | Authored + compiled + runtime preview | 4/7 |
| 1D/2D Blend Trees | Recursive state motion | Root Blend Tree authored + compiled/runtime; imported nested trees preserved | 4/7 |
| Layer weight, additive/override and binding mask | State-machine layer fields | Authored + compiled + runtime preview | 4/7 |
| Extension components | Static payload + registered adapter | Built-in vector adapter compiled; third-party adapters remain plugin work | 8+ |
| Native 3D carrier/version | Empty HYA 1.0 core + required `org.haiyue.animation-3d@1` | Authored + compiled + exact WebGPU runtime | G06/G09 |
| 3D TRS and perspective/orthographic camera | Canonical quaternion TRS + `camera3d` component | Authored + compiled; reuses Animation3D binding/mixer | G06/G09 |
| Primitive and glTF model resources | `primitive3d` / `model3d` + core binary resource id | Authored + compiled + runtime; glTF adapter remains owner | G06/G07/G09 |
| Joint and Morph clips | Animation3D transform binding / `morph.weights` | Imported/authored + runtime; source-neutral clips | G06/G09 |
| Basic material channels | `material3d` property binding with fixed widths | Authored + compiled + runtime | G06/G09 |
| Particle3D descriptor | Data-only counterpart of engine `ParticleEmitter3DOptions` | Authored + deterministic seek/runtime | G05/G06/G09 |
| Animation3D state machine | `haiyue-animation3d-state-machine@1`, binding-id masks | Compiled + existing mixer/runtime owner | G06/G08/G09 |
| Native 3D package resources | Stable asset ids + deterministic path/integrity manifest | Authored + deterministic package | G06/G09 |
| Mixed 2D/3D authoring | Separate project families; no mixed composition | Rejected: `E_PROJECT_MIXED_DIMENSIONS` at `$.mode` | Future contract only |
| Projected pseudo-3D effects | Existing 2D vector/transform data | Compiled as 2D; never labelled native 3D | Existing |
| General NLE media lanes | Not a HYA runtime concept; requires explicit bake contract | Future format | Not scheduled |
| Runtime script/expression execution | Explicitly prohibited by HYA | Future format | Not applicable |

## State-machine compatibility policy

The compiler and runtime read the canonical typed registry exported by
`animation-spec/src/state-machine.ts`. `Full` channels run through the existing
Animation2D/Animation3D sampler, mixer and pose buffer. `Degraded` channels have an
executable bounded policy; `Unsupported` channels fail with the registry diagnostic
instead of sampling the composition a second time.

| State-machine channel | Support | Sampling / mixing / ownership policy |
| --- | --- | --- |
| Core transform and opacity | Full | Numeric track; override/additive, layer weight, binding mask and cross-fade in the shared pose buffer |
| Sprite UV | Full | Step track; highest weight wins, equal weights use earlier action order, switch occurs at the dominant-weight boundary |
| Vector and legacy path morph | Full | Numeric shape channel; topology/value width is fixed by HYA validation and geometry is updated on the shared visual instance |
| Particle2D / Particle3D | Full | Effect cue on the shared emitter; enter/restart once, loop follows cue policy, destination takes ownership during transition, final exit stops emission and clears; native scene/model mixers share one controller transaction |
| Native 3D pose | Full | Existing Animation3D pose/mixer; override/additive, layer mask and cross-fade remain controller-transactional |
| Audio | Degraded | One shared media playhead; only one full-weight override layer, clip-only motions and zero-duration transitions; overlap fails with `E_STATE_MACHINE_CHANNEL_AUDIO_UNMIXABLE_RANGE`, and rejected `play()` reports `W_STATE_MACHINE_CHANNEL_AUDIO_AUTOPLAY_REJECTED` |
| Resource switch | Degraded | Dominant Step switch on the shared visual; overlapping resource ownership must report `E_STATE_MACHINE_CHANNEL_RESOURCE_SWITCH_OVERLAP` until authoring exposes the binding |
| Vector paint/modifiers, text animator, visual-effect and composite-expansion tracks | Unsupported | Export/runtime fail with `E_STATE_MACHINE_CHANNEL_ADVANCED_INLINE_UNSUPPORTED`; ordinary non-state-machine playback remains fully supported |
| Unknown component side effects | Unsupported | No registered channel strategy; runtime reports an exact component path and never duplicates a runtime instance |
