"use strict"

/* =========================================================
   Pizarra — fondo de pantalla interactivo (Wallpaper Engine)
   ---------------------------------------------------------
   Modelo: cada página guarda una lista ordenada de objetos.
     stroke  → trazo de tiza / rotulador / resaltador / borrador
     shape   → línea, flecha, rectángulo o elipse
     text    → texto libre
     note    → nota adhesiva
     image   → imagen
   Los trazos y formas se pintan en el canvas #ink (vectoriales,
   así se pueden deshacer y se redibujan nítidos al cambiar de
   resolución). Textos, notas e imágenes son elementos HTML.
   Todo se guarda solo en IndexedDB (con localStorage de respaldo).
   ========================================================= */

/* ---------- Utilidades ---------- */

const $ = (s) => document.querySelector(s)
const $$ = (s) => [...document.querySelectorAll(s)]
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4)
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const r1 = (v) => Math.round(v * 10) / 10
const deepCopy = (o) => JSON.parse(JSON.stringify(o))

function hexRgb(hex) {
  let h = String(hex || "#ffffff").replace("#", "")
  if (h.length === 3) h = h.split("").map((c) => c + c).join("")
  const n = parseInt(h, 16) || 0
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const rgbHex = (r, g, b) => "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")
function luminance(hex) {
  const [r, g, b] = hexRgb(hex)
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

/* ---------- Constantes ---------- */

const COLORS = ["#f4f1e8", "#ffe066", "#ffa94d", "#ff8fab", "#74c0fc", "#8ce99a", "#ff6b6b", "#1f1f1f"]

const THEMES = [
  { id: "verde", name: "Pizarra verde", color: "#26392f" },
  { id: "negro", name: "Negro", color: "#0e0f10" },
  { id: "grafito", name: "Grafito", color: "#2a2d31" },
  { id: "azul", name: "Azul noche", color: "#1c2a3a" },
  { id: "blanca", name: "Pizarra blanca", color: "#f1f0eb" },
]

const FONTS = [
  { id: "print", label: "Manuscrita", css: '"Segoe Print", "Ink Free", "Comic Sans MS", cursive' },
  { id: "ink", label: "Ink Free", css: '"Ink Free", "Segoe Print", "Comic Sans MS", cursive' },
  { id: "sans", label: "Normal", css: '"Segoe UI", system-ui, sans-serif' },
  { id: "mono", label: "Código", css: 'Consolas, "Cascadia Mono", monospace' },
]

const PEN_TOOLS = ["chalk", "marker", "highlighter", "eraser"]
const SIZE_PRESETS = [2, 4, 8, 16, 32]
const SHORTCUTS = { v: "select", b: "chalk", m: "marker", h: "highlighter", e: "eraser", s: "shape", t: "text", n: "note" }

/* ---------- Estado ---------- */

const newBoard = () => ({ id: uid(), objects: [] })

function defaultState() {
  return {
    v: 2,
    boards: [newBoard()],
    current: 0,
    tool: "chalk",
    prevTool: "chalk",
    lastPen: "chalk",
    shape: "rect",
    color: COLORS[0],
    size: 6,
    settings: { theme: "verde", customBg: "#3b3b3b", grid: "none", texture: true, font: "print" },
    ui: { toolbar: null, collapsed: false, keyboard: null },
  }
}

function hydrate(saved) {
  const d = defaultState()
  if (!saved || !Array.isArray(saved.boards) || !saved.boards.length) return d
  const s = { ...d, ...saved }
  s.settings = { ...d.settings, ...(saved.settings || {}) }
  s.ui = { ...d.ui, ...(saved.ui || {}) }
  s.current = clamp(saved.current | 0, 0, saved.boards.length - 1)
  s.boards.forEach((b) => {
    if (!b.id) b.id = uid()
    if (!Array.isArray(b.objects)) b.objects = []
  })
  return s
}

let S = defaultState()
const board = () => S.boards[S.current]
const findObj = (id) => board().objects.find((o) => o.id === id)

/* ---------- Guardado ---------- */

const Store = {
  db: null,
  open() {
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open("pizarra-wallpaper", 1)
        req.onupgradeneeded = () => req.result.createObjectStore("kv")
        req.onsuccess = () => resolve((this.db = req.result))
        req.onerror = () => resolve(null)
        req.onblocked = () => resolve(null)
      } catch (e) {
        resolve(null)
      }
    })
  },
  async load() {
    await this.open()
    if (this.db) {
      const v = await new Promise((resolve) => {
        try {
          const q = this.db.transaction("kv", "readonly").objectStore("kv").get("state")
          q.onsuccess = () => resolve(q.result || null)
          q.onerror = () => resolve(null)
        } catch (e) {
          resolve(null)
        }
      })
      if (v) return v
    }
    try {
      const raw = localStorage.getItem("pizarra-state")
      return raw ? JSON.parse(raw) : null
    } catch (e) {
      return null
    }
  },
  save(data) {
    if (this.db) {
      try {
        const tx = this.db.transaction("kv", "readwrite")
        tx.objectStore("kv").put(data, "state")
        tx.onerror = () => this.saveLocal(data)
        return
      } catch (e) {
        /* sigue abajo */
      }
    }
    this.saveLocal(data)
  },
  saveLocal(data) {
    try {
      localStorage.setItem("pizarra-state", JSON.stringify(data))
    } catch (e) {
      toast("No se pudo guardar: el almacenamiento está lleno")
    }
  },
}

let saveTimer = null
function scheduleSave() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => Store.save(S), 500)
}
function saveNow() {
  clearTimeout(saveTimer)
  Store.save(S)
}

/* ---------- Historial (deshacer / rehacer por página) ---------- */

const histories = new Map()
function hist() {
  const id = board().id
  if (!histories.has(id)) histories.set(id, { undo: [], redo: [] })
  return histories.get(id)
}

function record(cmd) {
  const h = hist()
  h.undo.push(cmd)
  if (h.undo.length > 300) h.undo.shift()
  h.redo.length = 0
  changed()
}

function changed() {
  updateUndoButtons()
  scheduleSave()
}

function removeFromBoard(id) {
  const objs = board().objects
  const i = objs.findIndex((o) => o.id === id)
  if (i >= 0) objs.splice(i, 1)
}

