import type { Transition } from "motion/react";

/** iOS-like deceleration curve for pushes, pops and sheets. */
export const EASE_OUT: Transition = { duration: 0.36, ease: [0.32, 0.72, 0, 1] };
/** Small controls (segmented thumb, switch knob): quick, slightly springy. */
export const SNAP: Transition = { type: "spring", stiffness: 600, damping: 40 };
/** Content swaps that need no direction (bottom bar, banners). */
export const FADE: Transition = { duration: 0.18, ease: "easeOut" };

/**
 * Horizontal slide used for page pushes and month paging. `dir` 1 = forward (comes in from the right,
 * leaves to the left), -1 = back (the mirror image), 0 = crossfade.
 */
export const slide = {
  enter: (dir: number) => ({ x: dir === 0 ? 0 : dir > 0 ? "100%" : "-28%", opacity: dir === 0 ? 0 : 1 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir === 0 ? 0 : dir > 0 ? "-28%" : "100%", opacity: dir === 0 ? 0 : 1 }),
};
