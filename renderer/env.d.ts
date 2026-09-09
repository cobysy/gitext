// Vite rewrites ?worker imports to Worker constructors. Pull only this one declaration
// to avoid reopening vite/client's other ambient globals.
declare module '*?worker'
{
  const workerConstructor: new () => Worker;
  export default workerConstructor;
}

declare module '*.vue'
{
  import type { DefineComponent } from 'vue';
  // object (allows falsy values); unknown (no instance reading).
  const component: DefineComponent<object, object, unknown>;
  export default component;
}
