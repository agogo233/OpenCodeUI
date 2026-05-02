import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { defaultKeymap } from '@codemirror/commands'
import { EditorState, StateEffect, StateField, type Extension } from '@codemirror/state'
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  highlightSelectionMatches,
  openSearchPanel,
  search,
  searchKeymap,
  SearchQuery,
  selectMatches,
  setSearchQuery,
} from '@codemirror/search'
import {
  Decoration,
  EditorView,
  drawSelection,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  type DecorationSet,
  type Panel,
} from '@codemirror/view'
import { useSyntaxHighlightRef, type HighlightTokens } from '../hooks/useSyntaxHighlight'
import { themeStore } from '../store/themeStore'

/** codeFontScale 偏移 -> 代码行高 (px)。基准 24px，每 1px 字号偏移对应 2px 行高增量 */
function codeLineHeight(offset: number): number {
  return 24 + offset * 2
}

interface CodePreviewProps {
  code: string
  language: string
  maxHeight?: number
  isResizing?: boolean
  wordWrap?: boolean
}

export function CodePreview({ code, language, maxHeight, isResizing = false, wordWrap }: CodePreviewProps) {
  const { codeWordWrap, codeFontScale } = useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot)
  const resolvedWordWrap = wordWrap ?? codeWordWrap
  const lineHeight = codeLineHeight(codeFontScale)
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const { tokensRef, version } = useSyntaxHighlightRef(code, {
    lang: language,
    enabled: language !== 'text',
  })

  const extensions = useMemo(() => createCodePreviewExtensions(resolvedWordWrap, lineHeight), [resolvedWordWrap, lineHeight])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: code,
        extensions,
      }),
    })

    viewRef.current = view

    return () => {
      view.destroy()
      if (viewRef.current === view) viewRef.current = null
    }
  }, [code, extensions])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ effects: setShikiTokensEffect.of(tokensRef.current) })
  }, [tokensRef, version])

  const handleKeyDownCapture = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      const view = viewRef.current
      if (!view) return
      event.preventDefault()
      openSearchPanel(view)
    }
  }, [])

  return (
    <div
      className="h-full min-h-0 w-full overflow-hidden font-mono text-[length:var(--fs-code)]"
      data-resizing={isResizing ? 'true' : undefined}
      onKeyDownCapture={handleKeyDownCapture}
      style={maxHeight !== undefined ? { maxHeight } : undefined}
    >
      <div ref={hostRef} className="h-full min-h-0" />
    </div>
  )
}

function createCodePreviewExtensions(wordWrap: boolean, lineHeight: number): Extension[] {
  const extensions: Extension[] = [
    EditorState.readOnly.of(true),
    lineNumbers(),
    highlightActiveLineGutter(),
    drawSelection(),
    keymap.of([...searchKeymap, ...defaultKeymap]),
    search({ top: true, createPanel: createCodePreviewSearchPanel }),
    highlightSelectionMatches(),
    shikiDecorationsField,
    codePreviewTheme(lineHeight),
  ]

  if (wordWrap) extensions.push(EditorView.lineWrapping)

  return extensions
}

const setShikiTokensEffect = StateEffect.define<HighlightTokens | null>()

const shikiDecorationsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setShikiTokensEffect)) {
        return buildShikiDecorations(transaction.state, effect.value)
      }
    }
    return decorations.map(transaction.changes)
  },
  provide: field => EditorView.decorations.from(field),
})

function buildShikiDecorations(state: EditorState, tokens: HighlightTokens | null): DecorationSet {
  if (!tokens) return Decoration.none

  const ranges = []
  for (let lineIndex = 0; lineIndex < tokens.length && lineIndex < state.doc.lines; lineIndex++) {
    const line = state.doc.line(lineIndex + 1)
    let offset = 0

    for (const token of tokens[lineIndex] ?? []) {
      const from = line.from + offset
      const to = Math.min(from + token.content.length, line.to)
      offset += token.content.length
      if (!token.color || from >= to) continue
      ranges.push(Decoration.mark({ attributes: { style: `color: ${token.color}` } }).range(from, to))
    }
  }

  return Decoration.set(ranges, true)
}

