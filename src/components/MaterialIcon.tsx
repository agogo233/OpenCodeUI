import { useEffect } from 'react'
import { ensureIconSprite, iconSymbolHref } from '../utils/materialIconSprite'

interface MaterialIconProps {
  /** icon name without .svg, see utils/materialIcons */
  icon: string
  size?: number
  className?: string
}

export function MaterialIcon({ icon, size = 16, className }: MaterialIconProps) {
  useEffect(() => {
    ensureIconSprite()
  }, [])

  return (
    <svg
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
      onDragStart={e => e.preventDefault()}
    >
      <use href={iconSymbolHref(icon)} />
    </svg>
  )
}
