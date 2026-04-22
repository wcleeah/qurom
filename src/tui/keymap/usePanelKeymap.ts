import { useKeyboard } from "@opentui/react"
import { useEffect, useRef } from "react"

export type ScrollAdapter = {
  scrollBy: (delta: number) => void
  scrollViewport: (multiplier: number) => void
  scrollContent: (multiplier: number) => void
  scrollToTop: () => void
  scrollToBottom: () => void
}

export type UsePanelKeymapInput = {
  active: boolean
  scroll: ScrollAdapter
  onGPendingChange?: (pending: boolean) => void
}

export function usePanelKeymap({ active, scroll, onGPendingChange }: UsePanelKeymapInput) {
  const gPendingRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(
    () => () => {
      if (gPendingRef.current) clearTimeout(gPendingRef.current)
    },
    [],
  )

  useKeyboard((key) => {
    if (!active) return

    if (key.name === "j") return scroll.scrollBy(1)
    if (key.name === "k") return scroll.scrollBy(-1)
    if (key.ctrl && key.name === "d") return scroll.scrollViewport(0.5)
    if (key.ctrl && key.name === "u") return scroll.scrollViewport(-0.5)
    if (key.ctrl && key.name === "f") return scroll.scrollContent(1)
    if (key.ctrl && key.name === "b") return scroll.scrollContent(-1)
    if (key.shift && key.name === "g") {
      if (gPendingRef.current) {
        clearTimeout(gPendingRef.current)
        gPendingRef.current = undefined
        onGPendingChange?.(false)
      }
      return scroll.scrollToBottom()
    }

    if (key.name !== "g") return
    if (gPendingRef.current) {
      clearTimeout(gPendingRef.current)
      gPendingRef.current = undefined
      onGPendingChange?.(false)
      return scroll.scrollToTop()
    }

    onGPendingChange?.(true)
    gPendingRef.current = setTimeout(() => {
      gPendingRef.current = undefined
      onGPendingChange?.(false)
    }, 500)
  })
}
