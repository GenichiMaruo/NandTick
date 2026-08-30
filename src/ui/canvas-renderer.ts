import { getInstancePorts } from '@/core/graph'
import type { ComponentDefinition, ComponentInstance, ComponentShape, ComponentVisual, Point } from '@/core/model'
import type { Simulator } from '@/core/simulator'
import { getPreviewMode } from '@/core/visual'
import { canvasTheme, componentColors, type CanvasThemePalette, type DesignTheme, type FiveColors } from './design-theme'

export const PICO_PALETTE = [
  '#000000', '#1D2B53', '#7E2553', '#008751', '#AB5236', '#5F574F', '#C2C3C7', '#FFF1E8',
  '#FF004D', '#FFA300', '#FFEC27', '#00E436', '#29ADFF', '#83769C', '#FF77A8', '#FFCCAA',
]

export function componentPath(context: CanvasRenderingContext2D, shape: ComponentShape, x: number, y: number, width: number, height: number): void {
  context.beginPath()
  if (shape === 'ellipse') context.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2)
  else if (shape === 'pill') context.roundRect(x, y, width, height, height / 2)
  else if (shape === 'trapezoid') { context.moveTo(x + 16, y); context.lineTo(x + width - 12, y); context.lineTo(x + width, y + height / 2); context.lineTo(x + width - 12, y + height); context.lineTo(x + 16, y + height); context.closePath() }
  else if (shape === 'polygon') { context.moveTo(x + width / 2, y); context.lineTo(x + width, y + height * 0.3); context.lineTo(x + width * 0.82, y + height); context.lineTo(x + width * 0.18, y + height); context.lineTo(x, y + height * 0.3); context.closePath() }
  else if (shape === 'diamond') { context.moveTo(x + width / 2, y); context.lineTo(x + width, y + height / 2); context.lineTo(x + width / 2, y + height); context.lineTo(x, y + height / 2); context.closePath() }
  else if (shape === 'hexagon') { const cut = Math.min(18, width * 0.16); context.moveTo(x + cut, y); context.lineTo(x + width - cut, y); context.lineTo(x + width, y + height / 2); context.lineTo(x + width - cut, y + height); context.lineTo(x + cut, y + height); context.lineTo(x, y + height / 2); context.closePath() }
  else if (shape === 'triangle') { context.moveTo(x + 7, y + 4); context.lineTo(x + width - 7, y + height / 2); context.lineTo(x + 7, y + height - 4); context.closePath() }
  else if (shape === 'and-gate') {
    context.moveTo(x, y); context.lineTo(x + width * 0.48, y)
    context.bezierCurveTo(x + width * 0.83, y, x + width, y + height * 0.22, x + width, y + height / 2)
    context.bezierCurveTo(x + width, y + height * 0.78, x + width * 0.83, y + height, x + width * 0.48, y + height)
    context.lineTo(x, y + height); context.closePath()
  } else if (shape === 'or-gate' || shape === 'xor-gate') {
    context.moveTo(x + 4, y)
    context.bezierCurveTo(x + width * 0.48, y + 2, x + width * 0.78, y + height * 0.13, x + width, y + height / 2)
    context.bezierCurveTo(x + width * 0.78, y + height * 0.87, x + width * 0.48, y + height - 2, x + 4, y + height)
    context.bezierCurveTo(x + width * 0.23, y + height * 0.68, x + width * 0.23, y + height * 0.32, x + 4, y)
    context.closePath()
  } else context.roundRect(x, y, width, height, shape === 'rounded' ? 13 : 2)
}

function drawShapeDetails(context: CanvasRenderingContext2D, shape: ComponentShape, x: number, y: number, width: number, height: number, border: string): void {
  context.save()
  context.strokeStyle = border
  context.lineWidth = 1.2
  if (shape === 'xor-gate') {
    context.beginPath(); context.moveTo(x - 3, y + 2)
    context.bezierCurveTo(x + width * 0.15, y + height * 0.32, x + width * 0.15, y + height * 0.68, x - 3, y + height - 2)
    context.stroke()
  }
  context.restore()
}

