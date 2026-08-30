import { BUILTINS } from './builtins'
import type { ComponentDefinition, ComponentInstance, ComponentShape, ComponentVisual, PreviewMode } from './model'

export const SHAPE_OPTIONS: Array<{ value: ComponentShape; label: string }> = [
  { value: 'rounded', label: 'Rounded' },
  { value: 'rectangle', label: 'Rectangle' },
  { value: 'ellipse', label: 'Ellipse' },
  { value: 'pill', label: 'Pill' },
  { value: 'trapezoid', label: 'Trapezoid' },
  { value: 'polygon', label: 'Pentagon' },
  { value: 'diamond', label: 'Diamond' },
  { value: 'hexagon', label: 'Hexagon' },
  { value: 'and-gate', label: 'AND gate' },
  { value: 'or-gate', label: 'OR gate' },
  { value: 'xor-gate', label: 'XOR gate' },
  { value: 'triangle', label: 'Triangle' },
]

const fallback: ComponentVisual = {
  fill: '#263b50', border: '#60718b', text: '#eef2fa', shape: 'rounded', width: 120, height: 76,
}

export function getPreviewMode(instance: ComponentInstance): PreviewMode {
  const mode = instance.parameters.previewMode
  return mode === 'compact' || mode === 'expanded' ? mode : 'off'
}

export function getComponentVisual(instance: ComponentInstance, definitions: ComponentDefinition[]): ComponentVisual {
  const base = instance.builtin
    ? BUILTINS[instance.componentId as keyof typeof BUILTINS]?.visual ?? fallback
    : definitions.find(definition => definition.id === instance.componentId)?.visual ?? fallback
  return { ...base, ...instance.visualOverride }
}

/** Preview expansion changes presentation bounds only; the simulation graph is untouched. */
export function getRenderVisual(instance: ComponentInstance, definitions: ComponentDefinition[]): ComponentVisual {
  const visual = getComponentVisual(instance, definitions)
  if (getPreviewMode(instance) !== 'expanded') return visual
  if (instance.componentId === 'RAM_256x8') return { ...visual, width: Math.max(370, visual.width), height: Math.max(350, visual.height) }
  if (instance.componentId === 'PICO88_DISPLAY') return { ...visual, width: Math.max(330, visual.width), height: Math.max(390, visual.height) }
  return { ...visual, width: Math.max(240, visual.width), height: Math.max(164, visual.height) }
}

export function cyclePreviewMode(instance: ComponentInstance): PreviewMode {
  const current = getPreviewMode(instance)
  return current === 'off' ? 'compact' : current === 'compact' ? 'expanded' : 'off'
}