function applyCmd(c, reverse) {
  const b = board()
  switch (c.t) {
    case "add":
      if (reverse) removeFromBoard(c.obj.id)
      else b.objects.splice(Math.min(c.index, b.objects.length), 0, c.obj)
      break
    case "remove":
      if (reverse) b.objects.splice(Math.min(c.index, b.objects.length), 0, c.obj)
      else removeFromBoard(c.obj.id)
      break
    case "update": {
      const o = findObj(c.id)
      if (o) Object.assign(o, reverse ? c.before : c.after)
      break
    }
    case "clear":
      b.objects = reverse ? c.objects.slice() : []
      break
    case "order": {
      const i = b.objects.findIndex((o) => o.id === c.id)
      if (i >= 0) {
        const [o] = b.objects.splice(i, 1)
        b.objects.splice(reverse ? c.from : c.to, 0, o)
      }
      break
    }
  }
}

function undo() {
  finishEditing()
  const h = hist()
  const c = h.undo.pop()
  if (!c) return
  applyCmd(c, true)
  h.redo.push(c)
  deselect()
  renderAll()
  changed()
}

function redo() {
  finishEditing()
  const h = hist()
  const c = h.redo.pop()
  if (!c) return
  applyCmd(c, false)
  h.undo.push(c)
  deselect()
  renderAll()
  changed()
}

function updateUndoButtons() {
  const h = hist()
  $("#undoBtn").disabled = !h.undo.length
  $("#redoBtn").disabled = !h.redo.length
}

/* ---------- Canvas ---------- */

const ink = $("#ink")
const live = $("#live")
const ictx = ink.getContext("2d")
const lctx = live.getContext("2d")
let dpr = 1

function resizeCanvases() {
  dpr = window.devicePixelRatio || 1
  for (const c of [ink, live]) {
    c.width = Math.round(innerWidth * dpr)
    c.height = Math.round(innerHeight * dpr)
    c.style.width = innerWidth + "px"
    c.style.height = innerHeight + "px"
  }
  renderInk()
}

function clearCtx(ctx) {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

function renderInk() {
  clearCtx(ictx)
  for (const o of board().objects) {
    if (o.kind === "stroke" || o.kind === "shape") drawObj(ictx, o)
  }
}

/* Textura de tiza: un patrón de ruido teñido del color elegido */
const chalkCache = new Map()
function chalkPattern(ctx, color) {
  let tile = chalkCache.get(color)
  if (!tile) {
    const s = 160
    tile = document.createElement("canvas")
    tile.width = tile.height = s
    const x = tile.getContext("2d")
    const img = x.createImageData(s, s)
    const [r, g, b] = hexRgb(color)
    for (let i = 0; i < img.data.length; i += 4) {
      const n = Math.random()
      img.data[i] = r
      img.data[i + 1] = g
      img.data[i + 2] = b
      img.data[i + 3] = n < 0.2 ? n * 260 : 165 + Math.random() * 90
    }
    x.putImageData(img, 0, 0)
    chalkCache.set(color, tile)
  }
  return ctx.createPattern(tile, "repeat")
}

function applyInk(ctx, o) {
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = "source-over"
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  ctx.lineWidth = o.w
  switch (o.brush) {
    case "eraser":
      ctx.globalCompositeOperation = "destination-out"
      ctx.strokeStyle = "#000"
      break
    case "highlighter":
      ctx.globalAlpha = 0.38
      ctx.lineCap = "square"
      ctx.strokeStyle = o.color
      break
    case "chalk":
      ctx.strokeStyle = chalkPattern(ctx, o.color)
      break
    default:
      ctx.strokeStyle = o.color
  }
}

/* Trazo suavizado con curvas por los puntos medios */
function tracePath(ctx, p) {
  const n = p.length / 2
  ctx.beginPath()
  ctx.moveTo(p[0], p[1])
  if (n === 1) {
    ctx.lineTo(p[0] + 0.01, p[1])
    return
  }
  for (let i = 1; i < n - 1; i++) {
    const x = p[2 * i], y = p[2 * i + 1]
    ctx.quadraticCurveTo(x, y, (x + p[2 * i + 2]) / 2, (y + p[2 * i + 3]) / 2)
  }
  ctx.lineTo(p[2 * n - 2], p[2 * n - 1])
}

function traceShape(ctx, o) {
  const { x1, y1, x2, y2 } = o
  ctx.beginPath()
  if (o.shape === "line" || o.shape === "arrow") {
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    if (o.shape === "arrow") {
      const a = Math.atan2(y2 - y1, x2 - x1)
      const len = Math.max(14, o.w * 3.2)
      for (const s of [-1, 1]) {
        ctx.moveTo(x2, y2)
        ctx.lineTo(x2 - len * Math.cos(a + s * 0.45), y2 - len * Math.sin(a + s * 0.45))
      }
    }
  } else if (o.shape === "rect") {
    ctx.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1))
  } else {
    ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2)
  }
}

function drawObj(ctx, o) {
  ctx.save()
  applyInk(ctx, o)
  if (o.kind === "stroke") tracePath(ctx, o.pts)
  else traceShape(ctx, o)
  ctx.stroke()
  ctx.restore()
}

/* ---------- Dibujo con puntero ---------- */

let cur = null
let liveQueued = false

function brushWidth(tool = S.tool) {
  if (tool === "eraser") return Math.max(10, S.size * 3)
  if (tool === "highlighter") return Math.max(10, S.size * 3)
  return S.size
}

function requestLive() {
  if (liveQueued) return
  liveQueued = true
  requestAnimationFrame(() => {
    liveQueued = false
    clearCtx(lctx)
    if (cur && cur.brush !== "eraser") drawObj(lctx, cur)
  })
}

function eraseSegment(a, b) {
  ictx.save()
  applyInk(ictx, cur)
  ictx.beginPath()
  ictx.moveTo(a.x, a.y)
  ictx.lineTo(b.x + (a.x === b.x && a.y === b.y ? 0.01 : 0), b.y)
  ictx.stroke()
  ictx.restore()
}

function addPoint(p) {
  if (cur.kind === "shape") {
    cur.x2 = p.x
    cur.y2 = p.y
    requestLive()
    return
  }
  const a = cur.pts
  const lx = a[a.length - 2], ly = a[a.length - 1]
  if (Math.hypot(p.x - lx, p.y - ly) < 1.2) return
  a.push(r1(p.x), r1(p.y))
  if (cur.brush === "eraser") eraseSegment({ x: lx, y: ly }, p)
  else requestLive()
}

