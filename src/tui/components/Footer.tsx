import { theme } from "../theme"

export const Footer = () => (
  <box paddingLeft={1} paddingRight={1} paddingBottom={1} flexShrink={0}>
    <text fg={theme.textMuted}>Ctrl-C cancel run</text>
  </box>
)
