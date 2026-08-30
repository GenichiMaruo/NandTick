export const LOW = 0 as const
export const HIGH = 1 as const
export const Z = 2 as const
export const X = 3 as const
export type LogicState = typeof LOW | typeof HIGH | typeof Z | typeof X

const chunksFor = (width: number) => Math.ceil(width / 32)

function tailMask(width: number): number {
  const bits = width & 31
  return bits === 0 ? 0xffffffff : (0xffffffff >>> (32 - bits))
}

/** Packed 4-state bit vector. `ones`, `xMask` and `zMask` never overlap. */
export class LogicValue {
  readonly width: number
  readonly ones: Uint32Array
  readonly xMask: Uint32Array
  readonly zMask: Uint32Array

  constructor(width: number, ones?: Uint32Array, xMask?: Uint32Array, zMask?: Uint32Array) {
    if (!Number.isInteger(width) || width < 1) throw new Error(`Invalid logic width: ${width}`)
    const chunks = chunksFor(width)
    this.width = width
    this.ones = ones ? new Uint32Array(ones) : new Uint32Array(chunks)
    this.xMask = xMask ? new Uint32Array(xMask) : new Uint32Array(chunks)
    this.zMask = zMask ? new Uint32Array(zMask) : new Uint32Array(chunks)
    if (this.ones.length !== chunks || this.xMask.length !== chunks || this.zMask.length !== chunks) {
      throw new Error('Packed vector storage does not match its width')
    }
    this.trim()
  }

  static fill(width: number, state: LogicState): LogicValue {
    const chunks = chunksFor(width)
    const ones = new Uint32Array(chunks)
    const x = new Uint32Array(chunks)
    const z = new Uint32Array(chunks)
    const target = state === HIGH ? ones : state === X ? x : state === Z ? z : undefined
    target?.fill(0xffffffff)
    return new LogicValue(width, ones, x, z)
  }

  static fromNumber(width: number, value: number | bigint): LogicValue {
    let remaining = BigInt(value)
    if (remaining < 0n) throw new Error('Logic values cannot be negative')
    const ones = new Uint32Array(chunksFor(width))
    for (let i = 0; i < ones.length; i += 1) {
      ones[i] = Number(remaining & 0xffffffffn)
      remaining >>= 32n
    }
    if (remaining !== 0n) throw new Error(`Value does not fit in ${width} bits`)
    return new LogicValue(width, ones)
  }

  static parse(text: string, width: number): LogicValue {
    const source = text.trim().replaceAll('_', '')
    if (!source) throw new Error('Value is empty')
    if (/^0b[01xz]+$/i.test(source)) {
      const digits = source.slice(2)
      if (digits.length > width) throw new Error(`Value exceeds ${width} bits`)
      const value = LogicValue.fill(width, LOW)
      for (let i = 0; i < digits.length; i += 1) {
        const state = digits[digits.length - 1 - i].toUpperCase()
        value.setBit(i, state === '1' ? HIGH : state === 'X' ? X : state === 'Z' ? Z : LOW)
      }
      return value
    }
    if (/^0x[0-9a-f]+$/i.test(source)) return LogicValue.fromNumber(width, BigInt(source))
    if (/^[0-9]+$/.test(source)) return LogicValue.fromNumber(width, BigInt(source))
    if (/^[01xz]+$/i.test(source)) return LogicValue.parse(`0b${source}`, width)
    throw new Error(`Invalid logic value: ${text}`)
  }

  private trim(): void {
    const last = this.ones.length - 1
    const mask = tailMask(this.width)
    this.ones[last] &= mask
    this.xMask[last] &= mask
    this.zMask[last] &= mask
    for (let i = 0; i < this.ones.length; i += 1) {
      this.ones[i] &= ~(this.xMask[i] | this.zMask[i])
      this.xMask[i] &= ~this.zMask[i]
    }
  }

  clone(): LogicValue {
    return new LogicValue(this.width, this.ones, this.xMask, this.zMask)
  }

  getBit(index: number): LogicState {
    if (index < 0 || index >= this.width) throw new Error(`Bit ${index} is out of range`)
    const chunk = index >>> 5
    const mask = 1 << (index & 31)
    if (this.xMask[chunk] & mask) return X
    if (this.zMask[chunk] & mask) return Z
    return this.ones[chunk] & mask ? HIGH : LOW
  }

  setBit(index: number, state: LogicState): void {
    const chunk = index >>> 5
    const mask = 1 << (index & 31)
    this.ones[chunk] &= ~mask
    this.xMask[chunk] &= ~mask
    this.zMask[chunk] &= ~mask
    if (state === HIGH) this.ones[chunk] |= mask
    if (state === X) this.xMask[chunk] |= mask
    if (state === Z) this.zMask[chunk] |= mask
  }

  equals(other: LogicValue): boolean {
    if (this.width !== other.width) return false
    for (let i = 0; i < this.ones.length; i += 1) {
      if (this.ones[i] !== other.ones[i] || this.xMask[i] !== other.xMask[i] || this.zMask[i] !== other.zMask[i]) return false
    }
    return true
  }

  resizeZeroExtend(width: number): LogicValue {
    if (width < this.width) throw new Error(`Cannot truncate ${this.width}-bit value to ${width} bits`)
    if (width === this.width) return this.clone()
    const chunks = chunksFor(width)
    const ones = new Uint32Array(chunks)
    const x = new Uint32Array(chunks)
    const z = new Uint32Array(chunks)
    ones.set(this.ones)
    x.set(this.xMask)
    z.set(this.zMask)
    return new LogicValue(width, ones, x, z)
  }

