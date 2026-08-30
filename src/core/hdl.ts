import { BUILTINS } from './builtins'
import { analyzeDefinitionDelay, analyzeGraphDelay } from './delay-analysis'
import { getInstancePorts } from './graph'
import type { CircuitGraph, ComponentDefinition, ComponentInstance, Net, PortSpec } from './model'

export type HdlMode = 'synthesizable' | 'delay'
export interface HdlExport { code: string; warnings: string[]; errors: string[] }

const ident = (value: string) => {
  const normalized = value.replace(/[^a-zA-Z0-9_$]/g, '_')
  return /^[a-zA-Z_$]/.test(normalized) ? normalized : `_${normalized}`
}
const range = (width: number) => width > 1 ? `[${width - 1}:0] ` : ''

function netFor(graph: CircuitGraph, instanceId: string, portId: string): Net | undefined {
  return graph.nets.find(net => net.endpoints.some(endpoint => endpoint.instanceId === instanceId && endpoint.portId === portId))
}

function moduleForGraph(name: string, graph: CircuitGraph, definitions: ComponentDefinition[], definition: ComponentDefinition | undefined, mode: HdlMode, tickMs: number, warnings: string[], errors: string[]): string {
  const ports = definition?.ports ?? []
  const delay = definition ? analyzeDefinitionDelay(definition, definitions) : analyzeGraphDelay(graph, definitions)
  const lines: string[] = []
  lines.push(`// simulator_max_delay_ticks = ${delay.maxDelay ?? 'feedback / dynamic'}`)
  if (mode === 'delay') lines.push(`// simulation-only delay model; 1 tick = ${tickMs} ms`)
  lines.push(`module ${ident(name)}${ports.length ? ' (' : ';'}`)
  ports.forEach((port, index) => lines.push(`  ${port.direction.toLowerCase()} wire ${range(port.width)}${ident(port.name)}${index === ports.length - 1 ? '' : ','}`))
  if (ports.length) lines.push(');')
  for (const net of graph.nets) lines.push(`  wire ${range(net.width)}${ident(net.name ?? `net_${net.id}`)};`)

  const netName = (instance: ComponentInstance, port: PortSpec) => {
    const net = netFor(graph, instance.id, port.id)
    return net ? ident(net.name ?? `net_${net.id}`) : `${port.width}'bz`
  }
  const physicalDelay = (ticks: number) => Number((Math.max(0, ticks) * tickMs).toFixed(6))
  const delayed = (instance: ComponentInstance) => mode === 'delay' && Number(instance.parameters.delay ?? 0) > 0 ? `#${physicalDelay(Number(instance.parameters.delay))} ` : ''
  for (const instance of graph.instances) {
    const portsForInstance = getInstancePorts(instance, definitions)
    const p = Object.fromEntries(portsForInstance.map(port => [port.id, netName(instance, port)]))
    const assign = (target: string, expression: string) => lines.push(`  assign ${delayed(instance)}${target} = ${expression};`)
    const assignPort = (portId: string, expression: string) => {
      const port = portsForInstance.find(candidate => candidate.id === portId)
      const net = netFor(graph, instance.id, portId)
      const extended = port && net && port.direction === 'OUTPUT' && port.width < net.width
        ? `{{${net.width - port.width}{1'b0}}, ${expression}}`
        : expression
      assign(p[portId], extended)
    }
    if (!instance.builtin) {
      const target = definitions.find(candidate => candidate.id === instance.componentId)
      if (!target) { errors.push(`Missing component definition for ${instance.name}.`); continue }
      lines.push(`  ${ident(target.name)} ${ident(instance.name)} (${target.ports.map(port => `.${ident(port.name)}(${p[port.id]})`).join(', ')});`)
      continue
    }
    switch (instance.componentId) {
      case 'CONST0': assignPort('y', `{${Number(instance.parameters.width ?? 1)}{1'b0}}`); break
      case 'CONST1': assignPort('y', `{${Number(instance.parameters.width ?? 1)}{1'b1}}`); break
      case 'NOT': assignPort('y', `~${p.a}`); break
      case 'AND': assignPort('y', `${p.a} & ${p.b}`); break
      case 'OR': assignPort('y', `${p.a} | ${p.b}`); break
      case 'XOR': assignPort('y', `${p.a} ^ ${p.b}`); break
      case 'NAND': assignPort('y', `~(${p.a} & ${p.b})`); break
      case 'NOR': assignPort('y', `~(${p.a} | ${p.b})`); break
      case 'XNOR': assignPort('y', `~(${p.a} ^ ${p.b})`); break
      case 'BUFFER': case 'JUNCTION': assignPort('y', p.a); break
      case 'BIT_SELECT': assignPort('y', `${p.a}[${Number(instance.parameters.bit ?? 0)}]`); break
      case 'BUS_SLICE': assignPort('y', `${p.a}[${Number(instance.parameters.msb ?? 0)}:${Number(instance.parameters.lsb ?? 0)}]`); break
      case 'BUS_JOIN': assignPort('y', `{${p.high}, ${p.low}}`); break
      case 'INPUT_PIN': {
        const port = definition?.ports.find(candidate => candidate.id === instance.parameters.bindingPortId)
        if (port?.direction === 'INOUT') lines.push(`  tran (${p.y}, ${ident(port.name)});`)
        else if (port) assignPort('y', ident(port.name))
        break
      }
      case 'OUTPUT_PIN': {
        const port = definition?.ports.find(candidate => candidate.id === instance.parameters.bindingPortId)
        if (port) assign(ident(port.name), p.a); break
      }
      case 'RAM_256x8': {
        const memory = ident(`${instance.name}_memory`)
        lines.push(`  reg [7:0] ${memory} [0:255];`)
        const initial = Array.isArray(instance.parameters.initialMemory) ? instance.parameters.initialMemory as number[] : []
        if (initial.some(value => value !== 0)) {
          lines.push(`  initial begin`)
          initial.forEach((value, address) => { if (value) lines.push(`    ${memory}[8'h${address.toString(16).padStart(2, '0')}] = 8'h${value.toString(16).padStart(2, '0')};`) })
          lines.push('  end')
          warnings.push(`${instance.name}: current memory contents are embedded in HDL source.`)
        }
        lines.push(`  integer ${ident(`${instance.name}_i`)};`)
        lines.push(`  always @(posedge ${p.clk} or posedge ${p.reset}) begin`)
        lines.push(`    if (${p.reset}) for (${ident(`${instance.name}_i`)} = 0; ${ident(`${instance.name}_i`)} < 256; ${ident(`${instance.name}_i`)}++) ${memory}[${ident(`${instance.name}_i`)}] <= 8'h00;`)
        lines.push(`    else if (${p.writeEn}) ${memory}[${p.addr}] <= ${p.dataIn};`)
        lines.push('  end')
        const readDelay = mode === 'delay' ? `#${physicalDelay(Number(instance.parameters.readDelay ?? 1))} ` : ''
        const dataOutNet = netFor(graph, instance.id, 'dataOut')
        const readValue = `${p.readEn} ? ${memory}[${p.addr}] : 8'bz`
        const extendedRead = dataOutNet && dataOutNet.width > 8 ? `{{${dataOutNet.width - 8}{1'b0}}, (${readValue})}` : readValue
        lines.push(`  assign ${readDelay}${p.dataOut} = ${extendedRead};`)
        break
      }
      case 'PICO88_DISPLAY': errors.push(`${instance.name}: PICO88_DISPLAY is simulation-only and cannot be exported as synthesizable logic.`); break
      case 'TOGGLE': case 'BUTTON': case 'CLOCK': errors.push(`${instance.name}: ${instance.componentId} is a test utility and cannot be exported.`); break
    }
  }
  lines.push('endmodule')
  return lines.join('\n')
}

