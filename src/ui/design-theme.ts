import type { ComponentVisual } from '@/core/model'

export type PaletteTheme = 'misty-cocoa' | 'deep-navy' | 'lilac-candy' | 'garden-picnic' | 'sunset-sorbet'
export type ColorTheme = PaletteTheme | 'custom'
export type DesignTheme = 'studio' | ColorTheme
export type FiveColors = readonly [string, string, string, string, string]

interface ThemeUiColors {
  bg: string
  panel: string
  panel2: string
  panel3: string
  line: string
  lineSoft: string
  text: string
  muted: string
  muted2: string
  accent: string
  accentDark: string
  blue: string
  danger: string
  warning: string
}

interface ResolvedPalette {
  id: ColorTheme
  label: string
  description: string
  colors: FiveColors
  componentTones: readonly [string, string, string]
  ui: ThemeUiColors
}

export interface PalettePreset extends ResolvedPalette {
  id: PaletteTheme
}

export const DEFAULT_CUSTOM_COLORS: FiveColors = ['#294C60', '#4D8B8A', '#F1F7ED', '#E6B89C', '#C66B5A']

export const PALETTE_THEMES: PalettePreset[] = [
  {
    id: 'misty-cocoa', label: 'Misty Cocoa', description: 'くすみブルーとココアのやさしい配色',
    colors: ['#283044', '#78A1BB', '#EBF5EE', '#BFA89E', '#8B786D'],
    componentTones: ['#78A1BB', '#BFA89E', '#8B786D'],
    ui: { bg: '#EBF5EE', panel: '#F9FBFA', panel2: '#E3ECE8', panel3: '#D7E2DF', line: '#C5D2D0', lineSoft: '#DFE8E4', text: '#283044', muted: '#6D7380', muted2: '#8B786D', accent: '#668FA9', accentDark: '#D8E8EC', blue: '#527E9A', danger: '#A85F68', warning: '#9A713E' },
  },
  {
    id: 'deep-navy', label: 'Deep Navy', description: '静かなネイビーとスレートの大人配色',
    colors: ['#0D1B2A', '#1B263B', '#415A77', '#778DA9', '#E0E1DD'],
    componentTones: ['#1B263B', '#415A77', '#778DA9'],
    ui: { bg: '#E0E1DD', panel: '#F7F8F5', panel2: '#D9DEE0', panel3: '#CBD3D9', line: '#B8C3CC', lineSoft: '#D5DADC', text: '#0D1B2A', muted: '#415A77', muted2: '#778DA9', accent: '#415A77', accentDark: '#CAD5DF', blue: '#344D6A', danger: '#A84E5A', warning: '#8E6828' },
  },
  {
    id: 'lilac-candy', label: 'Lilac Candy', description: 'ミルキーな藤色とモーヴのかわいい配色',
    colors: ['#815E5B', '#685155', '#7A6F9B', '#8B85C1', '#D4CDF4'],
    componentTones: ['#815E5B', '#7A6F9B', '#8B85C1'],
    ui: { bg: '#D4CDF4', panel: '#FAF8FF', panel2: '#E9E4F8', panel3: '#DED8EF', line: '#C5BBDE', lineSoft: '#E5DFF3', text: '#554247', muted: '#716783', muted2: '#815E5B', accent: '#7A6F9B', accentDark: '#E2DDF5', blue: '#736CAC', danger: '#A25769', warning: '#96703F' },
  },
  {
    id: 'garden-picnic', label: 'Garden Picnic', description: 'ハーブと柑橘を合わせた元気な配色',
    colors: ['#264653', '#2A9D8F', '#E9F5DB', '#F4A261', '#E76F51'],
    componentTones: ['#2A9D8F', '#F4A261', '#E76F51'],
    ui: { bg: '#E9F5DB', panel: '#FBFDF7', panel2: '#E3EFD7', panel3: '#D5E5CE', line: '#BFD2C0', lineSoft: '#DDE9D5', text: '#264653', muted: '#55716F', muted2: '#788C7C', accent: '#2A9D8F', accentDark: '#D3EEE7', blue: '#357F91', danger: '#D65F48', warning: '#C77D35' },
  },
  {
    id: 'sunset-sorbet', label: 'Sunset Sorbet', description: 'セージとアプリコットの温かな配色',
    colors: ['#3D405B', '#81B29A', '#F4F1DE', '#F2CC8F', '#E07A5F'],
    componentTones: ['#81B29A', '#F2CC8F', '#E07A5F'],
    ui: { bg: '#F4F1DE', panel: '#FFFDF5', panel2: '#F6EFD9', panel3: '#EDE4CB', line: '#D9CCB5', lineSoft: '#ECE4D2', text: '#3D405B', muted: '#68776F', muted2: '#958775', accent: '#679C83', accentDark: '#DDECE4', blue: '#557C93', danger: '#C96555', warning: '#B88742' },
  },
]

