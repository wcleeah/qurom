import { useEffect, useMemo, useState } from "react"
import type { RunStore } from "../state/runStore"
import type { SystemStatusStore } from "../state/systemStatus"
import { useSystemStatusSelector } from "../state/systemStatus"
import { useStoreSelector } from "../state/useStore"
import { theme } from "../theme"

export interface SystemStatusSurfaceProps {
  store: RunStore
  systemStatus: SystemStatusStore
}

const SURFACE_MS = 6000

const stringifyError = (value: unknown): string => {
  if (value instanceof Error) return value.message
  return String(value)
}

export const SystemStatusSurface = ({ store, systemStatus }: SystemStatusSurfaceProps) => {
  const lifecycleError = useStoreSelector(store, (s) => s.lifecycle.error)
  const runSystemLog = useStoreSelector(store, (s) => s.systemLog)
  const appEntries = useSystemStatusSelector(systemStatus, (s) => s.entries)
  const latestRunEntry = runSystemLog.at(-1)
  const latestAppEntry = appEntries.at(-1)
  const [visible, setVisible] = useState(false)
  const latestEntry =
    latestAppEntry && latestRunEntry
      ? latestAppEntry.ts >= latestRunEntry.ts
        ? { kind: "app" as const, entry: latestAppEntry }
        : { kind: "run" as const, entry: latestRunEntry }
      : latestAppEntry
        ? { kind: "app" as const, entry: latestAppEntry }
        : latestRunEntry
          ? { kind: "run" as const, entry: latestRunEntry }
          : undefined

  const surface = useMemo(() => {
    if (lifecycleError) {
      return {
        level: "error" as const,
        title: "Run failed",
        text: stringifyError(lifecycleError),
      }
    }

    if (latestEntry?.kind === "app") {
      return {
        level: latestEntry.entry.level,
        title: latestEntry.entry.level === "error" ? "System error" : "System notice",
        text: latestEntry.entry.text,
      }
    }

    if (latestEntry?.kind === "run") {
      return {
        level: "warn" as const,
        title: "Runner status",
        text: latestEntry.entry.text,
      }
    }

    return undefined
  }, [lifecycleError, latestEntry])

  useEffect(() => {
    if (!surface) {
      setVisible(false)
      return
    }

    setVisible(true)
    if (surface.level === "error") return

    const id = setTimeout(() => setVisible(false), SURFACE_MS)
    return () => clearTimeout(id)
  }, [surface])

  if (!surface || !visible) return null

  return (
    <box
      position="absolute"
      top={1}
      right={1}
      maxWidth={52}
      border
      borderStyle="single"
      borderColor={surface.level === "error" ? theme.error : theme.warning}
      backgroundColor={theme.backgroundPanel}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
      flexDirection="column"
      zIndex={10}
    >
      <text
        fg={surface.level === "error" ? theme.error : theme.accent}
        selectionBg={theme.selectionBg}
        selectionFg={theme.selectionFg}
      >
        {surface.title}
      </text>
      <text fg={theme.text} wrapMode="word" selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
        {surface.text}
      </text>
    </box>
  )
}
