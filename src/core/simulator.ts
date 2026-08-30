import type { CompiledCircuit, CompiledComponent } from './compiler'
import { concatenate, HIGH, LogicValue, logicAnd, logicNot, logicOr, logicXor, LOW, resolveDrivers, X, Z } from './logic-value'

type DriverEvent = { kind: 'driver'; driverId: number; value: LogicValue }
type ClockEvent = { kind: 'clock'; componentId: number; high: boolean }
type MemoryWriteEvent = { kind: 'memory-write'; componentId: number; address: number; value: number }
type SimulatorEvent = DriverEvent | ClockEvent | MemoryWriteEvent

interface ClockState { high: boolean }
interface RamState { memory: Uint8Array; lastClock: boolean }
export interface PicoState {
  screen: Uint8Array
  vram: Uint8Array
  lastExec: boolean
  r1Out: number
  lastCommand: string
  currentAddress: number
  selectedNibble: 'high' | 'low'
  registers: [number, number, number, number]
}

export interface SimulatorStats {
  currentTick: number
  pendingEvents: number
  evaluatedComponents: number
  processedEvents: number
  oscillation: string | null
}

const commandNames = ['PLOT', 'BPLOT', 'CLS', 'BCLS', 'FLIP', 'VPOKE', 'VPEEK', '—']

export class Simulator {
  readonly compiled: CompiledCircuit
  currentTick = 0
  readonly netValues: LogicValue[]
  readonly netLastChanged: Uint32Array
  readonly driverValues: LogicValue[]
  private readonly desiredValues: LogicValue[]
  private readonly eventBuckets = new Map<number, SimulatorEvent[]>()
  private readonly states = new Map<number, ClockState | RamState | PicoState>()
  private processedEvents = 0
  private evaluatedComponents = 0
  private oscillation: string | null = null
  private eventsPerTickLimit: number

  constructor(compiled: CompiledCircuit, eventsPerTickLimit = 10000) {
    this.compiled = compiled
    this.eventsPerTickLimit = eventsPerTickLimit
    this.netValues = compiled.nets.map(net => LogicValue.fill(net.width, Z))
    this.netLastChanged = new Uint32Array(compiled.nets.length)
    this.driverValues = compiled.drivers.map(driver => LogicValue.fill(driver.width, Z))
    this.desiredValues = this.driverValues.map(value => value.clone())
    this.reset()
  }

  reset(): void {
    this.currentTick = 0
    this.processedEvents = 0
    this.evaluatedComponents = 0
    this.oscillation = null
    this.eventBuckets.clear()
    this.states.clear()
    for (const net of this.compiled.nets) this.netValues[net.id] = LogicValue.fill(net.width, Z)
    this.netLastChanged.fill(0)
    for (const driver of this.compiled.drivers) {
      this.driverValues[driver.id] = LogicValue.fill(driver.width, Z)
      this.desiredValues[driver.id] = this.driverValues[driver.id].clone()
    }
    for (const component of this.compiled.components) {
      if (component.kind === 'RAM_256x8') {
        const initial = Array.isArray(component.parameters.initialMemory) ? component.parameters.initialMemory as number[] : []
        const memory = new Uint8Array(256)
        memory.set(initial.slice(0, 256))
        this.states.set(component.id, { memory, lastClock: false } satisfies RamState)
      } else if (component.kind === 'PICO88_DISPLAY') {
        this.states.set(component.id, { screen: new Uint8Array(128), vram: new Uint8Array(128), lastExec: false, r1Out: 0, lastCommand: '—', currentAddress: 0, selectedNibble: 'high', registers: [0, 0, 0, 0] } satisfies PicoState)
      } else if (component.kind === 'CLOCK') {
        const high = Boolean(Number(component.parameters.initialState ?? 0))
        this.states.set(component.id, { high } satisfies ClockState)
        this.schedule(this.currentTick, { kind: 'driver', driverId: component.outputDrivers.y, value: LogicValue.fromNumber(1, high ? 1 : 0) })
        this.scheduleClock(component, high)
      }
    }
    for (const component of this.compiled.components) if (component.kind !== 'CLOCK') this.evaluate(component.id)
    this.drainCurrentTick()
  }

  setEventsPerTickLimit(limit: number): void {
    this.eventsPerTickLimit = Math.max(1, Math.floor(limit))
  }

  get stats(): SimulatorStats {
    let pendingEvents = 0
    for (const events of this.eventBuckets.values()) pendingEvents += events.length
    return { currentTick: this.currentTick, pendingEvents, evaluatedComponents: this.evaluatedComponents, processedEvents: this.processedEvents, oscillation: this.oscillation }
  }

