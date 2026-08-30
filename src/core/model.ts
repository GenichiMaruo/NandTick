export type PortDirection = 'INPUT' | 'OUTPUT' | 'INOUT'
export type PortSide = 'left' | 'right' | 'top' | 'bottom'

export interface Point {
  x: number
  y: number
}

export interface PortSpec {
  id: string
  name: string
  direction: PortDirection
  width: number
  position: { side: PortSide; offset: number }
  displayOrder: number
  description?: string
}

export type ComponentShape =
  | 'rectangle'
  | 'rounded'
  | 'ellipse'
  | 'pill'
  | 'trapezoid'
  | 'polygon'
  | 'diamond'
  | 'hexagon'
  | 'and-gate'
  | 'or-gate'
  | 'xor-gate'
  | 'triangle'

export type PreviewMode = 'off' | 'compact' | 'expanded'

export interface ComponentVisual {
  fill: string
  border: string
  text: string
  shape: ComponentShape
  width: number
  height: number
}

export type BuiltinKind =
  | 'CONST0'
  | 'CONST1'
  | 'NOT'
  | 'AND'
  | 'OR'
  | 'XOR'
  | 'NAND'
  | 'NOR'
  | 'XNOR'
  | 'BUFFER'
  | 'TOGGLE'
  | 'BUTTON'
  | 'CLOCK'
  | 'INPUT_PIN'
  | 'OUTPUT_PIN'
  | 'BIT_SELECT'
  | 'BUS_SLICE'
  | 'BUS_JOIN'
  | 'JUNCTION'
  | 'RAM_256x8'
  | 'PICO88_DISPLAY'

export interface ComponentInstance {
  id: string
  name: string
  componentId: BuiltinKind | string
  builtin: boolean
  position: Point
  rotation: number
  parameters: Record<string, unknown>
  /** Per-instance presentation only; never affects compilation or simulation. */
  visualOverride?: Partial<ComponentVisual>
}

export interface NetEndpoint {
  instanceId: string
  portId: string
}

export interface WireBranchRoute {
  /** The non-root endpoint reached by this branch. */
  endpoint: NetEndpoint
  /** Editable world-space bend points, ordered from the route root to the endpoint. */
  points: Point[]
}

export interface WireRoute {
  /** Every branch starts at this endpoint; routing is presentation-only. */
  root: NetEndpoint
  branches: WireBranchRoute[]
}

export interface Net {
  id: string
  name?: string
  width: number
  endpoints: NetEndpoint[]
  route?: WireRoute
}

export interface CircuitGraph {
  instances: ComponentInstance[]
  nets: Net[]
}

export interface CircuitTestCase {
  id: string
  enabled: boolean
  name: string
  inputs: Record<string, string>
  expected: Record<string, string>
  sampleTick: number
  sequence?: Array<{ tick: number; inputs?: Record<string, string>; expected?: Record<string, string> }>
  result: 'PASS' | 'FAIL' | 'RUNNING' | 'NOT_RUN'
  actual?: Record<string, string>
  failure?: string
}

export interface ComponentDefinition {
  id: string
  name: string
  ports: PortSpec[]
  internalGraph: CircuitGraph
  visual: ComponentVisual
  description?: string
  category: string
  tests: CircuitTestCase[]
  metadata: { createdAt: string; updatedAt: string }
}

export interface ProjectSettings {
  tickDurationMs: number
  eventsPerTickLimit: number
  maxAutomaticTicks: number
  liveSignals: boolean
}

export interface Project {
  version: 1
  id: string
  name: string
  description: string
  createdAt: string
  updatedAt: string
  settings: ProjectSettings
  mainGraph: CircuitGraph
  definitions: ComponentDefinition[]
  tests: CircuitTestCase[]
}

export interface ValidationIssue {
  severity: 'error' | 'warning'
  code: string
  message: string
  netId?: string
  instanceId?: string
}

export const EMPTY_GRAPH: CircuitGraph = { instances: [], nets: [] }

export function createId(prefix: string): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10)
  return `${prefix}_${random}`
}

export function cloneProject(project: Project): Project {
  return structuredClone(project)
}
