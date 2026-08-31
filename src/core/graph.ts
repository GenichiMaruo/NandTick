import { BUILTINS, getBuiltinPorts } from './builtins'
import type {
  CircuitGraph,
  ComponentDefinition,
  ComponentInstance,
  LooseWireRoute,
  Net,
  NetEndpoint,
  Point,
  PortSpec,
  Project,
  ValidationIssue,
} from './model'

export function getInstancePorts(instance: ComponentInstance, definitions: ComponentDefinition[]): PortSpec[] {
  if (instance.builtin) return getBuiltinPorts(instance)
  return definitions.find(definition => definition.id === instance.componentId)?.ports ?? []
}

export function getPort(instance: ComponentInstance, portId: string, definitions: ComponentDefinition[]): PortSpec | undefined {
  return getInstancePorts(instance, definitions).find(port => port.id === portId)
}

export function endpointKey(endpoint: NetEndpoint): string {
  return `${endpoint.instanceId}:${endpoint.portId}`
}

export function inferNetWidth(endpoints: NetEndpoint[], graph: CircuitGraph, definitions: ComponentDefinition[]): number {
  const ports = endpoints.flatMap(endpoint => {
    const instance = graph.instances.find(candidate => candidate.id === endpoint.instanceId)
    const found = instance ? getPort(instance, endpoint.portId, definitions) : undefined
    return found ? [found] : []
  })
  const consumers = ports.filter(port => port.direction === 'INPUT' || port.direction === 'INOUT')
  if (consumers.length) return consumers[0].width
  const outputs = ports.filter(port => port.direction === 'OUTPUT')
  return Math.max(1, ...outputs.map(port => port.width))
}

export function connectEndpoints(
  graph: CircuitGraph,
  first: NetEndpoint,
  second: NetEndpoint,
  definitions: ComponentDefinition[],
  createId: (prefix: string) => string,
): CircuitGraph {
  if (endpointKey(first) === endpointKey(second)) return graph
  const firstNet = graph.nets.find(net => net.endpoints.some(endpoint => endpointKey(endpoint) === endpointKey(first)))
  const secondNet = graph.nets.find(net => net.endpoints.some(endpoint => endpointKey(endpoint) === endpointKey(second)))
  if (firstNet && secondNet && firstNet.id === secondNet.id) return graph

  let nets: Net[]
  if (firstNet && secondNet) {
    const mergedEndpoints = uniqueEndpoints([...firstNet.endpoints, ...secondNet.endpoints])
    const routeSource = firstNet.route ?? secondNet.route
    const looseWires = [...(firstNet.route?.looseWires ?? []), ...(secondNet.route?.looseWires ?? [])]
    const route = routeSource || looseWires.length ? {
      root: routeSource?.root ?? mergedEndpoints[0],
      branches: routeSource?.branches ?? [],
      looseWires,
    } : undefined
    const merged = pruneWireRoute({ ...firstNet, endpoints: mergedEndpoints, width: inferNetWidth(mergedEndpoints, graph, definitions), route })
    nets = graph.nets.filter(net => net.id !== secondNet.id).map(net => net.id === firstNet.id ? merged : net)
  } else if (firstNet || secondNet) {
    const existing = firstNet ?? secondNet!
    const added = firstNet ? second : first
    const mergedEndpoints = uniqueEndpoints([...existing.endpoints, added])
    nets = graph.nets.map(net => net.id === existing.id ? { ...net, endpoints: mergedEndpoints, width: inferNetWidth(mergedEndpoints, graph, definitions) } : net)
  } else {
    const endpoints = [first, second]
    nets = [...graph.nets, { id: createId('net'), endpoints, width: inferNetWidth(endpoints, graph, definitions) }]
  }
  return { ...graph, nets }
}