function endStroke() {
  if (!cur) return
  const o = cur
  cur = null
  clearCtx(lctx)
  if (o.kind === "shape") {
    if (Math.hypot(o.x2 - o.x1, o.y2 - o.y1) < 3) return
    for (const k of ["x1", "y1", "x2", "y2"]) o[k] = r1(o[k])
  }
  if (o.brush !== "eraser") drawObj(ictx, o)
  const objs = board().objects
  objs.push(o)
  record({ t: "add", obj: o, index: objs.length - 1 })
}

ink.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return
  e.preventDefault()
  closePopovers()
  const wasEditing = !!editing
  finishEditing()
  deselect()
  const p = { x: e.clientX, y: e.clientY }
  const t = S.tool

  if (PEN_TOOLS.includes(t)) {
    ink.setPointerCapture(e.pointerId)
    cur = { kind: "stroke", id: uid(), brush: t, color: S.color, w: brushWidth(t), pts: [r1(p.x), r1(p.y)] }
    if (t === "eraser") eraseSegment(p, p)
    else requestLive()
  } else if (t === "shape") {
    ink.setPointerCapture(e.pointerId)
    cur = {
      kind: "shape", id: uid(), shape: S.shape, brush: S.lastPen === "marker" ? "marker" : "chalk",
      color: S.color, w: S.size, x1: p.x, y1: p.y, x2: p.x, y2: p.y,
    }
  } else if (t === "text" && !wasEditing) {
    createText(p)
  } else if (t === "note" && !wasEditing) {
    createNote(p)
  }
})

ink.addEventListener("pointermove", (e) => {
  moveBrushCursor(e)
  if (!cur) return
  const list = e.getCoalescedEvents ? e.getCoalescedEvents() : []
  for (const ev of list.length ? list : [e]) addPoint({ x: ev.clientX, y: ev.clientY })
})

ink.addEventListener("pointerup", endStroke)
ink.addEventListener("pointercancel", endStroke)
ink.addEventListener("lostpointercapture", endStroke)
ink.addEventListener("pointerleave", () => { if (!cur) brushCursor.style.display = "none" })

/* Cursor circular que muestra el grosor */
const brushCursor = $("#brushCursor")
function moveBrushCursor(e) {
  if (!PEN_TOOLS.includes(S.tool)) return
  brushCursor.style.display = "block"
  brushCursor.style.left = e.clientX + "px"
  brushCursor.style.top = e.clientY + "px"
}
function updateBrushCursor() {
  const w = Math.max(4, brushWidth())
  brushCursor.style.width = brushCursor.style.height = w + "px"
  brushCursor.classList.toggle("eraser", S.tool === "eraser")
  if (!PEN_TOOLS.includes(S.tool)) brushCursor.style.display = "none"
}

/* ---------- Objetos HTML (texto, notas, imágenes) ---------- */

const imageLayer = $("#imageLayer")
const textLayer = $("#textLayer")
const els = new Map()

function renderDom() {
  imageLayer.innerHTML = ""
  textLayer.innerHTML = ""
  els.clear()
  for (const o of board().objects) {
    if (o.kind === "image" || o.kind === "text" || o.kind === "note") mountObj(o)
  }
}

function renderAll() {
  renderInk()
  renderDom()
}

function mountObj(o) {
  const el = document.createElement("div")
  el.className = "obj " + o.kind
  el.dataset.id = o.id
  if (o.kind === "image") {
    const img = new Image()
    img.draggable = false
    img.src = o.src
    el.appendChild(img)
    imageLayer.appendChild(el)
  } else {
    textLayer.appendChild(el)
  }
  els.set(o.id, el)
  syncEl(o, el)
  bindObj(el)
  return el
}

function syncEl(o, el = els.get(o.id)) {
  if (!el) return
  el.style.left = o.x + "px"
  el.style.top = o.y + "px"
  if (o.kind === "image" || o.kind === "note") {
    el.style.width = o.w + "px"
    el.style.height = o.h + "px"
  }
  if (o.kind === "text") {
    el.style.color = o.color
    el.style.fontSize = o.fontSize + "px"
  }
  if (o.kind === "note") el.style.background = o.bg
  if (o.kind !== "image" && !el.classList.contains("editing") && el._text !== o.text) {
    el.textContent = o.text
    el._text = o.text
    if (selected === o.id) addHandles(el)
  }
}

function bindObj(el) {
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return
    const o = findObj(el.dataset.id) || (editing && editing.obj.id === el.dataset.id ? editing.obj : null)
    if (!o) return
    if (el.classList.contains("editing")) return // dejar colocar el cursor de texto
    e.preventDefault()
    e.stopPropagation()
    closePopovers()
    if (e.target.classList.contains("handle")) return startResize(e, o, el, e.target.dataset.pos)
    if (editing) finishEditing()
    if ((S.tool === "text" || S.tool === "note") && o.kind !== "image") return startEditing(o)
    select(o.id)
    startDrag(e, o, el)
  })
  el.addEventListener("dblclick", () => {
    const o = findObj(el.dataset.id)
    if (o && o.kind !== "image") startEditing(o)
  })
}

function nextTextSize() {
  return Math.max(16, Math.round(S.size * 4))
}

function noteColor(c) {
  const l = luminance(c)
  if (l > 0.85 || l < 0.15) return "#fff0a0"
  const [r, g, b] = hexRgb(c)
  const m = (v) => Math.round(v + (255 - v) * 0.45)
  return rgbHex(m(r), m(g), m(b))
}

function createText(p) {
  const fs = nextTextSize()
  const o = { kind: "text", id: uid(), x: Math.round(p.x - 4), y: Math.round(p.y - fs * 0.7), text: "", color: S.color, fontSize: fs }
  mountObj(o)
  startEditing(o, true)
}

function createNote(p) {
  const o = { kind: "note", id: uid(), x: Math.round(p.x - 110), y: Math.round(p.y - 24), w: 220, h: 190, text: "", bg: noteColor(S.color) }
  mountObj(o)
  startEditing(o, true)
}

/* Imágenes: se reducen a 1600 px para no llenar el almacenamiento */
function readFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = reject
    r.readAsDataURL(file)
  })
}
function loadImg(src) {
  return new Promise((resolve, reject) => {
    const i = new Image()
    i.onload = () => resolve(i)
    i.onerror = reject
    i.src = src
  })
}

