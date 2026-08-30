import { BUILTINS } from './builtins'
import { getInstancePorts } from './graph'
import type { CircuitGraph, ComponentDefinition } from './model'

export interface DelayAnalysis {
  maxDelay: number | null
  feedback: boolean
  criticalPath: string[]
}

export function analyzeDefinitionDelay(definition: ComponentDefinition, definitions: ComponentDefinition[], active = new Set<string>()): DelayAnalysis {
  if (active.has(definition.id)) return { maxDelay: null, feedback: true, criticalPath: [] }
  const nextActive = new Set(active).add(definition.id)
  return analyzeGraphDelay(definition.internalGraph, definitions, nextActive)
}

export function analyzeGraphDelay(graph: CircuitGraph, definitions: ComponentDefinition[], active = new Set<string>()): DelayAnalysis {
  const nodes = graph.instances
  if (nodes.length === 0) return { maxDelay: 0, feedback: false, criticalPath: [] }

  const index = new Map(nodes.map((instance, i) => [instance.id, i]))
  const edges: number[][] = nodes.map(() => [])
  const indegree = new Uint32Array(nodes.length)
  const delays = nodes.map(instance => {
    if (instance.builtin) {
      if (instance.componentId === 'RAM_256x8') return Math.max(Number(instance.parameters.readDelay ?? 1), Number(instance.parameters.writeDelay ?? 1))
      return Math.max(0, Number(instance.parameters.delay ?? BUILTINS[instance.componentId as keyof typeof BUILTINS]?.defaultParameters.delay ?? 0))
    }
    const definition = definitions.find(candidate => candidate.id === instance.componentId)
    if (!definition) return 0
    const nested = analyzeDefinitionDelay(definition, definitions, active)
    return nested.maxDelay ?? Number.POSITIVE_INFINITY
  })

  for (const net of graph.nets) {
    const drivers = net.endpoints.filter(endpoint => {
      const instance = nodes[index.get(endpoint.instanceId) ?? -1]
      return instance && getInstancePorts(instance, definitions).find(port => port.id === endpoint.portId)?.direction !== 'INPUT'
    })
    const consumers = net.endpoints.filter(endpoint => {
      const instance = nodes[index.get(endpoint.instanceId) ?? -1]
      return instance && getInstancePorts(instance, definitions).find(port => port.id === endpoint.portId)?.direction !== 'OUTPUT'
    })
    for (const driver of drivers) for (const consumer of consumers) {
      const from = index.get(driver.instanceId); const to = index.get(consumer.instanceId)
      if (from === undefined || to === undefined || from === to || edges[from].includes(to)) continue
      edges[from].push(to); indegree[to] += 1
    }
  }

  const queue: number[] = []
  const distance = new Float64Array(nodes.length)
  const previous = new Int32Array(nodes.length).fill(-1)
  for (let i = 0; i < nodes.length; i += 1) {
    distance[i] = delays[i]
    if (indegree[i] === 0) queue.push(i)
  }
  let visited = 0
  while (queue.length) {
    const current = queue.shift()!
    visited += 1
    for (const next of edges[current]) {
      const proposed = distance[current] + delays[next]
      if (proposed >= distance[next]) { distance[next] = proposed; previous[next] = current }
      indegree[next] -= 1
      if (indegree[next] === 0) queue.push(next)
    }
  }
  if (visited !== nodes.length || delays.some(value => !Number.isFinite(value))) return { maxDelay: null, feedback: true, criticalPath: [] }
  let end = 0
  // Prefer the downstream node when zero-delay routing/boundary nodes tie.
  for (let i = 1; i < distance.length; i += 1) if (distance[i] >= distance[end]) end = i
  const maxDelay = distance[end]
  const criticalPath: string[] = []
  for (let current = end; current >= 0; current = previous[current]) {
    criticalPath.unshift(nodes[current].name)
    if (previous[current] < 0) break
  }
  return { maxDelay, feedback: false, criticalPath }
}