export const DESIGN_THEMES: Array<{ id: DesignTheme; label: string; description: string }> = [
  { id: 'studio', label: 'Studio', description: '落ち着いたフラットダーク' },
  ...PALETTE_THEMES,
  { id: 'custom', label: 'My Palette', description: '生成・編集できる自分だけの5色' },
]

export function isPaletteTheme(value: unknown): value is PaletteTheme {
  return PALETTE_THEMES.some(theme => theme.id === value)
}

export function isColorTheme(value: unknown): value is ColorTheme {
  return value === 'custom' || isPaletteTheme(value)
}

export function isDesignTheme(value: unknown): value is DesignTheme {
  return value === 'studio' || isColorTheme(value)
}

export function isFiveColorPalette(value: unknown): value is FiveColors {
  return Array.isArray(value) && value.length === 5 && value.every(color => typeof color === 'string' && /^#[\da-f]{6}$/i.test(color))
}

export function palettePreset(theme: PaletteTheme): PalettePreset {
  return PALETTE_THEMES.find(item => item.id === theme)!
}

function parseHex(value: string): number[] | null {
  return value.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i)?.slice(1).map(part => Number.parseInt(part, 16)) ?? null
}

function mixHex(first: string, second: string, amount: number): string {
  const from = parseHex(first); const to = parseHex(second)
  if (!from || !to) return first
  const ratio = Math.max(0, Math.min(1, amount))
  return `#${from.map((channel, index) => Math.round(channel + (to[index] - channel) * ratio).toString(16).padStart(2, '0')).join('')}`
}

function rgba(color: string, alpha: number): string {
  const values = parseHex(color)
  return values ? `rgba(${values.join(',')},${alpha})` : color
}

function brightness(color: string): number {
  const values = parseHex(color)
  return values ? values[0] * .299 + values[1] * .587 + values[2] * .114 : 255
}

function customPalette(colors: FiveColors): ResolvedPalette {
  const ordered = [...colors].sort((first, second) => brightness(first) - brightness(second))
  const darkest = ordered[0]
  const lightest = ordered.at(-1)!
  const text = brightness(darkest) > 135 ? mixHex(darkest, '#000000', .68) : darkest
  const rawAccent = colors[1]
  const accent = brightness(rawAccent) > 185 ? mixHex(rawAccent, text, .35) : rawAccent
  const panel = mixHex(lightest, '#FFFFFF', .76)
  const panel2 = mixHex(colors[2], '#FFFFFF', .72)
  const panel3 = mixHex(colors[3], '#FFFFFF', .64)
  const line = mixHex(colors[4], text, .32)
  const muted = mixHex(text, lightest, .44)
  return {
    id: 'custom', label: 'My Palette', description: '生成・編集できる自分だけの5色', colors,
    componentTones: [colors[1], colors[3], colors[4]],
    ui: {
      bg: mixHex(colors[4], '#FFFFFF', .74), panel, panel2, panel3,
      line: mixHex(line, '#FFFFFF', .42), lineSoft: mixHex(line, '#FFFFFF', .7),
      text, muted, muted2: mixHex(muted, lightest, .36), accent,
      accentDark: mixHex(accent, '#FFFFFF', .78), blue: mixHex(colors[1], '#245B88', .34),
      danger: '#B84F5C', warning: '#9B6B24',
    },
  }
}

