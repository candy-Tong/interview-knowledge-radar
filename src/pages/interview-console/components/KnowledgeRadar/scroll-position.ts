type CenteredScrollPosition = {
  anchorHeight: number;
  anchorTop: number;
  contentHeight: number;
  viewportHeight: number;
};

/** Centers a focus region whenever the surrounding content permits it. */
export function calculateCenteredScrollTop({
  anchorHeight,
  anchorTop,
  contentHeight,
  viewportHeight,
}: CenteredScrollPosition) {
  const centeredScrollTop = anchorTop + anchorHeight / 2 - viewportHeight / 2;
  const maximumScrollTop = Math.max(contentHeight - viewportHeight, 0);
  return Math.min(Math.max(centeredScrollTop, 0), maximumScrollTop);
}
