import { describe, expect, it } from 'vitest'
import { createAdaptiveShikiTheme } from './shiki'

describe('createAdaptiveShikiTheme', () => {
  it('creates a custom dark Shiki theme with project syntax groups', () => {
    const theme = createAdaptiveShikiTheme(true)

    expect(theme.name).toBe('OpenCodeUI Dark')
    expect(theme.type).toBe('dark')
    expect(theme.colors?.['editor.foreground']).toBeTruthy()
    expect(theme.tokenColors?.some(rule => includesScope(rule.scope, 'support.type.property-name.json'))).toBe(true)
    expect(theme.tokenColors?.some(rule => includesScope(rule.scope, 'entity.name.function'))).toBe(true)
    expect(theme.tokenColors?.some(rule => includesScope(rule.scope, 'markup.heading'))).toBe(true)
  })

  it('creates a custom light Shiki theme', () => {
    const theme = createAdaptiveShikiTheme(false)

    expect(theme.name).toBe('OpenCodeUI Light')
    expect(theme.type).toBe('light')
    expect(theme.tokenColors?.length).toBeGreaterThan(10)
  })
})

function includesScope(scope: string | string[] | undefined, expected: string) {
  return Array.isArray(scope) ? scope.includes(expected) : scope === expected
}
