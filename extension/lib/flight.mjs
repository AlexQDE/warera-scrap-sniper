// Single flight: concurrent asks that share a key (two tabs ticking, a tick
// racing the refresh button, two tabs filtering the same item) share ONE run
// instead of each hitting the API. Once the run settles, the next ask runs
// again. Pure; the background worker keeps one of these for its lifetime.

/** Returns once(key, run): run() is started for a key only while none is in flight for it. */
export function makeSingleFlight() {
  const inflight = new Map();
  return (key, run) => {
    if (inflight.has(key)) return inflight.get(key);
    const p = new Promise((resolve) => resolve(run())).finally(() =>
      inflight.delete(key),
    ); // run() starts now, not a tick later
    inflight.set(key, p);
    return p;
  };
}
