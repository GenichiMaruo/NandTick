import { describe, expect, it } from 'vitest'
import { createBuiltinInstance } from './builtins'
import { compileCircuit } from './compiler'
import { connectEndpoints } from './graph'
import type { CircuitGraph, ComponentDefinition } from './model'
import { createComponentDefinition } from './project'
import { Simulator } from './simulator'

const createId = (() => { let id = 0; return (prefix: string) => `${prefix}_${id++}` })()
const wire = (graph: CircuitGraph, a: [string, string], b: [string, string], definitions: ComponentDefinition[] = []) => connectEndpoints(graph, { instanceId: a[0], portId: a[1] }, { instanceId: b[0], portId: b[1] }, definitions, createId)

describe('event-driven simulator', () => {
  it('propagates only after configured tick delay', () => {
    const a = createBuiltinInstance('TOGGLE', 0, 0, 'a'); const b = createBuiltinInstance('TOGGLE', 0, 0, 'b')
    const gate = createBuiltinInstance('AND', 0, 0, 'and'); gate.parameters.delay = 2
    const output = createBuiltinInstance('OUTPUT_PIN', 0, 0, 'y')
    let graph: CircuitGraph = { instances: [a, b, gate, output], nets: [] }
    graph = wire(graph, ['a', 'y'], ['and', 'a']); graph = wire(graph, ['b', 'y'], ['and', 'b']); graph = wire(graph, ['and', 'y'], ['y', 'a'])
    const simulator = new Simulator(compileCircuit(graph, []))
    simulator.setInput('a', '1'); simulator.setInput('b', '1')
    simulator.advance(1)
    expect(simulator.valueAtEndpoint('y', 'a')?.toBinary()).not.toBe('0b1')
    simulator.advance(1)
    expect(simulator.valueAtEndpoint('y', 'a')?.toBinary()).toBe('0b1')
    expect(simulator.stats.evaluatedComponents).toBeLessThan(20)
  })

  it('zero-extends a narrow output onto a wide net', () => {
    const source = createBuiltinInstance('TOGGLE', 0, 0, 'source'); source.parameters.width = 4
    const output = createBuiltinInstance('OUTPUT_PIN', 0, 0, 'output'); output.parameters.width = 8
    let graph: CircuitGraph = { instances: [source, output], nets: [] }
    graph = wire(graph, ['source', 'y'], ['output', 'a'])
    const simulator = new Simulator(compileCircuit(graph, [])); simulator.setInput('source', '0b1011')
    expect(simulator.valueAtEndpoint('output', 'a')?.toBinary()).toBe('0b00001011')
  })

  it('flattens hierarchical custom components while retaining delay', () => {
    const inverter = createComponentDefinition('Inverter', [{ name: 'A', direction: 'INPUT', width: 1 }, { name: 'Y', direction: 'OUTPUT', width: 1 }])
    const input = inverter.internalGraph.instances.find(instance => instance.componentId === 'INPUT_PIN')!
    const output = inverter.internalGraph.instances.find(instance => instance.componentId === 'OUTPUT_PIN')!
    const gate = createBuiltinInstance('NOT', 0, 0, 'inner_not'); gate.parameters.delay = 1
    inverter.internalGraph.instances.push(gate)
    inverter.internalGraph = wire(inverter.internalGraph, [input.id, 'y'], [gate.id, 'a'], [inverter])
    inverter.internalGraph = wire(inverter.internalGraph, [gate.id, 'y'], [output.id, 'a'], [inverter])
    const source = createBuiltinInstance('TOGGLE', 0, 0, 'source')
    const probe = createBuiltinInstance('OUTPUT_PIN', 0, 0, 'probe')
    const custom = { id: 'custom', name: 'INV', componentId: inverter.id, builtin: false as const, position: { x: 0, y: 0 }, rotation: 0, parameters: {} }
    let graph: CircuitGraph = { instances: [source, custom, probe], nets: [] }
    graph = wire(graph, ['source', 'y'], ['custom', inverter.ports[0].id], [inverter])
    graph = wire(graph, ['custom', inverter.ports[1].id], ['probe', 'a'], [inverter])
    const simulator = new Simulator(compileCircuit(graph, [inverter])); simulator.setInput('source', '1'); simulator.advance(1)
    expect(simulator.valueAtEndpoint('probe', 'a')?.toBinary()).toBe('0b0')
  })

  it('applies RAM images atomically and performs asynchronous reads', () => {
    const specs: Array<[string, string, number]> = [['addr', 'TOGGLE', 8], ['din', 'TOGGLE', 8], ['re', 'TOGGLE', 1], ['we', 'TOGGLE', 1], ['clk', 'TOGGLE', 1], ['rst', 'TOGGLE', 1]]
    const inputs = specs.map(([name, kind, width]) => { const item = createBuiltinInstance(kind as 'TOGGLE', 0, 0, name); item.parameters.width = width; return item })
    const ram = createBuiltinInstance('RAM_256x8', 0, 0, 'ram'); const output = createBuiltinInstance('OUTPUT_PIN', 0, 0, 'output'); output.parameters.width = 8
    let graph: CircuitGraph = { instances: [...inputs, ram, output], nets: [] }
    for (const [input, port] of [['addr', 'addr'], ['din', 'dataIn'], ['re', 'readEn'], ['we', 'writeEn'], ['clk', 'clk'], ['rst', 'reset']] as Array<[string, string]>) graph = wire(graph, [input, 'y'], ['ram', port])
    graph = wire(graph, ['ram', 'dataOut'], ['output', 'a'])
    const simulator = new Simulator(compileCircuit(graph, [])); const image = new Uint8Array(256); image[0x2a] = 0xc7; simulator.applyRam('ram', image)
    simulator.setInput('addr', '0x2A'); simulator.setInput('re', '1'); simulator.advance(1)
    expect(simulator.valueAtEndpoint('output', 'a')?.toHex()).toBe('0xC7')
    simulator.setInput('addr', '1'); simulator.setInput('din', '0xAA'); simulator.setInput('we', '1'); simulator.setInput('clk', '1')
    simulator.setInput('rst', '1'); simulator.setInput('rst', '0'); simulator.advance(5)
    expect(simulator.getRam('ram')?.[1]).toBe(0)
  })

  it('implements PICO-88 plot and FLIP copy semantics', () => {
    const input = (id: string, width: number) => { const instance = createBuiltinInstance('TOGGLE', 0, 0, id); instance.parameters.width = width; return instance }
    const inputs = [input('r0', 8), input('r1', 8), input('r2', 8), input('r3', 8), input('cmd', 3), input('exec', 1), input('reset', 1)]
    const pico = createBuiltinInstance('PICO88_DISPLAY', 0, 0, 'pico'); const output = createBuiltinInstance('OUTPUT_PIN', 0, 0, 'out'); output.parameters.width = 8
    let graph: CircuitGraph = { instances: [...inputs, pico, output], nets: [] }
    for (const [source, port] of [['r0', 'r0'], ['r1', 'r1'], ['r2', 'r2'], ['r3', 'r3'], ['cmd', 'command'], ['exec', 'exec'], ['reset', 'reset']] as Array<[string, string]>) graph = wire(graph, [source, 'y'], ['pico', port])
    graph = wire(graph, ['pico', 'r1Out'], ['out', 'a'])
    const simulator = new Simulator(compileCircuit(graph, []))
    simulator.setInput('r1', '2'); simulator.setInput('r2', '1'); simulator.setInput('r3', '0xA'); simulator.setInput('cmd', '1'); simulator.setInput('exec', '1')
    let state = simulator.getPico('pico')!; expect(state.vram[9]).toBe(0xa0); expect(state.screen[9]).toBe(0)
    simulator.setInput('exec', '0'); simulator.setInput('cmd', '4'); simulator.setInput('exec', '1')
    state = simulator.getPico('pico')!; expect(state.screen[9]).toBe(0xa0); expect(state.vram[9]).toBe(0xa0)
  })
})