  advance(ticks: number): SimulatorStats {
    if (this.oscillation) return this.stats
    const target = this.currentTick + Math.max(0, Math.floor(ticks))
    while (true) {
      let next = Number.POSITIVE_INFINITY
      for (const tick of this.eventBuckets.keys()) if (tick >= this.currentTick && tick < next) next = tick
      if (next > target) break
      this.currentTick = next
      this.drainCurrentTick()
      if (this.oscillation) break
    }
    if (!this.oscillation) this.currentTick = target
    return this.stats
  }

  setInput(instanceId: string, value: string | LogicValue): void {
    const components = this.compiled.components.filter(component => component.sourceInstanceId === instanceId && ['TOGGLE', 'BUTTON', 'INPUT_PIN'].includes(component.kind))
    for (const component of components) {
      const width = component.portSpecs.find(port => port.id === 'y')?.width ?? 1
      component.parameters.value = typeof value === 'string' ? value : value.toBinary()
      // Parse now so invalid values do not enter the runtime parameters.
      if (typeof value === 'string') LogicValue.parse(value, width)
      this.evaluate(component.id)
    }
    this.drainCurrentTick()
  }

  valueAtEndpoint(instanceId: string, portId: string): LogicValue | undefined {
    const netId = this.compiled.endpointToNet.get(`root:${instanceId}:${portId}`)
    return netId === undefined ? undefined : this.netValues[netId]
  }

  valueForSourceNet(netId: string): LogicValue | undefined {
    const compiledId = this.compiled.sourceNetToNet.get(netId)
    return compiledId === undefined ? undefined : this.netValues[compiledId]
  }

  lastChangedForSourceNet(netId: string): number | undefined {
    const compiledId = this.compiled.sourceNetToNet.get(netId)
    return compiledId === undefined ? undefined : this.netLastChanged[compiledId]
  }

  getRam(instanceId: string): Uint8Array | undefined {
    const component = this.findRootComponent(instanceId, 'RAM_256x8')
    const state = component ? this.states.get(component.id) as RamState | undefined : undefined
    return state ? new Uint8Array(state.memory) : undefined
  }

  /** Read-only-by-convention view for the Canvas renderer; avoids copying 256 bytes every frame. */
  peekRam(instanceId: string): Uint8Array | undefined {
    const component = this.findRootComponent(instanceId, 'RAM_256x8')
    return component ? (this.states.get(component.id) as RamState | undefined)?.memory : undefined
  }

  applyRam(instanceId: string, memory: Uint8Array): void {
    if (memory.length !== 256) throw new Error('RAM_256x8 requires exactly 256 bytes')
    const component = this.findRootComponent(instanceId, 'RAM_256x8')
    if (!component) throw new Error('RAM instance is not present in the compiled circuit')
    const state = this.states.get(component.id) as RamState
    state.memory.set(memory)
    this.evaluate(component.id)
    this.drainCurrentTick()
  }

  getPico(instanceId: string): PicoState | undefined {
    const component = this.findRootComponent(instanceId, 'PICO88_DISPLAY')
    const state = component ? this.states.get(component.id) as PicoState | undefined : undefined
    return state ? { ...state, screen: new Uint8Array(state.screen), vram: new Uint8Array(state.vram), registers: [...state.registers] as PicoState['registers'] } : undefined
  }

  /** Read-only-by-convention view for the Canvas renderer. */
  peekPico(instanceId: string): PicoState | undefined {
    const component = this.findRootComponent(instanceId, 'PICO88_DISPLAY')
    return component ? this.states.get(component.id) as PicoState | undefined : undefined
  }

  private findRootComponent(instanceId: string, kind: CompiledComponent['kind']): CompiledComponent | undefined {
    return this.compiled.components.find(component => component.path === `root/${instanceId}` && component.kind === kind)
  }

  private schedule(tick: number, event: SimulatorEvent): void {
    const bucket = this.eventBuckets.get(tick) ?? []
    bucket.push(event)
    this.eventBuckets.set(tick, bucket)
  }

  private scheduleOutput(component: CompiledComponent, portId: string, value: LogicValue, delay?: number): void {
    const driverId = component.outputDrivers[portId]
    if (driverId === undefined) return
    const desired = this.desiredValues[driverId]
    if (desired.equals(value)) return
    this.desiredValues[driverId] = value.clone()
    this.schedule(this.currentTick + Math.max(0, Math.floor(delay ?? Number(component.parameters.delay ?? 0))), { kind: 'driver', driverId, value: value.clone() })
  }