export function resolvedPalette(theme: ColorTheme, customColors: FiveColors = DEFAULT_CUSTOM_COLORS): ResolvedPalette {
  return theme === 'custom' ? customPalette(customColors) : palettePreset(theme)
}

export function themeVariables(theme: DesignTheme, customColors: FiveColors = DEFAULT_CUSTOM_COLORS): Record<string, string> {
  if (theme === 'studio') return {}
  const palette = resolvedPalette(theme, customColors)
  const { ui, colors } = palette
  return {
    '--bg': ui.bg, '--panel': ui.panel, '--panel-2': ui.panel2, '--panel-3': ui.panel3,
    '--line': ui.line, '--line-soft': ui.lineSoft, '--text': ui.text, '--muted': ui.muted,
    '--muted-2': ui.muted2, '--accent': ui.accent, '--accent-dark': ui.accentDark,
    '--blue': ui.blue, '--danger': ui.danger, '--warning': ui.warning,
    '--chrome': mixHex(ui.panel, colors[1], .18),
    '--chrome-alt': mixHex(ui.panel, colors[3], .25),
    '--chrome-strong': mixHex(ui.panel, colors[4], .2),
  }
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const h = ((hue % 360) + 360) % 360
  const s = Math.max(0, Math.min(100, saturation)) / 100
  const l = Math.max(0, Math.min(100, lightness)) / 100
  const chroma = (1 - Math.abs(2 * l - 1)) * s
  const sector = h / 60
  const x = chroma * (1 - Math.abs((sector % 2) - 1))
  const [red, green, blue] = sector < 1 ? [chroma, x, 0] : sector < 2 ? [x, chroma, 0] : sector < 3 ? [0, chroma, x] : sector < 4 ? [0, x, chroma] : sector < 5 ? [x, 0, chroma] : [chroma, 0, x]
  const match = l - chroma / 2
  return `#${[red, green, blue].map(channel => Math.round((channel + match) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`
}

export function generateHarmoniousPalette(random = Math.random): FiveColors {
  const next = () => Math.max(0, Math.min(.999999, random()))
  const baseHue = next() * 360
  const harmonies = [
    [0, 24, 176, 202, 326],
    [0, 36, 152, 188, 218],
    [0, 58, 118, 180, 238],
    [0, 28, 142, 208, 326],
  ]
  const offsets = harmonies[Math.floor(next() * harmonies.length)]
  const saturation = 46 + next() * 24
  return [
    hslToHex(baseHue + offsets[0], saturation - 12, 22),
    hslToHex(baseHue + offsets[1], saturation, 46),
    hslToHex(baseHue + offsets[2], saturation - 22, 92),
    hslToHex(baseHue + offsets[3], saturation - 7, 70),
    hslToHex(baseHue + offsets[4], saturation - 13, 54),
  ]
}

export interface CanvasThemePalette {
  background: string
  gridMinor: string
  gridMajor: string
  signalIdle: string
  signalUnknown: string
  signalFloating: string
  signalHigh: string
  signalLow: string
  error: string
  errorText: string
  selected: string
  selectedGlow: string
  wireLabel: string
  wireLabelText: string
  openWire: string
  openWireText: string
  portOutline: string
  portLabel: string
  pendingWire: string
  inversion: string
  previewPanel: string
  previewBorder: string
  previewMuted: string
  previewValue: string
  input: string
  output: string
  inout: string
  separator: string
  componentMuted: string
  controlOff: string
  controlOn: string
  controlOffBorder: string
  controlOnBorder: string
  controlOffText: string
  controlOnText: string
}

