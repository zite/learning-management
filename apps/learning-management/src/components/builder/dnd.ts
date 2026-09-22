import { closestCenter, pointerWithin, type CollisionDetection, type Modifier } from '@dnd-kit/core';

/** Lists here only reorder vertically. */
export const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });

/** The item under the pointer; the nearest one when the pointer leaves the list. */
export const pointerFirst: CollisionDetection = args => {
  const hits = pointerWithin(args);
  return hits.length ? hits : closestCenter(args);
};

/**
 * Edge scrolling that only starts right at the edge. dnd-kit's default zone
 * (20% of the scroller) catches a tall card during an ordinary drag and scrolls
 * the list out from under the pointer.
 */
export const gentleAutoScroll = { threshold: { x: 0, y: 0.08 }, acceleration: 5 };