function drawInversionBubble(context: CanvasRenderingContext2D, instance: ComponentInstance, x: number, y: number, visual: ComponentVisual, palette: CanvasThemePalette, border: string): void {
  if (!['NOT', 'NAND', 'NOR', 'XNOR'].includes(instance.componentId)) return
  context.beginPath(); context.arc(x + visual.width, y + visual.height / 2, 8, 0, Math.PI * 2)
  context.fillStyle = palette.inversion; context.fill()
  context.strokeStyle = border; context.lineWidth = 1.5; context.stroke()
}

function previewPanel(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, palette: CanvasThemePalette): void {
  context.beginPath(); context.roundRect(x, y, width, height, 8)
  context.fillStyle = palette.previewPanel; context.fill()
  context.strokeStyle = palette.previewBorder; context.lineWidth = 1; context.stroke()
}

function formatValue(value: ReturnType<Simulator['valueAtEndpoint']>): string {
  if (!value) return '—'
  return value.width >= 4 ? value.toHex() : value.toBinary(false)
}

function drawRamPreview(context: CanvasRenderingContext2D, instance: ComponentInstance, visual: ComponentVisual, x: number, y: number, simulator: Simulator, palette: CanvasThemePalette): void {
  const mode = getPreviewMode(instance)
  const memory = simulator.peekRam(instance.id)
  if (!memory) return
  const addressValue = simulator.valueAtEndpoint(instance.id, 'addr')?.toBigInt()
  const activeAddress = Number(addressValue ?? 0n) & 0xff
  const expanded = mode === 'expanded'
  const columns = expanded ? 16 : 8
  const rows = expanded ? 16 : 4
  const start = expanded ? 0 : Math.floor(activeAddress / 32) * 32
  const panelX = x + 14; const panelY = y + 43; const panelWidth = visual.width - 28; const panelHeight = visual.height - 58
  previewPanel(context, panelX, panelY, panelWidth, panelHeight, palette)
  const headerHeight = 22
  context.textAlign = 'left'; context.textBaseline = 'middle'; context.font = '600 9px ui-monospace, monospace'; context.fillStyle = '#f3c58f'
  context.fillText(`ADDR ${activeAddress.toString(16).padStart(2, '0').toUpperCase()}`, panelX + 9, panelY + 12)
  context.textAlign = 'right'; context.fillStyle = palette.previewMuted; context.fillText(expanded ? '256 BYTES' : `${start.toString(16).padStart(2, '0').toUpperCase()}–${(start + 31).toString(16).padStart(2, '0').toUpperCase()}`, panelX + panelWidth - 9, panelY + 12)
  const gap = expanded ? 2 : 3
  const cellWidth = (panelWidth - 16 - gap * (columns - 1)) / columns
  const cellHeight = (panelHeight - headerHeight - 10 - gap * (rows - 1)) / rows
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
    const address = start + row * columns + column
    const cellX = panelX + 8 + column * (cellWidth + gap); const cellY = panelY + headerHeight + 3 + row * (cellHeight + gap)
    context.beginPath(); context.roundRect(cellX, cellY, cellWidth, cellHeight, 2)
    context.fillStyle = address === activeAddress ? '#8b5d31' : memory[address] ? '#253d47' : '#121a23'; context.fill()
    if (address === activeAddress) { context.strokeStyle = '#ffc56c'; context.lineWidth = 1; context.stroke() }
    if (cellWidth >= 13 && cellHeight >= 10) {
      context.fillStyle = address === activeAddress ? '#fff3d6' : memory[address] ? '#b9d8e0' : '#526171'
      context.font = `${expanded ? 6.5 : 7.5}px ui-monospace, monospace`; context.textAlign = 'center'; context.textBaseline = 'middle'
      context.fillText(memory[address].toString(16).padStart(2, '0').toUpperCase(), cellX + cellWidth / 2, cellY + cellHeight / 2 + .5)
    }
  }
}

