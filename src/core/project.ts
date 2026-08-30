import { connectEndpoints } from './graph'
import { createBuiltinInstance } from './builtins'
import type { CircuitGraph, ComponentDefinition, PortSpec, Project } from './model'
import { createId } from './model'

export function createStarterProject(): Project {
  const a = createBuiltinInstance('TOGGLE', 90, 155, 'input_a')
  a.name = 'A'
  const b = createBuiltinInstance('TOGGLE', 90, 285, 'input_b')
  b.name = 'B'
  const and = createBuiltinInstance('AND', 330, 210, 'gate_and')
  and.name = 'AND_1'
  const output = createBuiltinInstance('OUTPUT_PIN', 585, 220, 'output_y')
  output.name = 'Y'
  let graph: CircuitGraph = { instances: [a, b, and, output], nets: [] }
  graph = connectEndpoints(graph, { instanceId: a.id, portId: 'y' }, { instanceId: and.id, portId: 'a' }, [], createId)
  graph = connectEndpoints(graph, { instanceId: b.id, portId: 'y' }, { instanceId: and.id, portId: 'b' }, [], createId)
  graph = connectEndpoints(graph, { instanceId: and.id, portId: 'y' }, { instanceId: output.id, portId: 'a' }, [], createId)
  const now = new Date().toISOString()
  return {
    version: 1,
    id: createId('project'),
    name: 'Untitled CPU Lab',
    description: 'Event-driven digital circuit project',
    createdAt: now,
    updatedAt: now,
    settings: { tickDurationMs: 100, eventsPerTickLimit: 10000, maxAutomaticTicks: 100000, liveSignals: true },
    mainGraph: graph,
    definitions: [],
    tests: [],
  }
}

export function createComponentDefinition(name: string, ports: Array<Pick<PortSpec, 'name' | 'direction' | 'width'>>): ComponentDefinition {
  const now = new Date().toISOString()
  const normalizedPorts: PortSpec[] = ports.map((item, index) => ({
    ...item,
    id: createId('port'),
    displayOrder: index,
    position: {
      side: item.direction === 'INPUT' ? 'left' : item.direction === 'OUTPUT' ? 'right' : index % 2 ? 'right' : 'left',
      offset: (index + 1) / (ports.length + 1),
    },
  }))
  const instances = normalizedPorts.map((item, index) => {
    const isInput = item.direction === 'INPUT' || item.direction === 'INOUT'
    const instance = createBuiltinInstance(isInput ? 'INPUT_PIN' : 'OUTPUT_PIN', isInput ? 70 : 570, 80 + index * 100, createId('boundary'))
    instance.name = item.name
    instance.parameters.width = item.width
    instance.parameters.bindingPortId = item.id
    return instance
  })
  return {
    id: createId('component'),
    name,
    ports: normalizedPorts,
    internalGraph: { instances, nets: [] },
    visual: { fill: '#263b50', border: '#60718b', text: '#eef2fa', shape: 'rounded', width: 126, height: Math.max(76, ports.length * 28 + 28) },
    category: 'Custom',
    tests: [],
    metadata: { createdAt: now, updatedAt: now },
  }
}
