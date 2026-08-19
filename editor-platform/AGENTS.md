# Headless Editor Platform instructions

- No DOM, WebGPU, Engine, UI, product model, storage global, or AI dependency.
- Every registration and asynchronous operation has an explicit owner and idempotent disposal path.
- Activation and history transactions fail atomically with structured diagnostics.
- Run package conformance tests plus repository boundary/API gates.
