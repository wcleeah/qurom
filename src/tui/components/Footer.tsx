import { theme } from "../theme"

export const Footer = () => (
  <box paddingLeft={1} paddingRight={1} paddingBottom={1} flexShrink={0}>
    <text fg={theme.textMuted} selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
      Ctrl-C cancel run  ·  y copy selection
    </text>
  </box>
)
