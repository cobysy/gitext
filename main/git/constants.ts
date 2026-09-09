/** Cap on git output: generated files/bundles produce megabytes (pipe, clone, DOM cost paid thrice). */
export const MAX_GIT_OUTPUT_BYTES = 2_000_000;

/** Binary sniff: git's rule is NUL byte in first 8000 bytes (xdiff/xutils.c). */
export const BINARY_SNIFF_BYTES = 8000;
