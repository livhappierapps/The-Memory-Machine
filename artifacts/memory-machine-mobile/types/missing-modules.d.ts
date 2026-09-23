declare module "expo" {
  export function reloadAppAsync(): Promise<void>;
  export function registerRootComponent(component: React.ComponentType): void;
}

declare module "expo/fetch" {
  const fetch: typeof globalThis.fetch;
  export { fetch };
}

declare module "jszip";
