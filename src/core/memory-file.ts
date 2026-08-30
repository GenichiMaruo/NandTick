export type MemoryFileFormat = 'HEX_BYTE_SEQUENCE' | 'ADDRESS_VALUE_FORMAT'
export type MemoryImportMode = 'REPLACE' | 'PATCH'

export interface ParsedMemoryFile {
  format: MemoryFileFormat
  entries: Map<number, number>
  warnings: string[]
}

export interface MemoryPreviewRow {
  address: number
  current: number
  next: number
}

function cleanLines(text: string): string[] {
  return text.split(/\r?\n/).map(line => {
    const hash = line.indexOf('#')
    const slash = line.indexOf('//')
    const cut = [hash, slash].filter(index => index >= 0).reduce((lowest, index) => Math.min(lowest, index), line.length)
    return line.slice(0, cut).trim()
  }).filter(Boolean)
}

function parseHex(token: string, label: string, line?: number): number {
  const normalized = token.trim().replace(/^0x/i, '')
  if (!/^[0-9a-f]+$/i.test(normalized)) throw new Error(`${label}${line ? ` on line ${line}` : ''} is not hexadecimal: “${token}”`)
  return Number.parseInt(normalized, 16)
}

export function parseMemoryText(text: string): ParsedMemoryFile {
  const lines = cleanLines(text)
  if (!lines.length) return { format: 'HEX_BYTE_SEQUENCE', entries: new Map(), warnings: [] }
  const addressFormat = lines.some(line => line.includes(':'))
  const entries = new Map<number, number>()
  const warnings: string[] = []
  if (addressFormat) {
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      const match = line.match(/^([^:\s]+)\s*:\s*([^\s]+)$/)
      if (!match) throw new Error(`Invalid address:value record on line ${index + 1}: “${line}”`)
      const address = parseHex(match[1], 'Address', index + 1)
      const value = parseHex(match[2], 'Value', index + 1)
      if (address > 0xff) throw new Error(`Address 0x${address.toString(16).toUpperCase()} on line ${index + 1} is outside 0x00..0xFF`)
      if (value > 0xff) throw new Error(`Value 0x${value.toString(16).toUpperCase()} on line ${index + 1} exceeds 8 bits`)
      if (entries.has(address)) warnings.push(`Duplicate address 0x${address.toString(16).padStart(2, '0').toUpperCase()}; the later value is used.`)
      entries.set(address, value)
    }
    return { format: 'ADDRESS_VALUE_FORMAT', entries, warnings }
  }

  const tokens = lines.flatMap(line => line.split(/\s+/).filter(Boolean))
  if (tokens.length > 256) throw new Error(`File contains ${tokens.length} bytes; RAM_256x8 accepts at most 256 and is never truncated.`)
  tokens.forEach((token, address) => {
    const value = parseHex(token, `Token ${address + 1}`)
    if (value > 0xff) throw new Error(`Value 0x${value.toString(16).toUpperCase()} at byte ${address} exceeds 8 bits`)
    entries.set(address, value)
  })
  return { format: 'HEX_BYTE_SEQUENCE', entries, warnings }
}

export function applyMemoryImport(current: Uint8Array, parsed: ParsedMemoryFile, mode: MemoryImportMode): { memory: Uint8Array; preview: MemoryPreviewRow[] } {
  if (current.length !== 256) throw new Error('RAM_256x8 requires a 256-byte current image')
  const memory = mode === 'REPLACE' ? new Uint8Array(256) : new Uint8Array(current)
  for (const [address, value] of parsed.entries) memory[address] = value
  const preview: MemoryPreviewRow[] = []
  for (let address = 0; address < 256; address += 1) {
    if (current[address] !== memory[address]) preview.push({ address, current: current[address], next: memory[address] })
  }
  return { memory, preview }
}

export function exportMemoryText(memory: Uint8Array, format: MemoryFileFormat, start = 0, end = 255): string {
  if (memory.length !== 256) throw new Error('RAM_256x8 requires 256 bytes')
  const from = Math.max(0, Math.min(255, Math.floor(start)))
  const to = Math.max(from, Math.min(255, Math.floor(end)))
  const hex = (value: number) => value.toString(16).padStart(2, '0').toUpperCase()
  if (format === 'ADDRESS_VALUE_FORMAT') {
    return Array.from({ length: to - from + 1 }, (_, index) => {
      const address = from + index
      return `${hex(address)}: ${hex(memory[address])}`
    }).join('\n') + '\n'
  }
  const bytes = Array.from(memory.slice(from, to + 1), hex)
  const rows: string[] = []
  for (let index = 0; index < bytes.length; index += 16) rows.push(bytes.slice(index, index + 16).join(' '))
  return rows.join('\n') + '\n'
}
