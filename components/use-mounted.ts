import { useSyncExternalStore } from "react";

const noSubscribe = () => () => {};

/** False on the server and the first client render, for anything that depends on the viewer's clock or storage. */
export function useMounted(): boolean {
  return useSyncExternalStore(noSubscribe, () => true, () => false);
}
