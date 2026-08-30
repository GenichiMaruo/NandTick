import { describe, expect, it } from 'vitest'
import { createBuiltinInstance } from './builtins'
import type { CircuitGraph } from './model'
import { simulationSignature } from './simulation-signature'
import { cyclePreviewMode, getComponentVisual, getPreviewMode, getRenderVisual, SHAPE_OPTIONS } from './visual'

describe('component presentation', () => {
  it('cycles between symbol, preview, and expanded modes', () => {
    const instance = createBuiltinInstance('AND', 10, 20, 'gate')
    expect(getPreviewMode(instance)).toBe('off')
    expect(cyclePreviewMode(instance)).toBe('compact')
    instance.parameters.previewMode = 'compact'
    expect(cyclePreviewMode(instance)).toBe('expanded')
    instance.parameters.previewMode = 'expanded'
    expect(cyclePreviewMode(instance)).toBe('off')
  })

  it('keeps instance appearance overrides separate from builtin defaults', () => {
    const first = createBuiltinInstance('AND', 0, 0, 'first')
    const second = createBuiltinInstance('AND', 0, 0, 'second')
    first.visualOverride = { shape: 'diamond', fill: '#ff006e', width: 222 }

    expect(getComponentVisual(first, [])).toMatchObject({ shape: 'diamond', fill: '#ff006e', width: 222 })
    expect(getComponentVisual(second, []).shape).toBe('and-gate')
    expect(SHAPE_OPTIONS.map(option => option.value)).toEqual(expect.arrayContaining(['pill', 'hexagon', 'and-gate', 'or-gate', 'xor-gate']))
  })

  it('expands RAM and PICO preview bounds without changing the stored visual', () => {
    const ram = createBuiltinInstance('RAM_256x8', 0, 0, 'ram')
    const pico = createBuiltinInstance('PICO88_DISPLAY', 0, 0, 'pico')
    ram.parameters.previewMode = 'expanded'
    pico.parameters.previewMode = 'expanded'

    expect(getRenderVisual(ram, [])).toMatchObject({ width: 370, height: 350 })
    expect(getRenderVisual(pico, [])).toMatchObject({ width: 330, height: 390 })
    expect(getComponentVisual(ram, [])).toMatchObject({ width: 198, height: 196 })
    expect(getComponentVisual(pico, [])).toMatchObject({ width: 210, height: 236 })
  })

  it('does not rebuild the simulator for purely visual edits', () => {
    const instance = createBuiltinInstance('CLOCK', 20, 30, 'clock')
    const graph = { instances: [instance], nets: [] }
    const before = simulationSignature(graph, [])

    instance.position = { x: 440, y: 180 }
    instance.name = 'Fun clock'
    instance.parameters.previewMode = 'expanded'
    instance.visualOverride = { shape: 'ellipse', fill: '#ffbe0b', width: 250 }
    expect(simulationSignature(graph, [])).toBe(before)

    instance.parameters.period = 12
    expect(simulationSignature(graph, [])).not.toBe(before)
  })

  it('treats editable wire bend points as presentation-only', () => {
    const source = createBuiltinInstance('CONST1', 0, 0, 'source')
    const target = createBuiltinInstance('OUTPUT_PIN', 200, 0, 'target')
    const root = { instanceId: source.id, portId: 'y' }
    const endpoint = { instanceId: target.id, portId: 'a' }
    const graph: CircuitGraph = { instances: [source, target], nets: [{ id: 'wire', width: 1, endpoints: [root, endpoint], route: { root, branches: [{ endpoint, points: [{ x: 80, y: 20 }] }] } }] }
    const before = simulationSignature(graph, [])
    graph.nets[0].route!.branches[0].points = [{ x: 120, y: 90 }, { x: 160, y: 30 }]
    expect(simulationSignature(graph, [])).toBe(before)
  })
})
