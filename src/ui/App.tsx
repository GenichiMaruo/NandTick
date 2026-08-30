'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  Activity, Box, ChevronRight, CirclePlay, Clock3, Copy, Cpu, Database, Download, FileCode2,
  EyeOff, FolderOpen, Gauge, Maximize2, MemoryStick, MousePointer2, Palette, PanelTopOpen,
  MoonStar, Pause, Play, Plus, Redo2, RotateCcw, Save, Search, Settings2, Shapes, Sparkles, Square,
  TestTube2, Trash2, Undo2, Upload, Zap,
} from 'lucide-react'
import { BUILTIN_LIST, BUILTINS, createBuiltinInstance } from '@/core/builtins'
import { compileCircuit } from '@/core/compiler'
import { analyzeDefinitionDelay, analyzeGraphDelay } from '@/core/delay-analysis'
import { branchNet, connectEndpoints, disconnectEndpoint, forbiddenDefinitions, getInstancePorts, inferNetWidth, removeInstances, setWireBranchRoute, validateProject } from '@/core/graph'
import { exportHdl, type HdlMode } from '@/core/hdl'
import type { BuiltinKind, CircuitGraph, CircuitTestCase, ComponentInstance, ComponentVisual, NetEndpoint, Point, PortDirection, Project } from '@/core/model'
import { cloneProject, createId } from '@/core/model'
import { downloadText, exportProject, importProject, listProjects, loadProject, saveProject } from '@/core/persistence'
import { createComponentDefinition, createStarterProject } from '@/core/project'
import { Simulator } from '@/core/simulator'
import { simulationSignature } from '@/core/simulation-signature'
import { cyclePreviewMode, getComponentVisual, getPreviewMode, SHAPE_OPTIONS } from '@/core/visual'
import { CircuitCanvas } from './CircuitCanvas'
import { DEFAULT_CUSTOM_COLORS, generateHarmoniousPalette, isColorTheme, isDesignTheme, isFiveColorPalette, PALETTE_THEMES, resolvedPalette, themeVariables, type ColorTheme, type DesignTheme, type FiveColors, type PaletteTheme } from './design-theme'
import { HdlPanel, MemoryPanel, NewComponentDialog, PicoPanel, ProjectsPanel, TestsPanel } from './Panels'

type Dialog = 'new-component' | 'memory' | 'pico' | 'tests' | 'hdl' | 'projects' | null

const CUSTOM_COLOR_ROLES = ['文字', 'アクセント', '明るい面', 'やさしい色', '差し色']

function mutateCurrentGraph(project: Project, scopeId: string | null, mutate: (graph: CircuitGraph) => CircuitGraph): Project {
  if (!scopeId) return { ...project, mainGraph: mutate(project.mainGraph), updatedAt: new Date().toISOString() }
  return {
    ...project,
    updatedAt: new Date().toISOString(),
    definitions: project.definitions.map(definition => definition.id === scopeId
      ? { ...definition, internalGraph: mutate(definition.internalGraph), metadata: { ...definition.metadata, updatedAt: new Date().toISOString() } }
      : definition),
  }
}

function customInstance(definitionId: string, definitions: Project['definitions'], point: Point): ComponentInstance {
  const definition = definitions.find(candidate => candidate.id === definitionId)!
  return { id: createId('inst'), name: definition.name, componentId: definition.id, builtin: false, position: point, rotation: 0, parameters: {} }
}

function signalText(value: ReturnType<Simulator['valueAtEndpoint']>): string {
  if (!value) return '—'
  return value.width >= 4 ? value.toHex() : value.toBinary()
}