async function addImageFile(file) {
  if (!file || !file.type.startsWith("image/")) return
  try {
    const url = await readFile(file)
    const img = await loadImg(url)
    let src = url
    let w = img.naturalWidth, h = img.naturalHeight
    const keepOriginal = file.type === "image/gif" && file.size < 3e6
    if (!keepOriginal) {
      const sc = Math.min(1, 1600 / Math.max(w, h))
      const c = document.createElement("canvas")
      c.width = Math.round(w * sc)
      c.height = Math.round(h * sc)
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height)
      src = c.toDataURL("image/webp", 0.9)
      if (!src.startsWith("data:image/webp")) src = c.toDataURL("image/png")
      w = c.width
      h = c.height
    }
    const dw = Math.min(w, innerWidth * 0.35, 520)
    const dh = (dw * h) / w
    const o = { kind: "image", id: uid(), x: Math.round((innerWidth - dw) / 2), y: Math.round((innerHeight - dh) / 2), w: Math.round(dw), h: Math.round(dh), src }
    finishEditing()
    const objs = board().objects
    objs.push(o)
    mountObj(o)
    record({ t: "add", obj: o, index: objs.length - 1 })
    setTool("select")
    select(o.id)
  } catch (err) {
    toast("No se pudo abrir la imagen")
  }
}

$("#imageInput").addEventListener("change", (e) => {
  addImageFile(e.target.files[0])
  e.target.value = ""
})

document.addEventListener("paste", (e) => {
  if (editing) return
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"))
  if (item) addImageFile(item.getAsFile())
})
document.addEventListener("dragover", (e) => e.preventDefault())
document.addEventListener("drop", (e) => {
  e.preventDefault()
  const f = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith("image/"))
  if (f) addImageFile(f)
})

/* ---------- Selección, mover y redimensionar ---------- */

let selected = null

function select(id) {
  if (selected === id) return placeContextBar()
  deselect()
  const el = els.get(id)
  if (!el) return
  selected = id
  el.classList.add("selected")
  addHandles(el)
  placeContextBar()
}

function deselect() {
  if (!selected) return
  const el = els.get(selected)
  if (el) {
    el.classList.remove("selected")
    removeHandles(el)
  }
  selected = null
  $("#contextBar").classList.add("hidden")
}

function addHandles(el) {
  removeHandles(el)
  for (const pos of ["nw", "ne", "sw", "se"]) {
    const h = document.createElement("div")
    h.className = "handle " + pos
    h.dataset.pos = pos
    h.contentEditable = "false"
    el.appendChild(h)
  }
}
function removeHandles(el) {
  el.querySelectorAll(".handle").forEach((h) => h.remove())
}

function startDrag(e, o, el) {
  const sx = e.clientX, sy = e.clientY, ox = o.x, oy = o.y
  let moved = false
  el.setPointerCapture(e.pointerId)
  const move = (ev) => {
    const dx = ev.clientX - sx, dy = ev.clientY - sy
    if (!moved && Math.hypot(dx, dy) < 3) return
    moved = true
    o.x = Math.round(clamp(ox + dx, 40 - el.offsetWidth, innerWidth - 40))
    o.y = Math.round(clamp(oy + dy, 40 - el.offsetHeight, innerHeight - 40))
    el.style.left = o.x + "px"
    el.style.top = o.y + "px"
    placeContextBar()
  }
  const up = () => {
    el.removeEventListener("pointermove", move)
    el.removeEventListener("pointerup", up)
    el.removeEventListener("pointercancel", up)
    if (moved) record({ t: "update", id: o.id, before: { x: ox, y: oy }, after: { x: o.x, y: o.y } })
  }
  el.addEventListener("pointermove", move)
  el.addEventListener("pointerup", up)
  el.addEventListener("pointercancel", up)
}

const geomKeys = (o) => ["x", "y", "w", "h", "fontSize"].filter((k) => k in o)
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]))

function startResize(e, o, el, pos) {
  const handle = e.target
  handle.setPointerCapture(e.pointerId)
  const sx = e.clientX, sy = e.clientY
  const r0 = { x: o.x, y: o.y, w: el.offsetWidth, h: el.offsetHeight }
  const keys = geomKeys(o)
  const before = pick(o, keys)
  const keepRatio = o.kind !== "note"
  const minSize = o.kind === "note" ? 100 : 24
  const west = pos.includes("w"), north = pos.includes("n")

  const move = (ev) => {
    const dx = ev.clientX - sx, dy = ev.clientY - sy
    let w = r0.w + (west ? -dx : dx)
    let h = r0.h + (north ? -dy : dy)
    let scale = 1
    if (keepRatio) {
      scale = Math.max(w / r0.w, h / r0.h, minSize / Math.min(r0.w, r0.h))
      w = r0.w * scale
      h = r0.h * scale
    } else {
      w = Math.max(minSize, w)
      h = Math.max(minSize, h)
    }
    o.x = Math.round(west ? r0.x + r0.w - w : r0.x)
    o.y = Math.round(north ? r0.y + r0.h - h : r0.y)
    if (o.kind === "text") o.fontSize = Math.max(8, Math.round(before.fontSize * scale * 10) / 10)
    else {
      o.w = Math.round(w)
      o.h = Math.round(h)
    }
    syncEl(o, el)
    placeContextBar()
  }
  const up = () => {
    handle.removeEventListener("pointermove", move)
    handle.removeEventListener("pointerup", up)
    handle.removeEventListener("pointercancel", up)
    const after = pick(o, keys)
    if (JSON.stringify(after) !== JSON.stringify(before)) record({ t: "update", id: o.id, before, after })
  }
  handle.addEventListener("pointermove", move)
  handle.addEventListener("pointerup", up)
  handle.addEventListener("pointercancel", up)
}

function deleteObj(id) {
  const objs = board().objects
  const i = objs.findIndex((o) => o.id === id)
  if (i < 0) return
  if (selected === id) deselect()
  const [o] = objs.splice(i, 1)
  const el = els.get(id)
  if (el) el.remove()
  els.delete(id)
  record({ t: "remove", obj: o, index: i })
}

