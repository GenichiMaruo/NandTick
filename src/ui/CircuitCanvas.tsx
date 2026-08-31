'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getInstancePorts } from '@/core/graph'
import type { CircuitGraph, ComponentDefinition, ComponentInstance, LooseWireRoute, Net, NetEndpoint, Point, PortSpec, ValidationIssue } from '@/core/model'
import type { Simulator } from '@/core/simulator'
import { getRenderVisual } from '@/core/visual'
import { drawComponent, previewControlRect } from './canvas-renderer'
import { canvasTheme, type CanvasThemePalette, type DesignTheme, type FiveColors } from './design-theme'

interface Props {
  graph: CircuitGraph
  definitions: ComponentDefinition[]
  simulator: Simulator
  revision: number
  selectedIds: string[]
  selectedNetId: string | null
  placement: { componentId: string; builtin: boolean } | null
  wireMode: boolean
  marqueeMode: boolean
  theme: DesignTheme
  customColors: FiveColors
  onSelection: (ids: string[], netId: string | null) => void
  onPlace: (componentId: string, builtin: boolean, point: Point) => void
  onMove: (ids: string[], delta: Point) => void
  onConnect: (first: NetEndpoint, second: NetEndpoint) => void
  onWireRoute: (netId: string, root: NetEndpoint, routes: Array<{ endpoint: NetEndpoint; points: Point[] }>) => void
  onWireBranch: (netId: string, root: NetEndpoint, sourceEndpoint: NetEndpoint, sourcePoints: Point[], targetEndpoint: NetEndpoint, targetPoints: Point[]) => void
  onCreateLooseWire: (start: Point, end: Point, points: Point[], startEndpoint?: NetEndpoint, endEndpoint?: NetEndpoint, netId?: string, startJunction?: boolean, endJunction?: boolean) => void
  onLooseWireRoute: (netId: string, wireId: string, points: Point[], start?: Point, end?: Point) => void
  onAttachLooseWire: (netId: string, wireId: string, side: 'start' | 'end', endpoint: NetEndpoint, point: Point) => void
  onRemoveLooseWire: (netId: string, wireId: string) => void
  onRemoveWireBranch: (netId: string, endpoint: NetEndpoint) => void
  onOpenComponent: (definitionId: string) => void
  onToggle: (instanceId: string, pressed?: boolean) => void
  onPreviewMode: (instanceId: string) => void
  issues: ValidationIssue[]
}

type Hover =
  | { kind: 'port'; instance: ComponentInstance; port: PortSpec; x: number; y: number }
  | { kind: 'net'; netId: string; x: number; y: number }
  | null

interface View { x: number; y: number; zoom: number }

type WireBranchTarget =
  | { kind: 'endpoint'; endpoint: NetEndpoint }
  | { kind: 'loose'; wire: LooseWireRoute }

interface WireBranchGeometry {
  netId: string
  root?: NetEndpoint
  target: WireBranchTarget
  points: Point[]
  path: Point[]
}

interface WireHit extends WireBranchGeometry {
  segmentIndex: number
  point: Point
  distance: number
}

interface WirePointEdit {
  netId: string
  root?: NetEndpoint
  edits: Array<{ target: WireBranchTarget; points: Point[]; indices: number[] }>
}

interface PendingWire { point: Point; endpoint?: NetEndpoint }

interface LooseEndDrag { branch: WireBranchGeometry; side: 'start' | 'end' }

interface Marquee {
  start: Point
  current: Point
  baseIds: string[]
}

interface PinchGesture {
  distance: number
  worldMidpoint: Point
  view: View
}

function endpointKey(endpoint: NetEndpoint): string {
  return `${endpoint.instanceId}:${endpoint.portId}`
}

function sameEndpoint(first: NetEndpoint, second: NetEndpoint): boolean {
  return endpointKey(first) === endpointKey(second)
}

function sameTarget(first: WireBranchTarget, second: WireBranchTarget): boolean {
  return first.kind === 'endpoint' && second.kind === 'endpoint'
    ? sameEndpoint(first.endpoint, second.endpoint)
    : first.kind === 'loose' && second.kind === 'loose' && first.wire.id === second.wire.id
}

function samePoint(first: Point, second: Point, tolerance = .2): boolean {
  return Math.abs(first.x - second.x) <= tolerance && Math.abs(first.y - second.y) <= tolerance
}

function pointKey(point: Point): string {
  return `${Math.round(point.x * 10)}:${Math.round(point.y * 10)}`
}

function portPoint(instance: ComponentInstance, port: PortSpec, definitions: ComponentDefinition[], offset?: Point): Point {
  const visual = getRenderVisual(instance, definitions)
  const position = { x: instance.position.x + (offset?.x ?? 0), y: instance.position.y + (offset?.y ?? 0) }
  if (port.position.side === 'left') return { x: position.x, y: position.y + visual.height * port.position.offset }
  if (port.position.side === 'right') return { x: position.x + visual.width, y: position.y + visual.height * port.position.offset }
  if (port.position.side === 'top') return { x: position.x + visual.width * port.position.offset, y: position.y }
  return { x: position.x + visual.width * port.position.offset, y: position.y + visual.height }
}

function signalColor(binary: string | undefined, palette: CanvasThemePalette): string {
  if (!binary) return palette.signalIdle
  if (binary.includes('X')) return palette.signalUnknown
  if (binary.includes('Z')) return palette.signalFloating
  return binary.endsWith('1') ? palette.signalHigh : palette.signalLow
}

function closestPointOnSegment(point: Point, start: Point, end: Point): { point: Point; distance: number } {
  const dx = end.x - start.x; const dy = end.y - start.y
  if (dx === 0 && dy === 0) return { point: start, distance: Math.hypot(point.x - start.x, point.y - start.y) }
  const amount = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)))
  const projected = { x: start.x + amount * dx, y: start.y + amount * dy }
  return { point: projected, distance: Math.hypot(point.x - projected.x, point.y - projected.y) }
}

function defaultRoutePoints(start: Point, end: Point): Point[] {
  if (Math.abs(start.x - end.x) < .2 || Math.abs(start.y - end.y) < .2) return []
  const middleX = (start.x + end.x) / 2
  return [{ x: middleX, y: start.y }, { x: middleX, y: end.y }]
}

