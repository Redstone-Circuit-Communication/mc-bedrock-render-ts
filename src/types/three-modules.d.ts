// The renderer bundles three.js, postprocessing and n8ao (the Java package's rendering stack). @types/three is not part of this
// package's toolchain, so these modules are typed loosely; nothing of their types appears in the public declarations.
declare module 'three';
declare module 'three/examples/jsm/controls/OrbitControls.js';
declare module 'n8ao';
