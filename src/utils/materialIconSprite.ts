// One-shot loader for the material-icons SVG sprite (public/material-icons/sprite.svg).
// Injected inline (instead of external <use> references) for broad compatibility.

let loadingPromise: Promise<void> | null = null

export function ensureIconSprite(): Promise<void> {
  if (loadingPromise) return loadingPromise
  loadingPromise = fetch(`${import.meta.env.BASE_URL}material-icons/sprite.svg`)
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.text()
    })
    .then(text => {
      const holder = document.createElement('div')
      holder.setAttribute('aria-hidden', 'true')
      holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden'
      holder.innerHTML = text
      document.body.prepend(holder)
    })
    .catch(err => {
      loadingPromise = null
      console.warn('[material-icons] Failed to load icon sprite:', err)
    })
  return loadingPromise
}

export function iconSymbolHref(icon: string): string {
  return `#mi-${icon}`
}
