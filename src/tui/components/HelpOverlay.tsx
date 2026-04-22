import { theme } from "../theme"

export const HelpOverlay = () => (
  <box
    position="absolute"
    top="20%"
    left="20%"
    width="60%"
    border
    borderStyle="double"
    borderColor={theme.borderActive}
    backgroundColor={theme.backgroundPanel}
    padding={1}
    flexDirection="column"
    zIndex={20}
  >
    <text fg={theme.accent}>keyboard help</text>
    <text fg={theme.textMuted}>h/j/k/l move focus</text>
    <text fg={theme.textMuted}>Tab / Shift-Tab cycle focus</text>
    <text fg={theme.textMuted}>Esc release panel focus</text>
    <text fg={theme.textMuted}>focused panel: j/k, Ctrl-d/u, Ctrl-f/b, gg, G</text>
    <text fg={theme.textMuted}>? toggle help</text>
    <text fg={theme.textMuted}>Ctrl-C cancel run</text>
    <text fg={theme.textMuted}>Q force-quit confirm</text>
    <text fg={theme.textMuted}>y copy selection</text>
  </box>
)
