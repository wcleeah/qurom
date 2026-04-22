import type { FocusRegion } from "../state/layout"
import { theme } from "../theme"

export interface FooterProps {
  screen: "prompt" | "running" | "summary"
  focused?: FocusRegion
  gPending?: boolean
}

const footerText = ({ screen, focused, gPending }: FooterProps): string => {
  if (screen === "prompt") return "Tab switch modes  ·  Enter run  ·  q quit"
  if (screen === "summary") return "r rerun  ·  n new topic  ·  f new document  ·  q quit"
  if (gPending) return "g… top  ·  G bottom  ·  Esc release focus"
  if (focused && focused !== "dashboard") {
    return "j/k scroll  ·  Ctrl-d/u half page  ·  Ctrl-f/b page  ·  gg top  ·  G bottom  ·  Esc release"
  }
  return "h/j/k/l focus  ·  Tab cycle  ·  ? help  ·  Ctrl-C cancel  ·  Q quit  ·  y copy"
}

export const Footer = ({ screen, focused, gPending = false }: FooterProps) => (
  <box paddingLeft={1} paddingRight={1} paddingBottom={1} flexShrink={0}>
    <text fg={theme.textMuted} selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
      {footerText({ screen, focused, gPending })}
    </text>
  </box>
)