function drawPicoPreview(context: CanvasRenderingContext2D, instance: ComponentInstance, visual: ComponentVisual, x: number, y: number, simulator: Simulator, palette: CanvasThemePalette): void {
  const state = simulator.peekPico(instance.id)
  if (!state) return
  const expanded = getPreviewMode(instance) === 'expanded'
  const maxDisplay = Math.min(visual.width - 28, visual.height - (expanded ? 82 : 68))
  const displaySize = Math.max(64, Math.floor(maxDisplay / 16) * 16)
  const displayX = x + (visual.width - displaySize) / 2; const displayY = y + 42
  context.fillStyle = '#030506'; context.fillRect(displayX - 4, displayY - 4, displaySize + 8, displaySize + 8)
  const pixel = displaySize / 16
  for (let index = 0; index < 128; index += 1) {
    const byte = state.screen[index]; const row = Math.floor(index / 8); const column = (index % 8) * 2
    context.fillStyle = PICO_PALETTE[byte >> 4]; context.fillRect(displayX + column * pixel, displayY + row * pixel, pixel + .2, pixel + .2)
    context.fillStyle = PICO_PALETTE[byte & 15]; context.fillRect(displayX + (column + 1) * pixel, displayY + row * pixel, pixel + .2, pixel + .2)
  }
  context.strokeStyle = palette.previewBorder; context.lineWidth = 1; context.strokeRect(displayX - 4, displayY - 4, displaySize + 8, displaySize + 8)
  context.textAlign = 'center'; context.textBaseline = 'middle'; context.font = '600 8px ui-monospace, monospace'; context.fillStyle = palette.previewValue
  const footerY = displayY + displaySize + 14
  context.fillText(expanded ? `${state.lastCommand}  ·  ADDR ${state.currentAddress.toString(16).padStart(2, '0').toUpperCase()}  ·  ${state.selectedNibble.toUpperCase()} NIBBLE` : `${state.lastCommand} · SCREEN`, x + visual.width / 2, footerY)
}

function drawGenericPreview(context: CanvasRenderingContext2D, instance: ComponentInstance, visual: ComponentVisual, x: number, y: number, simulator: Simulator, definitions: ComponentDefinition[], palette: CanvasThemePalette): void {
  const mode = getPreviewMode(instance)
  const ports = getInstancePorts(instance, definitions)
  if (mode === 'compact') {
    const outputs = ports.filter(port => port.direction !== 'INPUT')
    const target = outputs[0] ?? ports.at(-1)
    if (!target) return
    const value = simulator.valueAtEndpoint(instance.id, target.id)
    const label = `${target.name}  ${formatValue(value)}`
    const width = Math.min(visual.width - 24, Math.max(54, context.measureText(label).width + 18))
    previewPanel(context, x + (visual.width - width) / 2, y + visual.height / 2 + 7, width, 24, palette)
    context.fillStyle = value ? palette.previewValue : palette.previewMuted; context.font = '600 9px ui-monospace, monospace'; context.textAlign = 'center'; context.textBaseline = 'middle'
    context.fillText(label, x + visual.width / 2, y + visual.height / 2 + 19)
    return
  }
  const panelX = x + 16; const panelY = y + 43; const panelWidth = visual.width - 32; const panelHeight = visual.height - 58
  previewPanel(context, panelX, panelY, panelWidth, panelHeight, palette)
  const visible = ports.slice(0, Math.max(1, Math.floor((panelHeight - 10) / 22)))
  visible.forEach((port, index) => {
    const rowY = panelY + 12 + index * 22
    const value = simulator.valueAtEndpoint(instance.id, port.id)
    context.textBaseline = 'middle'; context.font = '600 8px ui-monospace, monospace'; context.textAlign = 'left'; context.fillStyle = port.direction === 'OUTPUT' ? palette.output : port.direction === 'INPUT' ? palette.input : palette.inout
    context.fillText(port.name, panelX + 9, rowY)
    context.textAlign = 'right'; context.fillStyle = signalColorForValue(value?.toBinary(false), palette); context.fillText(formatValue(value), panelX + panelWidth - 9, rowY)
    if (index < visible.length - 1) { context.strokeStyle = palette.separator; context.beginPath(); context.moveTo(panelX + 8, rowY + 10); context.lineTo(panelX + panelWidth - 8, rowY + 10); context.stroke() }
  })
}