  private input(component: CompiledComponent, portId: string): LogicValue {
    const netId = component.ports[portId]
    const width = component.portSpecs.find(port => port.id === portId)?.width ?? 1
    if (netId === undefined) return LogicValue.fill(width, Z)
    const value = this.netValues[netId]
    if (value.width === width) return value
    if (value.width < width) return value.resizeZeroExtend(width)
    return value.slice(width - 1, 0)
  }

  private evaluate(componentId: number): void {
    const component = this.compiled.components[componentId]
    this.evaluatedComponents += 1
    const width = component.portSpecs.find(port => port.id === 'y')?.width ?? Number(component.parameters.width ?? 1)
    switch (component.kind) {
      case 'CONST0': this.scheduleOutput(component, 'y', LogicValue.fill(width, LOW)); break
      case 'CONST1': this.scheduleOutput(component, 'y', LogicValue.fill(width, HIGH)); break
      case 'TOGGLE': case 'BUTTON': case 'INPUT_PIN': {
        let value: LogicValue
        try { value = LogicValue.parse(String(component.parameters.value ?? '0'), width) }
        catch { value = LogicValue.fill(width, X) }
        this.scheduleOutput(component, 'y', value)
        break
      }
      case 'NOT': this.scheduleOutput(component, 'y', logicNot(this.input(component, 'a'))); break
      case 'AND': this.scheduleOutput(component, 'y', logicAnd(this.input(component, 'a'), this.input(component, 'b'))); break
      case 'OR': this.scheduleOutput(component, 'y', logicOr(this.input(component, 'a'), this.input(component, 'b'))); break
      case 'XOR': this.scheduleOutput(component, 'y', logicXor(this.input(component, 'a'), this.input(component, 'b'))); break
      case 'NAND': this.scheduleOutput(component, 'y', logicNot(logicAnd(this.input(component, 'a'), this.input(component, 'b')))); break
      case 'NOR': this.scheduleOutput(component, 'y', logicNot(logicOr(this.input(component, 'a'), this.input(component, 'b')))); break
      case 'XNOR': this.scheduleOutput(component, 'y', logicNot(logicXor(this.input(component, 'a'), this.input(component, 'b')))); break
      case 'BUFFER': case 'JUNCTION': this.scheduleOutput(component, 'y', this.input(component, 'a').clone()); break
      case 'BIT_SELECT': {
        const input = this.input(component, 'a'); const bit = Math.max(0, Math.min(input.width - 1, Number(component.parameters.bit ?? 0)))
        this.scheduleOutput(component, 'y', input.slice(bit, bit)); break
      }
      case 'BUS_SLICE': {
        const input = this.input(component, 'a'); const lsb = Number(component.parameters.lsb ?? 0); const msb = Number(component.parameters.msb ?? 0)
        try { this.scheduleOutput(component, 'y', input.slice(msb, lsb)) } catch { this.scheduleOutput(component, 'y', LogicValue.fill(width, X)) }
        break
      }
      case 'BUS_JOIN': this.scheduleOutput(component, 'y', concatenate(this.input(component, 'high'), this.input(component, 'low'))); break
      case 'RAM_256x8': this.evaluateRam(component); break
      case 'PICO88_DISPLAY': this.evaluatePico(component); break
      case 'OUTPUT_PIN': break
      case 'CLOCK': break
    }
  }

  private evaluateRam(component: CompiledComponent): void {
    const state = this.states.get(component.id) as RamState
    const reset = this.input(component, 'reset').getBit(0) === HIGH
    const clock = this.input(component, 'clk').getBit(0) === HIGH
    if (reset) {
      state.memory.fill(0)
      for (const [tick, events] of this.eventBuckets) {
        const remaining = events.filter(event => event.kind !== 'memory-write' || event.componentId !== component.id)
        if (remaining.length) this.eventBuckets.set(tick, remaining)
        else this.eventBuckets.delete(tick)
      }
    }
    if (!reset && clock && !state.lastClock && this.input(component, 'writeEn').getBit(0) === HIGH) {
      const address = Number(this.input(component, 'addr').toBigInt() ?? 0n) & 0xff
      const value = Number(this.input(component, 'dataIn').toBigInt() ?? 0n) & 0xff
      this.schedule(this.currentTick + Math.max(0, Number(component.parameters.writeDelay ?? 1)), { kind: 'memory-write', componentId: component.id, address, value })
    }
    state.lastClock = clock
    const enabled = this.input(component, 'readEn').getBit(0) === HIGH
    const addressValue = this.input(component, 'addr').toBigInt()
    const output = enabled && addressValue !== null
      ? LogicValue.fromNumber(8, state.memory[Number(addressValue) & 0xff])
      : LogicValue.fill(8, component.parameters.readDisabledValue === '0' ? LOW : Z)
    this.scheduleOutput(component, 'dataOut', output, Number(component.parameters.readDelay ?? 1))
  }

