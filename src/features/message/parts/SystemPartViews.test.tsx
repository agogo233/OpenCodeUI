import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PatchPartView, RetryPartView } from './SystemPartViews'

describe('SystemPartViews', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => window.setTimeout(() => cb(performance.now()), 16))
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
      clearTimeout(id)
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('toggles retry details with a semantic button', () => {
    render(
      <RetryPartView
        part={{
          attempt: 2,
          error: { data: { message: 'network timeout', isRetryable: true, statusCode: 504 } },
          time: { created: Date.now() },
        } as any}
      />,
    )

    const toggle = screen.getByRole('button', { name: /Retry attempt 2/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(toggle)
    act(() => {
      vi.advanceTimersByTime(16)
    })

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('network timeout')).toBeInTheDocument()
  })

  it('toggles patch details with a semantic button', () => {
    render(
      <PatchPartView
        part={{
          hash: 'abcdef123456',
          files: ['src/app.tsx', 'src/store/messageStore.ts'],
        } as any}
      />,
    )

    const toggle = screen.getByRole('button', { name: /2 files changed/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(toggle)
    act(() => {
      vi.advanceTimersByTime(16)
    })

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('src/app.tsx')).toBeInTheDocument()
  })
})
