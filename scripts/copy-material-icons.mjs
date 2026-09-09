/**
 * Build a single SVG sprite (public/material-icons/sprite.svg) from the
 * material-icon-theme SVGs that are actually referenced by
 * src/utils/materialIcons.ts.
 *
 * Runs automatically via postinstall hook.
 */

import { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const srcDir = resolve(root, 'node_modules/material-icon-theme/icons')
const destDir = resolve(root, 'public/material-icons')
const spritePath = resolve(destDir, 'sprite.svg')

if (!existsSync(srcDir)) {
  console.warn('[build-material-icons] Source not found, skipping:', srcDir)
  process.exit(0)
}

// Parse materialIcons.ts to extract every icon name referenced
const tsSource = readFileSync(resolve(root, 'src/utils/materialIcons.ts'), 'utf-8')

const icons = new Set()

// Icon values after colon: 'icon-name'
for (const m of tsSource.matchAll(/:\s*'([a-z0-9_-]+)'/g)) {
  icons.add(m[1])
}
// Array items [ext, icon]
for (const m of tsSource.matchAll(/\[\s*'[^']+'\s*,\s*'([a-z0-9_-]+)'\s*\]/g)) {
  icons.add(m[1])
}
// Defaults
icons.add('file')
icons.add('folder')
icons.add('folder-open')

// Folder icons need both base and -open variants
for (const icon of [...icons]) {
  if (icon.startsWith('folder-') && !icon.endsWith('-open')) {
    icons.add(icon + '-open')
  }
}

/**
 * Convert a standalone SVG into a <symbol>, namespacing internal ids
 * (gradients, defs, use refs) so multiple icons can coexist in one document.
 */
function toSymbol(name, svgMarkup) {
  const viewBox = /viewBox="([^"]+)"/.exec(svgMarkup)?.[1] ?? '0 0 16 16'
  let inner = svgMarkup.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')

  const ids = [...inner.matchAll(/id="([^"]+)"/g)].map(m => m[1])
  for (const id of new Set(ids)) {
    const prefixed = `mi-${name}__${id}`
    inner = inner
      .replaceAll(`id="${id}"`, `id="${prefixed}"`)
      .replaceAll(`url(#${id})`, `url(#${prefixed})`)
      .replaceAll(`href="#${id}"`, `href="#${prefixed}"`)
  }

  return `<symbol id="mi-${name}" viewBox="${viewBox}">${inner}</symbol>`
}

// Clean destination and (re)build the sprite
if (existsSync(destDir)) {
  rmSync(destDir, { recursive: true })
}
mkdirSync(destDir, { recursive: true })

const symbols = []
let missing = 0
for (const icon of [...icons].sort()) {
  const srcPath = resolve(srcDir, icon + '.svg')
  if (existsSync(srcPath)) {
    symbols.push(toSymbol(icon, readFileSync(srcPath, 'utf-8')))
  } else {
    console.warn(`  [WARN] Missing: ${icon}.svg`)
    missing++
  }
}

const sprite =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">' +
  symbols.join('') +
  '</svg>\n'

// Guard: every id/local reference must be namespaced, otherwise gradients
// would silently leak across symbols in the shared document.
const leaks = [...sprite.matchAll(/(?:id="|url\(#|href="#)(?!mi-)([^"&#)]+)/g)].map(m => m[1])
if (leaks.length) {
  console.error('[build-material-icons] Un-namespaced id refs:', [...new Set(leaks)].join(', '))
  process.exit(1)
}

writeFileSync(spritePath, sprite)

console.log(
  `[build-material-icons] Built sprite with ${symbols.length} icons -> public/material-icons/sprite.svg` +
    (missing ? ` (${missing} missing)` : ''),
)