/* Barra contextual */
function placeContextBar() {
  const bar = $("#contextBar")
  const el = selected && els.get(selected)
  if (!el) return bar.classList.add("hidden")
  const o = findObj(selected)
  const isImg = o.kind === "image"
  bar.querySelector('[data-ctx="edit"]').classList.toggle("hidden", isImg)
  bar.querySelector('[data-ctx="color"]').classList.toggle("hidden", isImg)
  bar.classList.remove("hidden")
  const r = el.getBoundingClientRect()
  const w = bar.offsetWidth, h = bar.offsetHeight
  let y = r.top - h - 18
  if (y < 8) y = r.bottom + 18
  bar.style.left = clamp(r.left + r.width / 2 - w / 2, 8, innerWidth - w - 8) + "px"
  bar.style.top = clamp(y, 8, innerHeight - h - 8) + "px"
}

$("#contextBar").addEventListener("pointerdown", (e) => e.preventDefault())
$("#contextBar").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-ctx]")
  if (!btn || !selected) return
  const o = findObj(selected)
  if (!o) return
  const objs = board().objects
  switch (btn.dataset.ctx) {
    case "edit":
      startEditing(o)
      break
    case "color":
      recolor(o, S.color)
      break
    case "duplicate": {
      const c = deepCopy(o)
      c.id = uid()
      c.x += 24
      c.y += 24
      objs.push(c)
      mountObj(c)
      record({ t: "add", obj: c, index: objs.length - 1 })
      select(c.id)
      break
    }
    case "front": {
      const from = objs.indexOf(o)
      const to = objs.length - 1
      if (from === to) break
      objs.splice(from, 1)
      objs.push(o)
      record({ t: "order", id: o.id, from, to })
      const id = o.id
      deselect()
      renderDom()
      select(id)
      break
    }
    case "delete":
      deleteObj(o.id)
      break
  }
})

function recolor(o, color) {
  const key = o.kind === "note" ? "bg" : o.kind === "text" ? "color" : null
  if (!key) return
  const value = key === "bg" ? noteColor(color) : color
  if (o[key] === value) return
  const before = { [key]: o[key] }
  o[key] = value
  syncEl(o)
  const inBoard = board().objects.includes(o)
  if (inBoard) record({ t: "update", id: o.id, before, after: { [key]: value } })
}

/* ---------- Edición de texto ---------- */

let editing = null

function placeCaretEnd(el) {
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  const sel = getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
}

function startEditing(o, isNew = false) {
  if (editing && editing.obj === o) return
  finishEditing()
  deselect()
  const el = els.get(o.id)
  if (!el) return
  editing = { obj: o, el, isNew, before: o.text }
  removeHandles(el)
  el.classList.add("editing")
  try {
    el.contentEditable = "plaintext-only"
  } catch (err) {
    el.contentEditable = "true"
  }
  el.spellcheck = false
  const focus = () => {
    el.focus()
    placeCaretEnd(el)
  }
  focus()
  setTimeout(() => { if (editing && editing.el === el && document.activeElement !== el) focus() }, 0)
  showKeyboard()
}

function finishEditing() {
  if (!editing) return
  const { obj: o, el, isNew, before } = editing
  editing = null
  hideKeyboard()
  el.classList.remove("editing")
  el.contentEditable = "false"
  el.blur()
  getSelection().removeAllRanges()
  const text = el.innerText.replace(/\s+$/, "")
  const empty = !text.trim()
  const objs = board().objects

  if (o.kind === "text" && empty) {
    el.remove()
    els.delete(o.id)
    if (!isNew) {
      const i = objs.indexOf(o)
      if (i >= 0) {
        objs.splice(i, 1)
        record({ t: "remove", obj: o, index: i })
      }
    }
    return
  }
  o.text = text
  el._text = null
  syncEl(o, el)
  if (isNew) {
    objs.push(o)
    record({ t: "add", obj: o, index: objs.length - 1 })
  } else if (text !== before) {
    record({ t: "update", id: o.id, before: { text: before }, after: { text } })
  }
}

/* ---------- Teclado en pantalla ---------- */

const LAYOUTS = {
  abc: [
    [..."1234567890"],
    [..."qwertyuiop"],
    [..."asdfghjklñ"],
    ["SHIFT", ..."zxcvbnm", ",", ".", "BACK"],
    ["MODE", "?", "SPACE", "!", "ENTER"],
  ],
  sym: [
    [..."1234567890"],
    ["á", "é", "í", "ó", "ú", "ü", "¿", "?", "¡", "!"],
    ["@", "#", "$", "%", "&", "*", "(", ")", '"', "'"],
    ["SHIFT", "-", "_", "+", "=", "/", ":", ";", "€", "BACK"],
    ["MODE", "<", "SPACE", ">", "ENTER"],
  ],
}
const kb = { layout: "abc", shift: false, caps: false, lastShift: 0 }
const keyboardEl = $("#keyboard")

function keyLabel(k) {
  switch (k) {
    case "SHIFT": return "⇧"
    case "BACK": return "⌫"
    case "ENTER": return "↵"
    case "SPACE": return "espacio"
    case "MODE": return kb.layout === "abc" ? "?123 áé" : "abc"
  }
  return kb.shift || kb.caps ? k.toUpperCase() : k
}

function renderKeyboard() {
  const rows = $("#kbRows")
  rows.innerHTML = ""
  for (const row of LAYOUTS[kb.layout]) {
    const r = document.createElement("div")
    r.className = "k-row"
    for (const k of row) {
      const b = document.createElement("button")
      b.className = "key"
      b.dataset.key = k
      b.textContent = keyLabel(k)
      if (["SHIFT", "BACK", "ENTER", "MODE"].includes(k)) b.classList.add("mod")
      if (k === "SPACE") b.classList.add("space")
      if (k === "SHIFT" && (kb.shift || kb.caps)) b.classList.add("on")
      r.appendChild(b)
    }
    rows.appendChild(r)
  }
}

function kbCommand(cmd, value) {
  if (!editing) return
  const el = editing.el
  if (document.activeElement !== el) {
    el.focus()
    placeCaretEnd(el)
  }
  if (document.execCommand(cmd, false, value)) return
  // Respaldo por si execCommand no está disponible
  const sel = getSelection()
  if (!sel.rangeCount) placeCaretEnd(el)
  const range = sel.getRangeAt(0)
  if (cmd === "insertText") {
    range.deleteContents()
    const node = document.createTextNode(value)
    range.insertNode(node)
    range.setStartAfter(node)
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)
  } else if (cmd === "delete") {
    if (range.collapsed) sel.modify("extend", "backward", "character")
    sel.getRangeAt(0).deleteContents()
  }
}