export function App() {
  const [project, setProject] = useState<Project>(() => createStarterProject())
  const [hydrated, setHydrated] = useState(false)
  const [scopeStack, setScopeStack] = useState<string[]>([])
  const scopeId = scopeStack.at(-1) ?? null
  const currentDefinition = project.definitions.find(definition => definition.id === scopeId)
  const graph = currentDefinition?.internalGraph ?? project.mainGraph
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [selectedNetId, setSelectedNetId] = useState<string | null>(null)
  const [placement, setPlacement] = useState<{ componentId: string; builtin: boolean } | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [paletteSearch, setPaletteSearch] = useState('')
  const [running, setRunning] = useState(false)
  const [revision, setRevision] = useState(0)
  const [advanceCount, setAdvanceCount] = useState(100)
  const [hdlMode, setHdlMode] = useState<HdlMode>('synthesizable')
  const [savedState, setSavedState] = useState<'saved' | 'saving' | 'local'>('local')
  const [projects, setProjects] = useState<Array<Pick<Project, 'id' | 'name' | 'updatedAt'>>>([])
  const [designTheme, setDesignTheme] = useState<DesignTheme>('studio')
  const [lastPalette, setLastPalette] = useState<ColorTheme>('misty-cocoa')
  const [customColors, setCustomColors] = useState<FiveColors>(DEFAULT_CUSTOM_COLORS)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteNotice, setPaletteNotice] = useState<string | null>(null)
  const [themeReady, setThemeReady] = useState(false)
  const projectImportRef = useRef<HTMLInputElement>(null)
  const palettePickerRef = useRef<HTMLDivElement>(null)
  const paletteNoticeTimer = useRef<number | null>(null)
  const past = useRef<Project[]>([])
  const future = useRef<Project[]>([])
  const runStartedTick = useRef(0)

  const commit = useCallback((update: (previous: Project) => Project) => {
    setProject(previous => {
      past.current.push(cloneProject(previous)); if (past.current.length > 80) past.current.shift()
      future.current = []
      return update(previous)
    })
    setSavedState('saving')
  }, [])

  useEffect(() => {
    const requestedTheme = new URLSearchParams(window.location.search).get('theme')
    const storedTheme = localStorage.getItem('nandtick:design-theme')
    const storedPalette = localStorage.getItem('nandtick:last-palette')
    const storedCustomColors = localStorage.getItem('nandtick:custom-palette')
    const requested = requestedTheme === 'friendly' ? 'misty-cocoa' : requestedTheme
    const stored = storedTheme === 'friendly' ? 'misty-cocoa' : storedTheme
    const restored = isDesignTheme(requested) ? requested : isDesignTheme(stored) ? stored : 'studio'
    if (storedCustomColors) {
      try { const parsed: unknown = JSON.parse(storedCustomColors); if (isFiveColorPalette(parsed)) setCustomColors(parsed) }
      catch { /* Ignore an invalid older preference. */ }
    }
    setDesignTheme(restored)
    if (isColorTheme(restored)) setLastPalette(restored)
    else if (isColorTheme(storedPalette)) setLastPalette(storedPalette)
    setThemeReady(true)
  }, [])

  useEffect(() => {
    if (!themeReady) return
    localStorage.setItem('nandtick:design-theme', designTheme)
    if (isColorTheme(designTheme)) localStorage.setItem('nandtick:last-palette', designTheme)
  }, [designTheme, themeReady])

  useEffect(() => {
    if (themeReady) localStorage.setItem('nandtick:custom-palette', JSON.stringify(customColors))
  }, [customColors, themeReady])

  useEffect(() => {
    if (!paletteOpen) return
    const close = (event: PointerEvent) => { if (!palettePickerRef.current?.contains(event.target as Node)) setPaletteOpen(false) }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [paletteOpen])

  useEffect(() => () => { if (paletteNoticeTimer.current !== null) window.clearTimeout(paletteNoticeTimer.current) }, [])

  useEffect(() => {
    let active = true
    const restore = async () => {
      try {
        const lastId = localStorage.getItem('nandtick:last-project')
        if (lastId) {
          const restored = await loadProject(lastId)
          if (restored && active) setProject(restored)
        }
      } finally { if (active) setHydrated(true) }
    }
    void restore()
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!hydrated) return
    setSavedState('saving')
    const timer = window.setTimeout(() => {
      void saveProject(project).then(() => {
        localStorage.setItem('nandtick:last-project', project.id)
        setSavedState('saved')
      }).catch(() => setSavedState('local'))
    }, 650)
    return () => window.clearTimeout(timer)
  }, [hydrated, project])

  const simulationKey = useMemo(() => simulationSignature(graph, project.definitions), [graph, project.definitions])
  // Presentation-only edits intentionally retain the compiled graph and live simulator.
  const compiled = useMemo(() => compileCircuit(graph, project.definitions), [simulationKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const simulator = useMemo(() => new Simulator(compiled, project.settings.eventsPerTickLimit), [compiled, project.settings.eventsPerTickLimit])
  const issues = useMemo(() => [...validateProject(project, graph), ...compiled.issues], [compiled.issues, graph, project])
  const errors = issues.filter(issue => issue.severity === 'error')
  const stats = simulator.stats // revision intentionally causes this snapshot to refresh
  void revision

  useEffect(() => { setRunning(false); setRevision(value => value + 1) }, [simulator])
  useEffect(() => {
    if (!running) return
    runStartedTick.current = simulator.currentTick
    let last = performance.now(); let remainder = 0; let lastPaint = last
    const interval = window.setInterval(() => {
      const now = performance.now(); const elapsed = now - last; last = now
      remainder += elapsed / Math.max(0.1, project.settings.tickDurationMs)
      const ticks = Math.floor(remainder)
      if (ticks > 0) { simulator.advance(Math.min(ticks, 10000)); remainder -= ticks }
      if (now - lastPaint >= 50) { setRevision(value => value + 1); lastPaint = now }
      if (simulator.stats.oscillation || simulator.currentTick - runStartedTick.current >= project.settings.maxAutomaticTicks) setRunning(false)
    }, 12)
    return () => window.clearInterval(interval)
  }, [project.settings.maxAutomaticTicks, project.settings.tickDurationMs, running, simulator])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if (event.key === 'Escape') { setPlacement(null); setPaletteOpen(false) }
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelection() }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo() }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo() }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateSelection() }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') { event.preventDefault(); copySelection() }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') { event.preventDefault(); pasteSelection() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })

  const setGraph = (mutate: (graph: CircuitGraph) => CircuitGraph) => commit(previous => mutateCurrentGraph(previous, scopeId, mutate))
  const undo = () => {
    const previous = past.current.pop(); if (!previous) return
    future.current.push(cloneProject(project)); setProject(previous); setRunning(false); setSavedState('saving')
  }
  const redo = () => {
    const next = future.current.pop(); if (!next) return
    past.current.push(cloneProject(project)); setProject(next); setRunning(false); setSavedState('saving')
  }

  const deleteSelection = () => {
    if (!selectedIds.length && !selectedNetId) return
    setGraph(current => selectedNetId
      ? { ...current, nets: current.nets.filter(net => net.id !== selectedNetId) }
      : removeInstances(current, new Set(selectedIds)))
    setSelectedIds([]); setSelectedNetId(null)
  }

  const serializeSelection = () => {
    const ids = new Set(selectedIds)
    return {
      instances: graph.instances.filter(instance => ids.has(instance.id)),
      nets: graph.nets.filter(net => net.endpoints.length && net.endpoints.every(endpoint => ids.has(endpoint.instanceId))),
    }
  }
  const copySelection = () => {
    if (!selectedIds.length) return
    localStorage.setItem('nandtick:clipboard', JSON.stringify(serializeSelection()))
  }
  const pasteSelection = () => {
    try {
      const source = JSON.parse(localStorage.getItem('nandtick:clipboard') ?? '') as CircuitGraph
      const mapping = new Map(source.instances.map(instance => [instance.id, createId('inst')]))
      const instances = source.instances.map(instance => ({ ...structuredClone(instance), id: mapping.get(instance.id)!, name: `${instance.name} copy`, position: { x: instance.position.x + 32, y: instance.position.y + 32 } }))
      const nets = source.nets.map(net => {
        const cloned = structuredClone(net)
        const mapEndpoint = (endpoint: NetEndpoint): NetEndpoint => ({ ...endpoint, instanceId: mapping.get(endpoint.instanceId)! })
        return {
          ...cloned,
          id: createId('net'),
          endpoints: cloned.endpoints.map(mapEndpoint),
          route: cloned.route ? {
            root: mapEndpoint(cloned.route.root),
            branches: cloned.route.branches.map(branch => ({ endpoint: mapEndpoint(branch.endpoint), points: branch.points.map(point => ({ x: point.x + 32, y: point.y + 32 })) })),
          } : undefined,
        }
      })
      setGraph(current => ({ instances: [...current.instances, ...instances], nets: [...current.nets, ...nets] }))
      setSelectedIds(instances.map(instance => instance.id))
    } catch { /* empty clipboard */ }
  }
  const duplicateSelection = () => { copySelection(); pasteSelection() }

  const place = (componentId: string, builtin: boolean, point: Point) => {
    const id = createId('inst')
    const position = { x: Math.round(point.x / 8) * 8, y: Math.round(point.y / 8) * 8 }
    const instance = builtin ? createBuiltinInstance(componentId as BuiltinKind, position.x, position.y, id) : { ...customInstance(componentId, project.definitions, position), id }
    setGraph(current => ({ ...current, instances: [...current.instances, instance] }))
    setSelectedIds([id]); setSelectedNetId(null); setPlacement(null)
  }
  const move = (ids: string[], delta: Point) => setGraph(current => {
    const moved = new Set(ids)
    return {
      ...current,
      instances: current.instances.map(instance => moved.has(instance.id) ? { ...instance, position: { x: instance.position.x + delta.x, y: instance.position.y + delta.y } } : instance),
      nets: current.nets.map(net => net.route && net.endpoints.every(endpoint => moved.has(endpoint.instanceId)) ? { ...net, route: { ...net.route, branches: net.route.branches.map(branch => ({ ...branch, points: branch.points.map(point => ({ x: point.x + delta.x, y: point.y + delta.y })) })) } } : net),
    }
  })
  const connect = (first: NetEndpoint, second: NetEndpoint) => setGraph(current => connectEndpoints(current, first, second, project.definitions, createId))
  const routeWire = (netId: string, root: NetEndpoint, routes: Array<{ endpoint: NetEndpoint; points: Point[] }>) => setGraph(current => routes.reduce((next, route) => setWireBranchRoute(next, netId, root, route.endpoint, route.points), current))
  const createWireBranch = (netId: string, root: NetEndpoint, sourceEndpoint: NetEndpoint, sourcePoints: Point[], targetEndpoint: NetEndpoint, targetPoints: Point[]) => setGraph(current => branchNet(current, netId, root, sourceEndpoint, sourcePoints, targetEndpoint, targetPoints, project.definitions, createId))
  const removeWireBranch = (netId: string, endpoint: NetEndpoint) => {
    const net = graph.nets.find(candidate => candidate.id === netId)
    setGraph(current => disconnectEndpoint(current, endpoint))
    if (!net || net.endpoints.length <= 2) setSelectedNetId(null)
  }

  const updateInstance = (instanceId: string, change: Partial<ComponentInstance>) => setGraph(current => {
    const instances = current.instances.map(instance => instance.id === instanceId ? { ...instance, ...change } : instance)
    const next = { ...current, instances }
    return { ...next, nets: next.nets.map(net => ({ ...net, width: inferNetWidth(net.endpoints, next, project.definitions) })) }
  })
  const updateParameter = (instance: ComponentInstance, key: string, value: unknown) => updateInstance(instance.id, { parameters: { ...instance.parameters, [key]: value } })
  const cyclePreview = (instanceId: string) => {
    const instance = graph.instances.find(candidate => candidate.id === instanceId)
    if (instance) updateParameter(instance, 'previewMode', cyclePreviewMode(instance))
  }

  const toggleInput = (instanceId: string, pressed?: boolean) => {
    const instance = graph.instances.find(candidate => candidate.id === instanceId); if (!instance) return
    const port = getInstancePorts(instance, project.definitions).find(candidate => candidate.id === 'y')
    const current = simulator.valueAtEndpoint(instanceId, 'y')
    const next = pressed !== undefined ? (pressed ? '1' : '0') : current?.toBigInt() === 1n ? '0' : '1'
    try { simulator.setInput(instanceId, port && port.width > 1 ? `0b${next.padStart(port.width, '0')}` : next); setRevision(value => value + 1) } catch { /* inspector shows invalid entry */ }
  }

  const applyMemory = (instanceId: string, memory: Uint8Array) => {
    setRunning(false)
    simulator.applyRam(instanceId, memory)
    updateInstance(instanceId, { parameters: { ...graph.instances.find(instance => instance.id === instanceId)!.parameters, initialMemory: Array.from(memory) } })
  }

  const currentTests = currentDefinition?.tests ?? project.tests
  const setTests = (tests: CircuitTestCase[]) => commit(previous => currentDefinition
    ? { ...previous, definitions: previous.definitions.map(definition => definition.id === currentDefinition.id ? { ...definition, tests } : definition), updatedAt: new Date().toISOString() }
    : { ...previous, tests, updatedAt: new Date().toISOString() })
  const visualizeTest = (test: CircuitTestCase) => {
    setRunning(false); simulator.reset()
    const inputInstances = graph.instances.filter(instance => ['TOGGLE', 'BUTTON', 'INPUT_PIN'].includes(instance.componentId))
    const inputByName = new Map(inputInstances.map(instance => {
      const binding = currentDefinition?.ports.find(port => port.id === instance.parameters.bindingPortId)
      return [binding?.name ?? instance.name, instance.id]
    }))
    const events = [...(test.sequence ?? []), { tick: 0, inputs: test.inputs }].sort((a, b) => a.tick - b.tick)
    let tick = 0
    for (const event of events) {
      if (event.tick > tick) { simulator.advance(event.tick - tick); tick = event.tick }
      for (const [name, value] of Object.entries(event.inputs ?? {})) { const id = inputByName.get(name); if (id) simulator.setInput(id, value) }
    }
    if (test.sampleTick > tick) simulator.advance(test.sampleTick - tick)
    setRevision(value => value + 1)
  }

  const selected = graph.instances.find(instance => instance.id === selectedIds[0])
  const selectedNet = graph.nets.find(net => net.id === selectedNetId)
  const ramMemory = selected?.componentId === 'RAM_256x8' ? simulator.getRam(selected.id) : undefined
  const picoState = selected?.componentId === 'PICO88_DISPLAY' ? simulator.getPico(selected.id) : undefined
  const hdl = useMemo(() => exportHdl(graph, project.definitions, currentDefinition, hdlMode, project.settings.tickDurationMs), [currentDefinition, graph, hdlMode, project.definitions, project.settings.tickDurationMs])
  const scopeDelay = useMemo(() => currentDefinition ? analyzeDefinitionDelay(currentDefinition, project.definitions) : analyzeGraphDelay(graph, project.definitions), [currentDefinition, graph, project.definitions])
  const forbidden = useMemo(() => scopeId ? forbiddenDefinitions(scopeId, project.definitions) : new Set<string>(), [project.definitions, scopeId])

  const filteredBuiltins = BUILTIN_LIST.filter(item => `${item.name} ${item.kind} ${item.category}`.toLowerCase().includes(paletteSearch.toLowerCase()))
  const filteredDefinitions = project.definitions.filter(definition => !forbidden.has(definition.id) && `${definition.name} ${definition.category}`.toLowerCase().includes(paletteSearch.toLowerCase()))
  const groupedBuiltins = Object.groupBy(filteredBuiltins, item => item.category)

  const doAdvance = (ticks: number) => { setRunning(false); simulator.advance(ticks); setRevision(value => value + 1) }
  const reset = () => { setRunning(false); simulator.reset(); setRevision(value => value + 1) }
  const newProject = () => { past.current = []; future.current = []; setScopeStack([]); setProject(createStarterProject()); setSelectedIds([]); setSelectedNetId(null) }
  const openProjects = () => { void listProjects().then(setProjects); setDialog('projects') }
  const loadNamed = (id: string) => void loadProject(id).then(value => { if (value) { setProject(value); setScopeStack([]); past.current = []; future.current = [] } })

  const importProjectFile = async (file: File) => {
    try { const imported = importProject(await file.text()); setProject(imported); setScopeStack([]); past.current = []; future.current = [] }
    catch (error) { window.alert(error instanceof Error ? error.message : String(error)) }
  }

  const choosePalette = (theme: PaletteTheme) => {
    setDesignTheme(theme); setLastPalette(theme); setPaletteOpen(false)
  }
  const chooseCustomPalette = () => { setDesignTheme('custom'); setLastPalette('custom') }
  const editCustomColor = (index: number, color: string) => {
    setCustomColors(previous => {
      const next = [...previous] as [string, string, string, string, string]
      next[index] = color.toUpperCase()
      return next
    })
    chooseCustomPalette()
  }
  const surprisePalette = () => {
    setCustomColors(generateHarmoniousPalette())
    chooseCustomPalette()
    setPaletteNotice('新しい5色を生成しました')
    if (paletteNoticeTimer.current !== null) window.clearTimeout(paletteNoticeTimer.current)
    paletteNoticeTimer.current = window.setTimeout(() => setPaletteNotice(null), 2200)
  }
  const activePalette = resolvedPalette(isColorTheme(designTheme) ? designTheme : lastPalette, customColors)

  return <main className="app-shell" data-theme={designTheme === 'studio' ? 'studio' : 'friendly'} data-palette={isColorTheme(designTheme) ? designTheme : undefined} style={themeVariables(designTheme, customColors) as CSSProperties}>
    <header className="topbar">
      <div className="brand" onDoubleClick={surprisePalette} title="ヒント: ダブルクリックで配色をおまかせ"><div className="brand-mark"><Zap size={19} /></div><div><strong>NandTick</strong><span>LOGIC CIRCUIT STUDIO</span></div></div>
      <div className="project-heading"><input value={project.name} onChange={event => commit(previous => ({ ...previous, name: event.target.value, updatedAt: new Date().toISOString() }))} /><div className="save-state"><span className={savedState} />{savedState === 'saving' ? 'Saving…' : savedState === 'saved' ? 'Saved locally' : 'Local only'}</div></div>
      <nav className="top-actions">
        <div className="design-switcher" ref={palettePickerRef} role="group" aria-label="デザインテーマ">
          <button className={designTheme === 'studio' ? 'active' : ''} aria-pressed={designTheme === 'studio'} title="Studio · フラットダーク" onClick={() => { setDesignTheme('studio'); setPaletteOpen(false) }}><MoonStar size={14} /><span>Studio</span></button>
          <button className={isColorTheme(designTheme) ? 'active palette-trigger' : 'palette-trigger'} aria-pressed={isColorTheme(designTheme)} aria-expanded={paletteOpen} title="5色パレットを選ぶ・編集する" onClick={() => { if (designTheme === 'studio') setDesignTheme(lastPalette); setPaletteOpen(value => !value) }}>
            <Palette size={14} /><span>{isColorTheme(designTheme) ? activePalette.label : 'Colors'}</span><i className="mini-swatches" aria-hidden="true">{activePalette.colors.map((color, index) => <b key={`${color}-${index}`} style={{ background: color }} />)}</i>
          </button>
          {paletteOpen && <div className="palette-popover">
            <header><div><strong>Color sets</strong><span>外周UIを5色で着せ替え。回路面は明るさを保ちます</span></div><Sparkles size={16} /></header>
            <div className="palette-options">
              {PALETTE_THEMES.map(theme => <button key={theme.id} className={designTheme === theme.id ? 'active' : ''} onClick={() => choosePalette(theme.id)}><i>{theme.colors.map(color => <b key={color} style={{ background: color }} />)}</i><div><strong>{theme.label}</strong><span>{theme.description}</span></div>{designTheme === theme.id && <em>✓</em>}</button>)}
              <button className={designTheme === 'custom' ? 'active' : ''} onClick={chooseCustomPalette}><i>{customColors.map((color, index) => <b key={`${color}-${index}`} style={{ background: color }} />)}</i><div><strong>My Palette</strong><span>下の5色を自由に編集できます</span></div>{designTheme === 'custom' && <em>✓</em>}</button>
            </div>
            <button className="surprise-palette" onClick={surprisePalette}><Sparkles size={15} /><div><strong>おまかせ配色</strong><span>毎回、新しい5色の組み合わせを生成します</span></div></button>
            <section className="custom-palette-editor">
              <header><strong>My Paletteを編集</strong><span>色を変えるとすぐ画面に反映されます</span></header>
              <div>{customColors.map((color, index) => <label key={index}><span>{CUSTOM_COLOR_ROLES[index]}</span><input type="color" value={color} aria-label={`${CUSTOM_COLOR_ROLES[index]}の色`} onChange={event => editCustomColor(index, event.target.value)} /><input key={color} className="custom-color-code" defaultValue={color} maxLength={7} spellCheck={false} aria-label={`${CUSTOM_COLOR_ROLES[index]}のHEX値`} onChange={event => { const value = event.currentTarget.value.trim(); if (/^#[\da-f]{6}$/i.test(value)) editCustomColor(index, value) }} onBlur={event => { const value = event.currentTarget.value.trim(); if (/^#[\da-f]{6}$/i.test(value)) editCustomColor(index, value); else event.currentTarget.value = color }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} /></label>)}</div>
            </section>
          </div>}
        </div>
        <button onClick={openProjects} title="Projects"><FolderOpen size={17} /><span>Projects</span></button><button onClick={() => downloadText(`${project.name}.nandtick.json`, exportProject(project), 'application/json')}><Download size={17} /><span>Export</span></button><button onClick={() => projectImportRef.current?.click()}><Upload size={17} /><span>Import</span></button><button onClick={() => setDialog('hdl')}><FileCode2 size={17} /><span>HDL</span></button><input ref={projectImportRef} type="file" accept=".json,.nandtick.json" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void importProjectFile(file); event.target.value = '' }} />
      </nav>
    </header>

    <div className="workspace">
      <aside className="palette-sidebar">
        <div className="sidebar-title"><div><span className="eyebrow">LIBRARY</span><h2>Components</h2></div><button className="icon-button accent" title="New component" onClick={() => setDialog('new-component')}><Plus size={18} /></button></div>
        <label className="search-box"><Search size={15} /><input placeholder="Search gates, memory…" value={paletteSearch} onChange={event => setPaletteSearch(event.target.value)} /></label>
        <div className="palette-scroll">
          {Object.entries(groupedBuiltins).map(([category, items]) => <section className="palette-group" key={category}><h3>{category}</h3><div className="palette-grid">{items!.map(item => <button key={item.kind} className={placement?.componentId === item.kind ? 'active' : ''} onClick={() => setPlacement({ componentId: item.kind, builtin: true })} title={item.description}><span className="palette-symbol">{item.kind === 'AND' ? '&' : item.kind === 'OR' ? '≥1' : item.kind === 'NOT' ? '¬' : item.kind === 'RAM_256x8' ? 'RAM' : item.kind === 'PICO88_DISPLAY' ? '▦' : item.name.slice(0, 3).toUpperCase()}</span><span>{item.name}</span></button>)}</div></section>)}
          <section className="palette-group"><h3>Custom <span>{filteredDefinitions.length}</span></h3>{filteredDefinitions.length ? <div className="custom-list">{filteredDefinitions.map(definition => { const delay = analyzeDefinitionDelay(definition, project.definitions); return <button key={definition.id} className={placement?.componentId === definition.id ? 'active' : ''} onClick={() => setPlacement({ componentId: definition.id, builtin: false })}><Box size={16} /><div><strong>{definition.name}</strong><span>{definition.ports.length} ports · {delay.maxDelay ?? 'dynamic'}t</span></div></button> })}</div> : <div className="palette-empty">No reusable components</div>}</section>
        </div>
      </aside>

      <section className="editor-column">
        <div className="editor-toolbar">
          <div className="breadcrumbs"><button onClick={() => setScopeStack([])}><Cpu size={15} /> Main</button>{scopeStack.map((id, index) => { const definition = project.definitions.find(item => item.id === id); return <span key={`${id}${index}`}><ChevronRight size={14} /><button onClick={() => setScopeStack(items => items.slice(0, index + 1))}>{definition?.name ?? 'Missing'}</button></span> })}</div>
          <div className="edit-tools"><button title="Select"><MousePointer2 size={16} /></button><i /><button onClick={undo} disabled={!past.current.length} title="Undo"><Undo2 size={16} /></button><button onClick={redo} disabled={!future.current.length} title="Redo"><Redo2 size={16} /></button><button onClick={copySelection} disabled={!selectedIds.length} title="Copy"><Copy size={16} /></button><button onClick={duplicateSelection} disabled={!selectedIds.length} title="Duplicate"><Shapes size={16} /></button><button onClick={deleteSelection} disabled={!selectedIds.length && !selectedNetId} title="Delete"><Trash2 size={16} /></button></div>
          <div className="scope-timing"><Clock3 size={14} /><span>Max delay</span><strong>{scopeDelay.maxDelay === null ? 'feedback / dynamic' : `${scopeDelay.maxDelay} ticks`}</strong></div>
        </div>
        <div className="canvas-area">
          <CircuitCanvas graph={graph} definitions={project.definitions} simulator={simulator} revision={revision} selectedIds={selectedIds} selectedNetId={selectedNetId} placement={placement} theme={designTheme} customColors={customColors} onSelection={(ids, netId) => { setSelectedIds(ids); setSelectedNetId(netId) }} onPlace={place} onMove={move} onConnect={connect} onWireRoute={routeWire} onWireBranch={createWireBranch} onRemoveWireBranch={removeWireBranch} onOpenComponent={id => setScopeStack(items => [...items, id])} onToggle={toggleInput} onPreviewMode={cyclePreview} issues={issues} />
          {placement && <div className="placement-hint"><MousePointer2 size={15} /> Canvasをクリックして {placement.builtin ? BUILTINS[placement.componentId as BuiltinKind].name : project.definitions.find(definition => definition.id === placement.componentId)?.name} を配置</div>}
        </div>
        <div className="simulation-bar">
          <div className="transport"><button className="reset-button" onClick={reset} title="Reset"><RotateCcw size={17} /></button>{running ? <button className="pause-button" onClick={() => setRunning(false)}><Pause size={17} /> Pause</button> : <button className="run-button" disabled={errors.length > 0} onClick={() => setRunning(true)}><Play size={17} /> Run</button>}<button onClick={() => doAdvance(1)}>+1 Tick</button><button onClick={() => doAdvance(10)}>+10</button><div className="advance-control"><input type="number" min="1" value={advanceCount} onChange={event => setAdvanceCount(Math.max(1, Number(event.target.value)))} /><button onClick={() => doAdvance(advanceCount)}>Advance</button></div></div>
          <div className="sim-stats"><div><span>CURRENT TICK</span><strong>{stats.currentTick.toLocaleString()}</strong></div><div><span>PENDING</span><strong>{stats.pendingEvents.toLocaleString()}</strong></div><div><span>SPEED</span><strong>{(1000 / project.settings.tickDurationMs).toFixed(project.settings.tickDurationMs >= 100 ? 0 : 1)} tick/s</strong></div></div>
          <div className="tick-speed"><label><span>Tick duration</span><input type="range" min="1" max="1000" step="1" value={project.settings.tickDurationMs} onChange={event => commit(previous => ({ ...previous, settings: { ...previous.settings, tickDurationMs: Number(event.target.value) } }))} /></label><div><input type="number" min="0.1" max="10000" step="0.1" value={project.settings.tickDurationMs} onChange={event => commit(previous => ({ ...previous, settings: { ...previous.settings, tickDurationMs: Math.max(0.1, Number(event.target.value)) } }))} /><span>ms/tick</span></div></div>
        </div>
      </section>

      <aside className="inspector-sidebar">
        <div className="inspector-tabs"><button className="active"><Settings2 size={15} /> Inspector</button><button onClick={() => setDialog('tests')}><TestTube2 size={15} /> Tests</button></div>
        <div className="inspector-scroll">
          {selected ? <InstanceInspector instance={selected} project={project} simulator={simulator} definitions={project.definitions} updateInstance={updateInstance} updateParameter={updateParameter} onDelete={deleteSelection} onDuplicate={duplicateSelection} onMemory={() => setDialog('memory')} onPico={() => setDialog('pico')} onDefinitionVisual={(definitionId, key, value) => commit(previous => ({ ...previous, definitions: previous.definitions.map(definition => definition.id === definitionId ? { ...definition, visual: { ...definition.visual, [key]: value } } : definition), updatedAt: new Date().toISOString() }))} />
          : selectedNet ? <NetInspector net={selectedNet} graph={graph} simulator={simulator} />
          : <OverviewInspector project={project} graph={graph} issues={issues} delay={scopeDelay} onSelectIssue={issue => { if (issue.instanceId) setSelectedIds([issue.instanceId]); if (issue.netId) setSelectedNetId(issue.netId) }} onTests={() => setDialog('tests')} onHdl={() => setDialog('hdl')} />}
        </div>
      </aside>
    </div>

    {paletteNotice && <div className="palette-toast"><Sparkles size={16} /><div><strong>おまかせ配色</strong><span>{paletteNotice}</span></div></div>}
    {stats.oscillation && <div className="fatal-toast"><Activity size={18} /><div><strong>Simulation paused</strong><span>{stats.oscillation}</span></div></div>}
    {dialog === 'new-component' && <NewComponentDialog onClose={() => setDialog(null)} onCreate={(name, ports) => { const definition = createComponentDefinition(name, ports); commit(previous => ({ ...previous, definitions: [...previous.definitions, definition], updatedAt: new Date().toISOString() })); setScopeStack([definition.id]); setSelectedIds([]) }} />}
    {dialog === 'memory' && selected && ramMemory && <MemoryPanel instanceName={selected.name} memory={ramMemory} onApply={memory => applyMemory(selected.id, memory)} onClose={() => setDialog(null)} />}
    {dialog === 'pico' && selected && picoState && <PicoPanel name={selected.name} state={picoState} onClose={() => setDialog(null)} />}
    {dialog === 'tests' && <TestsPanel graph={graph} definitions={project.definitions} definition={currentDefinition} tests={currentTests} onChange={setTests} onVisualize={visualizeTest} onClose={() => setDialog(null)} />}
    {dialog === 'hdl' && <HdlPanel result={hdl} mode={hdlMode} onMode={setHdlMode} name={currentDefinition?.name ?? project.name} onClose={() => setDialog(null)} />}
    {dialog === 'projects' && <ProjectsPanel projects={projects} currentId={project.id} onLoad={loadNamed} onNew={newProject} onClose={() => setDialog(null)} />}
  </main>
}

function InspectorSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="inspector-section"><h3>{title}</h3>{children}</section>
}

function InstanceInspector({ instance, project, simulator, definitions, updateInstance, updateParameter, onDelete, onDuplicate, onMemory, onPico, onDefinitionVisual }: {
  instance: ComponentInstance; project: Project; simulator: Simulator; definitions: Project['definitions']; updateInstance: (id: string, change: Partial<ComponentInstance>) => void; updateParameter: (instance: ComponentInstance, key: string, value: unknown) => void; onDelete: () => void; onDuplicate: () => void; onMemory: () => void; onPico: () => void; onDefinitionVisual: (definitionId: string, key: string, value: unknown) => void
}) {
  const ports = getInstancePorts(instance, definitions)
  const definition = !instance.builtin ? definitions.find(item => item.id === instance.componentId) : undefined
  const visual = getComponentVisual(instance, definitions)
  const previewMode = getPreviewMode(instance)
  const delay = definition ? analyzeDefinitionDelay(definition, definitions) : { maxDelay: Number(instance.parameters.delay ?? (instance.componentId === 'RAM_256x8' ? Math.max(Number(instance.parameters.readDelay ?? 1), Number(instance.parameters.writeDelay ?? 1)) : 0)), feedback: false, criticalPath: [] }
  const parameterEntries = Object.entries(instance.parameters).filter(([key, value]) => !['initialMemory', 'bindingPortId', 'value', 'previewMode'].includes(key) && ['number', 'string'].includes(typeof value))
  const setInstanceVisual = (key: keyof ComponentVisual, value: ComponentVisual[keyof ComponentVisual]) => updateInstance(instance.id, { visualOverride: { ...instance.visualOverride, [key]: value } })
  return <>
    <div className="selected-heading"><div className="type-icon lively">{instance.componentId === 'PICO88_DISPLAY' ? <Square size={18} /> : instance.componentId === 'RAM_256x8' ? <MemoryStick size={18} /> : instance.builtin ? <Zap size={18} /> : <Box size={18} />}</div><div><span>{instance.builtin ? String(instance.componentId).replaceAll('_', ' ') : 'CUSTOM COMPONENT'}</span><input value={instance.name} onChange={event => updateInstance(instance.id, { name: event.target.value })} /></div></div>
    <InspectorSection title="IDENTITY"><div className="property-list"><label><span>Instance ID</span><code>{instance.id}</code></label><label><span>Type</span><strong>{instance.componentId}</strong></label></div></InspectorSection>
    <InspectorSection title="ON-CANVAS PREVIEW"><div className="preview-mode-picker">
      <button className={previewMode === 'off' ? 'active' : ''} onClick={() => updateParameter(instance, 'previewMode', 'off')}><EyeOff size={15} /><span>Off</span><small>Symbol only</small></button>
      <button className={previewMode === 'compact' ? 'active' : ''} onClick={() => updateParameter(instance, 'previewMode', 'compact')}><PanelTopOpen size={15} /><span>Preview</span><small>Live state</small></button>
      <button className={previewMode === 'expanded' ? 'active' : ''} onClick={() => updateParameter(instance, 'previewMode', 'expanded')}><Maximize2 size={15} /><span>Expand</span><small>Full detail</small></button>
    </div><p className="inspector-hint">Canvas右上の小さなボタンでも表示を切り替えられます。論理動作やtickには影響しません。</p></InspectorSection>
    <InspectorSection title="TIMING"><div className="delay-card"><Clock3 size={20} /><div><span>Maximum propagation</span><strong>{delay.maxDelay === null ? 'feedback / dynamic' : `${delay.maxDelay} ticks`}</strong><small>{delay.maxDelay === null ? 'Static bound is unavailable' : `${(delay.maxDelay * project.settings.tickDurationMs).toLocaleString()} ms @ ${project.settings.tickDurationMs} ms/tick`}</small></div></div>{delay.criticalPath.length > 0 && <div className="critical-path">{delay.criticalPath.join(' → ')}</div>}</InspectorSection>
    {parameterEntries.length > 0 && <InspectorSection title="PARAMETERS"><div className="parameter-grid">{parameterEntries.map(([key, value]) => <label key={key}><span>{key.replace(/([A-Z])/g, ' $1')}</span><input type={typeof value === 'number' ? 'number' : 'text'} min={key.toLowerCase().includes('delay') ? 0 : undefined} value={String(value)} onChange={event => updateParameter(instance, key, typeof value === 'number' ? Number(event.target.value) : event.target.value)} /></label>)}</div></InspectorSection>}
    <InspectorSection title={`PORTS · ${ports.length}`}><div className="port-list">{ports.map(port => { const value = simulator.valueAtEndpoint(instance.id, port.id); return <div key={port.id}><span className={`direction ${port.direction.toLowerCase()}`}>{port.direction.slice(0, 3)}</span><div><strong>{port.name}</strong><span>{port.width} bit [{port.width - 1}:0]</span></div><code>{signalText(value)}</code></div> })}</div></InspectorSection>
    <InspectorSection title="INSTANCE APPEARANCE"><div className="appearance-title"><Palette size={16} /><div><strong>Make it yours</strong><span>この部品だけに適用</span></div>{instance.visualOverride && <button onClick={() => updateInstance(instance.id, { visualOverride: undefined })}>Reset</button>}</div><AppearanceControls visual={visual} onChange={setInstanceVisual} /></InspectorSection>
    {definition && <InspectorSection title="CUSTOM DEFINITION DEFAULT"><p className="inspector-hint definition-hint"><Sparkles size={13} /> 新しく配置する同種の部品すべてに使う基本スタイルです。</p><AppearanceControls visual={definition.visual} onChange={(key, value) => onDefinitionVisual(definition.id, key, value)} /></InspectorSection>}
    {instance.componentId === 'RAM_256x8' && <button className="inspector-feature" onClick={onMemory}><MemoryStick size={19} /><div><strong>Open Memory Inspector</strong><span>Import, reload, edit, export</span></div><ChevronRight size={17} /></button>}
    {instance.componentId === 'PICO88_DISPLAY' && <button className="inspector-feature" onClick={onPico}><Square size={19} /><div><strong>Open Display Debugger</strong><span>Screen RAM, VRAM, palette</span></div><ChevronRight size={17} /></button>}
    <div className="inspector-actions"><button onClick={onDuplicate}><Copy size={15} /> Duplicate</button><button className="danger" onClick={onDelete}><Trash2 size={15} /> Delete</button></div>
  </>
}

function AppearanceControls({ visual, onChange }: { visual: ComponentVisual; onChange: (key: keyof ComponentVisual, value: ComponentVisual[keyof ComponentVisual]) => void }) {
  return <div className="visual-grid rich"><label><span>Fill</span><input type="color" value={visual.fill} onChange={event => onChange('fill', event.target.value)} /></label><label><span>Border</span><input type="color" value={visual.border} onChange={event => onChange('border', event.target.value)} /></label><label><span>Text</span><input type="color" value={visual.text} onChange={event => onChange('text', event.target.value)} /></label><label className="shape-field"><span>Shape</span><select value={visual.shape} onChange={event => onChange('shape', event.target.value as ComponentVisual['shape'])}>{SHAPE_OPTIONS.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label><label><span>Width</span><input type="number" min="60" max="800" value={visual.width} onChange={event => onChange('width', Math.min(800, Math.max(60, Number(event.target.value))))} /></label><label><span>Height</span><input type="number" min="40" max="800" value={visual.height} onChange={event => onChange('height', Math.min(800, Math.max(40, Number(event.target.value))))} /></label></div>
}

function NetInspector({ net, graph, simulator }: { net: CircuitGraph['nets'][number]; graph: CircuitGraph; simulator: Simulator }) {
  const value = simulator.valueForSourceNet(net.id)
  return <><div className="selected-heading"><div className="type-icon"><Activity size={18} /></div><div><span>NET / BUS</span><input value={net.name ?? net.id} readOnly /></div></div><InspectorSection title="SIGNAL"><div className="signal-card"><code>{value?.toBinary() ?? '—'}</code>{net.width >= 4 && <code>{value?.toHex() ?? '—'}</code>}<span>{net.width} bit [{net.width - 1}:0] · last change tick {simulator.lastChangedForSourceNet(net.id) ?? 0}</span></div></InspectorSection><InspectorSection title={`ENDPOINTS · ${net.endpoints.length}`}><div className="endpoint-list">{net.endpoints.map(endpoint => { const instance = graph.instances.find(item => item.id === endpoint.instanceId); return <div key={`${endpoint.instanceId}${endpoint.portId}`}><strong>{instance?.name ?? endpoint.instanceId}</strong><code>{endpoint.portId}</code></div> })}</div></InspectorSection></>
}

function OverviewInspector({ project, graph, issues, delay, onSelectIssue, onTests, onHdl }: { project: Project; graph: CircuitGraph; issues: ReturnType<typeof validateProject>; delay: ReturnType<typeof analyzeGraphDelay>; onSelectIssue: (issue: ReturnType<typeof validateProject>[number]) => void; onTests: () => void; onHdl: () => void }) {
  const errors = issues.filter(issue => issue.severity === 'error'); const warnings = issues.filter(issue => issue.severity === 'warning')
  return <><div className="overview-heading"><Gauge size={23} /><div><span>CIRCUIT OVERVIEW</span><strong>{graph.instances.length} components · {graph.nets.length} nets</strong></div></div><div className="overview-stats"><div><span>MAX DELAY</span><strong>{delay.maxDelay ?? 'Dynamic'}{delay.maxDelay !== null && 't'}</strong></div><div><span>ERRORS</span><strong className={errors.length ? 'bad' : ''}>{errors.length}</strong></div><div><span>WARNINGS</span><strong className={warnings.length ? 'warn' : ''}>{warnings.length}</strong></div><div><span>TICK</span><strong>{project.settings.tickDurationMs}ms</strong></div></div><InspectorSection title="VALIDATION"><div className="issue-list">{issues.length ? issues.map((issue, index) => <button key={`${issue.code}${index}`} className={issue.severity} onClick={() => onSelectIssue(issue)}><span>{issue.severity === 'error' ? '!' : '△'}</span><div><strong>{issue.code.replaceAll('_', ' ')}</strong><p>{issue.message}</p></div></button>) : <div className="valid-state"><CheckCircle /> <div><strong>Circuit is valid</strong><span>Ready to simulate and export</span></div></div>}</div></InspectorSection>{delay.criticalPath.length > 0 && <InspectorSection title="CRITICAL PATH"><div className="critical-path">{delay.criticalPath.join(' → ')}</div></InspectorSection>}<div className="overview-links"><button onClick={onTests}><TestTube2 size={17} /><div><strong>Test cases</strong><span>Tick-accurate verification</span></div><ChevronRight size={16} /></button><button onClick={onHdl}><FileCode2 size={17} /><div><strong>HDL export</strong><span>SystemVerilog / Verilog</span></div><ChevronRight size={16} /></button></div></>
}

function CheckCircle() { return <div className="check-circle">✓</div> }
