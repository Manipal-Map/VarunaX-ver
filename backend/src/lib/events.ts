import { EventEmitter } from "events";

// Cache the bus on globalThis in EVERY environment (the old version only did
// it in dev). Next.js can bundle routes separately in production; the pipeline
// runner and the SSE stream route must share ONE bus or live updates never
// reach the browser.
const globalForEvents = globalThis as unknown as { __varunaBus?: EventEmitter };
const bus = globalForEvents.__varunaBus ?? new EventEmitter();
globalForEvents.__varunaBus = bus;
bus.setMaxListeners(100);

export interface IncidentEvent {
  incidentId: string;
  system: string;
  status: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

export function emitIncidentUpdate(event: IncidentEvent): void {
  bus.emit(`incident:${event.incidentId}`, event);
  bus.emit("incident:*", event);
}

export function subscribeIncidentUpdates(
  incidentId: string,
  callback: (event: IncidentEvent) => void
): () => void {
  const channel = `incident:${incidentId}`;
  bus.on(channel, callback);
  return () => {
    bus.off(channel, callback);
  };
}

export function subscribeAllIncidentUpdates(
  callback: (event: IncidentEvent) => void
): () => void {
  bus.on("incident:*", callback);
  return () => {
    bus.off("incident:*", callback);
  };
}
