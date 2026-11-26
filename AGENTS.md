# KJMCL development

- KJMCL is the project at this repository root. `SJMCL/` is an excluded reference checkout; never modify it or copy implementation code from it.
- Preserve the Chinese, rectangular black/orange interface. Keep interface copy short and useful. Do not add sample accounts, fake download progress, or fake installed instances to production state.
- Maintain the local drawing catalogue at `docs/icon-atlas.html` whenever launcher icons or their functions change. Keep existing artwork IDs stable, update Chinese descriptions and Canvas/CSS references in `tools/icon-atlas/labels.mjs`, then run `npm run icons` and include the generated page. The development launcher watches the catalogue, and `npm run icons:check` checks for stale output.
- Renderer code must remain sandboxed. Extend `shared/types.ts`, `shared/schema.ts`, the named preload bridge, and main-process handlers together. Keep filesystem access, secrets, networking, and child processes in `electron/`.
- Split UI pages in `src/pages/` and domain services in `electron/core/`. Version persisted state and provide migrations when changing its schema. Never silently reset user state.
- Keep Java launches shell-free. Preserve OS path handling, architecture rules, archive path checks, cryptographic download verification, encrypted credentials, and redacted logging.
- Run `npm run typecheck` and targeted tests for changed behavior. For launch, preload, persistence, or desktop UI changes run `npm run test:desktop` with JDK 17+ on PATH. Tests must use disposable temporary data directories.
- Download sources and real account login were intentionally not exercised for the initial delivery. Do not describe mocked tests, build configuration, or JVM fixture launch as a real Minecraft or multi-OS acceptance test.
- Before delivery build with `npm run build`. Produce desktop bundles on the matching OS; record signing and testing limitations accurately. Never publish, register applications, or embed another launcher's OAuth ID without the user's applicable authorization.