  slice(msb: number, lsb: number): LogicValue {
    if (lsb < 0 || msb < lsb || msb >= this.width) throw new Error('Invalid bus slice')
    const result = LogicValue.fill(msb - lsb + 1, LOW)
    for (let bit = lsb; bit <= msb; bit += 1) result.setBit(bit - lsb, this.getBit(bit))
    return result
  }

  toBigInt(): bigint | null {
    for (let i = 0; i < this.ones.length; i += 1) if (this.xMask[i] || this.zMask[i]) return null
    let result = 0n
    for (let i = this.ones.length - 1; i >= 0; i -= 1) result = (result << 32n) | BigInt(this.ones[i])
    return result
  }

  toBinary(prefix = true): string {
    let result = ''
    for (let i = this.width - 1; i >= 0; i -= 1) {
      const state = this.getBit(i)
      result += state === HIGH ? '1' : state === LOW ? '0' : state === X ? 'X' : 'Z'
    }
    return `${prefix ? '0b' : ''}${result}`
  }

  toHex(prefix = true): string {
    let result = ''
    for (let nibble = Math.ceil(this.width / 4) - 1; nibble >= 0; nibble -= 1) {
      let value = 0
      let unknown = ''
      for (let bit = 0; bit < 4; bit += 1) {
        const index = nibble * 4 + bit
        if (index >= this.width) continue
        const state = this.getBit(index)
        if (state === X) unknown = 'X'
        else if (state === Z && !unknown) unknown = 'Z'
        else if (state === HIGH) value |= 1 << bit
      }
      result += unknown || value.toString(16).toUpperCase()
    }
    return `${prefix ? '0x' : ''}${result}`
  }
}

function binaryOp(a: LogicValue, b: LogicValue, op: 'and' | 'or' | 'xor'): LogicValue {
  if (a.width !== b.width) throw new Error('Logic operation width mismatch')
  const ones = new Uint32Array(a.ones.length)
  const x = new Uint32Array(a.ones.length)
  for (let i = 0; i < ones.length; i += 1) {
    const mask = i === ones.length - 1 ? tailMask(a.width) : 0xffffffff
    const aUnknown = a.xMask[i] | a.zMask[i]
    const bUnknown = b.xMask[i] | b.zMask[i]
    if (op === 'and') {
      const knownZero = ((~a.ones[i] & ~aUnknown) | (~b.ones[i] & ~bUnknown)) & mask
      const knownOne = a.ones[i] & b.ones[i]
      ones[i] = knownOne
      x[i] = (~(knownZero | knownOne)) & mask
    } else if (op === 'or') {
      const knownOne = (a.ones[i] | b.ones[i]) & mask
      const knownZero = (~a.ones[i] & ~aUnknown & ~b.ones[i] & ~bUnknown) & mask
      ones[i] = knownOne
      x[i] = (~(knownZero | knownOne)) & mask
    } else {
      const unknown = (aUnknown | bUnknown) & mask
      ones[i] = (a.ones[i] ^ b.ones[i]) & ~unknown & mask
      x[i] = unknown
    }
  }
  return new LogicValue(a.width, ones, x)
}

export const logicAnd = (a: LogicValue, b: LogicValue) => binaryOp(a, b, 'and')
export const logicOr = (a: LogicValue, b: LogicValue) => binaryOp(a, b, 'or')
export const logicXor = (a: LogicValue, b: LogicValue) => binaryOp(a, b, 'xor')

export function logicNot(value: LogicValue): LogicValue {
  const ones = new Uint32Array(value.ones.length)
  const x = new Uint32Array(value.ones.length)
  for (let i = 0; i < ones.length; i += 1) {
    const mask = i === ones.length - 1 ? tailMask(value.width) : 0xffffffff
    const unknown = value.xMask[i] | value.zMask[i]
    ones[i] = (~value.ones[i] & ~unknown) & mask
    x[i] = unknown & mask
  }
  return new LogicValue(value.width, ones, x)
}

export function resolveDrivers(values: LogicValue[], width: number): LogicValue {
  if (values.length === 0) return LogicValue.fill(width, Z)
  const expanded = values.map(value => value.resizeZeroExtend(width))
  const ones = new Uint32Array(chunksFor(width))
  const x = new Uint32Array(chunksFor(width))
  const z = new Uint32Array(chunksFor(width))
  for (let chunk = 0; chunk < ones.length; chunk += 1) {
    const mask = chunk === ones.length - 1 ? tailMask(width) : 0xffffffff
    let anyZero = 0
    let anyOne = 0
    let anyUnknown = 0
    let allZ = mask
    for (const value of expanded) {
      const unknown = value.xMask[chunk]
      const highZ = value.zMask[chunk]
      anyUnknown |= unknown
      anyOne |= value.ones[chunk]
      anyZero |= (~(value.ones[chunk] | unknown | highZ)) & mask
      allZ &= highZ
    }
    const conflict = anyZero & anyOne
    x[chunk] = (anyUnknown | conflict) & mask
    z[chunk] = allZ & ~x[chunk] & mask
    ones[chunk] = anyOne & ~x[chunk] & ~z[chunk] & mask
  }
  return new LogicValue(width, ones, x, z)
}

export function concatenate(high: LogicValue, low: LogicValue): LogicValue {
  const result = LogicValue.fill(high.width + low.width, LOW)
  for (let i = 0; i < low.width; i += 1) result.setBit(i, low.getBit(i))
  for (let i = 0; i < high.width; i += 1) result.setBit(low.width + i, high.getBit(i))
  return result
}