function pressKey(k) {
  switch (k) {
    case "SHIFT": {
      const now = Date.now()
      if (kb.caps) kb.caps = kb.shift = false
      else if (kb.shift && now - kb.lastShift < 350) kb.caps = true
      else kb.shift = !kb.shift
      kb.lastShift = now
      return renderKeyboard()
    }
    case "MODE":
      kb.layout = kb.layout === "abc" ? "sym" : "abc"
      return renderKeyboard()
    case "BACK":
      return kbCommand("delete")
    case "ENTER":
      return kbCommand("insertText", "\n")
    case "SPACE":
      return kbCommand("insertText", " ")
  }
  kbCommand("insertText", kb.shift || kb.caps ? k.toUpperCase() : k)
  if (kb.shift && !kb.caps) {
    kb.shift = false
    renderKeyboard()
  }
}

let repeatTimer = null
keyboardEl.addEventListener("pointerdown", (e) => {
  e.preventDefault() // no quitar el foco al texto
  const key = e.target.closest(".key")
  if (!key) return
  const k = key.dataset.key
  pressKey(k)
  // Mantener pulsado ⌫ borra seguido (máx. ~6 s por seguridad)
  if (k === "BACK") {
    clearInterval(repeatTimer)
    let ticks = 0
    repeatTimer = setInterval(() => {
      if (++ticks > 100) return stopRepeat()
      if (ticks > 7) pressKey(k)
    }, 60)
  }
})
const stopRepeat = () => clearInterval(repeatTimer)
document.addEventListener("pointerup", stopRepeat)
document.addEventListener("pointercancel", stopRepeat)
keyboardEl.addEventListener("pointerleave", stopRepeat)
window.addEventListener("blur", stopRepeat)

$("#kbDone").addEventListener("click", () => finishEditing())

function showKeyboard() {
  keyboardEl.classList.remove("hidden")
  const p = S.ui.keyboard
  if (p) {
    keyboardEl.classList.add("moved")
    keyboardEl.style.left = clamp(p.x, 8, innerWidth - keyboardEl.offsetWidth - 8) + "px"
    keyboardEl.style.top = clamp(p.y, 8, innerHeight - keyboardEl.offsetHeight - 8) + "px"
    keyboardEl.style.bottom = "auto"
  }
}
function hideKeyboard() {
  keyboardEl.classList.add("hidden")
  stopRepeat()
}

makeDraggable($("#kbHead"), keyboardEl, (x, y) => {
  keyboardEl.classList.add("moved")
  keyboardEl.style.bottom = "auto"
  S.ui.keyboard = { x, y }
  scheduleSave()
}, (e) => e.target.closest("#kbDone"))

/* ---------- Herramientas ---------- */

function setTool(t) {
  if (t !== "text" && t !== "note") finishEditing()
  if (t !== "select") deselect()
  if (t !== "lock" && S.tool !== "lock") S.prevTool = S.tool
  if (t === "lock" && S.tool !== "lock") S.prevTool = S.tool
  S.tool = t
  if (t === "chalk" || t === "marker") S.lastPen = t
  document.body.className = document.body.className.replace(/\btool-\S+/g, "").trim() + " tool-" + t
  $$("[data-tool]").forEach((b) => b.classList.toggle("active", b.dataset.tool === t))
  updateBrushCursor()
  scheduleSave()
}

$$("#toolbar [data-tool]").forEach((b) =>
  b.addEventListener("click", () => {
    const t = b.dataset.tool
    if (t === "lock") return setTool(S.tool === "lock" ? S.prevTool || "chalk" : "lock")
    if (t === "shape") {
      setTool("shape")
      return togglePopover($("#shapeMenu"), b)
    }
    setTool(t)
  })
)

$$("#shapeMenu [data-shape]").forEach((b) =>
  b.addEventListener("click", () => {
    setShape(b.dataset.shape)
    setTool("shape")
    closePopovers()
  })
)

function setShape(s) {
  S.shape = s
  $("#shapeIcon").setAttribute("href", "#i-" + s)
  $$("#shapeMenu [data-shape]").forEach((b) => b.classList.toggle("active", b.dataset.shape === s))
  scheduleSave()
}

/* Colores */
function buildSwatches() {
  const box = $("#swatches")
  box.innerHTML = ""
  for (const c of COLORS) {
    const b = document.createElement("button")
    b.className = "swatch"
    b.style.background = c
    b.dataset.color = c
    b.title = c
    b.addEventListener("click", () => setColor(c))
    box.appendChild(b)
  }
  const custom = document.createElement("label")
  custom.className = "swatch custom"
  custom.title = "Otro color"
  custom.innerHTML = '<span class="inner"></span><input type="color" id="customColor">'
  box.appendChild(custom)
  custom.querySelector("input").addEventListener("input", (e) => setColor(e.target.value))
}

function setColor(c, apply = true) {
  S.color = c
  const isPreset = COLORS.includes(c)
  $$(".swatch[data-color]").forEach((b) => b.classList.toggle("active", b.dataset.color === c))
  const custom = $(".swatch.custom")
  custom.classList.toggle("active", !isPreset)
  custom.querySelector(".inner").style.background = isPreset ? "transparent" : c
  if (!isPreset) $("#customColor").value = c
  $("#sizeDot").style.color = c
  if (apply) {
    const target = editing ? editing.obj : selected ? findObj(selected) : null
    if (target) recolor(target, c)
  }
  scheduleSave()
}

/* Grosor */
function buildSizes() {
  const box = $("#sizePresets")
  for (const s of SIZE_PRESETS) {
    const b = document.createElement("button")
    b.className = "btn"
    b.dataset.size = s
    b.title = s + " px"
    const dot = document.createElement("span")
    dot.style.width = dot.style.height = Math.min(22, Math.max(3, s * 0.7)) + "px"
    b.appendChild(dot)
    b.addEventListener("click", () => setSize(s))
    box.appendChild(b)
  }
  $("#sizeSlider").addEventListener("input", (e) => setSize(+e.target.value))
}

function setSize(n) {
  S.size = clamp(Math.round(n), 1, 80)
  $("#sizeSlider").value = S.size
  $("#sizeValue").textContent = S.size
  const d = clamp(S.size * 0.8 + 2, 4, 22)
  $("#sizeDot").style.width = $("#sizeDot").style.height = d + "px"
  $$("#sizePresets [data-size]").forEach((b) => b.classList.toggle("active", +b.dataset.size === S.size))
  updateBrushCursor()
  scheduleSave()
}

