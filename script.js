class DrawingBoard {
  constructor() {
    this.keyboard = document.getElementById("onScreenKeyboard")
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

    // Control events (verifica que existan los elementos en tu HTML)
    const colorPicker = document.getElementById("colorPicker")
    const sizeSlider = document.getElementById("sizeSlider")
    const sizeInput = document.getElementById("sizeInput")
    const clearBtn = document.getElementById("clearCanvas")
    const resetBtn = document.getElementById("resetAll")
    const imageInput = document.getElementById("imageInput")
    const toggleToolbarBtn = document.getElementById("toggleToolbar")

    if (colorPicker) colorPicker.addEventListener("change", this.setColor.bind(this))
    if (sizeSlider) sizeSlider.addEventListener("input", this.setSize.bind(this))
    if (sizeInput) sizeInput.addEventListener("input", this.setSize.bind(this))
    if (clearBtn) clearBtn.addEventListener("click", this.clearCanvas.bind(this))
    if (resetBtn) resetBtn.addEventListener("click", this.resetAll.bind(this))
    if (imageInput) imageInput.addEventListener("change", this.addImage.bind(this))
    if (toggleToolbarBtn) toggleToolbarBtn.addEventListener("click", this.toggleToolbar.bind(this))
  }

  // Inicializar toolbar draggable
  initToolbar() {
    let isDragging = false
    const dragOffset = { x: 0, y: 0 }

    if (!this.toolbar) return

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
      if (this.toolbar) this.toolbar.style.cursor = ""
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
    //  FIX: Evitar deseleccionar si se hace click en el teclado en pantalla
    if (e.target.closest(".keyboard")) {
      return
    }

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
    const btn = document.querySelector(`[data-tool="${tool}"]`)
    if (btn) btn.classList.add("active")

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
      case "none":
        this.canvas.style.cursor = "default"
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
      const sizeInput = document.getElementById("sizeInput")
      if (sizeInput) sizeInput.value = this.currentSize
    } else {
      const sizeSlider = document.getElementById("sizeSlider")
      if (sizeSlider) sizeSlider.value = this.currentSize
    }
  }

  // Agregar texto (cuando se usa la herramienta text)
  addText(e) {
    const rect = this.canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const textElement = document.createElement("div")
    textElement.className = "text-element"
    textElement.contentEditable = true
    textElement.spellcheck = false
    textElement.textContent = ""
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
      // Contenedor
      const wrapper = document.createElement("div")
      wrapper.className = "image-element"
      wrapper.style.left = "50px"
      wrapper.style.top = "50px"
      wrapper.style.width = "200px"
      wrapper.style.height = "auto"
      wrapper.style.position = "absolute"
      wrapper.style.minWidth = "50px"
      wrapper.style.minHeight = "50px"

      // Imagen dentro del contenedor
      const img = document.createElement("img")
      img.src = event.target.result
      img.style.width = "100%"
      img.style.height = "100%"
      img.style.display = "block"

      wrapper.appendChild(img)
      this.elementsLayer.appendChild(wrapper)

      this.makeElementInteractive(wrapper)
      this.selectElement(wrapper)
    }
    reader.readAsDataURL(file)

    // Reset input
    e.target.value = ""
  }

  // Hacer elemento interactivo
  makeElementInteractive(element) {
    element.addEventListener("mousedown", (e) => {
      //  No procesar si se hace click en un resize handle
      if (e.target.classList.contains("resize-handle")) {
        return
      }

      e.stopPropagation()
      this.selectElement(element)

      //  Sincronizar con focusedEditable para el teclado
      if (element.classList.contains("text-element") && window.__keyboardFocusedEditable !== undefined) {
        window.__keyboardFocusedEditable = element
      }

      this.startDrag(e, element)
    })

    //  Manejar focus en elementos de texto
    if (element.classList.contains("text-element")) {
      element.addEventListener("focus", () => {
        this.selectElement(element)
        if (window.__keyboardFocusedEditable !== undefined) {
          window.__keyboardFocusedEditable = element
        }
      })
    }
  }

  // Seleccionar elemento
  selectElement(element) {
    this.deselectElement()
    this.selectedElement = element
    element.classList.add("selected")

    //  Agregar asas de redimensionado para elementos seleccionados
    if (element.classList.contains("text-element") || element.classList.contains("image-element")) {
      this.addResizeHandles(element)
    }

    // 👉 Mostrar teclado si es un text-element
    if (element.classList.contains("text-element")) {
      this.keyboard.classList.remove("hidden")
      this.keyboard.style.display = "flex" // Cambiar a flex para mejor compatibilidad
    }
  }

  // Deseleccionar elemento
  deselectElement() {
    if (this.selectedElement) {
      //  Remover asas de redimensionado antes de deseleccionar
      this.removeResizeHandles(this.selectedElement)
      this.selectedElement.classList.remove("selected")
      this.selectedElement = null
    }
    // 👉 Ocultar teclado
    this.keyboard.classList.add("hidden")
    this.keyboard.style.display = "none"
    //  Limpiar también el focusedEditable del teclado
    if (window.__keyboardFocusedEditable !== undefined) {
      window.__keyboardFocusedEditable = null
    }
  }

  // Método para cerrar el teclado manualmente
  closeKeyboardManually() {
    this.keyboard.classList.add("hidden")
    this.keyboard.style.display = "none"
    //  Al cerrar manualmente, también deseleccionar el elemento
    if (this.selectedElement) {
      //  Remover asas antes de deseleccionar
      this.removeResizeHandles(this.selectedElement)
      this.selectedElement.classList.remove("selected")
      this.selectedElement = null
    }
    //  Limpiar también el focusedEditable del teclado
    if (window.__keyboardFocusedEditable !== undefined) {
      window.__keyboardFocusedEditable = null
    }
  }

  // Método para mostrar el teclado (no necesita resetear flag)
  showKeyboard() {
    this.keyboard.classList.remove("hidden")
    this.keyboard.style.display = "flex"
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

        //  Manejar proporción para imágenes
        if (element.classList.contains("image-element")) {
          const img = element.querySelector("img")
          if (img) {
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
    this.showConfirm(() => {
      this.ctx.fillStyle = "#000000"
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
    })
  }

  showConfirm(onOk) {
    const modal = document.getElementById("confirmModal")
    if (!modal) {
      // fallback si no existe modal
      if (confirm && typeof confirm === "function") {
        if (confirm("¿Borrar todo?")) onOk()
      }
      return
    }
    modal.classList.remove("hidden")

    const okBtn = document.getElementById("confirmOk")
    const cancelBtn = document.getElementById("confirmCancel")

    const close = () => modal.classList.add("hidden")

    okBtn.onclick = () => { close(); onOk() }
    cancelBtn.onclick = close
  }

  // Reset todo
  resetAll() {
    if (this.selectedElement) {
      this.deleteElement(this.selectedElement)
    } else {
      this.showConfirm(() => {
        this.ctx.fillStyle = "#000000"
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
        this.elementsLayer.innerHTML = ""
        this.selectedElement = null
      })
    }
  }

  // Toggle toolbar
  toggleToolbar() {
    if (!this.toolbar) return
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

// Inicializar aplicación + teclado en pantalla
document.addEventListener("DOMContentLoaded", () => {
  const board = new DrawingBoard()
  window.__drawingBoardInstance = board

  // On-screen keyboard script
  // Elements
  const keyboardToggle = document.getElementById("keyboardToggle");
  const keyboard = document.getElementById("onScreenKeyboard");
  const keyboardRows = document.getElementById("keyboardRows");
  const keyboardClose = document.getElementById("keyboardClose");
  const kbdShiftBtn = document.getElementById("kbdShift");
  const kbdSpace = document.getElementById("kbdSpace");
  const kbdEnter = document.getElementById("kbdEnter");
  const kbdBack = document.getElementById("kbdBack");
  const kbdDragHandle = document.getElementById("kbdDragHandle");

  // State
  let shiftActive = false;
  let focusedEditable = null; // element that receives typed chars

  //  Exponer focusedEditable globalmente para sincronización
  window.__keyboardFocusedEditable = focusedEditable;

  // Layout: rows (letters, numbers, special chars)
  const rows = [
    "1 2 3 4 5 6 7 8 9 0".split(" "),
    "q w e r t y u i o p".split(" "),
    "a s d f g h j k l ñ".split(" "),
    "z x c v b n m , .".split(" "),
    "# $ % * ^ ! [ ]".split(" "), // special row
  ];

  // Add letters uppercase when shift active
  function renderKeyboard() {
    if (!keyboardRows) return;
    keyboardRows.innerHTML = "";
    rows.forEach((row) => {
      const r = document.createElement("div");
      r.className = "k-row";
      row.forEach((key) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "key";
        btn.dataset.key = key;
        btn.textContent = displayForKey(key);
        btn.addEventListener("click", onKeyClick);
        r.appendChild(btn);
      });
      keyboardRows.appendChild(r);
    });
  }

  function displayForKey(k) {
    if (k.length === 1 && /[a-zñ]/i.test(k)) {
      return shiftActive ? k.toUpperCase() : k.toLowerCase();
    }
    return k;
  }

  // Insert character into focused editable
  function insertChar(char) {
    //  Usar la referencia global sincronizada
    focusedEditable = window.__keyboardFocusedEditable;

    if (!focusedEditable) {
      // If no focused editable, try detect current selection target:
      const active = document.activeElement;
      if (isEditable(active)) {
        focusedEditable = active;
        window.__keyboardFocusedEditable = active;
      }
    }
    if (!focusedEditable) {
      // If still none, create a new text element at center (compatible with your canvas)
      createAndFocusTextAtCenter(char);
      return;
    }
    if (focusedEditable.isContentEditable) {
      insertTextIntoContentEditable(focusedEditable, char);
    } else {
      // fallback: append textContent
      focusedEditable.textContent = (focusedEditable.textContent || "") + char;
    }
  }

  // Función para insertar texto en contentEditable - CORREGIDA
  function insertTextIntoContentEditable(el, text) {
    el.focus();

    const sel = window.getSelection();

    // Si no hay rango, crear uno al final
    if (!sel.rangeCount) {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false); // colapsar al final
      sel.removeAllRanges();
      sel.addRange(range);
    }

    const range = sel.getRangeAt(0);

    if (text === "\n") {
      // Crear un salto de línea
      const br = document.createElement("br");
      range.deleteContents();
      range.insertNode(br);

      // Mover cursor después del <br>
      range.setStartAfter(br);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      // Insertar texto normal
      const textNode = document.createTextNode(text);
      range.deleteContents(); // eliminar selección si la hay
      range.insertNode(textNode);

      // Mover cursor después del texto insertado
      range.setStartAfter(textNode);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  function placeCursorAtEnd(el) {
    const range = document.createRange();
    const sel = window.getSelection();

    // Si el elemento tiene contenido
    if (el.childNodes.length > 0) {
      const lastChild = el.childNodes[el.childNodes.length - 1];
      if (lastChild.nodeType === Node.TEXT_NODE) {
        range.setStart(lastChild, lastChild.textContent.length);
      } else {
        range.setStartAfter(lastChild);
      }
    } else {
      // Si no tiene contenido, colocar al inicio
      range.setStart(el, 0);
    }

    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // Create new text element compatible with your project and focus it
  function createAndFocusTextAtCenter(initialChar = "") {
    const elementsLayer = document.getElementById("elementsLayer");
    if (!elementsLayer) return;
    const rect = { x: window.innerWidth / 2 - 100, y: window.innerHeight / 2 - 20 };
    const textElement = document.createElement("div");
    textElement.className = "text-element";
    textElement.contentEditable = true;
    textElement.spellcheck = false;
    textElement.textContent = initialChar || "Texto";
    textElement.style.left = rect.x + "px";
    textElement.style.top = rect.y + "px";
    textElement.style.color = "#ffffff";
    textElement.style.fontSize = "20px";
    elementsLayer.appendChild(textElement);
    // Integrate with existing interactivity if your app exposes it.
    try {
      const boardInstance = window.__drawingBoardInstance;
      if (boardInstance && typeof boardInstance.makeElementInteractive === "function") {
        boardInstance.makeElementInteractive(textElement);
        boardInstance.selectElement(textElement);
      } else {
        setTimeout(() => {
          textElement.focus();
          placeCursorAtEnd(textElement);
        }, 10);
      }
      focusedEditable = textElement;
      window.__keyboardFocusedEditable = textElement; //  Sincronizar
    } catch (err) {
      setTimeout(() => {
        textElement.focus();
        placeCursorAtEnd(textElement);
      }, 10);
      focusedEditable = textElement;
      window.__keyboardFocusedEditable = textElement; //  Sincronizar
    }
  }

  // Backspace behavior
  function performBackspace() {
    focusedEditable = window.__keyboardFocusedEditable;

    if (!focusedEditable) return;

    if (focusedEditable.isContentEditable) {
      focusedEditable.focus();

      const sel = window.getSelection();
      if (!sel.rangeCount) {
        // Si no hay selección, crear una al final
        placeCursorAtEnd(focusedEditable);
        return;
      }

      const range = sel.getRangeAt(0);

      // Si hay selección de texto, eliminarla
      if (!range.collapsed) {
        range.deleteContents();
        return;
      }

      // Obtener la posición actual del cursor
      const startContainer = range.startContainer;
      const startOffset = range.startOffset;

      // Caso 1: Estamos en un nodo de texto
      if (startContainer.nodeType === Node.TEXT_NODE) {
        if (startOffset > 0) {
          // Eliminar un caracter hacia atrás en el mismo nodo
          const textContent = startContainer.textContent;
          startContainer.textContent = textContent.slice(0, startOffset - 1) + textContent.slice(startOffset);

          // Actualizar posición del cursor
          range.setStart(startContainer, startOffset - 1);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
          return;
        } else {
          // Estamos al inicio del nodo de texto, buscar nodo anterior
          const prevNode = getPreviousTextNode(startContainer, focusedEditable);
          if (prevNode) {
            const prevLength = prevNode.textContent.length;
            if (prevLength > 0) {
              // Eliminar último caracter del nodo anterior
              prevNode.textContent = prevNode.textContent.slice(0, -1);

              // Mover cursor al final del nodo anterior
              range.setStart(prevNode, prevNode.textContent.length);
              range.collapse(true);
              sel.removeAllRanges();
              sel.addRange(range);
              return;
            }
          }
        }
      }

      // Caso 2: Estamos en un elemento
      else if (startContainer.nodeType === Node.ELEMENT_NODE) {
        if (startOffset > 0) {
          const prevChild = startContainer.childNodes[startOffset - 1];

          // Si es un <br>, eliminarlo
          if (prevChild && prevChild.tagName === "BR") {
            prevChild.remove();
            return;
          }

          // Si es un nodo de texto, eliminar su último caracter
          if (prevChild && prevChild.nodeType === Node.TEXT_NODE) {
            const textContent = prevChild.textContent;
            if (textContent.length > 0) {
              prevChild.textContent = textContent.slice(0, -1);

              // Mover cursor al final de ese nodo
              range.setStart(prevChild, prevChild.textContent.length);
              range.collapse(true);
              sel.removeAllRanges();
              sel.addRange(range);
              return;
            }
          }
        }
      }

      // Fallback: si nada funcionó y hay contenido, usar textContent
      const content = focusedEditable.textContent || "";
      if (content.length > 0) {
        // Solo como último recurso
        const newContent = content.slice(0, -1);
        focusedEditable.textContent = newContent;
        placeCursorAtEnd(focusedEditable);
      }
    }
  }

  function getPreviousTextNode(node, rootElement) {
    let current = node;

    // Subir en el árbol hasta encontrar un nodo con hermano anterior
    while (current && current !== rootElement) {
      if (current.previousSibling) {
        current = current.previousSibling;

        // Bajar al nodo más profundo a la derecha
        while (current.lastChild) {
          current = current.lastChild;
        }

        // Si es un nodo de texto, lo encontramos
        if (current.nodeType === Node.TEXT_NODE) {
          return current;
        }
      } else {
        current = current.parentNode;
      }
    }

    return null;
  }

  // Enter behavior
  function performEnter() {
    insertChar("\n");
  }

  // Space
  function performSpace() {
    insertChar(" ");
  }

  // Helper: check if element is editable
  function isEditable(el) {
    if (!el) return false;
    return el.isContentEditable;
  }

  // Key click handler
  function onKeyClick(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    let charToInsert = displayForKey(key);
    if (/^\d+$/.test(key)) {
      charToInsert = key;
    }
    insertChar(charToInsert);
  }

  // Footer buttons
  if (kbdShiftBtn) {
    kbdShiftBtn.addEventListener("click", () => {
      shiftActive = !shiftActive;
      kbdShiftBtn.classList.toggle("active", shiftActive);
      renderKeyboard();
    });
  }
  if (kbdSpace) kbdSpace.addEventListener("click", performSpace);
  if (kbdEnter) kbdEnter.addEventListener("click", performEnter);
  if (kbdBack) kbdBack.addEventListener("click", performBackspace);

  // Toggle keyboard visibility
  if (keyboardToggle) {
    keyboardToggle.addEventListener("click", () => {
      if (!keyboard) return;
      keyboard.classList.toggle("hidden");
      keyboard.setAttribute("aria-hidden", keyboard.classList.contains("hidden") ? "true" : "false");
    });
  }
  if (keyboardClose) keyboardClose.addEventListener("click", () => {
    //  Usar el método de la instancia de DrawingBoard para cerrar manualmente
    const boardInstance = window.__drawingBoardInstance;
    if (boardInstance && typeof boardInstance.closeKeyboardManually === "function") {
      boardInstance.closeKeyboardManually();
    } else {
      // Fallback si no hay instancia
      keyboard.classList.add("hidden");
      keyboard.style.display = "none";
    }
  });

  // Track focus on content editable or inputs so keyboard types there
  document.addEventListener("focusin", (ev) => {
    const tgt = ev.target;
    if (isEditable(tgt)) {
      focusedEditable = tgt;
      window.__keyboardFocusedEditable = tgt; //  Sincronizar
    }
  });

  document.addEventListener("click", (ev) => {
    const tgt = ev.target;
    //  Limpiar focusedEditable solo si hacemos click fuera de elementos editables Y teclado
    if (!isEditable(tgt) && !tgt.closest(".keyboard") && !tgt.closest(".text-element")) {
      focusedEditable = null;
      window.__keyboardFocusedEditable = null; //  Sincronizar
    }
  });

  // Make keyboard draggable via header handle
  (function makeDraggable() {
    if (!kbdDragHandle || !keyboard) return;
    let dragging = false;
    let offsetX = 0, offsetY = 0;
    kbdDragHandle.addEventListener("mousedown", (e) => {
      dragging = true;
      const rect = keyboard.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      keyboard.style.transition = "none";
      document.body.style.userSelect = "none";
    });
    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      let x = e.clientX - offsetX;
      let y = e.clientY - offsetY;
      x = Math.max(8, Math.min(window.innerWidth - keyboard.offsetWidth - 8, x));
      y = Math.max(8, Math.min(window.innerHeight - keyboard.offsetHeight - 8, y));
      keyboard.style.left = x + "px";
      keyboard.style.top = y + "px";
      keyboard.style.right = "auto";
      keyboard.style.bottom = "auto";
      keyboard.style.position = "fixed";
    });
    document.addEventListener("mouseup", () => {
      if (dragging) {
        dragging = false;
        document.body.style.userSelect = "";
        keyboard.style.transition = "";
      }
    });
  })();

  // Inicializar
  renderKeyboard();

  // Expose reference note (ya expuesto arriba)
  // window.__drawingBoardInstance = board; // ya seteado
});