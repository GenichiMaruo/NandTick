import type { CircuitGraph, ComponentDefinition } from './model'

function runtimeParameters(parameters: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(parameters).filter(([key]) => key !== 'previewMode'))
}

function runtimeGraph(graph: CircuitGraph) {
  return {
    instances: graph.instances.map(instance => ({
      id: instance.id,
      componentId: instance.componentId,
      builtin: instance.builtin,
      parameters: runtimeParameters(instance.parameters),
    })),
    nets: graph.nets.map(net => ({ id: net.id, width: net.width, endpoints: net.endpoints })),
  }
}

/** Excludes position, labels, previews and visuals so presentation edits never rebuild the simulator. */
export function simulationSignature(graph: CircuitGraph, definitions: ComponentDefinition[]): string {
  return JSON.stringify({
    graph: runtimeGraph(graph),
    definitions: definitions.map(definition => ({
      id: definition.id,
      ports: definition.ports.map(port => ({ id: port.id, direction: port.direction, width: port.width })),
      graph: runtimeGraph(definition.internalGraph),
    })),
  })
}
