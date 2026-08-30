import { describe, expect, it } from 'vitest'
import type { ComponentVisual } from '@/core/model'
import { CANVAS_THEMES, canvasTheme, componentColors, generateHarmoniousPalette, isDesignTheme, isFiveColorPalette, PALETTE_THEMES, themeVariables, type FiveColors } from './design-theme'

const visual: ComponentVisual = {
  fill: '#173b50',
  border: '#526076',
  text: '#eef2fa',
  shape: 'and-gate',
  width: 112,
  height: 78,
}

describe('design themes', () => {
  it('accepts Studio, My Palette, and the five supported persisted palettes', () => {
    expect(isDesignTheme('studio')).toBe(true)
    expect(isDesignTheme('custom')).toBe(true)
    expect(PALETTE_THEMES).toHaveLength(5)
    PALETTE_THEMES.forEach(theme => expect(isDesignTheme(theme.id)).toBe(true))
    expect(isDesignTheme('friendly')).toBe(false)
    expect(isDesignTheme('light')).toBe(false)
    expect(isDesignTheme(null)).toBe(false)
  })

  it('stores the three requested five-color sets exactly', () => {
    expect(PALETTE_THEMES[0].colors).toEqual(['#283044', '#78A1BB', '#EBF5EE', '#BFA89E', '#8B786D'])
    expect(PALETTE_THEMES[1].colors).toEqual(['#0D1B2A', '#1B263B', '#415A77', '#778DA9', '#E0E1DD'])
    expect(PALETTE_THEMES[2].colors).toEqual(['#815E5B', '#685155', '#7A6F9B', '#8B85C1', '#D4CDF4'])
    PALETTE_THEMES.forEach(theme => expect(new Set(theme.colors).size).toBe(5))
  })

  it('keeps Studio colors exact and derives palette-colored components', () => {
    expect(componentColors(visual, 'studio')).toEqual({ fill: visual.fill, border: visual.border, text: visual.text })
    PALETTE_THEMES.forEach(theme => {
      expect(componentColors(visual, theme.id).fill).not.toBe(visual.fill)
      expect(CANVAS_THEMES[theme.id].background).not.toBe(CANVAS_THEMES.studio.background)
      expect(themeVariables(theme.id)['--accent']).toBe(theme.ui.accent)
    })
  })

  it('generates a completely new valid five-color combination', () => {
    const generated = generateHarmoniousPalette(() => .42)
    expect(isFiveColorPalette(generated)).toBe(true)
    expect(new Set(generated).size).toBe(5)
    expect(PALETTE_THEMES.some(theme => theme.colors.every((color, index) => color === generated[index]))).toBe(false)
  })

  it('supports editable custom colors and keeps even a dark set on a light canvas', () => {
    const darkColors: FiveColors = ['#050709', '#101820', '#18222C', '#202D39', '#293744']
    expect(themeVariables('custom', darkColors)['--chrome']).toMatch(/^#[\da-f]{6}$/i)
    expect(componentColors(visual, 'custom', darkColors).fill).not.toBe(visual.fill)
    const background = canvasTheme('custom', darkColors).background.match(/[\da-f]{2}/gi)!.map(value => Number.parseInt(value, 16))
    expect(Math.min(...background)).toBeGreaterThan(190)
  })
})
