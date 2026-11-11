// Tests load plain `.mjs` helpers from `scripts/` and the style editor's
// ESLint plugin from the addon; declare the wildcard rather than guessing each
// module's export shape.
declare module "*.mjs";
