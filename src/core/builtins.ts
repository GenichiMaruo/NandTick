import type { BuiltinKind, ComponentInstance, ComponentVisual, PortSpec } from './model'

export interface BuiltinDescriptor {
  kind: BuiltinKind
  name: string
  category: 'Logic' | 'I/O' | 'Routing' | 'Memory' | 'Display'
  description: string
  visual: ComponentVisual
  defaultParameters: Record<string, unknown>
  ports: (parameters: Record<string, unknown>) => PortSpec[]
  synthesizable: boolean
}

const visual = (fill: string, width = 104, height = 72, shape: ComponentVisual['shape'] = 'rounded'): ComponentVisual => ({
  fill,
  border: '#526076',
  text: '#eef2fa',
  shape,
  width,
  height,
})

const widthOf = (parameters: Record<string, unknown>, key = 'width', fallback = 1) => {
  const value = Number(parameters[key] ?? fallback)
  return Number.isInteger(value) && value > 0 ? value : fallback
}

const port = (id: string, name: string, direction: PortSpec['direction'], width: number, side: PortSpec['position']['side'], offset: number, displayOrder = 0, description?: string): PortSpec => ({
  id, name, direction, width, position: { side, offset }, displayOrder, description,
})

const binaryPorts = (parameters: Record<string, unknown>): PortSpec[] => {
  const width = widthOf(parameters)
  return [port('a', 'A', 'INPUT', width, 'left', 0.3), port('b', 'B', 'INPUT', width, 'left', 0.7, 1), port('y', 'Y', 'OUTPUT', width, 'right', 0.5)]
}

const unaryPorts = (parameters: Record<string, unknown>): PortSpec[] => {
  const width = widthOf(parameters)
  return [port('a', 'A', 'INPUT', width, 'left', 0.5), port('y', 'Y', 'OUTPUT', width, 'right', 0.5)]
}

