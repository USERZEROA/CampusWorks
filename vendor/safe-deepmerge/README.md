# Safe deep merge

The build toolchain uses this local MIT-licensed implementation instead of the unpatched `deepmerge` package. It preserves the merge API used by the Rollup resolver, including arrays, symbols, custom merge functions, and clone options. It rejects prototype meta-properties from both inputs and defines destination properties explicitly.

This addresses [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4), including crafted target objects. The upstream copyright notice is retained in LICENSE. Security and compatibility checks are in `tests/dependency-security.test.mjs`; production builds verify actual toolchain integration.
