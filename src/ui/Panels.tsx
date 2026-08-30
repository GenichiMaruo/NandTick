'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, Download, FileUp, FolderOpen, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { applyMemoryImport, exportMemoryText, parseMemoryText, type MemoryFileFormat, type MemoryImportMode, type MemoryPreviewRow, type ParsedMemoryFile } from '@/core/memory-file'
import { downloadText } from '@/core/persistence'
import { executeTest } from '@/core/test-runner'
import type { CircuitGraph, CircuitTestCase, ComponentDefinition, PortDirection, Project } from '@/core/model'
import type { HdlExport, HdlMode } from '@/core/hdl'
import type { PicoState, Simulator } from '@/core/simulator'

export function Modal({ title, eyebrow, children, onClose, wide = false }: { title: string; eyebrow?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><section className={`modal ${wide ? 'modal-wide' : ''}`}><header><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="閉じる"><X size={18} /></button></header>{children}</section></div>
}

export function NewComponentDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, ports: Array<{ name: string; direction: PortDirection; width: number }>) => void }) {
  const [name, setName] = useState('MyComponent')
  const [ports, setPorts] = useState<Array<{ id: number; name: string; direction: PortDirection; width: number }>>([
    { id: 1, name: 'A', direction: 'INPUT', width: 1 }, { id: 2, name: 'Y', direction: 'OUTPUT', width: 1 },
  ])
  const valid = name.trim() && ports.length > 0 && ports.every(port => port.name.trim() && Number.isInteger(port.width) && port.width > 0) && new Set(ports.map(port => port.name.trim())).size === ports.length
  return <Modal title="カスタム部品を作成" eyebrow="HIERARCHICAL COMPONENT" onClose={onClose}>
    <div className="form-stack">
      <label>Component name<input value={name} onChange={event => setName(event.target.value)} autoFocus /></label>
      <div className="section-label">PORTS</div>
      <div className="port-editor">
        {ports.map(port => <div className="port-editor-row" key={port.id}>
          <input aria-label="Port name" value={port.name} onChange={event => setPorts(items => items.map(item => item.id === port.id ? { ...item, name: event.target.value } : item))} />
          <select value={port.direction} onChange={event => setPorts(items => items.map(item => item.id === port.id ? { ...item, direction: event.target.value as PortDirection } : item))}><option>INPUT</option><option>OUTPUT</option><option>INOUT</option></select>
          <label className="inline-field">bits<input type="number" min="1" max="4096" value={port.width} onChange={event => setPorts(items => items.map(item => item.id === port.id ? { ...item, width: Number(event.target.value) } : item))} /></label>
          <button className="icon-button" disabled={ports.length === 1} onClick={() => setPorts(items => items.filter(item => item.id !== port.id))}><Trash2 size={15} /></button>
        </div>)}
      </div>
      <button className="subtle-button" onClick={() => setPorts(items => [...items, { id: Math.max(0, ...items.map(item => item.id)) + 1, name: `P${items.length}`, direction: 'INPUT', width: 1 }])}><Plus size={15} /> Port</button>
    </div>
    <footer className="modal-actions"><button className="ghost-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={!valid} onClick={() => { onCreate(name.trim(), ports.map(({ name: portName, direction, width }) => ({ name: portName.trim(), direction, width }))); onClose() }}><Check size={16} /> Create & open</button></footer>
  </Modal>
}

interface MemoryPanelProps {
  instanceName: string
  memory: Uint8Array
  onApply: (memory: Uint8Array) => void
  onClose: () => void
}