function cleanIntermediatePoints(points: Point[], start: Point, end: Point): Point[] {
  const cleaned: Point[] = []
  for (const point of points) {
    if (samePoint(point, start) || samePoint(point, end) || cleaned.some((candidate, index) => index === cleaned.length - 1 && samePoint(candidate, point))) continue
    cleaned.push(point)
  }
  return cleaned
}

function insertWirePoint(points: Point[], segmentIndex: number, point: Point): { points: Point[]; index: number } {
  if (segmentIndex > 0 && samePoint(points[segmentIndex - 1], point)) return { points, index: segmentIndex - 1 }
  if (segmentIndex < points.length && samePoint(points[segmentIndex], point)) return { points, index: segmentIndex }
  const next = [...points]
  next.splice(segmentIndex, 0, point)
  return { points: next, index: segmentIndex }
}

function polylineMidpoint(path: Point[]): Point {
  const lengths = path.slice(1).map((point, index) => Math.hypot(point.x - path[index].x, point.y - path[index].y))
  const halfway = lengths.reduce((total, length) => total + length, 0) / 2
  let traversed = 0
  for (let index = 0; index < lengths.length; index += 1) {
    if (traversed + lengths[index] >= halfway) {
      const amount = lengths[index] ? (halfway - traversed) / lengths[index] : 0
      return { x: path[index].x + (path[index + 1].x - path[index].x) * amount, y: path[index].y + (path[index + 1].y - path[index].y) * amount }
    }
    traversed += lengths[index]
  }
  return path.at(-1) ?? { x: 0, y: 0 }
}

function branchDeletePoint(branch: WireBranchGeometry): Point {
  if (branch.target.kind === 'loose') return polylineMidpoint(branch.path)
  const end = branch.path.at(-1)!
  const previous = branch.path.at(-2) ?? branch.path[0]
  return { x: previous.x + (end.x - previous.x) * .55, y: previous.y + (end.y - previous.y) * .55 }
}

