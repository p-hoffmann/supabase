// Trex integration: listens for postMessage from the trex parent iframe wrapper
// and applies the requested theme via next-themes. Safe to mount unconditionally;
// no-op when not embedded.
import { useEffect } from 'react'
import { useTheme } from 'next-themes'

export function TrexThemeSync() {
  const { setTheme } = useTheme()
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return
      const d = e.data
      if (!d || d.type !== 'trex:theme') return
      if (d.theme === 'light' || d.theme === 'dark') {
        setTheme(d.theme)
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [setTheme])
  return null
}