const studioCanvas: CanvasThemePalette = {
  background: '#0b1119', gridMinor: '#172332', gridMajor: '#1d2d3d',
  signalIdle: '#58667a', signalUnknown: '#ff4fa3', signalFloating: '#e5a94a', signalHigh: '#4ee6a8', signalLow: '#718198',
  error: '#f15764', errorText: '#ff8992', selected: '#5ee7b0', selectedGlow: 'rgba(78,230,168,.5)',
  wireLabel: '#0b0e14', wireLabelText: '#aeb9c9', openWire: '#FFB454', openWireText: '#2B1A00', portOutline: '#d3dbe7', portLabel: '#c5cfdd', pendingWire: '#5ee7b0', inversion: '#0b1119',
  previewPanel: 'rgba(5,9,14,.78)', previewBorder: 'rgba(128,158,186,.22)', previewMuted: '#8c9aab', previewValue: '#75ecc0',
  input: '#70b7ff', output: '#65e8b3', inout: '#f1bd6d', separator: 'rgba(128,150,174,.14)', componentMuted: '#8d9caf',
  controlOff: 'rgba(9,14,21,.82)', controlOn: 'rgba(35,92,74,.94)', controlOffBorder: 'rgba(122,139,161,.4)', controlOnBorder: 'rgba(92,238,183,.7)', controlOffText: '#758498', controlOnText: '#8ef2c9',
}

function paletteCanvas(preset: ResolvedPalette): CanvasThemePalette {
  const [dark, accent, , warm, neutral] = preset.colors
  const { ui } = preset
  const lightest = [...preset.colors].sort((first, second) => brightness(second) - brightness(first))[0]
  const canvasBackground = mixHex(lightest, '#FFFFFF', .82)
  return {
    background: canvasBackground,
    gridMinor: mixHex(canvasBackground, ui.text, .075), gridMajor: mixHex(canvasBackground, ui.text, .15),
    signalIdle: ui.muted2, signalUnknown: ui.danger, signalFloating: ui.warning, signalHigh: ui.accent, signalLow: ui.muted,
    error: ui.danger, errorText: mixHex(ui.danger, dark, .22), selected: ui.accent, selectedGlow: rgba(ui.accent, .2),
    wireLabel: mixHex(canvasBackground, '#FFFFFF', .7), wireLabelText: ui.text, openWire: ui.warning, openWireText: brightness(ui.warning) > 155 ? ui.text : '#FFFFFF', portOutline: mixHex(ui.text, '#FFFFFF', .45), portLabel: ui.text, pendingWire: ui.accent, inversion: canvasBackground,
    previewPanel: rgba(ui.panel, .94), previewBorder: rgba(ui.muted, .34), previewMuted: ui.muted, previewValue: ui.accent,
    input: accent, output: ui.accent, inout: warm, separator: rgba(ui.muted, .2), componentMuted: neutral,
    controlOff: rgba(ui.panel, .94), controlOn: rgba(ui.accentDark, .98), controlOffBorder: rgba(ui.muted, .42), controlOnBorder: rgba(ui.accent, .64), controlOffText: ui.muted, controlOnText: ui.accent,
  }
}

export const CANVAS_THEMES: Record<'studio' | PaletteTheme, CanvasThemePalette> = {
  studio: studioCanvas,
  ...Object.fromEntries(PALETTE_THEMES.map(theme => [theme.id, paletteCanvas(theme)])),
} as Record<'studio' | PaletteTheme, CanvasThemePalette>

export function canvasTheme(theme: DesignTheme, customColors: FiveColors = DEFAULT_CUSTOM_COLORS): CanvasThemePalette {
  return theme === 'custom' ? paletteCanvas(customPalette(customColors)) : CANVAS_THEMES[theme]
}

export function componentColors(visual: ComponentVisual, theme: DesignTheme, customColors: FiveColors = DEFAULT_CUSTOM_COLORS) {
  if (theme === 'studio') return { fill: visual.fill, border: visual.border, text: visual.text }
  const preset = resolvedPalette(theme, customColors)
  const toneIndex = Number.parseInt(visual.fill.replace('#', ''), 16) % preset.componentTones.length
  const tone = preset.componentTones[toneIndex]
  const fill = mixHex(tone, preset.ui.panel, .32)
  return {
    fill,
    border: mixHex(tone, preset.ui.text, .3),
    text: brightness(fill) < 138 ? mixHex(preset.ui.panel, '#FFFFFF', .25) : preset.ui.text,
  }
}