  private evaluatePico(component: CompiledComponent): void {
    const state = this.states.get(component.id) as PicoState
    const reset = this.input(component, 'reset').getBit(0) === HIGH
    const exec = this.input(component, 'exec').getBit(0) === HIGH
    const registers = ['r0', 'r1', 'r2', 'r3'].map(portId => Number(this.input(component, portId).toBigInt() ?? 0n) & 0xff) as PicoState['registers']
    state.registers = registers
    if (reset) {
      state.screen.fill(0); state.vram.fill(0); state.r1Out = 0; state.lastCommand = 'RESET'
    } else if (exec && !state.lastExec) {
      const command = Number(this.input(component, 'command').toBigInt() ?? 7n) & 7
      const x = registers[1] & 0x0f; const y = registers[2] & 0x0f; const color = registers[3] & 0x0f
      const address = (y << 3) | (x >> 1)
      state.currentAddress = address; state.selectedNibble = (x & 1) === 0 ? 'high' : 'low'; state.lastCommand = commandNames[command]
      const plot = (memory: Uint8Array) => { memory[address] = (x & 1) === 0 ? (memory[address] & 0x0f) | (color << 4) : (memory[address] & 0xf0) | color }
      if (command === 0) plot(state.screen)
      else if (command === 1) plot(state.vram)
      else if (command === 2) state.screen.fill(0)
      else if (command === 3) state.vram.fill(0)
      else if (command === 4) state.screen.set(state.vram)
      else if (command === 5) state.vram[registers[0] & 0x7f] = registers[1]
      else if (command === 6) state.r1Out = state.vram[registers[0] & 0x7f]
    }
    state.lastExec = exec
    this.scheduleOutput(component, 'r1Out', LogicValue.fromNumber(8, state.r1Out))
  }

  private scheduleClock(component: CompiledComponent, high: boolean): void {
    const highTicks = Math.max(1, Number(component.parameters.highTicks ?? 5))
    const lowTicks = Math.max(1, Number(component.parameters.lowTicks ?? 5))
    this.schedule(this.currentTick + (high ? highTicks : lowTicks), { kind: 'clock', componentId: component.id, high: !high })
  }

  private drainCurrentTick(): void {
    let eventsThisTick = 0
    while (this.eventBuckets.has(this.currentTick)) {
      const events = this.eventBuckets.get(this.currentTick)!
      this.eventBuckets.delete(this.currentTick)
      eventsThisTick += events.length
      this.processedEvents += events.length
      if (eventsThisTick > this.eventsPerTickLimit) {
        this.oscillation = `Zero-delay oscillation detected at tick ${this.currentTick}`
        return
      }
      const changedNets = new Set<number>()
      const directlyDirty = new Set<number>()
      for (const event of events) {
        if (event.kind === 'driver') {
          const driver = this.compiled.drivers[event.driverId]
          this.driverValues[event.driverId] = event.value
          changedNets.add(driver.netId)
        } else if (event.kind === 'clock') {
          const component = this.compiled.components[event.componentId]
          const state = this.states.get(component.id) as ClockState
          state.high = event.high
          const value = LogicValue.fromNumber(1, event.high ? 1 : 0)
          const driverId = component.outputDrivers.y
          this.desiredValues[driverId] = value.clone()
          this.driverValues[driverId] = value
          changedNets.add(this.compiled.drivers[driverId].netId)
          this.scheduleClock(component, event.high)
        } else {
          const component = this.compiled.components[event.componentId]
          const state = this.states.get(component.id) as RamState
          state.memory[event.address] = event.value
          directlyDirty.add(component.id)
        }
      }
      const dirty = new Set(directlyDirty)
      for (const netId of changedNets) {
        const net = this.compiled.nets[netId]
        const next = resolveDrivers(net.drivers.map(driverId => this.driverValues[driverId]), net.width)
        if (!next.equals(this.netValues[netId])) {
          this.netValues[netId] = next
          this.netLastChanged[netId] = this.currentTick
          for (const consumer of net.consumers) dirty.add(consumer)
        }
      }
      for (const componentId of dirty) this.evaluate(componentId)
    }
  }
}
