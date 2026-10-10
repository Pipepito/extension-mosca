import type { Clock } from '../../core/ports';

/** Si la vigilancia libera la sesión, tampoco ejecutar el callback que la despertó. */
export function lifecycleClock(clock: Clock, beforeTimer: () => void): Clock {
  function schedule(repeat: boolean, callback: () => void, delay: number) {
    let active = true;
    const cancel = (repeat ? clock.setInterval : clock.setTimeout)(() => {
      if (!active) return;
      beforeTimer();
      // beforeTimer puede llamar a runner.stop(), que cancela este mismo timer.
      if (!active) return;
      if (!repeat) active = false;
      callback();
    }, delay);
    return () => { active = false; cancel(); };
  }
  return { ...clock,
    setInterval: (callback, delay) => schedule(true, callback, delay),
    setTimeout: (callback, delay) => schedule(false, callback, delay),
  };
}