export function exportHdl(graph: CircuitGraph, definitions: ComponentDefinition[], currentDefinition: ComponentDefinition | undefined, mode: HdlMode, tickMs: number): HdlExport {
  const warnings: string[] = []; const errors: string[] = []
  const used = new Set<string>()
  const ordered: ComponentDefinition[] = []
  const visit = (definition: ComponentDefinition) => {
    if (used.has(definition.id)) return
    used.add(definition.id)
    for (const instance of definition.internalGraph.instances) if (!instance.builtin) {
      const dependency = definitions.find(candidate => candidate.id === instance.componentId)
      if (dependency) visit(dependency)
    }
    ordered.push(definition)
  }
  if (currentDefinition) visit(currentDefinition)
  else for (const instance of graph.instances) if (!instance.builtin) {
    const definition = definitions.find(candidate => candidate.id === instance.componentId)
    if (definition) visit(definition)
  }
  const modules = ordered.filter(definition => definition.id !== currentDefinition?.id).map(definition => moduleForGraph(definition.name, definition.internalGraph, definitions, definition, mode, tickMs, warnings, errors))
  modules.push(moduleForGraph(currentDefinition?.name ?? 'NandTickTop', graph, definitions, currentDefinition, mode, tickMs, warnings, errors))
  const timescale = mode === 'delay' ? '`timescale 1ms/1us\n\n' : ''
  return { code: timescale + modules.join('\n\n'), warnings, errors }
}

export const builtinSynthesizable = (kind: keyof typeof BUILTINS) => BUILTINS[kind].synthesizable