export function CircuitCanvas(props: Props) {
  const { graph, definitions, simulator } = props
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 800, height: 600 })
  const [view, setView] = useState<View>({ x: 45, y: 40, zoom: 1 })
  const [hover, setHover] = useState<Hover>(null)
  const [hoveredInstanceId, setHoveredInstanceId] = useState<string | null>(null)
  const [pendingWire, setPendingWire] = useState<PendingWire | null>(null)
  const [pointerWorld, setPointerWorld] = useState<Point>({ x: 0, y: 0 })
  const [drag, setDrag] = useState<{ start: Point; ids: string[]; delta: Point } | null>(null)
  const [panning, setPanning] = useState<{ start: Point; view: View; touch?: boolean } | null>(null)
  const [marquee, setMarquee] = useState<Marquee | null>(null)
  const [wireEdit, setWireEdit] = useState<WirePointEdit | null>(null)
  const [branchDrag, setBranchDrag] = useState<{ hit: WireHit; clientStart: Point; active: boolean } | null>(null)
  const [looseEndDrag, setLooseEndDrag] = useState<LooseEndDrag | null>(null)
  const touchPoints = useRef(new Map<number, Point>())
  const pinchGesture = useRef<PinchGesture | null>(null)
  const issueNets = useMemo(() => new Set(props.issues.filter(issue => issue.severity === 'error' && issue.netId).map(issue => issue.netId!)), [props.issues])
  const issueInstances = useMemo(() => new Set(props.issues.filter(issue => issue.severity === 'error' && issue.instanceId).map(issue => issue.instanceId!)), [props.issues])

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const observer = new ResizeObserver(entries => {
      const rect = entries[0].contentRect
      setSize({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setPendingWire(null); setBranchDrag(null); setLooseEndDrag(null); setWireEdit(null); setMarquee(null) }
    }
    window.addEventListener('keydown', cancel)
    return () => window.removeEventListener('keydown', cancel)
  }, [])

  const toWorld = useCallback((event: { clientX: number; clientY: number }): Point => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: (event.clientX - rect.left - view.x) / view.zoom, y: (event.clientY - rect.top - view.y) / view.zoom }
  }, [view])

  const dragOffset = (id: string): Point | undefined => drag?.ids.includes(id) ? drag.delta : undefined
  const capturePointer = (pointerId: number) => {
    try { canvasRef.current?.setPointerCapture(pointerId) }
    catch { /* Programmatically dispatched pointer events have no active pointer to capture. */ }
  }

  const zoomAroundCenter = (factor: number) => {
    setView(current => {
      const zoom = Math.max(.25, Math.min(3, current.zoom * factor))
      const center = { x: size.width / 2, y: size.height / 2 }
      const world = { x: (center.x - current.x) / current.zoom, y: (center.y - current.y) / current.zoom }
      return { zoom, x: center.x - world.x * zoom, y: center.y - world.y * zoom }
    })
  }

  const endpointPosition = useCallback((endpoint: NetEndpoint, withDrag = true): Point | null => {
    const instance = graph.instances.find(candidate => candidate.id === endpoint.instanceId)
    if (!instance) return null
    const port = getInstancePorts(instance, definitions).find(candidate => candidate.id === endpoint.portId)
    return port ? portPoint(instance, port, definitions, withDrag ? dragOffset(instance.id) : undefined) : null
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph.instances, definitions, drag])

  const wireBranches = (net: Net, withDrag = true): WireBranchGeometry[] => {
    const root = net.route?.root && net.endpoints.some(endpoint => sameEndpoint(endpoint, net.route!.root!)) ? net.route.root : net.endpoints[0]
    const attached = root ? (() => {
      const start = endpointPosition(root, withDrag)
      if (!start) return []
      return net.endpoints.filter(endpoint => !sameEndpoint(endpoint, root)).filter(endpoint => !(net.route?.looseWires ?? []).some(wire =>
        (wire.startEndpoint && wire.endEndpoint && sameEndpoint(wire.startEndpoint, root) && sameEndpoint(wire.endEndpoint, endpoint))
        || (wire.startEndpoint && wire.endEndpoint && sameEndpoint(wire.endEndpoint, root) && sameEndpoint(wire.startEndpoint, endpoint)),
      )).flatMap(endpoint => {
        const end = endpointPosition(endpoint, withDrag)
        if (!end) return []
        const target: WireBranchTarget = { kind: 'endpoint', endpoint }
        const edited = wireEdit?.netId === net.id ? wireEdit.edits.find(item => sameTarget(item.target, target)) : undefined
        const stored = net.route?.branches.find(branch => sameEndpoint(branch.endpoint, endpoint))
        const points = edited?.points ?? stored?.points ?? defaultRoutePoints(start, end)
        return [{ netId: net.id, root, target, points, path: [start, ...points, end] }]
      })
    })() : []
    const loose = (net.route?.looseWires ?? []).map(wire => {
      const target: WireBranchTarget = { kind: 'loose', wire }
      const edited = wireEdit?.netId === net.id ? wireEdit.edits.find(item => sameTarget(item.target, target)) : undefined
      let start = wire.startEndpoint ? endpointPosition(wire.startEndpoint, withDrag) ?? wire.start : wire.start
      let end = wire.endEndpoint ? endpointPosition(wire.endEndpoint, withDrag) ?? wire.end : wire.end
      if (looseEndDrag?.branch.netId === net.id && looseEndDrag.branch.target.kind === 'loose' && looseEndDrag.branch.target.wire.id === wire.id) {
        if (looseEndDrag.side === 'start') start = pointerWorld
        else end = pointerWorld
      }
      const points = edited?.points ?? wire.points
      return { netId: net.id, root, target, points, path: [start, ...points, end] }
    })
    return [...attached, ...loose]
  }

  const hitPort = (world: Point): { instance: ComponentInstance; port: PortSpec } | null => {
    for (let index = graph.instances.length - 1; index >= 0; index -= 1) {
      const instance = graph.instances[index]
      for (const port of getInstancePorts(instance, definitions)) {
        const point = portPoint(instance, port, definitions, dragOffset(instance.id))
        if (Math.hypot(point.x - world.x, point.y - world.y) < 10 / view.zoom) return { instance, port }
      }
    }
    return null
  }

  const hitInstance = (world: Point): ComponentInstance | null => {
    for (let index = graph.instances.length - 1; index >= 0; index -= 1) {
      const instance = graph.instances[index]; const visual = getRenderVisual(instance, definitions)
      if (world.x >= instance.position.x && world.x <= instance.position.x + visual.width && world.y >= instance.position.y && world.y <= instance.position.y + visual.height) return instance
    }
    return null
  }

  const hitPreviewControl = (world: Point): ComponentInstance | null => {
    if (!hoveredInstanceId) return null
    const instance = graph.instances.find(candidate => candidate.id === hoveredInstanceId)
    if (!instance) return null
    const rect = previewControlRect(instance, getRenderVisual(instance, definitions), dragOffset(instance.id))
    return world.x >= rect.x && world.x <= rect.x + rect.width && world.y >= rect.y && world.y <= rect.y + rect.height ? instance : null
  }

  const hitWire = (world: Point): WireHit | null => {
    let closest: WireHit | null = null
    for (const net of [...graph.nets].reverse()) {
      for (const branch of wireBranches(net, false)) {
        for (let index = 0; index < branch.path.length - 1; index += 1) {
          const hit = closestPointOnSegment(world, branch.path[index], branch.path[index + 1])
          if (hit.distance < 8 / view.zoom && (!closest || hit.distance < closest.distance)) closest = { ...branch, segmentIndex: index, ...hit }
        }
      }
    }
    return closest
  }

  const hitWaypoint = (world: Point): { branch: WireBranchGeometry; index: number; point: Point } | null => {
    const net = graph.nets.find(candidate => candidate.id === props.selectedNetId)
    if (!net) return null
    for (const branch of wireBranches(net, false)) {
      for (let index = 0; index < branch.points.length; index += 1) {
        if (Math.hypot(branch.points[index].x - world.x, branch.points[index].y - world.y) < 9 / view.zoom) return { branch, index, point: branch.points[index] }
      }
    }
    return null
  }

  const hitBranchDelete = (world: Point): { netId: string; target: WireBranchTarget } | null => {
    const net = graph.nets.find(candidate => candidate.id === props.selectedNetId)
    if (!net) return null
    for (const branch of wireBranches(net, false)) {
      if (branch.target.kind === 'endpoint' && net.endpoints.length <= 2) continue
      const point = branchDeletePoint(branch)
      if (Math.hypot(point.x - world.x, point.y - world.y) < 11 / view.zoom) return { netId: net.id, target: branch.target }
    }
    return null
  }

  const hitLooseEnd = (world: Point): LooseEndDrag | null => {
    for (const net of [...graph.nets].reverse()) for (const branch of wireBranches(net, false)) {
      if (branch.target.kind !== 'loose') continue
      const wire = branch.target.wire
      if (!wire.startEndpoint && !wire.startJunction && Math.hypot(branch.path[0].x - world.x, branch.path[0].y - world.y) < 11 / view.zoom) return { branch, side: 'start' }
      const end = branch.path.at(-1)!
      if (!wire.endEndpoint && !wire.endJunction && Math.hypot(end.x - world.x, end.y - world.y) < 11 / view.zoom) return { branch, side: 'end' }
    }
    return null
  }

  const beginWaypointEdit = (hit: { branch: WireBranchGeometry; index: number; point: Point }) => {
    const net = graph.nets.find(candidate => candidate.id === hit.branch.netId)!
    const edits = wireBranches(net, false).flatMap(branch => {
      const indices = branch.points.flatMap((point, index) => samePoint(point, hit.point) ? [index] : [])
      return indices.length ? [{ target: branch.target, points: [...branch.points], indices }] : []
    })
    setWireEdit({ netId: net.id, root: hit.branch.root, edits })
  }

  const finishBranch = (hit: WireHit, targetEndpoint: NetEndpoint) => {
    if (hit.target.kind === 'endpoint' && (!hit.root || sameEndpoint(hit.root, targetEndpoint) || sameEndpoint(hit.target.endpoint, targetEndpoint))) return
    const start = hit.root ? endpointPosition(hit.root, false) : null
    const end = endpointPosition(targetEndpoint, false)
    if (!end) return
    const junction = { x: Math.round(hit.point.x / 4) * 4, y: Math.round(hit.point.y / 4) * 4 }
    if (hit.target.kind === 'loose' || !hit.root || !start) {
      props.onCreateLooseWire(junction, end, defaultRoutePoints(junction, end), undefined, targetEndpoint, hit.netId, true)
      props.onSelection([], hit.netId)
      return
    }
    const inserted = insertWirePoint(hit.points, hit.segmentIndex, junction)
    const prefix = inserted.points.slice(0, inserted.index + 1)
    const bend = { x: junction.x, y: end.y }
    const targetPoints = cleanIntermediatePoints([...prefix, bend], start, end)
    props.onWireBranch(hit.netId, hit.root, hit.target.endpoint, cleanIntermediatePoints(inserted.points, start, hit.path.at(-1)!), targetEndpoint, targetPoints)
    props.onSelection([], hit.netId)
  }

  const finishLooseBranch = (hit: WireHit, end: Point) => {
    const junction = { x: Math.round(hit.point.x / 4) * 4, y: Math.round(hit.point.y / 4) * 4 }
    const snappedEnd = { x: Math.round(end.x / 4) * 4, y: Math.round(end.y / 4) * 4 }
    props.onCreateLooseWire(junction, snappedEnd, defaultRoutePoints(junction, snappedEnd), undefined, undefined, hit.netId, true)
    props.onSelection([], hit.netId)
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.floor(size.width * ratio)
    canvas.height = Math.floor(size.height * ratio)
    canvas.style.width = `${size.width}px`
    canvas.style.height = `${size.height}px`
    const context = canvas.getContext('2d')!
    const palette = canvasTheme(props.theme, props.customColors)
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, size.width, size.height)
    context.fillStyle = palette.background; context.fillRect(0, 0, size.width, size.height)

    context.save()
    context.translate(view.x, view.y); context.scale(view.zoom, view.zoom)
    const left = -view.x / view.zoom; const top = -view.y / view.zoom
    const right = left + size.width / view.zoom; const bottom = top + size.height / view.zoom
    const grid = 24
    context.beginPath(); context.strokeStyle = palette.gridMinor; context.lineWidth = 1 / view.zoom
    for (let x = Math.floor(left / grid) * grid; x < right; x += grid) { context.moveTo(x, top); context.lineTo(x, bottom) }
    for (let y = Math.floor(top / grid) * grid; y < bottom; y += grid) { context.moveTo(left, y); context.lineTo(right, y) }
    context.stroke()
    const major = grid * 5
    context.beginPath(); context.strokeStyle = palette.gridMajor; context.lineWidth = 1.2 / view.zoom
    for (let x = Math.floor(left / major) * major; x < right; x += major) { context.moveTo(x, top); context.lineTo(x, bottom) }
    for (let y = Math.floor(top / major) * major; y < bottom; y += major) { context.moveTo(left, y); context.lineTo(right, y) }
    context.stroke()

    // Component bodies are painted first so wires remain visible and clickable above them.
    for (const instance of graph.instances) {
      const visual = getRenderVisual(instance, definitions)
      const offset = dragOffset(instance.id) ?? { x: 0, y: 0 }
      const x = instance.position.x + offset.x; const y = instance.position.y + offset.y
      if (x + visual.width < left || x > right || y + visual.height < top || y > bottom) continue
      drawComponent(context, instance, visual, { x, y }, simulator, definitions, { selected: props.selectedIds.includes(instance.id), error: issueInstances.has(instance.id), zoom: view.zoom, theme: props.theme, customColors: props.customColors, showPreviewControl: hoveredInstanceId === instance.id })
    }

    for (const net of graph.nets) {
      const branches = wireBranches(net)
      const routePoints = branches.flatMap(branch => branch.path)
      if (!routePoints.length) continue
      const minX = Math.min(...routePoints.map(point => point.x)); const maxX = Math.max(...routePoints.map(point => point.x))
      const minY = Math.min(...routePoints.map(point => point.y)); const maxY = Math.max(...routePoints.map(point => point.y))
      if (maxX < left || minX > right || maxY < top || minY > bottom) continue
      const binary = simulator.valueForSourceNet(net.id)?.toBinary(false)
      const netWireColor = issueNets.has(net.id) ? palette.error : signalColor(binary, palette)
      const wireWidth = ((net.id === props.selectedNetId ? 4 : 2) + Math.min(3, Math.log2(net.width))) / view.zoom
      context.lineJoin = 'round'; context.lineCap = 'round'
      context.setLineDash(binary?.includes('Z') ? [7 / view.zoom, 6 / view.zoom] : [])
      branches.forEach((branch, branchIndex) => {
        const looseAnchors: Array<{ point: Point; open: boolean; junction: boolean }> = branch.target.kind === 'loose' ? [
          { point: branch.path[0], open: !branch.target.wire.startEndpoint && !branch.target.wire.startJunction, junction: Boolean(branch.target.wire.startJunction) },
          { point: branch.path.at(-1)!, open: !branch.target.wire.endEndpoint && !branch.target.wire.endJunction, junction: Boolean(branch.target.wire.endJunction) },
        ] : []
        const openAnchors = looseAnchors.filter(anchor => anchor.open)
        const isOpen = openAnchors.length > 0
        const branchColor = isOpen ? palette.openWire : netWireColor
        context.beginPath(); context.moveTo(branch.path[0].x, branch.path[0].y)
        branch.path.slice(1).forEach(point => context.lineTo(point.x, point.y))
        context.strokeStyle = palette.background; context.lineWidth = wireWidth + 4 / view.zoom; context.shadowBlur = 0; context.stroke()
        context.strokeStyle = branchColor; context.lineWidth = wireWidth
        context.shadowColor = !isOpen && binary?.endsWith('1') ? palette.selectedGlow : 'transparent'; context.shadowBlur = !isOpen && binary?.endsWith('1') ? 6 / view.zoom : 0
        context.stroke()
        if (branchIndex === 0 && view.zoom > .6) {
          const label = net.width > 1 ? `${net.width}  ${simulator.valueForSourceNet(net.id)?.toHex() ?? ''}` : (binary ?? '')
          const labelPoint = polylineMidpoint(branch.path)
          context.font = `${11 / Math.max(.8, view.zoom)}px ui-monospace, monospace`
          const metrics = context.measureText(label)
          context.fillStyle = palette.wireLabel; context.fillRect(labelPoint.x - metrics.width / 2 - 4, labelPoint.y - 9, metrics.width + 8, 17)
          context.fillStyle = issueNets.has(net.id) ? palette.errorText : palette.wireLabelText; context.textAlign = 'center'; context.textBaseline = 'alphabetic'; context.fillText(label, labelPoint.x, labelPoint.y + 4)
        }
        if (branch.target.kind === 'loose') {
          for (const anchor of looseAnchors) if (anchor.open || anchor.junction) {
            context.beginPath(); context.arc(anchor.point.x, anchor.point.y, (anchor.junction ? 4 : net.id === props.selectedNetId ? 6 : 4.5) / view.zoom, 0, Math.PI * 2)
            context.fillStyle = anchor.junction ? branchColor : palette.background; context.fill(); context.strokeStyle = branchColor; context.lineWidth = 2 / view.zoom; context.stroke()
          }
          if (view.zoom > .55) for (const anchor of openAnchors) {
            const fontSize = 8 / view.zoom; const padding = 4 / view.zoom; const height = 14 / view.zoom
            context.shadowBlur = 0; context.font = `800 ${fontSize}px ui-monospace, monospace`
            const width = context.measureText('OPEN').width + padding * 2
            const x = anchor.point.x + 9 / view.zoom; const y = anchor.point.y - 18 / view.zoom
            context.beginPath(); context.roundRect(x, y, width, height, 3 / view.zoom)
            context.fillStyle = palette.openWire; context.fill()
            context.fillStyle = palette.openWireText; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText('OPEN', x + width / 2, y + height / 2 + .2 / view.zoom)
          }
        }
      })
      context.shadowBlur = 0; context.setLineDash([])

      if (net.id === props.selectedNetId) {
        const counts = new Map<string, number>()
        branches.flatMap(branch => branch.points).forEach(point => counts.set(pointKey(point), (counts.get(pointKey(point)) ?? 0) + 1))
        const drawn = new Set<string>()
        for (const point of branches.flatMap(branch => branch.points)) {
          const key = pointKey(point)
          if (drawn.has(key)) continue
          drawn.add(key)
          const shared = (counts.get(key) ?? 0) > 1
          context.beginPath(); context.arc(point.x, point.y, (shared ? 6 : 5) / view.zoom, 0, Math.PI * 2)
          context.fillStyle = shared ? palette.selected : palette.background; context.fill()
          context.strokeStyle = palette.selected; context.lineWidth = 2 / view.zoom; context.stroke()
        }
        for (const branch of branches) {
          if (branch.target.kind === 'endpoint' && net.endpoints.length <= 2) continue
            const point = branchDeletePoint(branch)
            context.beginPath(); context.arc(point.x, point.y, 9 / view.zoom, 0, Math.PI * 2)
            context.fillStyle = palette.error; context.fill(); context.strokeStyle = palette.background; context.lineWidth = 1.5 / view.zoom; context.stroke()
            context.fillStyle = '#FFFFFF'; context.font = `700 ${11 / view.zoom}px system-ui, sans-serif`; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText('×', point.x, point.y - .2 / view.zoom)
        }
      }
    }

    if (branchDrag?.active) {
      context.beginPath(); context.moveTo(branchDrag.hit.point.x, branchDrag.hit.point.y); context.lineTo(pointerWorld.x, pointerWorld.y)
      context.strokeStyle = palette.pendingWire; context.lineWidth = 2 / view.zoom; context.setLineDash([6 / view.zoom, 5 / view.zoom]); context.stroke(); context.setLineDash([])
      context.beginPath(); context.arc(branchDrag.hit.point.x, branchDrag.hit.point.y, 5 / view.zoom, 0, Math.PI * 2); context.fillStyle = palette.selected; context.fill()
    }

    for (const instance of graph.instances) {
      const visual = getRenderVisual(instance, definitions)
      const offset = dragOffset(instance.id) ?? { x: 0, y: 0 }
      const x = instance.position.x + offset.x; const y = instance.position.y + offset.y
      if (x + visual.width < left || x > right || y + visual.height < top || y > bottom) continue
      for (const port of getInstancePorts(instance, definitions)) {
        const point = portPoint(instance, port, definitions, offset)
        const value = simulator.valueAtEndpoint(instance.id, port.id)
        context.beginPath(); context.arc(point.x, point.y, 5 / Math.max(.75, view.zoom), 0, Math.PI * 2)
        context.shadowColor = value?.toBinary(false).endsWith('1') ? palette.selectedGlow : 'transparent'; context.shadowBlur = value?.toBinary(false).endsWith('1') ? 6 / view.zoom : 0
        context.fillStyle = signalColor(value?.toBinary(false), palette); context.fill(); context.shadowBlur = 0; context.strokeStyle = palette.portOutline; context.lineWidth = 1 / view.zoom; context.stroke()
        if (view.zoom > .7) {
          context.font = `${9 / Math.max(.85, view.zoom)}px ui-monospace, monospace`; context.fillStyle = palette.portLabel; context.textBaseline = 'middle'
          const horizontal = port.position.side === 'left' || port.position.side === 'right'
          if (horizontal) { context.textAlign = port.position.side === 'left' ? 'left' : 'right'; context.fillText(port.name, point.x + (port.position.side === 'left' ? 10 : -10), point.y) }
        }
      }
    }

    if (pendingWire) {
      const start = pendingWire.endpoint ? endpointPosition(pendingWire.endpoint) ?? pendingWire.point : pendingWire.point
      context.beginPath(); context.moveTo(start.x, start.y); context.lineTo(pointerWorld.x, pointerWorld.y); context.strokeStyle = palette.pendingWire; context.lineWidth = 2 / view.zoom; context.setLineDash([5 / view.zoom, 4 / view.zoom]); context.stroke(); context.setLineDash([])
    }

    if (marquee) {
      const x = Math.min(marquee.start.x, marquee.current.x); const y = Math.min(marquee.start.y, marquee.current.y)
      const width = Math.abs(marquee.current.x - marquee.start.x); const height = Math.abs(marquee.current.y - marquee.start.y)
      context.fillStyle = palette.selectedGlow; context.fillRect(x, y, width, height)
      context.strokeStyle = palette.selected; context.lineWidth = 1.5 / view.zoom; context.setLineDash([6 / view.zoom, 4 / view.zoom]); context.strokeRect(x, y, width, height); context.setLineDash([])
    }
    context.restore()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchDrag, definitions, drag, endpointPosition, graph, hoveredInstanceId, issueInstances, issueNets, looseEndDrag, marquee, pendingWire, pointerWorld, props.customColors, props.revision, props.selectedIds, props.selectedNetId, props.theme, simulator, size, view, wireEdit])

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const world = toWorld(event); setPointerWorld(world)
    if (event.pointerType === 'touch') {
      touchPoints.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (touchPoints.current.size >= 2) {
        const [first, second] = [...touchPoints.current.values()]
        const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
        const rect = canvasRef.current!.getBoundingClientRect()
        pinchGesture.current = {
          distance: Math.max(1, Math.hypot(first.x - second.x, first.y - second.y)),
          worldMidpoint: { x: (midpoint.x - rect.left - view.x) / view.zoom, y: (midpoint.y - rect.top - view.y) / view.zoom },
          view,
        }
        setPendingWire(null); setDrag(null); setPanning(null); setMarquee(null); setWireEdit(null); setBranchDrag(null); setLooseEndDrag(null)
        capturePointer(event.pointerId)
        return
      }
    }
    if (event.button === 1 || (event.button === 0 && event.altKey)) {
      event.preventDefault(); setPanning({ start: { x: event.clientX, y: event.clientY }, view }); capturePointer(event.pointerId); return
    }
    if (event.button !== 0) return

    const deleteHit = hitBranchDelete(world)
    if (deleteHit) {
      if (deleteHit.target.kind === 'endpoint') props.onRemoveWireBranch(deleteHit.netId, deleteHit.target.endpoint)
      else props.onRemoveLooseWire(deleteHit.netId, deleteHit.target.wire.id)
      return
    }
    const waypointHit = hitWaypoint(world)
    if (waypointHit) { beginWaypointEdit(waypointHit); capturePointer(event.pointerId); return }
    const looseHit = hitLooseEnd(world)
    if (looseHit) { props.onSelection([], looseHit.branch.netId); setLooseEndDrag(looseHit); capturePointer(event.pointerId); return }
    const portHit = hitPort(world)
    if (portHit) {
      const endpoint = { instanceId: portHit.instance.id, portId: portHit.port.id }
      const point = portPoint(portHit.instance, portHit.port, definitions, dragOffset(portHit.instance.id))
      if (pendingWire) {
        if (pendingWire.endpoint) props.onConnect(pendingWire.endpoint, endpoint)
        else props.onCreateLooseWire(pendingWire.point, point, defaultRoutePoints(pendingWire.point, point), undefined, endpoint)
        setPendingWire(null)
      } else setPendingWire({ point, endpoint })
      return
    }
    if (props.placement) { props.onPlace(props.placement.componentId, props.placement.builtin, world); return }
    const wireHit = hitWire(world)
    if (wireHit) {
      if (pendingWire) {
        if (pendingWire.endpoint) finishBranch(wireHit, pendingWire.endpoint)
        else props.onCreateLooseWire(pendingWire.point, wireHit.point, defaultRoutePoints(pendingWire.point, wireHit.point), undefined, undefined, wireHit.netId, undefined, true)
        setPendingWire(null); return
      }
      props.onSelection([], wireHit.netId)
      setBranchDrag({ hit: wireHit, clientStart: { x: event.clientX, y: event.clientY }, active: false }); capturePointer(event.pointerId)
      return
    }
    if (pendingWire) {
      const start = pendingWire.endpoint ? endpointPosition(pendingWire.endpoint, false) ?? pendingWire.point : pendingWire.point
      const end = { x: Math.round(world.x / 4) * 4, y: Math.round(world.y / 4) * 4 }
      props.onCreateLooseWire(start, end, defaultRoutePoints(start, end), pendingWire.endpoint)
      setPendingWire(null); return
    }
    if (props.wireMode) { setPendingWire({ point: { x: Math.round(world.x / 4) * 4, y: Math.round(world.y / 4) * 4 } }); return }

    const previewHit = hitPreviewControl(world)
    if (previewHit) { props.onPreviewMode(previewHit.id); props.onSelection([previewHit.id], null); return }
    const instance = hitInstance(world)
    if (instance) {
      const ids = event.shiftKey
        ? props.selectedIds.includes(instance.id) ? props.selectedIds.filter(id => id !== instance.id) : [...props.selectedIds, instance.id]
        : props.selectedIds.includes(instance.id) ? props.selectedIds : [instance.id]
      props.onSelection(ids, null)
      setDrag({ start: world, ids, delta: { x: 0, y: 0 } }); capturePointer(event.pointerId)
      return
    }

    if (event.pointerType === 'touch' && !props.marqueeMode) {
      setPanning({ start: { x: event.clientX, y: event.clientY }, view, touch: true }); capturePointer(event.pointerId); return
    }

    const baseIds = event.shiftKey ? props.selectedIds : []
    if (!event.shiftKey) props.onSelection([], null)
    setMarquee({ start: world, current: world, baseIds }); capturePointer(event.pointerId)
  }

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const world = toWorld(event); setPointerWorld(world)
    if (event.pointerType === 'touch') {
      touchPoints.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (pinchGesture.current && touchPoints.current.size >= 2) {
        const [first, second] = [...touchPoints.current.values()]
        const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
        const rect = canvasRef.current!.getBoundingClientRect()
        const zoom = Math.max(.25, Math.min(3, pinchGesture.current.view.zoom * Math.hypot(first.x - second.x, first.y - second.y) / pinchGesture.current.distance))
        setView({ zoom, x: midpoint.x - rect.left - pinchGesture.current.worldMidpoint.x * zoom, y: midpoint.y - rect.top - pinchGesture.current.worldMidpoint.y * zoom })
        return
      }
    }
    if (panning) { setView({ ...panning.view, x: panning.view.x + event.clientX - panning.start.x, y: panning.view.y + event.clientY - panning.start.y }); return }
    if (looseEndDrag) return
    if (wireEdit) {
      const snapped = { x: Math.round(world.x / 4) * 4, y: Math.round(world.y / 4) * 4 }
      setWireEdit({ ...wireEdit, edits: wireEdit.edits.map(edit => ({ ...edit, points: edit.points.map((point, index) => edit.indices.includes(index) ? snapped : point) })) })
      return
    }
    if (branchDrag) {
      const active = branchDrag.active || Math.hypot(event.clientX - branchDrag.clientStart.x, event.clientY - branchDrag.clientStart.y) > 5
      if (active !== branchDrag.active) setBranchDrag({ ...branchDrag, active })
      return
    }
    if (drag) { setDrag({ ...drag, delta: { x: Math.round((world.x - drag.start.x) / 8) * 8, y: Math.round((world.y - drag.start.y) / 8) * 8 } }); return }
    if (marquee) { setMarquee({ ...marquee, current: world }); return }
    const portHit = hitPort(world)
    if (portHit) { setHoveredInstanceId(portHit.instance.id); setHover({ kind: 'port', instance: portHit.instance, port: portHit.port, x: event.nativeEvent.offsetX, y: event.nativeEvent.offsetY }); return }
    const wireHit = hitWire(world)
    if (wireHit) { setHoveredInstanceId(null); setHover({ kind: 'net', netId: wireHit.netId, x: event.nativeEvent.offsetX, y: event.nativeEvent.offsetY }); return }
    const instanceHit = hitInstance(world)
    if (instanceHit) { setHoveredInstanceId(instanceHit.id); setHover(null); return }
    setHoveredInstanceId(null)
    setHover(null)
  }

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType === 'touch') {
      const wasPinching = pinchGesture.current !== null
      touchPoints.current.delete(event.pointerId)
      if (touchPoints.current.size < 2) pinchGesture.current = null
      if (wasPinching) {
        setDrag(null); setPanning(null); setMarquee(null); setWireEdit(null); setBranchDrag(null); setLooseEndDrag(null)
        if (canvasRef.current?.hasPointerCapture(event.pointerId)) canvasRef.current.releasePointerCapture(event.pointerId)
        return
      }
    }
    const world = toWorld(event)
    if (panning?.touch && Math.hypot(event.clientX - panning.start.x, event.clientY - panning.start.y) <= 4) props.onSelection([], null)
    if (wireEdit) {
      const attached = wireEdit.edits.filter((edit): edit is typeof edit & { target: { kind: 'endpoint'; endpoint: NetEndpoint } } => edit.target.kind === 'endpoint')
      if (wireEdit.root && attached.length) props.onWireRoute(wireEdit.netId, wireEdit.root, attached.map(edit => ({ endpoint: edit.target.endpoint, points: edit.points })))
      for (const edit of wireEdit.edits) if (edit.target.kind === 'loose') props.onLooseWireRoute(wireEdit.netId, edit.target.wire.id, edit.points)
    }
    if (branchDrag?.active) {
      const target = hitPort(world)
      if (target) finishBranch(branchDrag.hit, { instanceId: target.instance.id, portId: target.port.id })
      else finishLooseBranch(branchDrag.hit, world)
    }
    if (looseEndDrag && looseEndDrag.branch.target.kind === 'loose') {
      const wire = looseEndDrag.branch.target.wire
      const target = hitPort(world)
      if (target) {
        const endpoint = { instanceId: target.instance.id, portId: target.port.id }
        const point = portPoint(target.instance, target.port, definitions)
        props.onAttachLooseWire(looseEndDrag.branch.netId, wire.id, looseEndDrag.side, endpoint, point)
      } else {
        const point = { x: Math.round(world.x / 4) * 4, y: Math.round(world.y / 4) * 4 }
        const start = looseEndDrag.side === 'start' ? point : looseEndDrag.branch.path[0]
        const end = looseEndDrag.side === 'end' ? point : looseEndDrag.branch.path.at(-1)!
        props.onLooseWireRoute(looseEndDrag.branch.netId, wire.id, cleanIntermediatePoints(wire.points, start, end), looseEndDrag.side === 'start' ? point : undefined, looseEndDrag.side === 'end' ? point : undefined)
      }
    }
    if (drag && (drag.delta.x || drag.delta.y)) props.onMove(drag.ids, drag.delta)
    if (marquee) {
      const left = Math.min(marquee.start.x, world.x); const right = Math.max(marquee.start.x, world.x)
      const top = Math.min(marquee.start.y, world.y); const bottom = Math.max(marquee.start.y, world.y)
      const moved = Math.hypot(world.x - marquee.start.x, world.y - marquee.start.y) * view.zoom > 4
      const within = moved ? graph.instances.filter(instance => {
        const visual = getRenderVisual(instance, definitions)
        return instance.position.x + visual.width >= left && instance.position.x <= right && instance.position.y + visual.height >= top && instance.position.y <= bottom
      }).map(instance => instance.id) : []
      props.onSelection([...new Set([...marquee.baseIds, ...within])], null)
    }
    setDrag(null); setPanning(null); setMarquee(null); setWireEdit(null); setBranchDrag(null); setLooseEndDrag(null)
    if (canvasRef.current?.hasPointerCapture(event.pointerId)) canvasRef.current.releasePointerCapture(event.pointerId)
  }

  const onDoubleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const world = toWorld(event)
    const waypoint = hitWaypoint(world)
    if (waypoint) {
      const net = graph.nets.find(candidate => candidate.id === waypoint.branch.netId)!
      const changed = wireBranches(net, false).flatMap(branch => {
        const points = branch.points.filter(point => !samePoint(point, waypoint.point))
        return points.length !== branch.points.length ? [{ branch, points }] : []
      })
      const attached = changed.filter(item => item.branch.target.kind === 'endpoint')
      if (waypoint.branch.root && attached.length) props.onWireRoute(net.id, waypoint.branch.root, attached.map(item => ({ endpoint: (item.branch.target as { kind: 'endpoint'; endpoint: NetEndpoint }).endpoint, points: item.points })))
      for (const item of changed) if (item.branch.target.kind === 'loose') props.onLooseWireRoute(net.id, item.branch.target.wire.id, item.points)
      return
    }
    const wireHit = hitWire(world)
    if (wireHit) {
      const start = wireHit.path[0]; const end = wireHit.path.at(-1)!
      const point = { x: Math.round(wireHit.point.x / 4) * 4, y: Math.round(wireHit.point.y / 4) * 4 }
      const inserted = insertWirePoint(wireHit.points, wireHit.segmentIndex, point)
      const points = cleanIntermediatePoints(inserted.points, start, end)
      if (wireHit.target.kind === 'endpoint' && wireHit.root) props.onWireRoute(wireHit.netId, wireHit.root, [{ endpoint: wireHit.target.endpoint, points }])
      else if (wireHit.target.kind === 'loose') props.onLooseWireRoute(wireHit.netId, wireHit.target.wire.id, points)
      props.onSelection([], wireHit.netId)
      return
    }
    const instance = hitInstance(world)
    if (instance) {
      if (!instance.builtin) props.onOpenComponent(instance.componentId)
      else if (instance.componentId === 'TOGGLE') props.onToggle(instance.id)
      else if (instance.componentId === 'RAM_256x8' || instance.componentId === 'PICO88_DISPLAY') props.onPreviewMode(instance.id)
    }
  }

  const hoverContent = (() => {
    if (!hover) return null
    if (hover.kind === 'port') {
      const value = simulator.valueAtEndpoint(hover.instance.id, hover.port.id)
      const connected = graph.nets.some(net => net.endpoints.some(endpoint => endpoint.instanceId === hover.instance.id && endpoint.portId === hover.port.id))
      return <><strong>{hover.instance.name}.{hover.port.name}</strong><span>{hover.port.direction} · {hover.port.width} bit [{hover.port.width - 1}:0]</span><code>{value?.toBinary() ?? '—'}</code>{hover.port.width >= 4 && <code>{value?.toHex() ?? '—'}</code>}<span>{connected ? 'Connected' : 'Unconnected'}</span></>
    }
    const net = graph.nets.find(candidate => candidate.id === hover.netId)!
    const value = simulator.valueForSourceNet(net.id)
    const openEnds = (net.route?.looseWires ?? []).reduce((count, wire) => count + Number(!wire.startEndpoint && !wire.startJunction) + Number(!wire.endEndpoint && !wire.endJunction), 0)
    return <><strong>{net.name || net.id}</strong><span>{net.width} bit [{net.width - 1}:0]{openEnds ? ` · open ends ${openEnds}` : ''}</span><code>{value?.toBinary() ?? '—'}</code>{net.width >= 4 && <code>{value?.toHex() ?? '—'}</code>}<span>Drag: branch · Free end: reconnect · Double-click: bend</span></>
  })()

  return (
    <div className={`canvas-shell ${props.placement ? 'is-placing' : ''} ${props.wireMode || branchDrag || pendingWire || looseEndDrag ? 'is-wiring' : ''} ${props.marqueeMode ? 'is-marquee' : ''} ${panning ? 'is-panning' : ''}`} ref={containerRef}>
      <canvas ref={canvasRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onPointerLeave={() => { if (!drag && !panning && !wireEdit && !branchDrag && !looseEndDrag && !marquee) { setHoveredInstanceId(null); setHover(null) } }} onDoubleClick={onDoubleClick} onAuxClick={event => event.preventDefault()} onWheel={event => {
        event.preventDefault()
        const rect = canvasRef.current!.getBoundingClientRect(); const px = event.clientX - rect.left; const py = event.clientY - rect.top
        const zoom = Math.max(.25, Math.min(3, view.zoom * Math.exp(-event.deltaY * .001)))
        const worldX = (px - view.x) / view.zoom; const worldY = (py - view.y) / view.zoom
        setView({ zoom, x: px - worldX * zoom, y: py - worldY * zoom })
      }} />
      <div className="canvas-zoom-controls" aria-label="キャンバス倍率"><button onClick={() => zoomAroundCenter(1 / 1.2)} aria-label="縮小">−</button><button onClick={() => setView(current => ({ zoom: 1, x: size.width / 2 - ((size.width / 2 - current.x) / current.zoom), y: size.height / 2 - ((size.height / 2 - current.y) / current.zoom) }))} aria-label="倍率を100%に戻す">{Math.round(view.zoom * 100)}%</button><button onClick={() => zoomAroundCenter(1.2)} aria-label="拡大">＋</button></div>
      <div className="canvas-badges"><span>{Math.round(view.zoom * 100)}%</span><span className="desktop-canvas-hint">{props.wireMode ? '配線: 2点をクリック' : '左ドラッグ: 範囲選択'}</span><span className="desktop-canvas-hint">中ボタン: pan</span><span className="desktop-canvas-hint">Wheel: zoom</span><span className="mobile-canvas-hint">{props.marqueeMode ? '1本指: 範囲選択' : props.wireMode ? 'タップ: 配線' : '1本指: 移動 · 2本指: zoom'}</span></div>
      {props.selectedNetId && <div className="wire-edit-hint">● ドラッグで曲げる · ○ 自由端を移動/接続 · 線からドラッグで分岐 · × で分岐削除</div>}
      {pendingWire && <button className="wire-cancel" onClick={() => setPendingWire(null)}>配線をキャンセル · Esc</button>}
      {hover && hoverContent && !branchDrag?.active && <div className="signal-tooltip" style={{ left: Math.min(hover.x + 14, size.width - 230), top: Math.min(hover.y + 14, size.height - 150) }}>{hoverContent}</div>}
    </div>
  )
}
