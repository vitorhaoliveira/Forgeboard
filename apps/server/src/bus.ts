import { EventEmitter } from "node:events";
import type { RunEvent } from "@forgeboard/shared";

/** In-process pub/sub so SSE connections receive events as they are produced. */
const emitter = new EventEmitter();
emitter.setMaxListeners(0);

export const bus = {
  publish(event: RunEvent): void {
    emitter.emit(event.taskId, event);
  },
  subscribe(taskId: string, listener: (event: RunEvent) => void): () => void {
    emitter.on(taskId, listener);
    return () => emitter.off(taskId, listener);
  },
};