function codePreviewTheme(lineHeight: number): Extension {
  return EditorView.theme({
    '&': {
      height: '100%',
      color: 'hsl(var(--text-100))',
      backgroundColor: 'transparent',
      fontSize: 'var(--fs-code)',
    },
    '.cm-editor': {
      height: '100%',
    },
    '.cm-scroller': {
      height: '100%',
      overflow: 'auto',
      fontFamily: 'var(--font-mono)',
      lineHeight: `${lineHeight}px`,
    },
    '.cm-content': {
      padding: '0',
      minHeight: '100%',
      caretColor: 'hsl(var(--accent-main-100))',
    },
    '.cm-cursor': {
      borderLeftColor: 'hsl(var(--accent-main-100))',
      borderLeftWidth: '2px',
    },
    '.cm-line': {
      padding: '0 1rem 0 0.75rem',
      minHeight: `${lineHeight}px`,
    },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      color: 'hsl(var(--text-500))',
      borderRight: '1px solid hsl(var(--border-100) / 0.35)',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      minWidth: '2rem',
      padding: '0 0.75rem 0 1rem',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'hsl(var(--accent-main-100) / 0.08)',
      color: 'hsl(var(--accent-main-100))',
    },
    '.cm-activeLine': {
      backgroundColor: 'transparent',
    },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
      backgroundColor: 'rgb(255 255 255 / 0.15)',
    },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
      backgroundColor: 'rgb(255 255 255 / 0.15)',
    },
    '&.cm-focused': {
      outline: 'none',
    },
    '.cm-searchMatch': {
      backgroundColor: 'hsl(var(--warning-100) / 0.22)',
      outline: '1px solid hsl(var(--warning-100) / 0.34)',
    },
    '.cm-searchMatch-selected': {
      backgroundColor: 'hsl(var(--warning-100) / 0.36)',
      outline: '1px solid hsl(var(--warning-100) / 0.58)',
    },
    '.cm-panels': {
      backgroundColor: 'hsl(var(--bg-100) / 0.96)',
      color: 'hsl(var(--text-200))',
      borderColor: 'hsl(var(--border-100) / 0.55)',
      fontFamily: 'inherit',
      backdropFilter: 'blur(10px)',
    },
    '.cm-panels-top': {
      borderBottom: '1px solid hsl(var(--border-100) / 0.55)',
    },
    '.cm-code-search': {
      display: 'flex',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: '0.5rem',
      padding: '0.5rem',
      fontSize: 'var(--fs-xs)',
      lineHeight: '1.4',
    },
    '.cm-code-search-inputWrap': {
      position: 'relative',
      minWidth: '13rem',
      flex: '1 1 16rem',
      maxWidth: '22rem',
    },
    '.cm-code-search-input': {
      width: '100%',
      height: '2rem',
      borderRadius: '0.5rem',
      border: '1px solid hsl(var(--border-200) / 0.65)',
      backgroundColor: 'hsl(var(--bg-000) / 0.82)',
      color: 'hsl(var(--text-100))',
      padding: '0 0.7rem',
      outline: 'none',
      font: 'inherit',
    },
    '.cm-code-search-input:focus': {
      borderColor: 'hsl(var(--accent-main-100) / 0.72)',
      boxShadow: '0 0 0 2px hsl(var(--accent-main-100) / 0.14)',
    },
    '.cm-code-search-nav, .cm-code-search-options': {
      display: 'inline-flex',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: '0.25rem',
      flex: '0 0 auto',
    },
    '.cm-code-search-options': {
      minWidth: 'min-content',
    },
    '.cm-code-search-button, .cm-code-search-toggle, .cm-code-search-iconButton': {
      appearance: 'none',
      WebkitAppearance: 'none',
      border: '1px solid hsl(var(--border-200) / 0.55)',
      backgroundColor: 'hsl(var(--bg-200) / 0.45)',
      color: 'hsl(var(--text-200))',
      borderRadius: '0.5rem',
      font: 'inherit',
      cursor: 'pointer',
      transition: 'background-color 120ms ease, color 120ms ease, border-color 120ms ease',
    },
    '.cm-code-search-button, .cm-code-search-toggle': {
      height: '1.8rem',
      padding: '0 0.6rem',
    },
    '.cm-code-search-iconButton': {
      marginLeft: 'auto',
      width: '1.8rem',
      minWidth: '1.8rem',
      height: '1.8rem',
      padding: '0',
      color: 'hsl(var(--text-400))',
    },
    '.cm-code-search-button:hover, .cm-code-search-toggle:hover, .cm-code-search-iconButton:hover': {
      backgroundColor: 'hsl(var(--bg-300) / 0.58)',
      color: 'hsl(var(--text-100))',
    },
    '.cm-code-search-toggle[aria-pressed="true"]': {
      borderColor: 'hsl(var(--accent-main-100) / 0.55)',
      backgroundColor: 'hsl(var(--accent-main-100) / 0.16)',
      color: 'hsl(var(--accent-main-100))',
    },
    '@media (max-width: 640px)': {
      '.cm-code-search-inputWrap': {
        maxWidth: 'none',
        flexBasis: 'calc(100% - 2.35rem)',
      },
    },
  })
}