export function MemoryPanel({ instanceName, memory: sourceMemory, onApply, onClose }: MemoryPanelProps) {
  const [memory, setMemory] = useState(() => new Uint8Array(sourceMemory))
  const [format, setFormat] = useState<MemoryFileFormat>('ADDRESS_VALUE_FORMAT')
  const [mode, setMode] = useState<MemoryImportMode>('REPLACE')
  const [parsed, setParsed] = useState<ParsedMemoryFile | null>(null)
  const [preview, setPreview] = useState<MemoryPreviewRow[]>([])
  const [candidate, setCandidate] = useState<Uint8Array | null>(null)
  const [error, setError] = useState('')
  const [filename, setFilename] = useState('No file selected')
  const fileInput = useRef<HTMLInputElement>(null)
  const handleRef = useRef<FileSystemFileHandle | null>(null)

  const parseFile = async (file: File) => {
    try {
      const result = parseMemoryText(await file.text())
      const applied = applyMemoryImport(memory, result, mode)
      setParsed(result); setCandidate(applied.memory); setPreview(applied.preview); setFilename(file.name); setError('')
    } catch (caught) { setParsed(null); setCandidate(null); setPreview([]); setError(caught instanceof Error ? caught.message : String(caught)) }
  }
  const chooseFile = async () => {
    if (window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({ multiple: false, types: [{ description: 'Memory text', accept: { 'text/plain': ['.hex', '.mem', '.txt'] } }] })
        handleRef.current = handle
        await parseFile(await handle.getFile())
      } catch (caught) { if ((caught as DOMException).name !== 'AbortError') setError(String(caught)) }
    } else fileInput.current?.click()
  }
  const reload = async () => {
    if (handleRef.current) await parseFile(await handleRef.current.getFile())
    else fileInput.current?.click()
  }
  useEffect(() => {
    if (!parsed) return
    const applied = applyMemoryImport(memory, parsed, mode)
    setCandidate(applied.memory); setPreview(applied.preview)
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  const applyCandidate = () => {
    if (!candidate) return
    setMemory(new Uint8Array(candidate)); onApply(candidate); setParsed(null); setCandidate(null); setPreview([])
  }
  const setByte = (address: number, raw: string) => {
    if (!/^[0-9a-f]{0,2}$/i.test(raw)) return
    const next = new Uint8Array(memory); next[address] = Number.parseInt(raw || '0', 16); setMemory(next)
  }
  const commitDirect = () => onApply(memory)
  const hex = (value: number) => value.toString(16).padStart(2, '0').toUpperCase()

  return <Modal title={`${instanceName} · Memory Inspector`} eyebrow="256 × 8 · 2048 BIT" onClose={onClose} wide>
    <div className="memory-layout">
      <section className="memory-grid-section">
        <div className="panel-toolbar"><span>Direct byte editor</span><button className="subtle-button" onClick={commitDirect}><Check size={14} /> Apply edits</button></div>
        <div className="memory-grid"><div className="memory-corner">×</div>{Array.from({ length: 16 }, (_, i) => <div className="memory-head" key={i}>{i.toString(16).toUpperCase()}</div>)}
          {Array.from({ length: 16 }, (_, row) => <div className="memory-row-fragment" key={row}><div className="memory-head">{row.toString(16).toUpperCase()}</div>{Array.from({ length: 16 }, (_, column) => { const address = row * 16 + column; return <input key={address} title={`0x${hex(address)}`} value={hex(memory[address])} onChange={event => setByte(address, event.target.value)} onBlur={commitDirect} /> })}</div>)}
        </div>
      </section>
      <aside className="memory-file-panel">
        <div><span className="section-label">EXTERNAL MEMORY FILE</span><p className="muted">ローカルファイルはブラウザ内だけで解析され、アップロードされません。</p></div>
        <div className="file-card"><FileUp size={20} /><div><strong>{filename}</strong><span>HEX sequence / address:value</span></div></div>
        <div className="button-row"><button className="primary-button" onClick={chooseFile}><FolderOpen size={15} /> Import</button><button className="subtle-button" onClick={reload}><RefreshCw size={15} /> Reload</button></div>
        <input ref={fileInput} type="file" accept=".hex,.mem,.txt,text/plain" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void parseFile(file); event.target.value = '' }} />
        <label>Import mode<select value={mode} onChange={event => setMode(event.target.value as MemoryImportMode)}><option value="REPLACE">REPLACE — clear then load</option><option value="PATCH">PATCH — keep other bytes</option></select></label>
        {error && <div className="notice error">{error}</div>}
        {parsed && <div className="preview-card"><div className="preview-summary"><strong>{preview.length} changes</strong><span>{parsed.format.replaceAll('_', ' ')}</span></div>{parsed.warnings.map(warning => <div className="notice warning" key={warning}>{warning}</div>)}<div className="preview-table"><div>Address</div><div>Current</div><div>New</div>{preview.slice(0, 80).flatMap(row => [<code key={`${row.address}a`}>{hex(row.address)}</code>, <code key={`${row.address}b`}>{hex(row.current)}</code>, <code key={`${row.address}c`}>{hex(row.next)}</code>])}{preview.length > 80 && <span className="muted">…and {preview.length - 80} more</span>}</div><button className="primary-button" onClick={applyCandidate}><Check size={15} /> Apply atomically</button></div>}
        <div className="divider" />
        <label>Export format<select value={format} onChange={event => setFormat(event.target.value as MemoryFileFormat)}><option value="ADDRESS_VALUE_FORMAT">Address : value</option><option value="HEX_BYTE_SEQUENCE">Hex byte sequence</option></select></label>
        <button className="subtle-button" onClick={() => downloadText(`${instanceName}.hex`, exportMemoryText(memory, format))}><Download size={15} /> Export entire memory</button>
        <button className="danger-button" onClick={() => { const cleared = new Uint8Array(256); setMemory(cleared); onApply(cleared) }}><Trash2 size={15} /> Clear memory</button>
      </aside>
    </div>
  </Modal>
}

