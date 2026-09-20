/// <reference types="svelte" />
/// <reference types="vite/client" />

/**
 * The workbench's own version, from the root package.json, injected by Vite.
 *
 * Not the same number as `locusVersion`, which records the normalizer that
 * produced a kit's calls and moves only when crates/locus does.
 */
declare const __APP_VERSION__: string;
