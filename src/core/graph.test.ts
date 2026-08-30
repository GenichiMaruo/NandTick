import { describe, expect, it } from 'vitest'
import { createBuiltinInstance } from './builtins'
import { branchNet, connectEndpoints, definitionCycle, disconnectEndpoint, forbiddenDefinitions, setWireBranchRoute, validateGraph } from './graph'
import type { CircuitGraph, ComponentDefinition } from './model'
import { createComponentDefinition } from './project'

const id = (() => { let value = 0; return (prefix: string) => `${prefix}_${value++}` })()

describe('graph validation', () => {
  it('infers consumer width and permits output zero-extension', () => {
    const output = createBuiltinInstance('CONST1', 0, 0, 'out'); output.parameters.width = 4
    const input = createBuiltinInstance('OUTPUT_PIN', 100, 0, 'in'); input.parameters.width = 8
    let graph: CircuitGraph = { instances: [output, input], nets: [] }
    graph = connectEndpoints(graph, { instanceId: 'out', portId: 'y' }, { instanceId: 'in', portId: 'a' }, [], id)
    expect(graph.nets[0].width).toBe(8)
    expect(validateGraph(graph, []).filter(issue => issue.severity === 'error')).toHaveLength(0)
  })

  it('rejects output truncation and incompatible consumers', () => {
    const output = createBuiltinInstance('CONST1', 0, 0, 'out'); output.parameters.width = 16
    const input = createBuiltinInstance('OUTPUT_PIN', 100, 0, 'in'); input.parameters.width = 8
    let graph: CircuitGraph = { instances: [output, input], nets: [] }
    graph = connectEndpoints(graph, { instanceId: 'out', portId: 'y' }, { instanceId: 'in', portId: 'a' }, [], id)
    expect(validateGraph(graph, []).some(issue => issue.code === 'OUTPUT_TRUNCATION')).toBe(true)
  })

  it('rejects a net with consumers but no driver', () => {
    const first = createBuiltinInstance('NOT', 0, 0, 'first')
    const second = createBuiltinInstance('NOT', 0, 0, 'second')
    let graph: CircuitGraph = { instances: [first, second], nets: [] }
    graph = connectEndpoints(graph, { instanceId: first.id, portId: 'a' }, { instanceId: second.id, portId: 'a' }, [], id)
    expect(validateGraph(graph, []).some(issue => issue.code === 'UNDRIVEN_NET')).toBe(true)
  })

  it('stores editable wire routes and can add or remove one branch without deleting the net', () => {
    const source = createBuiltinInstance('CONST1', 0, 0, 'source')
    const first = createBuiltinInstance('OUTPUT_PIN', 200, 0, 'first')
    const second = createBuiltinInstance('OUTPUT_PIN', 200, 100, 'second')
    const root = { instanceId: source.id, portId: 'y' }
    const firstEndpoint = { instanceId: first.id, portId: 'a' }
    const secondEndpoint = { instanceId: second.id, portId: 'a' }
    let graph: CircuitGraph = { instances: [source, first, second], nets: [] }
    graph = connectEndpoints(graph, root, firstEndpoint, [], id)
    graph = setWireBranchRoute(graph, graph.nets[0].id, root, firstEndpoint, [{ x: 80, y: 20 }])
    graph = branchNet(graph, graph.nets[0].id, root, firstEndpoint, [{ x: 80, y: 20 }, { x: 120, y: 20 }], secondEndpoint, [{ x: 80, y: 20 }, { x: 120, y: 100 }], [], id)
    expect(graph.nets[0].endpoints).toHaveLength(3)
    expect(graph.nets[0].route?.branches).toHaveLength(2)
    graph = disconnectEndpoint(graph, secondEndpoint)
    expect(graph.nets[0].endpoints).toHaveLength(2)
    expect(graph.nets[0].route?.branches.map(branch => branch.endpoint)).toEqual([firstEndpoint])
  })

  it('detects recursive definitions and excludes reverse dependants', () => {
    const a = createComponentDefinition('A', [{ name: 'I', direction: 'INPUT', width: 1 }])
    const b = createComponentDefinition('B', [{ name: 'I', direction: 'INPUT', width: 1 }])
    const use = (definition: ComponentDefinition, target: ComponentDefinition) => definition.internalGraph.instances.push({ id: `${definition.name}_${target.name}`, name: target.name, componentId: target.id, builtin: false, position: { x: 0, y: 0 }, rotation: 0, parameters: {} })
    use(b, a)
    expect(forbiddenDefinitions(a.id, [a, b])).toEqual(new Set([a.id, b.id]))
    use(a, b)
    expect(definitionCycle([a, b])).not.toBeNull()
  })
})
