export const TMUX_TOP_INSET = process.env.TMUX || process.env.TERM_PROGRAM === "tmux" ? 1 : 0

export const centeredColumnWidth = (width: number, wide: number, narrow: number): number => {
  if (width >= wide + 8) return wide
  return Math.max(42, Math.min(width - 4, narrow))
}
