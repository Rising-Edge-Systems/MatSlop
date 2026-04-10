/**
 * Plot-export warning helpers (US-013).
 *
 * When Octave's `matslop_export_fig(h)` fails to serialize a figure — either
 * because it throws inside Octave (unsupported handle, out-of-memory, etc.),
 * because the JSON it emits is malformed, or because the parsed figure
 * contains series types the live-script renderer doesn't yet support — we
 * want the UI to (a) degrade to the static PNG snapshot and (b) show a
 * human-readable warning banner above the plot that explains WHY the
 * interactive renderer isn't being used, and link to a help doc.
 *
 * This module is intentionally pure (no React, no DOM, no main-process
 * imports beyond the `PlotFigure` type) so it can be covered by vitest unit
 * tests without pulling the Electron runtime.
 */
import type { PlotFigure } from '../../main/plotSchema'

/**
 * Help URL shown in the warning banner. Points at docs/plot-export.md in the
 * repo so users can see the list of currently supported plot types.
 */
export const PLOT_EXPORT_HELP_URL =
  'https://github.com/matslop/matslop/blob/main/docs/plot-export.md'

export interface PlotWarning {
  /** Human-readable message to show in the warning banner. */
  message: string
  /**
   * When true the interactive Plotly renderer can't show the figure at all
   * and the UI must fall back to the static PNG snapshot. When false the
   * interactive renderer still works but some series were unsupported and
   * rendered as blank traces — we show the banner as an advisory.
   */
  fatal: boolean
  /**
   * List of unique Octave tags the renderer couldn't handle (e.g. 'patch',
   * 'histogram'). Only populated when `fatal === false`.
   */
  unsupportedTypes?: string[]
}

export interface BuildPlotWarningInput {
  /** Error message emitted from Octave when `matslop_export_fig(h)` threw. */
  octaveError?: string | null
  /** Error thrown by `parsePlotFigure` while decoding the JSON payload. */
  parseError?: string | null
  /** Parsed figure, or null if parsing failed / JSON was not provided. */
  figure?: PlotFigure | null
}

/**
 * Walk a parsed figure and collect the set of unique unknown Octave tags.
 * Returns an empty array when every series is a supported type.
 */
export function findUnsupportedSeries(figure: PlotFigure): string[] {
  const seen = new Set<string>()
  for (const ax of figure.axes) {
    for (const s of ax.series) {
      if (s.type === 'unknown') {
        seen.add(s.octaveType && s.octaveType.length > 0 ? s.octaveType : 'unknown')
      }
    }
  }
  return [...seen]
}

/**
 * Build a warning descriptor for a single figure, given whatever signals we
 * have from the export pipeline. Returns `null` when there's nothing to warn
 * about (the common happy path).
 *
 * Priority, highest first:
 *   1. Octave threw inside matslop_export_fig → fatal warning, fall back to PNG.
 *   2. The JSON was unparseable → fatal warning, fall back to PNG.
 *   3. The parsed figure contained `unknown` series → non-fatal advisory,
 *      still render with Plotly.
 */
export function buildPlotWarning(input: BuildPlotWarningInput): PlotWarning | null {
  const { octaveError, parseError, figure } = input

  if (octaveError && octaveError.trim().length > 0) {
    return {
      message:
        `Octave could not serialize this figure for the interactive renderer ` +
        `(${octaveError.trim()}). Showing a static PNG snapshot instead.`,
      fatal: true,
    }
  }

  if (parseError && parseError.trim().length > 0) {
    return {
      message:
        `The exported figure data was malformed and could not be parsed ` +
        `(${parseError.trim()}). Showing a static PNG snapshot instead.`,
      fatal: true,
    }
  }

  if (figure) {
    const unsupported = findUnsupportedSeries(figure)
    if (unsupported.length > 0) {
      const list = unsupported.join(', ')
      const plural = unsupported.length > 1 ? 's' : ''
      return {
        message:
          `Unsupported plot type${plural} (${list}) in this figure — the ` +
          `interactive renderer rendered what it could; see the help doc ` +
          `for the current list of supported plot types.`,
        fatal: false,
        unsupportedTypes: unsupported,
      }
    }
  }

  return null
}
