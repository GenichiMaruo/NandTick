import { describe, expect, it } from 'vitest'
import { createBuiltinInstance } from './builtins'
import { connectEndpoints } from './graph'
import { exportHdl } from './hdl'
import type { CircuitGraph } from './model'

describe('HDL export', () => {
  it('emits Verilog-compatible primitives and converts ticks to physical delay', () => {
    const source = createBuiltinInstance('CONST1', 0, 0, 'source'); source.parameters.width = 8; source.parameters.delay = 2
    const output = createBuiltinInstance('OUTPUT_PIN', 0, 0, 'output'); output.parameters.width = 8
    let graph: CircuitGraph = { instances: [source, output], nets: [] }
    graph = connectEndpoints(graph, { instanceId: source.id, portId: 'y' }, { instanceId: output.id, portId: 'a' }, [], () => 'signal')
    const exported = exportHdl(graph, [], undefined, 'delay', 10)
    expect(exported.code).toContain('`timescale 1ms/1us')
    expect(exported.code).toContain("assign #20 net_signal = {8{1'b1}};")
  })

  it('uses Verilog always blocks for RAM and reports simulation-only peripherals', () => {
    const ram = createBuiltinInstance('RAM_256x8', 0, 0, 'ram')
    const pico = createBuiltinInstance('PICO88_DISPLAY', 0, 0, 'pico')
    const graph: CircuitGraph = { instances: [ram, pico], nets: [] }
    const exported = exportHdl(graph, [], undefined, 'synthesizable', 1)
    expect(exported.code).toContain('reg [7:0] RAM_256_8_memory [0:255];')
    expect(exported.code).toContain('always @(')
    expect(exported.code).not.toContain('always_ff')
    expect(exported.errors.some(error => error.includes('simulation-only'))).toBe(true)
  })
})
