import { useKeyboard } from "@opentui/react"
import { theme } from "../theme"

export interface QuitConfirmProps {
  onYes: () => void
  onNo: () => void
}

export const QuitConfirm = ({ onYes, onNo }: QuitConfirmProps) => {
  useKeyboard((key) => {
    if (key.name === "y") onYes()
    else if (key.name === "n" || key.name === "escape") onNo()
  })

  return (
    <box
      position="absolute"
      top="35%"
      left="30%"
      width="40%"
      border
      borderStyle="double"
      borderColor={theme.borderActive}
      backgroundColor={theme.backgroundPanel}
      padding={1}
      flexDirection="column"
      zIndex={30}
    >
      <text fg={theme.accent}>quit research-qurom?</text>
      <text fg={theme.textMuted}>press y to quit or n to continue</text>
    </box>
  )
}
