# HaiyueStudio Editor repository instructions

- Node.js 22 or newer is required.
- Consume Engine, Extensions, animation-spec, shader-language, and UI only through declared package exports.
- Cross-repository relative imports, `file:../` dependencies, and imports from another repository's `src/` are forbidden.
- The Editor repository is AI-neutral: no model provider, Agent runtime/session/tooling, or DeepSeek Harness dependency.
- Preserve separate Scene, HYA, and Voxel domain models while M03 extracts shared lifecycle, Shell, History, Task,
  contribution, Plugin SDK, and app packaging contracts.
- Run the affected product typecheck/test/build and the repository boundary check.
