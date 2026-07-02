import { useRef } from 'react';

/**
 * Entry animation for a card "born" from the tail thinking row: the row fades
 * out while the card grows in place (height 0 → auto under overflow:hidden),
 * revealing its content without scaling it.
 *
 * This deliberately replaced a framer shared-element (`layoutId`) morph: the
 * seed id hopping row→card→row across the transcript made framer's projection
 * tree morph between unrelated boxes (cards flying, content scale-warped,
 * entering cards stuck invisible mid-crossfade). A mount-scoped grow is
 * self-contained and cannot misfire.
 */
export const SEED_GROW_INITIAL = { height: 0, opacity: 0 } as const;
export const SEED_GROW_ANIMATE = { height: 'auto', opacity: 1 } as const;

/** Freeze the seed flag at mount: a card either grows in at birth or never —
 *  the flag moving to a newer card later must not re-trigger or cancel it. */
export function useSeedGrow(seedGrow: boolean | undefined): boolean {
  return useRef(!!seedGrow).current;
}
