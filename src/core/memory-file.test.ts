import { describe, expect, it } from 'vitest'
import { applyMemoryImport, exportMemoryText, parseMemoryText } from './memory-file'

describe('memory text formats', () => {
  it('loads hex byte sequences and ignores comments', () => {
    const parsed = parseMemoryText('# program\n00 10 FF 3A // row')
    expect(parsed.format).toBe('HEX_BYTE_SEQUENCE')
    expect([...parsed.entries]).toEqual([[0, 0], [1, 0x10], [2, 0xff], [3, 0x3a]])
  })

  it('loads sparse address:value patches and warns on duplicate addresses', () => {
    const parsed = parseMemoryText('0x00: 0xFF\n10: AB\n10: 42')
    expect(parsed.entries.get(0x10)).toBe(0x42)
    expect(parsed.warnings).toHaveLength(1)
    const current = new Uint8Array(256); current[2] = 0x77
    const patch = applyMemoryImport(current, parsed, 'PATCH')
    const replace = applyMemoryImport(current, parsed, 'REPLACE')
    expect(patch.memory[2]).toBe(0x77)
    expect(replace.memory[2]).toBe(0)
  })

  it('rejects overflow rather than truncating', () => {
    expect(() => parseMemoryText('100: FF')).toThrow(/outside/)
    expect(() => parseMemoryText('00: 100')).toThrow(/exceeds 8 bits/)
    expect(() => parseMemoryText(Array(257).fill('00').join(' '))).toThrow(/never truncated/)
    expect(() => parseMemoryText('00 GG')).toThrow(/not hexadecimal/)
  })

  it('exports both required formats', () => {
    const memory = new Uint8Array(256); memory[0] = 0xa9; memory[1] = 0x10
    expect(exportMemoryText(memory, 'ADDRESS_VALUE_FORMAT', 0, 1)).toBe('00: A9\n01: 10\n')
    expect(exportMemoryText(memory, 'HEX_BYTE_SEQUENCE', 0, 1)).toBe('A9 10\n')
  })
})
