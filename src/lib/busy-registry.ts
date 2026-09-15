// Lightweight global "busy" registry for long-running tasks.
//
// Any code path performing a long operation that should keep the device
// awake can call `beginBusyTask("my-task")` and call the returned function
// to end it. Components can subscribe via `subscribeBusy` (used by the
// wake-lock hook in App).
//
// This is a deliberate side-channel — no React context needed — so it
// works from plain TS modules (export hooks, fetch helpers, etc.).

type Listener = (count: number) => void;

let _count = 0;
const _listeners = new Set<Listener>();

function _notify() {
  for (const l of _listeners) {
    try { l(_count); } catch { /* ignore */ }
  }
}

export function beginBusyTask(_label?: string): () => void {
  _count += 1;
  _notify();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    _count = Math.max(0, _count - 1);
    _notify();
  };
}

export function subscribeBusy(listener: Listener): () => void {
  _listeners.add(listener);
  listener(_count);
  return () => { _listeners.delete(listener); };
}

export function getBusyCount(): number {
  return _count;
}
