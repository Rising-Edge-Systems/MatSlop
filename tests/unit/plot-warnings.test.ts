import { describe, it, expect } from 'vitest'
import {
  buildPlotWarning,
  findUnsupportedSeries,
  PLOT_EXPORT_HELP_URL,
} from '../../src/renderer/editor/plotWarnings'
import type { PlotFigure } from '../../src/main/plotSchema'

/**
 * US-013 — Handle plot export failures gracefully.
 *
 * These tests pin the behavior of the pure warning-builder that the
 * LiveScriptEditor's InlinePlots component uses to decide whether (and how)
 * to show a warning banner above a figure that Octave couldn't perfectly
 * export to the interactive Plotly renderer.
 */

function figureWith(seriesTypes: string[]): PlotFigure {
  return {
    schemaVersion: 1,
    handle: 1,
    axes: [
      {
        series: seriesTypes.map((t) =>
          t === 'unknown' || t === 'patch' || t === 'histogram'
            ? { type: 'unknown', octaveType: t }
            : // Minimal stub for a 'line' series — enough for the helper.
              ({ type: 'line', x: [0, 1], y: [0, 1] } as any),
        ),
      },
    ],
  }
}

describe('buildPlotWarning', () => {
  it('returns null when everything exported cleanly', () => {
    const fig = figureWith(['line'])
    expect(buildPlotWarning({ figure: fig })).toBeNull()
  })

  it('returns null when no signals are provided', () => {
    expect(buildPlotWarning({})).toBeNull()
  })

  it('returns a fatal warning when Octave reports an export error', () => {
    const w = buildPlotWarning({ octaveError: 'unsupported handle type: patch' })
    expect(w).not.toBeNull()
    expect(w!.fatal).toBe(true)
    expect(w!.message).toContain('unsupported handle type: patch')
    expect(w!.message.toLowerCase()).toContain('static png')
  })

  it('ignores a blank octaveError string', () => {
    expect(buildPlotWarning({ octaveError: '   ' })).toBeNull()
  })

  it('returns a fatal warning when JSON parsing failed', () => {
    const w = buildPlotWarning({ parseError: 'Unexpected token in JSON' })
    expect(w).not.toBeNull()
    expect(w!.fatal).toBe(true)
    expect(w!.message).toContain('Unexpected token in JSON')
  })

  it('prioritises Octave errors over parse errors', () => {
    const w = buildPlotWarning({
      octaveError: 'serialize failed',
      parseError: 'json bad',
    })
    expect(w!.message).toContain('serialize failed')
    expect(w!.message).not.toContain('json bad')
  })

  it('returns a non-fatal advisory when the figure has unknown series', () => {
    const fig = figureWith(['line', 'patch'])
    const w = buildPlotWarning({ figure: fig })
    expect(w).not.toBeNull()
    expect(w!.fatal).toBe(false)
    expect(w!.unsupportedTypes).toEqual(['patch'])
    expect(w!.message).toContain('patch')
  })

  it('deduplicates unknown series types and pluralizes the message', () => {
    const fig = figureWith(['patch', 'patch', 'histogram'])
    const w = buildPlotWarning({ figure: fig })
    expect(w!.unsupportedTypes).toEqual(['patch', 'histogram'])
    expect(w!.message).toContain('patch')
    expect(w!.message).toContain('histogram')
    // Plural "types" when more than one
    expect(w!.message).toContain('types')
  })

  it('findUnsupportedSeries returns empty array for a clean figure', () => {
    expect(findUnsupportedSeries(figureWith(['line']))).toEqual([])
  })

  it('exposes a help URL pointing at the repo docs', () => {
    expect(PLOT_EXPORT_HELP_URL).toMatch(/^https?:\/\//)
  })
})
