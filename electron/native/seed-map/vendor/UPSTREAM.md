# Cubiomes

Source: https://github.com/xpple/cubiomes (MIT fork of https://github.com/Cubitect/cubiomes)

Pinned commit: `b99f6e472018cab903a096697117aab9d9170a19`, 2026-10-18, “Fix end city terrain check”.

License: MIT, copyright (c) 2020 Cubitect. The original LICENSE is retained in `cubiomes/LICENSE`. Root C headers/sources, tables and feature sources are vendored without implementation changes. `native/bridge.c` is KJMCL's own FFI adapter; no launcher or GPL Cubiomes Viewer code is used. Loot/carver source files present upstream are not part of the exposed map protocol.

## Actual support

The catalog contains explicit Java release versions from 1.0.0 through 26.3 that `str2mc` recognizes. It does not alias future or unknown versions. 1.0 generation is experimental in upstream. The modern branch has separate biome parameter tables for 1.21.5, 26.2 and 26.3, including pale garden, sulfur caves and dappled forest, and a 26.3 abandoned camp configuration. Each advertised version is exercised in all three dimensions by the native test suite.

Tiles use the actual Cubiomes layer/noise algorithms at scales 1, 4, 16, 64 and 256; the Nether and End use exact block point samples at scale 256, where a direct upstream tile scale is unavailable. Signed 64-bit seeds are parsed as decimal strings without a floating-point conversion. Ordinary structure positions pass upstream biome viability plus supported terrain checks; End cities additionally pass the version-specific surface-height check. Slime chunks use Java integer/RNG arithmetic.

Markers are predictions, not full generated blocks. In particular, desert/jungle temples and mansions use approximate overworld terrain checks; pre-1.18 spawn searches do not fully check grass blocks. Stronghold/spawn coordinates are marked approximate. Biome locate is a bounded grid search, marked approximate, with a returned sampling interval from 4 to 128 blocks. Missing tiny regions between samples can be missed. A feature scan stops after 262,144 candidates or the requested result count and reports truncation. User world modifications and world-generation mods/datapacks are outside this engine's model.

## Validation

Native tests reproduce upstream fixed biome and structure vectors: 26.3 dappled forest at `(68148,77,80990)` for seed `-3829811542736183482`, the 26.2/26.3 End-ring correction for seed `856461443495910397`, Nether portal/fortress positions, and the 1.9–1.12 versus 1.13+ End-city surface rejection. Tests also cover negative-coordinate tile seams, all dimensions and scales, Y/large-biome differences, seed precision above 2^53, and an independent Java integer/LCG slime calculation. These are deterministic algorithm tests; they are not an in-game acceptance run or independent confirmation of every 26.x terrain parameter.

## Build and runtime

Windows x64 uses Rust target `x86_64-pc-windows-gnu` and MSYS2 UCRT64 GCC/binutils on PATH. Install the target with `rustup target add x86_64-pc-windows-gnu`; build via `node scripts/build-seed-map.mjs` and test via `node scripts/test-seed-map.mjs`. This is separate from the save-manager's MSVC target. The fork uses C99 variable-length arrays and does not support MSVC. macOS/Linux use the native Rust target and a compatible C compiler; those platforms have not been built in this Windows session.

C compilation uses `-fwrapv` and `-ffp-contract=off` without fast-math. The Windows build checks PE imports against Windows system DLLs and smoke-tests the executable with only Windows system directories on PATH. No MSYS2/GCC runtime DLL is required or shipped. GCC/MinGW startup and runtime code can be statically incorporated by the toolchain; applicable license texts are retained in `runtime-licenses/` (GCC GPLv3 with Runtime Library Exception 3.1 and MinGW-w64 runtime notices). The exception permits independent non-GPL modules to use the covered runtime. The compiler itself is a build dependency and is not distributed.
