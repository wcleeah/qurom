import { TMUX_TOP_INSET } from "../layout"
import { theme } from "../theme"

export const TooSmallBanner = () => (
  <box flexDirection="column" flexGrow={1}>
    {TMUX_TOP_INSET > 0 ? <box height={TMUX_TOP_INSET} flexShrink={0} /> : null}
    <box
      border
      title="research-qurom"
      borderStyle="double"
      borderColor={theme.borderActive}
      backgroundColor={theme.backgroundPanel}
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      flexGrow={1}
      marginLeft={1}
      marginRight={1}
      marginBottom={1}
    >
      <text fg={theme.text}>terminal too small</text>
      <text fg={theme.textMuted}>resize to at least 60x20 for the split layout</text>
    </box>
  </box>
)
