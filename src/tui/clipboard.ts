export async function copy(text: string): Promise<void> {
  if (process.platform === "darwin") {
    const escaped = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
    const proc = Bun.spawn(["osascript", "-e", `set the clipboard to \"${escaped}\"`], {
      stdout: "ignore",
      stderr: "ignore",
    })
    if ((await proc.exited) === 0) return
  }

  if (process.env.WAYLAND_DISPLAY) {
    const proc = Bun.spawn(["wl-copy"], { stdin: "pipe", stdout: "ignore", stderr: "ignore" })
    proc.stdin.write(text)
    proc.stdin.end()
    if ((await proc.exited) === 0) return
  }

  const xclip = Bun.spawn(["xclip", "-selection", "clipboard"], { stdin: "pipe", stdout: "ignore", stderr: "ignore" })
  xclip.stdin.write(text)
  xclip.stdin.end()
  if ((await xclip.exited) === 0) return

  const xsel = Bun.spawn(["xsel", "--clipboard", "--input"], { stdin: "pipe", stdout: "ignore", stderr: "ignore" })
  xsel.stdin.write(text)
  xsel.stdin.end()
  if ((await xsel.exited) === 0) return

  throw new Error("clipboard unavailable")
}