function signalColorForValue(binary: string | undefined, palette: CanvasThemePalette): string {
  if (!binary) return palette.signalLow
  if (binary.includes('X')) return palette.signalUnknown
  if (binary.includes('Z')) return palette.signalFloating
  return binary.endsWith('1') ? palette.signalHigh : palette.signalLow
}

export function drawComponent(
  context: CanvasRenderingContext2D,
  instance: ComponentInstance,
  visual: ComponentVisual,
  position: Point,
  simulator: Simulator,
  definitions: ComponentDefinition[],
  options: { selected: boolean; error: boolean; zoom: number; theme: DesignTheme; customColors: FiveColors; showPreviewControl: boolean },
): void {
  const { x, y } = position
  const palette = canvasTheme(options.theme, options.customColors)
  const colors = componentColors(visual, options.theme, options.customColors)
  context.save()
  componentPath(context, visual.shape, x, y, visual.width, visual.height)
  if (options.selected) { context.shadowColor = palette.selectedGlow; context.shadowBlur = 12 / Math.max(.7, options.zoom) }
  context.fillStyle = colors.fill; context.fill(); context.shadowBlur = 0
  context.strokeStyle = options.error ? palette.error : options.selected ? palette.selected : colors.border
  context.lineWidth = options.selected ? 2.5 / options.zoom : 1.3 / options.zoom; context.stroke()
  drawShapeDetails(context, visual.shape, x, y, visual.width, visual.height, context.strokeStyle as string)
  drawInversionBubble(context, instance, x, y, visual, palette, context.strokeStyle as string)

  const mode = getPreviewMode(instance)
  context.fillStyle = colors.text; context.textAlign = 'center'; context.textBaseline = 'middle'
  context.font = `700 ${mode === 'off' ? 13 : 11}px system-ui, sans-serif`
  context.fillText(instance.name, x + visual.width / 2, y + (mode === 'off' ? visual.height / 2 - 6 : 18))
  if (mode === 'off') {
    context.fillStyle = palette.componentMuted; context.font = '9px ui-monospace, monospace'
    context.fillText(instance.builtin ? String(instance.componentId).replaceAll('_', ' ') : 'CUSTOM', x + visual.width / 2, y + visual.height / 2 + 13)
  } else if (instance.componentId === 'RAM_256x8') drawRamPreview(context, instance, visual, x, y, simulator, palette)
  else if (instance.componentId === 'PICO88_DISPLAY') drawPicoPreview(context, instance, visual, x, y, simulator, palette)
  else drawGenericPreview(context, instance, visual, x, y, simulator, definitions, palette)

  // The preview-mode control stays out of the circuit until the component is hovered.
  if (options.showPreviewControl) {
    context.beginPath(); context.roundRect(x + visual.width - 34, y + 8, 24, 18, 5)
    context.fillStyle = mode === 'off' ? palette.controlOff : palette.controlOn; context.fill()
    context.strokeStyle = mode === 'off' ? palette.controlOffBorder : palette.controlOnBorder; context.lineWidth = 1; context.stroke()
    context.fillStyle = mode === 'off' ? palette.controlOffText : palette.controlOnText; context.font = '700 10px ui-monospace, monospace'; context.textAlign = 'center'; context.textBaseline = 'middle'
    context.fillText(mode === 'expanded' ? '▣' : mode === 'compact' ? '◫' : '·', x + visual.width - 22, y + 17.5)
  }
  context.restore()
}

export function previewControlRect(instance: ComponentInstance, visual: ComponentVisual, offset?: Point) {
  return { x: instance.position.x + (offset?.x ?? 0) + visual.width - 38, y: instance.position.y + (offset?.y ?? 0) + 4, width: 32, height: 26 }
}
