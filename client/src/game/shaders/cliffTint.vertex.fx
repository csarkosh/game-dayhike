// Cliff tint vertex definitions, spliced by CliffTintPlugin (cliffTintPlugin.ts)
// at CUSTOM_VERTEX_DEFINITIONS: the per-instance ground colour the cliff shell
// writes (the same foliage attribute the ground cover carries), handed to the
// fragment stage untouched.
//
// COMMENT RULES: no semicolon inside a trailing comment on a code line, no
// hashed preprocessor keyword in comment prose.
#ifdef CLIFFTINT
#ifdef THIN_INSTANCES
attribute vec4 foliage;
#endif
varying vec4 vCliffTint;
#endif