$("#sizeBtn").addEventListener("click", (e) => togglePopover($("#sizeMenu"), e.currentTarget))

/* Deshacer, limpiar */
$("#undoBtn").addEventListener("click", undo)
$("#redoBtn").addEventListener("click", redo)
$("#clearBtn").addEventListener("click", clearPage)

function clearPage() {
  finishEditing()
  deselect()
  const b = board()
  if (!b.objects.length) return
  record({ t: "clear", objects: b.objects.slice() })
  b.objects = []
  renderAll()
  toast("Página limpiada", "Deshacer", undo)
}

/* ---------- Páginas ---------- */

function goPage(i) {
  finishEditing()
  deselect()
  S.current = clamp(i, 0, S.boards.length - 1)
  renderAll()
  updatePages()
  changed()
}

function updatePages() {
  $("#pageLabel").textContent = S.current + 1 + " / " + S.boards.length
  $("#prevPage").disabled = S.current === 0
  $("#nextPage").disabled = S.current === S.boards.length - 1
}

$("#prevPage").addEventListener("click", () => goPage(S.current - 1))
$("#nextPage").addEventListener("click", () => goPage(S.current + 1))
$("#pageLabel").addEventListener("click", (e) => togglePopover($("#pageMenu"), e.currentTarget))

$("#addPage").addEventListener("click", () => {
  closePopovers()
  S.boards.splice(S.current + 1, 0, newBoard())
  goPage(S.current + 1)
  toast("Página " + (S.current + 1) + " creada")
})

$("#deletePage").addEventListener("click", () => {
  closePopovers()
  const single = S.boards.length === 1
  const msg = single ? "¿Borrar todo el contenido de la página?" : "¿Eliminar la página " + (S.current + 1) + " y todo su contenido?"
  confirmBox(msg, () => {
    const b = board()
    histories.delete(b.id)
    if (single) {
      b.objects = []
      renderAll()
      changed()
    } else {
      S.boards.splice(S.current, 1)
      goPage(Math.min(S.current, S.boards.length - 1))
    }
  })
})

/* ---------- Ajustes de fondo ---------- */

let textureKind = null
function buildTexture(light) {
  const kind = light ? "light" : "dark"
  if (textureKind === kind) return
  textureKind = kind
  const s = 256
  const c = document.createElement("canvas")
  c.width = c.height = s
  const x = c.getContext("2d")
  const img = x.createImageData(s, s)
  for (let i = 0; i < img.data.length; i += 4) {
    const v = light ? 0 : 255
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v
    img.data[i + 3] = Math.random() < 0.5 ? 0 : Math.random() * (light ? 14 : 20)
  }
  x.putImageData(img, 0, 0)
  const dust = light ? 0 : 0.035
  const t = $("#texture")
  t.style.backgroundImage = [
    `url(${c.toDataURL()})`,
    `radial-gradient(ellipse 45% 30% at 22% 28%, rgba(255,255,255,${dust}), transparent 70%)`,
    `radial-gradient(ellipse 40% 35% at 78% 72%, rgba(255,255,255,${dust * 0.8}), transparent 70%)`,
    `radial-gradient(ellipse 30% 20% at 60% 18%, rgba(255,255,255,${dust * 0.6}), transparent 70%)`,
    `radial-gradient(ellipse at 50% 45%, transparent 55%, rgba(0,0,0,${light ? 0.08 : 0.38}) 100%)`,
  ].join(",")
  t.style.backgroundSize = `${s}px ${s}px, 100% 100%, 100% 100%, 100% 100%, 100% 100%`
}

function applySettings() {
  const st = S.settings
  const theme = THEMES.find((t) => t.id === st.theme)
  const bg = theme ? theme.color : st.customBg
  const light = luminance(bg) > 0.55
  const root = document.documentElement.style
  root.setProperty("--board", bg)
  root.setProperty("--grid-color", light ? "rgba(0,0,0,0.09)" : "rgba(255,255,255,0.07)")
  const font = FONTS.find((f) => f.id === st.font) || FONTS[0]
  root.setProperty("--text-font", font.css)
  document.body.classList.toggle("light", light)
  document.body.classList.toggle("textured", !!st.texture)
  $("#grid").className = st.grid === "none" ? "" : st.grid
  buildTexture(light)

  $$("#themes .theme").forEach((b) => b.classList.toggle("active", b.dataset.theme === st.theme))
  $$("#gridSeg [data-grid]").forEach((b) => b.classList.toggle("active", b.dataset.grid === st.grid))
  $$("#fontSeg [data-font]").forEach((b) => b.classList.toggle("active", b.dataset.font === st.font))
  $("#textureToggle").checked = !!st.texture
  const customTheme = $(".theme.custom")
  if (customTheme) customTheme.style.background = st.theme === "custom" ? st.customBg : ""
}

function setSetting(key, value) {
  S.settings[key] = value
  applySettings()
  scheduleSave()
}

function buildSettings() {
  const themes = $("#themes")
  for (const t of THEMES) {
    const b = document.createElement("button")
    b.className = "theme"
    b.dataset.theme = t.id
    b.title = t.name
    b.style.background = t.color
    b.addEventListener("click", () => setSetting("theme", t.id))
    themes.appendChild(b)
  }
  const custom = document.createElement("label")
  custom.className = "theme custom"
  custom.dataset.theme = "custom"
  custom.title = "Color personalizado"
  custom.innerHTML = '<input type="color">'
  const input = custom.querySelector("input")
  input.value = S.settings.customBg
  input.addEventListener("input", (e) => {
    S.settings.customBg = e.target.value
    setSetting("theme", "custom")
  })
  themes.appendChild(custom)

  $$("#gridSeg [data-grid]").forEach((b) => b.addEventListener("click", () => setSetting("grid", b.dataset.grid)))

  const fontSeg = $("#fontSeg")
  for (const f of FONTS) {
    const b = document.createElement("button")
    b.dataset.font = f.id
    b.textContent = f.label
    b.style.fontFamily = f.css
    b.addEventListener("click", () => setSetting("font", f.id))
    fontSeg.appendChild(b)
  }
  $("#textureToggle").addEventListener("change", (e) => setSetting("texture", e.target.checked))
}

$("#settingsBtn").addEventListener("click", (e) => togglePopover($("#settingsMenu"), e.currentTarget))

/* ---------- Menús flotantes ---------- */

