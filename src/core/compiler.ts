import { getInstancePorts } from './graph'
import type { BuiltinKind, CircuitGraph, ComponentDefinition, ComponentInstance, PortSpec, ValidationIssue } from './model'

class UnionFind {
  private parent = new Map<string, string>()

  add(value: string): void {
    if (!this.parent.has(value)) this.parent.set(value, value)
  }

  find(value: string): string {
    this.add(value)
    const parent = this.parent.get(value)!
    if (parent === value) return value
    const root = this.find(parent)
    this.parent.set(value, root)
    return root
  }

  union(first: string, second: string): void {
    const a = this.find(first); const b = this.find(second)
    if (a !== b) this.parent.set(b, a)
  }

  values(): string[] {
    return [...this.parent.keys()]
  }
}

interface PendingComponent {
  path: string
  sourceInstanceId: string
  kind: BuiltinKind
  parameters: Record<string, unknown>
  portSpecs: PortSpec[]
  portKeys: Record<string, string>
}

export interface CompiledDriver {
  id: number
  componentId: number
  portId: string
  netId: number
  width: number
}

export interface CompiledComponent {
  id: number
  path: string
  sourceInstanceId: string
  kind: BuiltinKind
  parameters: Record<string, unknown>
  portSpecs: PortSpec[]
  ports: Record<string, number>
  outputDrivers: Record<string, number>
}

export interface CompiledNet {
  id: number
  width: number
  drivers: number[]
  consumers: number[]
  sourceKeys: string[]
}

export interface CompiledCircuit {
  components: CompiledComponent[]
  nets: CompiledNet[]
  drivers: CompiledDriver[]
  endpointToNet: Map<string, number>
  sourceNetToNet: Map<string, number>
  issues: ValidationIssue[]
}

export function compileCircuit(graph: CircuitGraph, definitions: ComponentDefinition[]): CompiledCircuit {
  const union = new UnionFind()
  const widths = new Map<string, number>()
  const endpointKeys = new Map<string, string>()
  const pending: PendingComponent[] = []
  const issues: ValidationIssue[] = []
  const definitionsById = new Map(definitions.map(definition => [definition.id, definition]))

  const registerKey = (key: string, width: number) => {
    union.add(key)
    widths.set(key, Math.max(widths.get(key) ?? 1, width))
    return key
  }

  const expand = (
    currentGraph: CircuitGraph,
    path: string,
    boundaryMap: Map<string, string> | undefined,
    activeDefinitions: Set<string>,
  ) => {
    const instanceById = new Map(currentGraph.instances.map(instance => [instance.id, instance]))
    const localEndpointNet = new Map<string, string>()
    for (const net of currentGraph.nets) {
      const key = registerKey(`${path}:net:${net.id}`, net.width)
      for (const endpoint of net.endpoints) localEndpointNet.set(`${endpoint.instanceId}:${endpoint.portId}`, key)
    }

    const keyForPort = (instance: ComponentInstance, portSpec: PortSpec): string => {
      const key = localEndpointNet.get(`${instance.id}:${portSpec.id}`)
        ?? `${path}:loose:${instance.id}:${portSpec.id}`
      registerKey(key, portSpec.width)
      endpointKeys.set(`${path}:${instance.id}:${portSpec.id}`, key)
      return key
    }

    for (const instance of currentGraph.instances) {
      const ports = getInstancePorts(instance, definitions)
      const portKeys = Object.fromEntries(ports.map(portSpec => [portSpec.id, keyForPort(instance, portSpec)]))
      if (instance.builtin) {
        const bindingPortId = String(instance.parameters.bindingPortId ?? '')
        const isBoundary = instance.componentId === 'INPUT_PIN' || instance.componentId === 'OUTPUT_PIN'
        if (isBoundary && boundaryMap?.has(bindingPortId)) {
          const localPortId = instance.componentId === 'INPUT_PIN' ? 'y' : 'a'
          union.union(portKeys[localPortId], boundaryMap.get(bindingPortId)!)
          continue
        }
        pending.push({
          path: `${path}/${instance.id}`,
          sourceInstanceId: instance.id,
          kind: instance.componentId as BuiltinKind,
          parameters: structuredClone(instance.parameters),
          portSpecs: ports,
          portKeys,
        })
        continue
      }

      const definition = definitionsById.get(instance.componentId)
      if (!definition) {
        issues.push({ severity: 'error', code: 'INVALID_COMPONENT_REFERENCE', message: `${instance.name} references missing definition ${instance.componentId}.`, instanceId: instance.id })
        continue
      }
      if (activeDefinitions.has(definition.id)) {
        issues.push({ severity: 'error', code: 'RECURSIVE_COMPONENT', message: `Recursive component dependency detected at ${definition.name}.`, instanceId: instance.id })
        continue
      }
      const nestedBoundary = new Map<string, string>()
      for (const portSpec of definition.ports) nestedBoundary.set(portSpec.id, portKeys[portSpec.id])
      expand(definition.internalGraph, `${path}/${instance.id}`, nestedBoundary, new Set(activeDefinitions).add(definition.id))
    }

    // Preserve endpoint lookup even for malformed endpoints so diagnostics can identify the net.
    for (const net of currentGraph.nets) for (const endpoint of net.endpoints) {
      if (!instanceById.has(endpoint.instanceId)) continue
      endpointKeys.set(`${path}:${endpoint.instanceId}:${endpoint.portId}`, `${path}:net:${net.id}`)
    }
  }

  expand(graph, 'root', undefined, new Set())

  const groups = new Map<string, string[]>()
  for (const key of union.values()) {
    const root = union.find(key)
    const list = groups.get(root) ?? []
    list.push(key)
    groups.set(root, list)
  }
  const rootToNet = new Map<string, number>()
  const nets: CompiledNet[] = [...groups.entries()].map(([root, sourceKeys], id) => {
    rootToNet.set(root, id)
    return { id, width: Math.max(...sourceKeys.map(key => widths.get(key) ?? 1)), drivers: [], consumers: [], sourceKeys }
  })
  const netForKey = (key: string) => rootToNet.get(union.find(key))!

  const drivers: CompiledDriver[] = []
  const components: CompiledComponent[] = pending.map((item, id) => {
    const ports = Object.fromEntries(Object.entries(item.portKeys).map(([portId, key]) => [portId, netForKey(key)]))
    const outputDrivers: Record<string, number> = {}
    for (const portSpec of item.portSpecs) {
      const netId = ports[portSpec.id]
      if (portSpec.direction === 'OUTPUT' || portSpec.direction === 'INOUT') {
        const driverId = drivers.length
        drivers.push({ id: driverId, componentId: id, portId: portSpec.id, netId, width: portSpec.width })
        nets[netId].drivers.push(driverId)
        outputDrivers[portSpec.id] = driverId
      }
      if (portSpec.direction === 'INPUT' || portSpec.direction === 'INOUT') {
        if (!nets[netId].consumers.includes(id)) nets[netId].consumers.push(id)
      }
    }
    return { id, path: item.path, sourceInstanceId: item.sourceInstanceId, kind: item.kind, parameters: item.parameters, portSpecs: item.portSpecs, ports, outputDrivers }
  })

  const endpointToNet = new Map<string, number>()
  for (const [endpoint, key] of endpointKeys) endpointToNet.set(endpoint, netForKey(key))
  const sourceNetToNet = new Map<string, number>()
  for (const net of graph.nets) sourceNetToNet.set(net.id, netForKey(`root:net:${net.id}`))
  return { components, nets, drivers, endpointToNet, sourceNetToNet, issues }
}