const descriptors: BuiltinDescriptor[] = [
  ['CONST0', 'Constant 0', 'Logic', 'Packed LOW constant', visual('#25354d', 78, 58, 'ellipse'), { width: 1, delay: 0, previewMode: 'off' }, (p: Record<string, unknown>) => [port('y', '0', 'OUTPUT', widthOf(p), 'right', 0.5)], true],
  ['CONST1', 'Constant 1', 'Logic', 'Packed HIGH constant', visual('#1d493c', 78, 58, 'ellipse'), { width: 1, delay: 0, previewMode: 'off' }, (p: Record<string, unknown>) => [port('y', '1', 'OUTPUT', widthOf(p), 'right', 0.5)], true],
  ['NOT', 'NOT', 'Logic', 'Bitwise inversion', visual('#402d56', 104, 72, 'triangle'), { width: 1, delay: 1, previewMode: 'off' }, unaryPorts, true],
  ['AND', 'AND', 'Logic', 'Bitwise conjunction', visual('#173b50', 112, 78, 'and-gate'), { width: 1, delay: 1, previewMode: 'off' }, binaryPorts, true],
  ['OR', 'OR', 'Logic', 'Bitwise disjunction', visual('#203653', 112, 78, 'or-gate'), { width: 1, delay: 1, previewMode: 'off' }, binaryPorts, true],
  ['XOR', 'XOR', 'Logic', 'Bitwise exclusive OR', visual('#30335d', 118, 78, 'xor-gate'), { width: 1, delay: 1, previewMode: 'off' }, binaryPorts, true],
  ['NAND', 'NAND', 'Logic', 'Bitwise inverted AND', visual('#482d4d', 112, 78, 'and-gate'), { width: 1, delay: 1, previewMode: 'off' }, binaryPorts, true],
  ['NOR', 'NOR', 'Logic', 'Bitwise inverted OR', visual('#482d4d', 112, 78, 'or-gate'), { width: 1, delay: 1, previewMode: 'off' }, binaryPorts, true],
  ['XNOR', 'XNOR', 'Logic', 'Bitwise inverted XOR', visual('#493154', 118, 78, 'xor-gate'), { width: 1, delay: 1, previewMode: 'off' }, binaryPorts, true],
  ['BUFFER', 'Buffer', 'Logic', 'Transport buffer', visual('#234056', 104, 72, 'triangle'), { width: 1, delay: 1, previewMode: 'off' }, unaryPorts, true],
  ['TOGGLE', 'Toggle input', 'I/O', 'Interactive packed input', visual('#164b3c', 118, 68, 'pill'), { width: 1, value: '0b0', delay: 0, previewMode: 'compact' }, (p: Record<string, unknown>) => [port('y', 'OUT', 'OUTPUT', widthOf(p), 'right', 0.5)], false],
  ['BUTTON', 'Push button', 'I/O', 'Momentary one-bit input', visual('#5a3925', 118, 68, 'pill'), { value: '0b0', delay: 0, previewMode: 'compact' }, () => [port('y', 'OUT', 'OUTPUT', 1, 'right', 0.5)], false],
  ['CLOCK', 'Clock', 'I/O', 'Tick-driven clock generator', visual('#57471f', 122, 78, 'hexagon'), { periodTicks: 10, highTicks: 5, lowTicks: 5, initialState: 0, delay: 0, previewMode: 'compact' }, () => [port('y', 'CLK', 'OUTPUT', 1, 'right', 0.5)], false],
  ['INPUT_PIN', 'Input port', 'I/O', 'Custom component input boundary', visual('#174b3f', 110, 58, 'pill'), { width: 1, bindingPortId: '', value: '0b0', delay: 0, previewMode: 'off' }, (p: Record<string, unknown>) => [port('y', 'OUT', 'OUTPUT', widthOf(p), 'right', 0.5)], true],
  ['OUTPUT_PIN', 'Output port', 'I/O', 'Custom component output boundary', visual('#443257', 110, 58, 'pill'), { width: 1, bindingPortId: '', delay: 0, previewMode: 'off' }, (p: Record<string, unknown>) => [port('a', 'IN', 'INPUT', widthOf(p), 'left', 0.5)], true],
  ['BIT_SELECT', 'Bit select', 'Routing', 'Select one bit from a bus', visual('#293242', 104, 68, 'diamond'), { width: 8, bit: 0, delay: 0, previewMode: 'off' }, (p: Record<string, unknown>) => [port('a', 'BUS', 'INPUT', widthOf(p), 'left', 0.5), port('y', 'BIT', 'OUTPUT', 1, 'right', 0.5)], true],
  ['BUS_SLICE', 'Bus slice', 'Routing', 'Select an inclusive bus range', visual('#293242', 110, 72, 'trapezoid'), { width: 8, msb: 3, lsb: 0, delay: 0, previewMode: 'off' }, (p: Record<string, unknown>) => [port('a', 'BUS', 'INPUT', widthOf(p), 'left', 0.5), port('y', 'SLICE', 'OUTPUT', Math.max(1, Number(p.msb ?? 3) - Number(p.lsb ?? 0) + 1), 'right', 0.5)], true],
  ['BUS_JOIN', 'Bus join', 'Routing', 'Concatenate high and low buses', visual('#293242', 116, 76, 'hexagon'), { highWidth: 4, lowWidth: 4, delay: 0, previewMode: 'off' }, (p: Record<string, unknown>) => {
    const high = widthOf(p, 'highWidth', 4); const low = widthOf(p, 'lowWidth', 4)
    return [port('high', 'HIGH', 'INPUT', high, 'left', 0.3), port('low', 'LOW', 'INPUT', low, 'left', 0.7, 1), port('y', 'BUS', 'OUTPUT', high + low, 'right', 0.5)]
  }, true],
  ['JUNCTION', 'Junction', 'Routing', 'Zero-delay branch point', visual('#2c3544', 76, 60, 'diamond'), { width: 1, delay: 0, previewMode: 'off' }, (p: Record<string, unknown>) => [port('a', 'A', 'INPUT', widthOf(p), 'left', 0.5), port('y', 'Y', 'OUTPUT', widthOf(p), 'right', 0.5)], true],
  ['RAM_256x8', 'RAM 256×8', 'Memory', 'Asynchronous read, synchronous write memory', visual('#453328', 198, 196, 'hexagon'), { readDelay: 1, writeDelay: 1, readDisabledValue: 'Z', initialMemory: Array(256).fill(0), previewMode: 'compact' }, () => [
    port('addr', 'ADDR', 'INPUT', 8, 'left', 0.15), port('dataIn', 'DATA IN', 'INPUT', 8, 'left', 0.32, 1), port('readEn', 'READ EN', 'INPUT', 1, 'left', 0.5, 2), port('writeEn', 'WRITE EN', 'INPUT', 1, 'left', 0.65, 3), port('clk', 'CLK', 'INPUT', 1, 'left', 0.8, 4), port('reset', 'RESET', 'INPUT', 1, 'bottom', 0.5, 5), port('dataOut', 'DATA OUT', 'OUTPUT', 8, 'right', 0.3),
  ], true],
  ['PICO88_DISPLAY', 'PICO-88 Display', 'Display', '16×16, 4bpp isolated display peripheral', visual('#102f3b', 210, 236, 'rounded'), { delay: 1, previewMode: 'compact' }, () => [
    port('r0', 'R0', 'INPUT', 8, 'left', 0.12), port('r1', 'R1', 'INPUT', 8, 'left', 0.25, 1), port('r2', 'R2', 'INPUT', 8, 'left', 0.38, 2), port('r3', 'R3', 'INPUT', 8, 'left', 0.51, 3), port('command', 'COMMAND', 'INPUT', 3, 'left', 0.67, 4), port('exec', 'EXEC', 'INPUT', 1, 'left', 0.8, 5), port('reset', 'RESET', 'INPUT', 1, 'bottom', 0.5, 6), port('r1Out', 'R1 OUT', 'OUTPUT', 8, 'right', 0.32),
  ], false],
].map(([kind, name, category, description, visualValue, defaultParameters, ports, synthesizable]) => ({ kind, name, category, description, visual: visualValue, defaultParameters, ports, synthesizable } as BuiltinDescriptor))

export const BUILTINS = Object.fromEntries(descriptors.map(item => [item.kind, item])) as Record<BuiltinKind, BuiltinDescriptor>
export const BUILTIN_LIST = descriptors

export function getBuiltinPorts(instance: ComponentInstance): PortSpec[] {
  return BUILTINS[instance.componentId as BuiltinKind].ports(instance.parameters)
}

export function createBuiltinInstance(kind: BuiltinKind, x: number, y: number, id: string): ComponentInstance {
  const descriptor = BUILTINS[kind]
  return {
    id,
    name: descriptor.name,
    componentId: kind,
    builtin: true,
    position: { x, y },
    rotation: 0,
    parameters: structuredClone(descriptor.defaultParameters),
  }
}
