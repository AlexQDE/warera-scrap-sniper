/** Coalesce DOM work; never let a noisy stream postpone a scan indefinitely. */
export function createScheduler(
  run,
  { delay = 100, set = setTimeout, cancel = clearTimeout } = {},
) {
  let timer = null;
  return {
    schedule() {
      if (timer != null) return;
      timer = set(() => {
        timer = null;
        run();
      }, delay);
    },
    cancel() {
      if (timer != null) cancel(timer);
      timer = null;
    },
  };
}