function togglePopover(pop, anchor) {
  const wasOpen = !pop.classList.contains("hidden")
  closePopovers()
  if (wasOpen) return
  pop.classList.remove("hidden")
  const r = anchor.getBoundingClientRect()
  const w = pop.offsetWidth, h = pop.offsetHeight
  let y = r.bottom + 10
  if (y + h > innerHeight - 8) y = r.top - 10 - h
  pop.style.left = clamp(r.left + r.width / 2 - w / 2, 8, innerWidth - w - 8) + "px"
  pop.style.top = clamp(y, 8, innerHeight - h - 8) + "px"
}

function closePopovers() {
  $$(".popover").forEach((p) => p.classList.add("hidden"))
}

const POPOVER_ANCHORS = "#shapeBtn, #sizeBtn, #settingsBtn, #pageLabel"
document.addEventListener("pointerdown", (e) => {
  if (!e.target.closest(".popover") && !e.target.closest(POPOVER_ANCHORS)) closePopovers()
  // Clic en el fondo vacío (modo selección): soltar selección / edición
  if (e.target.id === "bg") {
    finishEditing()
    deselect()
  }
}, true)

/* Que los botones no roben el foco del texto que se está editando */
$("#toolbar").addEventListener("pointerdown", (e) => {
  if (e.target.closest(".btn, .swatch:not(.custom)")) e.preventDefault()
})
$$(".popover").forEach((p) => p.addEventListener("pointerdown", (e) => {
  if (e.target.closest(".btn")) e.preventDefault()
}))

/* ---------- Barra de herramientas movible ---------- */

const toolbar = $("#toolbar")

function makeDraggable(handle, target, onEnd, ignore) {
  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || (ignore && ignore(e))) return
    e.preventDefault()
    const r = target.getBoundingClientRect()
    const ox = e.clientX - r.left, oy = e.clientY - r.top
    handle.setPointerCapture(e.pointerId)
    target.style.transform = "none"
    let last = { x: r.left, y: r.top }
    const move = (ev) => {
      last.x = clamp(ev.clientX - ox, 4, innerWidth - target.offsetWidth - 4)
      last.y = clamp(ev.clientY - oy, 4, innerHeight - target.offsetHeight - 4)
      target.style.left = last.x + "px"
      target.style.top = last.y + "px"
    }
    const up = () => {
      handle.removeEventListener("pointermove", move)
      handle.removeEventListener("pointerup", up)
      handle.removeEventListener("pointercancel", up)
      onEnd(Math.round(last.x), Math.round(last.y))
    }
    handle.addEventListener("pointermove", move)
    handle.addEventListener("pointerup", up)
    handle.addEventListener("pointercancel", up)
    closePopovers()
  })
}

function placeToolbar() {
  const p = S.ui.toolbar
  const w = toolbar.offsetWidth, h = toolbar.offsetHeight
  const x = p ? p.x : (innerWidth - w) / 2
  const y = p ? p.y : 16
  toolbar.style.left = clamp(x, 4, Math.max(4, innerWidth - w - 4)) + "px"
  toolbar.style.top = clamp(y, 4, Math.max(4, innerHeight - h - 4)) + "px"
}

makeDraggable($("#toolbarGrip"), toolbar, (x, y) => {
  S.ui.toolbar = { x, y }
  scheduleSave()
})

function setCollapsed(c) {
  S.ui.collapsed = c
  toolbar.classList.toggle("collapsed", c)
  $("#collapseBtn use").setAttribute("href", c ? "#i-expand" : "#i-minus")
  $("#collapseBtn").title = c ? "Mostrar barra" : "Contraer barra"
  closePopovers()
  placeToolbar()
  scheduleSave()
}
$("#collapseBtn").addEventListener("click", () => setCollapsed(!S.ui.collapsed))

/* ---------- Aviso y confirmación ---------- */

let toastTimer = null
function toast(msg, actionLabel, action) {
  const t = $("#toast")
  $("#toastText").textContent = msg
  const btn = $("#toastAction")
  btn.classList.toggle("hidden", !actionLabel)
  btn.textContent = actionLabel || ""
  btn.onclick = () => {
    t.classList.add("hidden")
    if (action) action()
  }
  t.classList.remove("hidden")
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => t.classList.add("hidden"), actionLabel ? 6000 : 2500)
}

function confirmBox(text, onOk) {
  const m = $("#confirm")
  $("#confirmText").textContent = text
  m.classList.remove("hidden")
  const close = () => m.classList.add("hidden")
  $("#confirmOk").onclick = () => {
    close()
    onOk()
  }
  $("#confirmCancel").onclick = close
}

/* ---------- Atajos de teclado (si hay teclado físico) ---------- */

document.addEventListener("keydown", (e) => {
  if (editing) {
    if (e.key === "Escape") {
      e.preventDefault()
      finishEditing()
    }
    return
  }
  if (e.target.matches && e.target.matches("input")) return
  const k = e.key.toLowerCase()
  const mod = e.ctrlKey || e.metaKey
  if (mod && k === "z") {
    e.preventDefault()
    e.shiftKey ? redo() : undo()
  } else if (mod && k === "y") {
    e.preventDefault()
    redo()
  } else if (!mod && !e.altKey) {
    if ((k === "delete" || k === "backspace") && selected) {
      e.preventDefault()
      deleteObj(selected)
    } else if (k === "escape") {
      deselect()
      closePopovers()
    } else if (k === "[") setSize(S.size - (S.size > 10 ? 2 : 1))
    else if (k === "]") setSize(S.size + (S.size >= 10 ? 2 : 1))
    else if (SHORTCUTS[k]) setTool(SHORTCUTS[k])
  }
})

/* ---------- Arranque ---------- */

let resizeTimer = null
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => {
    resizeCanvases()
    placeToolbar()
    placeContextBar()
  }, 120)
})

window.addEventListener("pagehide", () => {
  finishEditing()
  saveNow()
})
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") saveNow()
})

async function init() {
  S = hydrate(await Store.load())
  buildSwatches()
  buildSizes()
  buildSettings()
  renderKeyboard()
  applySettings()
  resizeCanvases()
  renderDom()
  setShape(S.shape)
  setColor(S.color, false)
  setSize(S.size)
  setTool(S.tool)
  setCollapsed(!!S.ui.collapsed)
  updatePages()
  updateUndoButtons()
  // Acceso para depurar desde la consola (F12 en el navegador)
  window.__pizarra = { get state() { return S }, undo, redo, render: renderAll, save: saveNow }
}

init()
