import { describe, expect, it } from 'vitest'
import { HIGH, LogicValue, logicAnd, logicNot, logicOr, logicXor, resolveDrivers, X, Z } from './logic-value'

describe('LogicValue', () => {
  it('parses and formats arbitrary-width packed values', () => {
    const value = LogicValue.parse('0x1234_5678_9ABC_DEF0', 64)
    expect(value.toHex()).toBe('0x123456789ABCDEF0')
    expect(value.toBigInt()).toBe(0x123456789abcdef0n)
  })

  it('retains X/Z states and applies 4-state truth tables', () => {
    const unknown = LogicValue.parse('0bXZ10', 4)
    expect(unknown.toBinary()).toBe('0bXZ10')
    expect(logicAnd(unknown, LogicValue.parse('0b0000', 4)).toBinary()).toBe('0b0000')
    expect(logicOr(unknown, LogicValue.parse('0b1111', 4)).toBinary()).toBe('0b1111')
    expect(logicXor(unknown, LogicValue.parse('0b0000', 4)).toBinary()).toBe('0bXX10')
    expect(logicNot(LogicValue.parse('0b10XZ', 4)).toBinary()).toBe('0b01XX')
  })

  it('resolves multiple drivers bit by bit', () => {
    expect(resolveDrivers([LogicValue.fill(4, Z)], 4).toBinary()).toBe('0bZZZZ')
    expect(resolveDrivers([LogicValue.parse('0b10ZZ', 4), LogicValue.parse('0bZ11Z', 4)], 4).toBinary()).toBe('0b1X1Z')
    expect(resolveDrivers([LogicValue.fill(1, HIGH), LogicValue.parse('0', 1)], 1).getBit(0)).toBe(X)
  })

  it('zero-extends outputs without truncating', () => {
    expect(LogicValue.parse('0b1011', 4).resizeZeroExtend(8).toBinary()).toBe('0b00001011')
    expect(() => LogicValue.parse('0xff', 8).resizeZeroExtend(4)).toThrow(/truncate/)
  })
})
