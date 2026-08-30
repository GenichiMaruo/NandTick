import { compileCircuit } from './compiler'
import { getInstancePorts, validateGraph } from './graph'
import { LogicValue } from './logic-value'
import type { CircuitGraph, CircuitTestCase, ComponentDefinition } from './model'
import { Simulator } from './simulator'

export interface TestExecution {
  test: CircuitTestCase
  simulator?: Simulator
}

function ioMaps(graph: CircuitGraph, definition?: ComponentDefinition) {
  const inputs = new Map<string, { instanceId: string; width: number }>()
  const outputs = new Map<string, { instanceId: string; portId: string; width: number }>()
  for (const instance of graph.instances) {
    if (['TOGGLE', 'BUTTON', 'INPUT_PIN'].includes(instance.componentId)) {
      const binding = definition?.ports.find(port => port.id === instance.parameters.bindingPortId)
      const width = Number(instance.parameters.width ?? 1)
      inputs.set(binding?.name ?? instance.name, { instanceId: instance.id, width })
    }
    if (instance.componentId === 'OUTPUT_PIN') {
      const binding = definition?.ports.find(port => port.id === instance.parameters.bindingPortId)
      outputs.set(binding?.name ?? instance.name, { instanceId: instance.id, portId: 'a', width: Number(instance.parameters.width ?? 1) })
    }
  }
  return { inputs, outputs }
}

export function executeTest(graph: CircuitGraph, definitions: ComponentDefinition[], source: CircuitTestCase, definition?: ComponentDefinition): TestExecution {
  const test = structuredClone(source)
  const errors = validateGraph(graph, definitions).filter(issue => issue.severity === 'error')
  if (errors.length) {
    test.result = 'FAIL'; test.failure = errors[0].message
    return { test }
  }
  try {
    const simulator = new Simulator(compileCircuit(graph, definitions))
    const maps = ioMaps(graph, definition)
    const events = [...(test.sequence ?? []), { tick: 0, inputs: test.inputs }, { tick: test.sampleTick, expected: test.expected }]
      .sort((a, b) => a.tick - b.tick)
    let tick = 0
    let failure = ''
    const actual: Record<string, string> = {}
    for (const event of events) {
      if (event.tick > tick) { simulator.advance(event.tick - tick); tick = event.tick }
      for (const [name, raw] of Object.entries(event.inputs ?? {})) {
        const target = maps.inputs.get(name)
        if (!target) throw new Error(`Unknown test input: ${name}`)
        simulator.setInput(target.instanceId, LogicValue.parse(raw, target.width))
      }
      for (const [name, expectedRaw] of Object.entries(event.expected ?? {})) {
        const target = maps.outputs.get(name)
        if (!target) throw new Error(`Unknown expected output: ${name}`)
        const value = simulator.valueAtEndpoint(target.instanceId, target.portId)
        const expected = LogicValue.parse(expectedRaw, target.width)
        actual[name] = value?.toBinary() ?? 'unconnected'
        if (!value?.equals(expected) && !failure) {
          let differingBit = -1
          if (value) for (let bit = 0; bit < target.width; bit += 1) if (value.getBit(bit) !== expected.getBit(bit)) { differingBit = bit; break }
          failure = `${name} @ tick ${tick}: expected ${expected.toBinary()}, actual ${value?.toBinary() ?? 'unconnected'}${differingBit >= 0 ? ` (first differing bit: ${differingBit})` : ''}`
        }
      }
    }
    test.actual = actual
    test.failure = failure || undefined
    test.result = failure ? 'FAIL' : 'PASS'
    return { test, simulator }
  } catch (error) {
    test.result = 'FAIL'; test.failure = error instanceof Error ? error.message : String(error)
    return { test }
  }
}

export function portNamesForTests(graph: CircuitGraph, definitions: ComponentDefinition[]) {
  return graph.instances.flatMap(instance => getInstancePorts(instance, definitions).map(port => `${instance.name}.${port.name}`))
}
