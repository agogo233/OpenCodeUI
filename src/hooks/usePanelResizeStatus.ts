import { useEffect, useState } from 'react'

export function usePanelResizeStatus(): boolean {
  const [isResizing, setIsResizing] = useState(false)

  useEffect(() => {
    const onStart = () => setIsResizing(true)
    const onEnd = () => setIsResizing(false)

    window.addEventListener('panel-resize-start', onStart)
    window.addEventListener('panel-resize-end', onEnd)

    return () => {
      window.removeEventListener('panel-resize-start', onStart)
      window.removeEventListener('panel-resize-end', onEnd)
    }
  }, [])

  return isResizing
}
