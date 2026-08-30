import { describe, expect, it } from 'vitest'
import { createBuiltinInstance } from './builtins'
import { analyzeGraphDelay } from './delay-analysis'
import { connectEndpoints } from './graph'
import type { CircuitGraph } from './model'

describe('delay analysis', () => {
  it('handles a circuit with no components', () => {
    expect(analyzeGraphDelay({ instances: [], nets: [] }, [])).toEqual({
      maxDelay: 0,
      feedback: false,
      criticalPath: [],
    })
  })

  it('sums each component delay exactly once along the critical path', () => {
    const input = createBuiltinInstance('INPUT_PIN', 0, 0, 'input')
    const not = createBuiltinInstance('NOT', 0, 0, 'not'); not.parameters.delay = 1
    const and = createBuiltinInstance('AND', 0, 0, 'and'); and.parameters.delay = 2
    const one = createBuiltinInstance('CONST1', 0, 0, 'one')
    const output = createBuiltinInstance('OUTPUT_PIN', 0, 0, 'output')
    let id = 0
    let graph: CircuitGraph = { instances: [input, not, and, one, output], nets: [] }
    const wire = (a: [string, string], b: [string, string]) => { graph = connectEndpoints(graph, { instanceId: a[0], portId: a[1] }, { instanceId: b[0], portId: b[1] }, [], prefix => `${prefix}_${id++}`) }
    wire(['input', 'y'], ['not', 'a']); wire(['not', 'y'], ['and', 'a']); wire(['one', 'y'], ['and', 'b']); wire(['and', 'y'], ['output', 'a'])
    const result = analyzeGraphDelay(graph, [])
    expect(result.maxDelay).toBe(3)
    expect(result.criticalPath).toEqual(['Input port', 'NOT', 'AND', 'Output port'])
  })

  it('marks signal feedback as dynamic', () => {
    const first = createBuiltinInstance('NOT', 0, 0, 'first')
    const second = createBuiltinInstance('NOT', 0, 0, 'second')
    let graph: CircuitGraph = { instances: [first, second], nets: [] }; let id = 0
    graph = connectEndpoints(graph, { instanceId: first.id, portId: 'y' }, { instanceId: second.id, portId: 'a' }, [], prefix => `${prefix}_${id++}`)
    graph = connectEndpoints(graph, { instanceId: second.id, portId: 'y' }, { instanceId: first.id, portId: 'a' }, [], prefix => `${prefix}_${id++}`)
    expect(analyzeGraphDelay(graph, [])).toMatchObject({ maxDelay: null, feedback: true })
  })
})