const PICO_PALETTE = ['#000000', '#1D2B53', '#7E2553', '#008751', '#AB5236', '#5F574F', '#C2C3C7', '#FFF1E8', '#FF004D', '#FFA300', '#FFEC27', '#00E436', '#29ADFF', '#83769C', '#FF77A8', '#FFCCAA']

function MemoryDump({ title, data }: { title: string; data: Uint8Array }) {
  const hex = (value: number) => value.toString(16).padStart(2, '0').toUpperCase()
  return <div className="dump"><strong>{title}</strong><div className="dump-grid">{Array.from(data, (value, index) => <code key={index} title={`0x${hex(index)}`}>{hex(value)}</code>)}</div></div>
}

export function PicoPanel({ name, state, onClose }: { name: string; state: PicoState; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const context = canvas.current?.getContext('2d'); if (!context) return
    context.imageSmoothingEnabled = false
    for (let index = 0; index < 128; index += 1) {
      const byte = state.screen[index]; const y = Math.floor(index / 8); const x = (index % 8) * 2
      context.fillStyle = PICO_PALETTE[byte >> 4]; context.fillRect(x * 16, y * 16, 16, 16)
      context.fillStyle = PICO_PALETTE[byte & 15]; context.fillRect((x + 1) * 16, y * 16, 16, 16)
    }
  }, [state])
  return <Modal title={`${name} · Display Debugger`} eyebrow="PICO-88 · 16 × 16 · 4BPP" onClose={onClose} wide>
    <div className="pico-layout"><div><canvas className="pico-display" ref={canvas} width={256} height={256} /><div className="palette-strip">{PICO_PALETTE.map((color, index) => <span key={color} style={{ background: color }} title={`${index.toString(16).toUpperCase()} ${color}`} />)}</div></div>
      <div className="pico-debug"><div className="stat-grid"><div><span>Last command</span><strong>{state.lastCommand}</strong></div><div><span>Address</span><strong>0x{state.currentAddress.toString(16).padStart(2, '0').toUpperCase()}</strong></div><div><span>Nibble</span><strong>{state.selectedNibble}</strong></div><div><span>R0 · R1 · R2 · R3</span><strong>{state.registers.map(value => value.toString(16).padStart(2, '0').toUpperCase()).join(' · ')}</strong></div></div><MemoryDump title="SCREEN RAM · display source" data={state.screen} /><MemoryDump title="VRAM · back buffer" data={state.vram} /></div>
    </div>
  </Modal>
}

function testIo(graph: CircuitGraph, definition?: ComponentDefinition) {
  if (definition) return {
    inputs: definition.ports.filter(port => port.direction !== 'OUTPUT').map(port => port.name),
    outputs: definition.ports.filter(port => port.direction !== 'INPUT').map(port => port.name),
  }
  return {
    inputs: graph.instances.filter(instance => ['TOGGLE', 'BUTTON', 'INPUT_PIN'].includes(instance.componentId)).map(instance => instance.name),
    outputs: graph.instances.filter(instance => instance.componentId === 'OUTPUT_PIN').map(instance => instance.name),
  }
}

