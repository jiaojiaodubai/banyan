// The style editor's ESLint plugin ships as plain JS inside the addon, and the
// parity test loads it directly; declare the wildcard rather than guessing its
// export shape.
declare module "*.mjs";
