# Editor App Kit instructions

- A product descriptor contains identity and policy, not build implementation.
- Assembly is deterministic and path-safe; PWA and Electron renderer trees come from the same staged Web tree.
- Keep Electron security defaults fixed and reject source maps, tests, sources and unsafe navigation.
- Do not add provider, Agent or AI-specific descriptor fields.