function uniqueEndpoints(endpoints: NetEndpoint[]): NetEndpoint[] {
  const seen = new Set<string>()
  return endpoints.filter(endpoint => {
    const key = endpointKey(endpoint)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function pruneWireRoute(net: Net): Net {
  if (!net.route) return net
  const endpointKeys = new Set(net.endpoints.map(endpointKey))
  const root = net.route.root && endpointKeys.has(endpointKey(net.route.root)) ? net.route.root : net.endpoints[0]
  const looseWires = (net.route.looseWires ?? []).map(wire => ({
    ...wire,
    startEndpoint: wire.startEndpoint && endpointKeys.has(endpointKey(wire.startEndpoint)) ? wire.startEndpoint : undefined,
    endEndpoint: wire.endEndpoint && endpointKeys.has(endpointKey(wire.endEndpoint)) ? wire.endEndpoint : undefined,
  }))
  if (!root && !looseWires.length) return { ...net, route: undefined }
  return {
    ...net,
    route: {
      root,
      branches: root ? net.route.branches.filter(branch => endpointKeys.has(endpointKey(branch.endpoint)) && endpointKey(branch.endpoint) !== endpointKey(root)) : [],
      looseWires,
    },
  }
}

export function setWireBranchRoute(graph: CircuitGraph, netId: string, root: NetEndpoint, endpoint: NetEndpoint, points: Point[]): CircuitGraph {
  return {
    ...graph,
    nets: graph.nets.map(net => {
      if (net.id !== netId) return net
      const endpointKeys = new Set(net.endpoints.map(endpointKey))
      if (!endpointKeys.has(endpointKey(root)) || !endpointKeys.has(endpointKey(endpoint)) || endpointKey(root) === endpointKey(endpoint)) return net
      const branches = (net.route?.branches ?? []).filter(branch => endpointKey(branch.endpoint) !== endpointKey(endpoint))
      return { ...net, route: { root, branches: [...branches, { endpoint, points }], looseWires: net.route?.looseWires } }
    }),
  }
}

export function addLooseWire(
  graph: CircuitGraph,
  wire: Omit<LooseWireRoute, 'id'>,
  definitions: ComponentDefinition[],
  createId: (prefix: string) => string,
  netId?: string,
): CircuitGraph {
  const anchors = uniqueEndpoints([wire.startEndpoint, wire.endEndpoint].filter((endpoint): endpoint is NetEndpoint => Boolean(endpoint)))
  const looseWire: LooseWireRoute = { ...wire, id: createId('loose') }
  let next = graph
  let resolvedNetId = netId ?? graph.nets.find(net => anchors.some(anchor => net.endpoints.some(endpoint => endpointKey(endpoint) === endpointKey(anchor))))?.id

  if (resolvedNetId) for (const anchor of anchors) {
    const target = next.nets.find(net => net.id === resolvedNetId)
    if (!target) break
    const owner = next.nets.find(net => net.endpoints.some(endpoint => endpointKey(endpoint) === endpointKey(anchor)))
    if (owner && owner.id !== target.id) {
      if (target.endpoints.length) {
        const sourceEndpoint = target.endpoints[0]
        next = connectEndpoints(next, sourceEndpoint, anchor, definitions, createId)
        resolvedNetId = next.nets.find(net => net.endpoints.some(endpoint => endpointKey(endpoint) === endpointKey(sourceEndpoint)) && net.endpoints.some(endpoint => endpointKey(endpoint) === endpointKey(anchor)))?.id ?? target.id
      } else {
        const targetLooseWires = target.route?.looseWires ?? []
        next = {
          ...next,
          nets: next.nets.filter(net => net.id !== target.id).map(net => net.id !== owner.id ? net : {
            ...net,
            route: {
              root: net.route?.root ?? net.endpoints[0],
              branches: net.route?.branches ?? [],
              looseWires: [...(net.route?.looseWires ?? []), ...targetLooseWires],
            },
          }),
        }
        resolvedNetId = owner.id
      }
    } else if (!owner) {
      next = {
        ...next,
        nets: next.nets.map(net => {
          if (net.id !== target.id) return net
          const endpoints = uniqueEndpoints([...net.endpoints, anchor])
          return { ...net, endpoints, width: inferNetWidth(endpoints, next, definitions) }
        }),
      }
    }
  }

  const existing = resolvedNetId ? next.nets.find(net => net.id === resolvedNetId) : undefined
  if (!existing) {
    const id = createId('net')
    const endpoints = anchors
    return {
      ...next,
      nets: [...next.nets, {
        id,
        endpoints,
        width: inferNetWidth(endpoints, next, definitions),
        route: { root: endpoints[0], branches: [], looseWires: [looseWire] },
      }],
    }
  }
  return {
    ...next,
    nets: next.nets.map(net => {
      if (net.id !== existing.id) return net
      const endpoints = uniqueEndpoints([...net.endpoints, ...anchors])
      return {
        ...net,
        endpoints,
        width: inferNetWidth(endpoints, next, definitions),
        route: {
          root: net.route?.root ?? endpoints[0],
          branches: net.route?.branches ?? [],
          looseWires: [...(net.route?.looseWires ?? []), looseWire],
        },
      }
    }),
  }
}

export function setLooseWireRoute(graph: CircuitGraph, netId: string, wireId: string, points: Point[], start?: Point, end?: Point): CircuitGraph {
  return {
    ...graph,
    nets: graph.nets.map(net => net.id !== netId || !net.route ? net : {
      ...net,
      route: {
        ...net.route,
        looseWires: (net.route.looseWires ?? []).map(wire => wire.id === wireId ? {
          ...wire,
          points,
          start: start ?? wire.start,
          end: end ?? wire.end,
        } : wire),
      },
    }),
  }
}

export function connectLooseWire(
  graph: CircuitGraph,
  netId: string,
  wireId: string,
  side: 'start' | 'end',
  endpoint: NetEndpoint,
  point: Point,
  definitions: ComponentDefinition[],
  createId: (prefix: string) => string,
): CircuitGraph {
  const sourceNet = graph.nets.find(net => net.id === netId)
  const looseWire = sourceNet?.route?.looseWires?.find(wire => wire.id === wireId)
  if (!sourceNet || !looseWire) return graph
  const owner = graph.nets.find(net => net.endpoints.some(candidate => endpointKey(candidate) === endpointKey(endpoint)))
  let next = graph
  let resolvedNetId = sourceNet.id

  if (owner && owner.id !== sourceNet.id) {
    if (sourceNet.endpoints.length) {
      const sourceEndpoint = sourceNet.endpoints[0]
      next = connectEndpoints(next, sourceEndpoint, endpoint, definitions, createId)
      resolvedNetId = next.nets.find(net => net.endpoints.some(candidate => endpointKey(candidate) === endpointKey(sourceEndpoint)) && net.endpoints.some(candidate => endpointKey(candidate) === endpointKey(endpoint)))?.id ?? sourceNet.id
    } else {
      next = {
        ...next,
        nets: next.nets.filter(net => net.id !== sourceNet.id).map(net => net.id !== owner.id ? net : {
          ...net,
          route: {
            root: net.route?.root ?? net.endpoints[0],
            branches: net.route?.branches ?? [],
            looseWires: [...(net.route?.looseWires ?? []), ...(sourceNet.route?.looseWires ?? [])],
          },
        }),
      }
      resolvedNetId = owner.id
    }
  } else if (!owner) {
    next = {
      ...next,
      nets: next.nets.map(net => {
        if (net.id !== sourceNet.id) return net
        const endpoints = uniqueEndpoints([...net.endpoints, endpoint])
        return { ...net, endpoints, width: inferNetWidth(endpoints, { ...next, nets: next.nets }, definitions) }
      }),
    }
  }

  return {
    ...next,
    nets: next.nets.map(net => net.id !== resolvedNetId || !net.route ? net : {
      ...net,
      route: {
        ...net.route,
        looseWires: (net.route.looseWires ?? []).map(wire => wire.id !== wireId ? wire : side === 'start'
          ? { ...wire, start: point, startEndpoint: endpoint }
          : { ...wire, end: point, endEndpoint: endpoint }),
      },
    }),
  }
}

export function removeLooseWire(graph: CircuitGraph, netId: string, wireId: string): CircuitGraph {
  return {
    ...graph,
    nets: graph.nets.flatMap(net => {
      if (net.id !== netId || !net.route) return [net]
      const looseWires = (net.route.looseWires ?? []).filter(wire => wire.id !== wireId)
      if (!looseWires.length && net.endpoints.length < 2) return []
      return [pruneWireRoute({ ...net, route: { ...net.route, looseWires } })]
    }),
  }
}

export function branchNet(
  graph: CircuitGraph,
  netId: string,
  root: NetEndpoint,
  sourceEndpoint: NetEndpoint,
  sourcePoints: Point[],
  targetEndpoint: NetEndpoint,
  targetPoints: Point[],
  definitions: ComponentDefinition[],
  createId: (prefix: string) => string,
): CircuitGraph {
  const net = graph.nets.find(candidate => candidate.id === netId)
  if (!net || net.endpoints.some(endpoint => endpointKey(endpoint) === endpointKey(targetEndpoint))) return graph
  const connected = connectEndpoints(graph, root, targetEndpoint, definitions, createId)
  const merged = connected.nets.find(candidate => candidate.endpoints.some(endpoint => endpointKey(endpoint) === endpointKey(root)) && candidate.endpoints.some(endpoint => endpointKey(endpoint) === endpointKey(targetEndpoint)))
  if (!merged) return connected
  const routedSource = setWireBranchRoute(connected, merged.id, root, sourceEndpoint, sourcePoints)
  return setWireBranchRoute(routedSource, merged.id, root, targetEndpoint, targetPoints)
}

export function disconnectEndpoint(graph: CircuitGraph, endpoint: NetEndpoint): CircuitGraph {
  return {
    ...graph,
    nets: graph.nets
      .map(net => pruneWireRoute({ ...net, endpoints: net.endpoints.filter(candidate => endpointKey(candidate) !== endpointKey(endpoint)) }))
      .filter(net => net.endpoints.length > 1 || Boolean(net.route?.looseWires?.length)),
  }
}

export function removeInstances(graph: CircuitGraph, ids: Set<string>): CircuitGraph {
  return {
    instances: graph.instances.filter(instance => !ids.has(instance.id)),
    nets: graph.nets
      .map(net => pruneWireRoute({ ...net, endpoints: net.endpoints.filter(endpoint => !ids.has(endpoint.instanceId)) }))
      .filter(net => net.endpoints.length > 1 || Boolean(net.route?.looseWires?.length)),
  }
}

export function directDependencies(definition: ComponentDefinition): Set<string> {
  return new Set(definition.internalGraph.instances.filter(instance => !instance.builtin).map(instance => instance.componentId))
}

export function definitionCycle(definitions: ComponentDefinition[]): string[] | null {
  const byId = new Map(definitions.map(definition => [definition.id, definition]))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const stack: string[] = []
  const visit = (id: string): string[] | null => {
    if (visiting.has(id)) return [...stack.slice(stack.indexOf(id)), id]
    if (visited.has(id)) return null
    visiting.add(id)
    stack.push(id)
    const definition = byId.get(id)
    if (definition) {
      for (const dependency of directDependencies(definition)) {
        const cycle = visit(dependency)
        if (cycle) return cycle
      }
    }
    stack.pop()
    visiting.delete(id)
    visited.add(id)
    return null
  }
  for (const definition of definitions) {
    const cycle = visit(definition.id)
    if (cycle) return cycle
  }
  return null
}

/** Definitions hidden while editing `target`, including all reverse dependants. */
export function forbiddenDefinitions(target: string, definitions: ComponentDefinition[]): Set<string> {
  const forbidden = new Set([target])
  let changed = true
  while (changed) {
    changed = false
    for (const definition of definitions) {
      if (forbidden.has(definition.id)) continue
      if ([...directDependencies(definition)].some(dependency => forbidden.has(dependency))) {
        forbidden.add(definition.id)
        changed = true
      }
    }
  }
  return forbidden
}

export function validateGraph(graph: CircuitGraph, definitions: ComponentDefinition[]): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const instanceById = new Map(graph.instances.map(instance => [instance.id, instance]))
  const attached = new Map<string, string>()

  for (const net of graph.nets) {
    if (!Number.isInteger(net.width) || net.width < 1) {
      issues.push({ severity: 'error', code: 'INVALID_WIDTH', message: `Net ${net.name ?? net.id} has an invalid width.`, netId: net.id })
      continue
    }
    let driverCount = 0
    for (const endpoint of net.endpoints) {
      const instance = instanceById.get(endpoint.instanceId)
      const endpointId = endpointKey(endpoint)
      if (attached.has(endpointId) && attached.get(endpointId) !== net.id) {
        issues.push({ severity: 'error', code: 'MULTIPLE_NETS', message: `${endpointId} is connected to more than one net.`, netId: net.id, instanceId: endpoint.instanceId })
      }
      attached.set(endpointId, net.id)
      if (!instance) {
        issues.push({ severity: 'error', code: 'INVALID_INSTANCE', message: `Net references missing instance ${endpoint.instanceId}.`, netId: net.id })
        continue
      }
      const portSpec = getPort(instance, endpoint.portId, definitions)
      if (!portSpec) {
        issues.push({ severity: 'error', code: 'INVALID_PORT', message: `${instance.name} has no port ${endpoint.portId}.`, netId: net.id, instanceId: instance.id })
        continue
      }
      if (portSpec.direction === 'OUTPUT') {
        driverCount += 1
        if (portSpec.width > net.width) issues.push({ severity: 'error', code: 'OUTPUT_TRUNCATION', message: `Cannot truncate ${portSpec.width}-bit output ${instance.name}.${portSpec.name} to ${net.width}-bit bus.`, netId: net.id, instanceId: instance.id })
      } else {
        if (portSpec.direction === 'INOUT') driverCount += 1
        if (portSpec.width !== net.width) issues.push({ severity: 'error', code: 'WIDTH_MISMATCH', message: `Width mismatch: ${portSpec.direction.toLowerCase()} ${instance.name}.${portSpec.name} requires ${portSpec.width} bits, connected bus is ${net.width} bits.`, netId: net.id, instanceId: instance.id })
      }
    }
    if (driverCount === 0 && net.endpoints.length > 0) issues.push({ severity: 'error', code: 'UNDRIVEN_NET', message: `${net.name ?? net.id} has no OUTPUT or INOUT driver.`, netId: net.id })
    if (driverCount > 1) issues.push({ severity: 'warning', code: 'MULTIPLE_DRIVERS', message: `${net.name ?? net.id} has ${driverCount} drivers; X/Z resolution is enabled.`, netId: net.id })
  }

  for (const instance of graph.instances) {
    const ports = getInstancePorts(instance, definitions)
    for (const portSpec of ports) {
      if ((portSpec.direction === 'INPUT' || portSpec.direction === 'INOUT') && !attached.has(`${instance.id}:${portSpec.id}`)) {
        issues.push({ severity: 'error', code: 'UNCONNECTED_INPUT', message: `Required input ${instance.name}.${portSpec.name} is not connected.`, instanceId: instance.id })
      }
    }
    if (!instance.builtin && !definitions.some(definition => definition.id === instance.componentId)) {
      issues.push({ severity: 'error', code: 'INVALID_COMPONENT_REFERENCE', message: `${instance.name} references a missing component definition.`, instanceId: instance.id })
    }
    if (instance.builtin && !(instance.componentId in BUILTINS)) {
      issues.push({ severity: 'error', code: 'INVALID_BUILTIN', message: `${instance.name} has an unknown builtin type.`, instanceId: instance.id })
    }
    if (instance.componentId === 'RAM_256x8') {
      const memory = instance.parameters.initialMemory
      if (!Array.isArray(memory) || memory.length !== 256 || memory.some(value => !Number.isInteger(value) || value < 0 || value > 255)) {
        issues.push({ severity: 'error', code: 'INVALID_MEMORY', message: `${instance.name} must contain exactly 256 bytes.`, instanceId: instance.id })
      }
    }
    if (instance.componentId === 'CLOCK') {
      const period = Number(instance.parameters.periodTicks)
      const high = Number(instance.parameters.highTicks)
      const low = Number(instance.parameters.lowTicks)
      if (![period, high, low].every(value => Number.isInteger(value) && value >= 1) || period !== high + low) {
        issues.push({ severity: 'error', code: 'INVALID_CLOCK', message: `${instance.name} requires positive integer timing with periodTicks = highTicks + lowTicks.`, instanceId: instance.id })
      }
    }
  }
  return issues
}

export function validateProject(project: Project, graph: CircuitGraph = project.mainGraph): ValidationIssue[] {
  const issues = validateGraph(graph, project.definitions)
  const cycle = definitionCycle(project.definitions)
  if (cycle) issues.push({ severity: 'error', code: 'RECURSIVE_COMPONENT', message: `Recursive component dependency detected: ${cycle.join(' → ')}` })
  return issues
}
