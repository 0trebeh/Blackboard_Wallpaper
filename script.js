class DrawingBoard {
  constructor() {
    this.canvas = document.getElementById("drawingCanvas")
    this.ctx = this.canvas.getContext("2d")
    this.elementsLayer = document.getElementById("elementsLayer")
    this.toolbar = document.getElementById("toolbar")

    // Estado de la aplicación
    this.currentTool = "pencil"
    this.isDrawing = false
    this.currentColor = "#ffffff"
    this.currentSize = 5
    this.selectedElement = null
    this.isDragging = false
    this.isResizing = false
    this.dragOffset = { x: 0, y: 0 }
    this.lastPoint = null

    // Inicializar
    this.initCanvas()
    this.initEventListeners()
    this.initToolbar()
  }

  // Inicializar canvas
  initCanvas() {
    this.resizeCanvas()
    window.addEventListener("resize", () => this.debounce(this.resizeCanvas.bind(this), 100))

    // Configuración inicial del canvas
    this.ctx.lineCap = "round"
    this.ctx.lineJoin = "round"
    this.ctx.fillStyle = "#000000"
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
  }

  // Redimensionar canvas
  resizeCanvas() {
    this.canvas.width = window.innerWidth
    this.canvas.height = window.innerHeight
    this.canvas.style.width = window.innerWidth + "px"
    this.canvas.style.height = window.innerHeight + "px"

    // Restaurar configuración después del resize
    this.ctx.lineCap = "round"
    this.ctx.lineJoin = "round"
    this.ctx.fillStyle = "#000000"
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
  }

  // Inicializar event listeners
  initEventListeners() {
    // Canvas events
    this.canvas.addEventListener("mousedown", this.handleMouseDown.bind(this))
    this.canvas.addEventListener("mousemove", this.handleMouseMove.bind(this))
    this.canvas.addEventListener("mouseup", this.handleMouseUp.bind(this))
    this.canvas.addEventListener("click", this.handleCanvasClick.bind(this))

    // Document events
    document.addEventListener("keydown", this.handleKeyDown.bind(this))
    document.addEventListener("click", this.handleDocumentClick.bind(this))

    // Tool events
    document.querySelectorAll(".tool-btn[data-tool]").forEach((btn) => {
      btn.addEventListener("click", (e) => this.setTool(e.target.dataset.tool))
    })

    // Control events
    document.getElementById("colorPicker").addEventListener("change", this.setColor.bind(this))
    document.getElementById("sizeSlider").addEventListener("input", this.setSize.bind(this))
    document.getElementById("sizeInput").addEventListener("input", this.setSize.bind(this))
    document.getElementById("clearCanvas").addEventListener("click", this.clearCanvas.bind(this))
    document.getElementById("resetAll").addEventListener("click", this.resetAll.bind(this))
    document.getElementById("imageInput").addEventListener("change", this.addImage.bind(this))
    document.getElementById("toggleToolbar").addEventListener("click", this.toggleToolbar.bind(this))
  }

  // Inicializar toolbar draggable
  initToolbar() {
    let isDragging = false
    const dragOffset = { x: 0, y: 0 }

    this.toolbar.addEventListener("mousedown", (e) => {
      if (e.target === this.toolbar || e.target.classList.contains("tool-label")) {
        isDragging = true
        const rect = this.toolbar.getBoundingClientRect()
        dragOffset.x = e.clientX - rect.left
        dragOffset.y = e.clientY - rect.top
        this.toolbar.style.cursor = "grabbing"
      }
    })

    document.addEventListener("mousemove", (e) => {
      if (isDragging) {
        const x = Math.max(0, Math.min(window.innerWidth - this.toolbar.offsetWidth, e.clientX - dragOffset.x))
        const y = Math.max(0, Math.min(window.innerHeight - this.toolbar.offsetHeight, e.clientY - dragOffset.y))

        this.toolbar.style.left = x + "px"
        this.toolbar.style.top = y + "px"
      }
    })

    document.addEventListener("mouseup", () => {
      isDragging = false
      this.toolbar.style.cursor = ""
    })
  }

  // Manejar mouse down
  handleMouseDown(e) {
    if (this.currentTool === "pencil" || this.currentTool === "eraser") {
      this.isDrawing = true
      this.lastPoint = null
      this.draw(e)
    }
  }

  // Manejar mouse move
  handleMouseMove(e) {
    if (this.isDrawing && (this.currentTool === "pencil" || this.currentTool === "eraser")) {
      requestAnimationFrame(() => this.draw(e))
    }
  }

  // Manejar mouse up
  handleMouseUp(e) {
    this.isDrawing = false
    this.lastPoint = null
    this.ctx.beginPath()
  }

  // Manejar click en canvas
  handleCanvasClick(e) {
    if (this.currentTool === "text") {
      this.addText(e)
    }
  }

  // Manejar click en documento
  handleDocumentClick(e) {
    if (!e.target.closest(".text-element") && !e.target.closest(".image-element")) {
      this.deselectElement()
    }
  }

  // Manejar teclas
  handleKeyDown(e) {
    if ((e.key === "Delete" || e.key === "Backspace") && this.selectedElement) {
      this.deleteElement(this.selectedElement)
      e.preventDefault()
    }
  }

  // Establecer herramienta
  setTool(tool) {
    this.currentTool = tool

    // Actualizar UI
    document.querySelectorAll(".tool-btn[data-tool]").forEach((btn) => {
      btn.classList.remove("active")
    })
    document.querySelector(`[data-tool="${tool}"]`).classList.add("active")

    // Actualizar cursor
    this.updateCursor()
  }

  // Actualizar cursor
  updateCursor() {
    this.canvas.classList.remove("drawing", "erasing", "text-mode")

    switch (this.currentTool) {
      case "pencil":
        this.canvas.classList.add("drawing")
        break
      case "eraser":
        this.canvas.classList.add("erasing")
        break
      case "text":
        this.canvas.classList.add("text-mode")
        break
    }
  }

  // Dibujar
  draw(e) {
    const rect = this.canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    if (this.currentTool === "pencil") {
      this.ctx.globalCompositeOperation = "source-over"
      this.ctx.strokeStyle = this.currentColor
    } else if (this.currentTool === "eraser") {
      this.ctx.globalCompositeOperation = "destination-out"
    }

    this.ctx.lineWidth = this.currentSize

    if (!this.lastPoint) {
      this.ctx.beginPath()
      this.ctx.moveTo(x, y)
      this.lastPoint = { x, y }
    } else {
      this.ctx.beginPath()
      this.ctx.moveTo(this.lastPoint.x, this.lastPoint.y)
      this.ctx.lineTo(x, y)
      this.ctx.stroke()
      this.lastPoint = { x, y }
    }
  }

  // Establecer color
  setColor(e) {
    this.currentColor = e.target.value
  }

  // Establecer tamaño
  setSize(e) {
    this.currentSize = Number.parseInt(e.target.value)

    // Sincronizar slider y input
    if (e.target.id === "sizeSlider") {
      document.getElementById("sizeInput").value = this.currentSize
    } else {
      document.getElementById("sizeSlider").value = this.currentSize
    }
  }

  // Agregar texto
  addText(e) {
    const rect = this.canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const textElement = document.createElement("div")
    textElement.className = "text-element"
    textElement.contentEditable = true
    textElement.textContent = "Texto"
    textElement.style.left = x + "px"
    textElement.style.top = y + "px"
    textElement.style.color = this.currentColor
    textElement.style.fontSize = this.currentSize * 3 + "px"

    this.elementsLayer.appendChild(textElement)
    this.makeElementInteractive(textElement)

    // Seleccionar y enfocar
    setTimeout(() => {
      this.selectElement(textElement)
      textElement.focus()
      this.selectAllText(textElement)
    }, 10)
  }

  // Agregar imagen
  addImage(e) {
    const file = e.target.files[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const img = document.createElement("img")
      img.src = event.target.result
      img.className = "image-element"
      img.style.left = "50px"
      img.style.top = "50px"
      img.style.maxWidth = "300px"
      img.style.height = "auto"
      img.style.position = "absolute"
      img.style.minWidth = "50px"
      img.style.minHeight = "50px"

      this.elementsLayer.appendChild(img)
      this.makeElementInteractive(img)
      this.selectElement(img)
    }
    reader.readAsDataURL(file)

    // Reset input
    e.target.value = ""
  }

  // Hacer elemento interactivo
  makeElementInteractive(element) {
    element.addEventListener("mousedown", (e) => {
      e.stopPropagation()
      this.selectElement(element)
      this.startDrag(e, element)
    })
  }

  // Seleccionar elemento
  selectElement(element) {
    this.deselectElement()
    this.selectedElement = element
    element.classList.add("selected")
    this.addResizeHandles(element)
  }

  // Deseleccionar elemento
  deselectElement() {
    if (this.selectedElement) {
      this.selectedElement.classList.remove("selected")
      this.removeResizeHandles(this.selectedElement)
      this.selectedElement = null
    }
  }

  // Agregar asas de redimensionado
  addResizeHandles(element) {
    const handles = ["nw", "ne", "sw", "se"]

    handles.forEach((position) => {
      const handle = document.createElement("div")
      handle.className = `resize-handle ${position}`
      handle.addEventListener("mousedown", (e) => {
        e.stopPropagation()
        this.startResize(e, element, position)
      })
      element.appendChild(handle)
    })
  }

  // Remover asas de redimensionado
  removeResizeHandles(element) {
    const handles = element.querySelectorAll(".resize-handle")
    handles.forEach((handle) => handle.remove())
  }

  // Iniciar arrastre
  startDrag(e, element) {
    this.isDragging = true
    const rect = element.getBoundingClientRect()
    this.dragOffset.x = e.clientX - rect.left
    this.dragOffset.y = e.clientY - rect.top

    const handleMouseMove = (e) => {
      if (this.isDragging) {
        const x = e.clientX - this.dragOffset.x
        const y = e.clientY - this.dragOffset.y
        element.style.left = Math.max(0, x) + "px"
        element.style.top = Math.max(0, y) + "px"
      }
    }

    const handleMouseUp = () => {
      this.isDragging = false
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
    }

    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleMouseUp)
  }

  // Iniciar redimensionado
  startResize(e, element, position) {
    this.isResizing = true
    const startX = e.clientX
    const startY = e.clientY
    const startWidth = element.offsetWidth
    const startHeight = element.offsetHeight
    const startLeft = element.offsetLeft
    const startTop = element.offsetTop

    const handleMouseMove = (e) => {
      if (this.isResizing) {
        const deltaX = e.clientX - startX
        const deltaY = e.clientY - startY

        let newWidth = startWidth
        let newHeight = startHeight
        let newLeft = startLeft
        let newTop = startTop

        switch (position) {
          case "se":
            newWidth = Math.max(20, startWidth + deltaX)
            newHeight = Math.max(20, startHeight + deltaY)
            break
          case "sw":
            newWidth = Math.max(20, startWidth - deltaX)
            newHeight = Math.max(20, startHeight + deltaY)
            newLeft = startLeft + deltaX
            break
          case "ne":
            newWidth = Math.max(20, startWidth + deltaX)
            newHeight = Math.max(20, startHeight - deltaY)
            newTop = startTop + deltaY
            break
          case "nw":
            newWidth = Math.max(20, startWidth - deltaX)
            newHeight = Math.max(20, startHeight - deltaY)
            newLeft = startLeft + deltaX
            newTop = startTop + deltaY
            break
        }

        if (element.tagName === "IMG") {
          const aspectRatio = startWidth / startHeight
          if (position === "se" || position === "nw") {
            newHeight = newWidth / aspectRatio
          } else if (position === "sw" || position === "ne") {
            newHeight = newWidth / aspectRatio
            if (position === "ne") {
              newTop = startTop + startHeight - newHeight
            }
            if (position === "sw") {
              newLeft = startLeft + startWidth - newWidth
            }
          }
        }

        element.style.width = newWidth + "px"
        element.style.height = newHeight + "px"
        element.style.left = Math.max(0, newLeft) + "px"
        element.style.top = Math.max(0, newTop) + "px"

        if (element.classList.contains("text-element")) {
          element.style.fontSize = Math.max(12, newWidth / 10) + "px"
        }
      }
    }

    const handleMouseUp = () => {
      this.isResizing = false
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
    }

    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleMouseUp)
  }

  // Eliminar elemento
  deleteElement(element) {
    element.remove()
    this.selectedElement = null
  }

  // Seleccionar todo el texto
  selectAllText(element) {
    const range = document.createRange()
    range.selectNodeContents(element)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
  }

  // Limpiar canvas
  clearCanvas() {
    if (confirm("Confirmar Limpieza")) {
      this.ctx.fillStyle = "#000000"
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
    }
  }

  // Reset todo
  resetAll() {
    if (confirm("Confirmar Reset")) {
      this.clearCanvas()
      this.elementsLayer.innerHTML = ""
      this.selectedElement = null
    }
  }

  // Toggle toolbar
  toggleToolbar() {
    this.toolbar.classList.toggle("hidden")
  }

  // Debounce utility
  debounce(func, wait) {
    let timeout
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout)
        func(...args)
      }
      clearTimeout(timeout)
      timeout = setTimeout(later, wait)
    }
  }
}

// Inicializar aplicación
document.addEventListener("DOMContentLoaded", () => {
  new DrawingBoard()
})
