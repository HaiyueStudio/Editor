# AnimationEditor test fixtures

These fixtures are owned by the Editor test suite. Tests must not reach into unpublished `test/` trees of installed Engine packages.

| Fixture | Provenance | Source SHA-256 |
| --- | --- | --- |
| `gltf/animation-characterization.gltf` | HaiYue-authored glTF animation characterization fixture, migrated from Engine `extensions/test/fixtures/gltf` | `c95e740825f19d6f2c812e50b9d36da9849bde96a715f92f1d897204357cd9ff` |
| `lottie/basic-lottie.json` | HaiYue-authored minimal Lottie conversion fixture, migrated from Engine `animation-spec/test/fixtures` | `7fe6faf9e21b9317099a8d040fac6d407de568d6911217ddd7cb044204b2e3cf` |

The copies intentionally remain byte-exact so Editor integration tests characterize the same public importer behavior without requiring private package fixtures. Both are HaiYue-authored internal test data; no third-party media is embedded.