function createCodePreviewSearchPanel(view: EditorView): Panel {
  const dom = document.createElement('div')
  dom.className = 'cm-code-search'

  const inputWrap = document.createElement('div')
  inputWrap.className = 'cm-code-search-inputWrap'

  const input = document.createElement('input')
  input.className = 'cm-code-search-input'
  input.type = 'search'
  input.placeholder = 'Find in code'
  input.setAttribute('main-field', 'true')
  input.setAttribute('aria-label', 'Find in code')
  input.spellcheck = false
  inputWrap.append(input)

  const nav = document.createElement('div')
  nav.className = 'cm-code-search-nav'

  const previousButton = createSearchButton('Previous', () => findPrevious(view))
  const nextButton = createSearchButton('Next', () => findNext(view))
  const allButton = createSearchButton('All', () => selectMatches(view))
  nav.append(previousButton, nextButton, allButton)

  const options = document.createElement('div')
  options.className = 'cm-code-search-options'

  const caseSensitive = createSearchToggle('Case')
  const regexp = createSearchToggle('Regex')
  const wholeWord = createSearchToggle('Word')
  options.append(caseSensitive.button, regexp.button, wholeWord.button)

  const closeButton = createSearchButton('×', () => {
    closeSearchPanel(view)
    view.focus()
  })
  closeButton.className = 'cm-code-search-iconButton'
  closeButton.title = 'Close search'
  closeButton.setAttribute('aria-label', 'Close search')

  dom.append(inputWrap, nav, options, closeButton)

  const syncFromState = () => {
    const query = getSearchQuery(view.state)
    if (document.activeElement !== input) input.value = query.search
    caseSensitive.setPressed(query.caseSensitive)
    regexp.setPressed(query.regexp)
    wholeWord.setPressed(query.wholeWord)
  }

  const applyQuery = () => {
    const current = getSearchQuery(view.state)
    view.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({
          search: input.value,
          caseSensitive: caseSensitive.pressed(),
          regexp: regexp.pressed(),
          wholeWord: wholeWord.pressed(),
          replace: current.replace,
          literal: current.literal,
        }),
      ),
    })
  }

  input.addEventListener('input', applyQuery)
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault()
      applyQuery()
      if (event.shiftKey) findPrevious(view)
      else findNext(view)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      closeSearchPanel(view)
      view.focus()
    }
  })

  for (const option of [caseSensitive, regexp, wholeWord]) {
    option.button.addEventListener('click', () => {
      option.setPressed(!option.pressed())
      applyQuery()
    })
  }

  syncFromState()

  return {
    dom,
    mount() {
      input.focus()
      input.select()
    },
    update() {
      syncFromState()
    },
    top: true,
  }
}

function createSearchButton(label: string, action: () => boolean | void): HTMLButtonElement {
  const button = document.createElement('button')
  button.className = 'cm-code-search-button'
  button.type = 'button'
  button.textContent = label
  button.addEventListener('mousedown', event => event.preventDefault())
  button.addEventListener('click', () => action())
  return button
}

function createSearchToggle(label: string) {
  const button = document.createElement('button')
  button.className = 'cm-code-search-toggle'
  button.type = 'button'
  button.textContent = label
  button.setAttribute('aria-pressed', 'false')

  return {
    button,
    pressed: () => button.getAttribute('aria-pressed') === 'true',
    setPressed: (pressed: boolean) => button.setAttribute('aria-pressed', pressed ? 'true' : 'false'),
  }
}