export function TestsPanel({ graph, definitions, definition, tests, onChange, onVisualize, onClose }: { graph: CircuitGraph; definitions: ComponentDefinition[]; definition?: ComponentDefinition; tests: CircuitTestCase[]; onChange: (tests: CircuitTestCase[]) => void; onVisualize: (test: CircuitTestCase) => void; onClose: () => void }) {
  const io = useMemo(() => testIo(graph, definition), [graph, definition])
  const add = () => onChange([...tests, { id: `test_${Date.now()}`, enabled: true, name: `test_${tests.length + 1}`, inputs: Object.fromEntries(io.inputs.map(name => [name, '0'])), expected: Object.fromEntries(io.outputs.map(name => [name, '0'])), sampleTick: 8, result: 'NOT_RUN' }])
  const update = (id: string, change: Partial<CircuitTestCase>) => onChange(tests.map(test => test.id === id ? { ...test, ...change, result: change.result ?? 'NOT_RUN' } : test))
  const run = (target: CircuitTestCase) => { const result = executeTest(graph, definitions, target, definition); update(target.id, result.test) }
  const runAll = () => onChange(tests.map(test => test.enabled ? executeTest(graph, definitions, test, definition).test : test))
  return <Modal title={`${definition?.name ?? 'Main circuit'} · Test Cases`} eyebrow="TICK-ACCURATE VERIFICATION" onClose={onClose} wide>
    <div className="panel-toolbar tests-toolbar"><div><strong>{tests.filter(test => test.result === 'PASS').length}/{tests.length}</strong> passing</div><div className="button-row"><button className="subtle-button" onClick={add}><Plus size={15} /> Test</button><button className="primary-button" onClick={runAll}>Run all</button></div></div>
    <div className="test-table-wrap tests-table-wrap"><table className="test-table"><thead><tr><th>On</th><th>Test name</th>{io.inputs.map(name => <th key={`i${name}`}>{name}<small>INPUT</small></th>)}{io.outputs.map(name => <th key={`o${name}`}>{name}<small>EXPECTED</small></th>)}<th>Sample tick</th><th>Result</th><th /></tr></thead><tbody>{tests.map(test => <tr key={test.id} className={test.result.toLowerCase()}><td><input type="checkbox" checked={test.enabled} onChange={event => update(test.id, { enabled: event.target.checked })} /></td><td><input value={test.name} onChange={event => update(test.id, { name: event.target.value })} /></td>{io.inputs.map(name => <td key={name}><input className="mono-input" value={test.inputs[name] ?? ''} onChange={event => update(test.id, { inputs: { ...test.inputs, [name]: event.target.value } })} /></td>)}{io.outputs.map(name => <td key={name}><input className="mono-input" value={test.expected[name] ?? ''} onChange={event => update(test.id, { expected: { ...test.expected, [name]: event.target.value } })} /></td>)}<td><input type="number" min="0" value={test.sampleTick} onChange={event => update(test.id, { sampleTick: Number(event.target.value) })} /></td><td><span className={`result-badge ${test.result.toLowerCase()}`}>{test.result}</span>{test.failure && <small className="test-failure">{test.failure}</small>}</td><td><div className="table-actions"><button title="Run" onClick={() => run(test)}>▶</button><button title="Visualize in editor" onClick={() => { onVisualize(test); onClose() }}>◎</button><button title="Delete" onClick={() => onChange(tests.filter(item => item.id !== test.id))}>×</button></div></td></tr>)}</tbody></table>{tests.length === 0 && <div className="empty-panel"><strong>No test cases yet</strong><span>Add a row to verify outputs at an exact simulation tick.</span><button className="primary-button" onClick={add}><Plus size={15} /> Add first test</button></div>}</div>
  </Modal>
}

export function HdlPanel({ result, mode, onMode, name, onClose }: { result: HdlExport; mode: HdlMode; onMode: (mode: HdlMode) => void; name: string; onClose: () => void }) {
  return <Modal title="HDL Export" eyebrow="SYSTEMVERILOG / VERILOG" onClose={onClose} wide>
    <div className="hdl-toolbar"><div className="segmented"><button className={mode === 'synthesizable' ? 'active' : ''} onClick={() => onMode('synthesizable')}>Synthesizable</button><button className={mode === 'delay' ? 'active' : ''} onClick={() => onMode('delay')}>Simulation with delay</button></div><button className="primary-button" onClick={() => downloadText(`${name}.sv`, result.code)}><Download size={15} /> Download .sv</button></div>
    {mode === 'delay' && <div className="notice warning">Simulation With Delay is not intended for synthesis.</div>}
    {result.errors.map(error => <div className="notice error" key={error}>{error}</div>)}{result.warnings.map(warning => <div className="notice warning" key={warning}>{warning}</div>)}
    <pre className="code-view"><code>{result.code}</code></pre>
  </Modal>
}

export function ProjectsPanel({ projects, currentId, onLoad, onNew, onClose }: { projects: Array<Pick<Project, 'id' | 'name' | 'updatedAt'>>; currentId: string; onLoad: (id: string) => void; onNew: () => void; onClose: () => void }) {
  return <Modal title="Local Projects" eyebrow="INDEXEDDB · BROWSER LOCAL" onClose={onClose}>
    <div className="project-list">{projects.map(project => <button key={project.id} className={project.id === currentId ? 'active' : ''} onClick={() => { onLoad(project.id); onClose() }}><div><strong>{project.name}</strong><span>{new Date(project.updatedAt).toLocaleString()}</span></div>{project.id === currentId && <span className="current-pill">CURRENT</span>}</button>)}</div>
    <footer className="modal-actions"><button className="primary-button" onClick={() => { onNew(); onClose() }}><Plus size={15} /> New project</button></footer>
  </Modal>
}
