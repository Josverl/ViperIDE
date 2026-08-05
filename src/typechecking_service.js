/*
 * SPDX-FileCopyrightText: 2026 Jos Verlinde
 * SPDX-License-Identifier: MIT
 */

const DIAGNOSTIC_DELAY_MS = 750

export function stubTargetForDevice(devInfo = {}) {
  const identity = [
    devInfo.machine,
    devInfo.sysname,
    devInfo.release,
    devInfo.version,
    devInfo.mpy_arch,
  ].filter(Boolean).join(' ').toLowerCase()

  if (identity.includes('circuitpython')) { return 'circuitpython' }
  if (/esp32/.test(identity)) { return 'esp32' }
  if (/rp2|rp2040|rp2350|raspberry pi pico/.test(identity)) { return 'rp2' }
  if (/stm32|pyboard/.test(identity)) { return 'stm32' }
  if (/samd/.test(identity)) { return 'samd' }
  if (/webassembly/.test(identity)) { return 'webassembly' }
  return 'stdlib'
}

// Owns the application-wide LSP lifecycle and state independently of editor and device UI.
export class TypecheckingService {
  constructor({
    createLSPClient,
    createLSPPlugin = null,
    configureEditor = null,
    notifyDocumentChange = null,
    notifyDocumentClose = null,
    switchBoard = null,
    prepareRuntime = null,
    revokeObjectURL = URL.revokeObjectURL.bind(URL),
  }) {
    if (typeof createLSPClient !== 'function') {
      throw new TypeError('TypecheckingService requires createLSPClient')
    }
    this.createLSPClient = createLSPClient
    this.createLSPPlugin = createLSPPlugin
    this.configureEditor = configureEditor
    this.notifyDocumentChange = notifyDocumentChange
    this.notifyDocumentClose = notifyDocumentClose
    this.switchBoard = switchBoard
    this.prepareRuntime = prepareRuntime
    this.revokeObjectURL = revokeObjectURL
    this.client = null
    this.transport = null
    this.workerBlobUrl = null
    this.selectedStubBundle = null
    this.documentVersions = new Map()
    this.diagnosticStatus = new Map()
    this.editorBindings = new Map()
    this.workspacePaths = new Set()
    this.status = 'idle'
    this.error = null
    this.initializing = null
    this.generation = 0
    this.clientConfig = null
    this.switching = null
  }

  initialize(config) {
    if (this.status === 'disposed') {
      return Promise.reject(new Error('TypecheckingService is disposed'))
    }
    if (this.status === 'ready') {
      return Promise.resolve(this.snapshot())
    }
    if (this.initializing) {
      return this.initializing
    }
    // A generation change prevents a late worker handshake from surviving disposal.
    const generation = this.generation
    this.status = 'starting'
    this.error = null

    const prepare = this.prepareRuntime
      ? this.prepareRuntime(config || {})
      : Promise.resolve(config || {})
    this.initializing = prepare.then(runtimeConfig => {
      if (!runtimeConfig.workerUrl) {
        throw new TypeError('TypecheckingService requires config.workerUrl')
      }
      this.workerBlobUrl = runtimeConfig.workerBlobUrl || null
      this.selectedStubBundle = runtimeConfig.stubBundle || null
      this.clientConfig = { ...config, ...runtimeConfig }
      if (generation !== this.generation || this.status === 'disposed') {
        this.releaseWorkerBlob()
        throw new Error('TypecheckingService was disposed during initialization')
      }
      return this.createLSPClient({ ...config, ...runtimeConfig })
    }).then(result => {
      if (generation !== this.generation || this.status === 'disposed') {
        this.closeResult(result)
        throw new Error('TypecheckingService was disposed during initialization')
      }
      this.client = result.client
      this.transport = result.transport
      this.status = 'ready'
      return this.snapshot()
    }).catch(error => {
      if (this.status !== 'disposed') {
        this.status = 'error'
        this.error = error
        this.releaseWorkerBlob()
      }
      throw error
    }).finally(() => {
      this.initializing = null
    })

    return this.initializing
  }

  openDocument(uri) {
    if (!uri) { throw new TypeError('Document URI is required') }
    this.documentVersions.set(uri, 1)
    return 1
  }

  setEditorIntegration(configureEditor) {
    if (typeof configureEditor !== 'function') {
      throw new TypeError('TypecheckingService requires an editor configurator')
    }
    this.configureEditor = configureEditor
  }

  createEditorExtensions(editorView, uri, content) {
    return this.createLSPPlugin(this.client, editorView, {
      fileUri: uri,
      languageId: 'python',
      initialContent: content,
      diagnosticDelayMs: DIAGNOSTIC_DELAY_MS,
      onDiagnosticsChange: diagnostics => this.setDiagnosticStatus(uri, diagnostics),
    })
  }

  async bindEditor(editorView, path) {
    if (this.initializing) {
      await this.initializing
    }
    // A board switch closes the old transport before the replacement is ready.
    if (this.switching) {
      await this.switching
    }
    if (this.status !== 'ready') {
      throw new Error(`TypecheckingService is not ready: ${this.status}`)
    }
    if (!this.createLSPPlugin || !this.configureEditor) {
      throw new Error('TypecheckingService editor integration is not configured')
    }

    const uri = this.uriForPath(path)
    const content = editorView.state.doc.toString()
    const workspacePath = this.workspacePath(path)
    this.transport.syncWorkspaceFile(workspacePath, content)
    this.workspacePaths.add(workspacePath)
    this.openDocument(uri)
    const extensions = this.createEditorExtensions(editorView, uri, content)
    if (!this.configureEditor(editorView, extensions)) {
      this.closeDocument(uri)
      throw new Error(`Editor does not support type checking: ${path}`)
    }
    this.editorBindings.set(editorView, { path, uri })
    return uri
  }

  changeEditor(editorView, content) {
    const binding = this.editorBindings.get(editorView)
    if (!binding || this.status !== 'ready') { return false }
    this.transport.syncWorkspaceFile(this.workspacePath(binding.path), content)
    const version = this.changeDocument(binding.uri)
    this.notifyDocumentChange(this.client, binding.uri, content, version)
    return true
  }

  unbindEditor(editorView) {
    const binding = this.editorBindings.get(editorView)
    if (!binding) { return false }
    if (this.status === 'ready') {
      this.notifyDocumentClose(this.client, binding.uri)
      this.configureEditor(editorView, [])
    }
    this.closeDocument(binding.uri)
    this.editorBindings.delete(editorView)
    return true
  }

  renamePath(oldPath, newPath) {
    if (this.status !== 'ready') { return }
    for (const [editorView, binding] of this.editorBindings) {
      const renamed = binding.path === oldPath
        ? newPath
        : binding.path.startsWith(`${oldPath}/`)
          ? newPath + binding.path.slice(oldPath.length)
          : null
      if (!renamed) { continue }

      const content = editorView.state.doc.toString()
      this.notifyDocumentClose(this.client, binding.uri)
      const oldWorkspacePath = this.workspacePath(binding.path)
      this.transport.deleteWorkspaceFile(oldWorkspacePath)
      this.workspacePaths.delete(oldWorkspacePath)
      this.closeDocument(binding.uri)

      const uri = this.uriForPath(renamed)
      const newWorkspacePath = this.workspacePath(renamed)
      this.transport.syncWorkspaceFile(newWorkspacePath, content)
      this.workspacePaths.add(newWorkspacePath)
      this.openDocument(uri)
      const extensions = this.createEditorExtensions(editorView, uri, content)
      this.configureEditor(editorView, extensions)
      this.editorBindings.set(editorView, { path: renamed, uri })
    }
  }

  removePath(path, recursive = false) {
    for (const [editorView, binding] of [...this.editorBindings]) {
      if (binding.path === path || (recursive && binding.path.startsWith(`${path}/`))) {
        this.unbindEditor(editorView)
      }
    }

    if (this.status !== 'ready') { return }
    const target = this.workspacePath(path)
    let deleted = false
    for (const workspacePath of [...this.workspacePaths]) {
      if (workspacePath === target || (recursive && workspacePath.startsWith(`${target}/`))) {
        this.transport.deleteWorkspaceFile(workspacePath)
        this.workspacePaths.delete(workspacePath)
        deleted = true
      }
    }
    if (!recursive && !deleted) {
      // A removed file may not have been opened during this session.
      this.transport.deleteWorkspaceFile(target)
    }
  }

  hydrateWorkspace(files) {
    if (this.status !== 'ready') { return 0 }
    let hydrated = 0
    for (const [path, content] of Object.entries(files)) {
      if (!path.endsWith('.py') || typeof content !== 'string') { continue }
      const workspacePath = this.workspacePath(path)
      if (this.workspacePaths.has(workspacePath)) { continue }
      this.transport.syncWorkspaceFile(workspacePath, content)
      this.workspacePaths.add(workspacePath)
      hydrated++
    }
    return hydrated
  }

  async selectDevice(devInfo) {
    if (this.initializing) { await this.initializing }
    const boardId = stubTargetForDevice(devInfo)
    if (this.selectedStubBundle?.id === boardId) { return false }
    if (this.switching) { return this.switching }
    if (this.status !== 'ready' || !this.switchBoard || !this.prepareRuntime) {
      throw new Error('TypecheckingService cannot switch stub bundles')
    }

    // Block transport users while switchBoard replaces the connected worker.
    this.status = 'switching'
    this.switching = this.prepareRuntime({ ...this.clientConfig, boardId }).
      then(async runtimeConfig => ({
        result: await this.switchBoard(
          { client: this.client, transport: this.transport },
          { ...this.clientConfig, ...runtimeConfig },
        ),
        runtimeConfig,
      })).
      then(({ result, runtimeConfig }) => {
        this.client = result.client
        this.transport = result.transport
        this.selectedStubBundle = runtimeConfig.stubBundle
        this.clientConfig = { ...this.clientConfig, ...runtimeConfig, boardId }
        this.rebindEditors()
        this.status = 'ready'
        return true
      }).
      catch(error => {
        this.status = 'error'
        this.error = error
        throw error
      }).
      finally(() => {
        this.switching = null
      })
    return this.switching
  }

  rebindEditors() {
    this.documentVersions.clear()
    this.diagnosticStatus.clear()
    this.workspacePaths.clear()
    for (const [editorView, binding] of this.editorBindings) {
      const content = editorView.state.doc.toString()
      const workspacePath = this.workspacePath(binding.path)
      this.transport.syncWorkspaceFile(workspacePath, content)
      this.workspacePaths.add(workspacePath)
      this.openDocument(binding.uri)
      const extensions = this.createEditorExtensions(editorView, binding.uri, content)
      this.configureEditor(editorView, extensions)
    }
  }

  uriForPath(path) {
    return `file:///workspace/${this.workspacePath(path).split('/').map(encodeURIComponent).join('/')}`
  }

  workspacePath(path) {
    if (typeof path !== 'string' || !path.trim()) {
      throw new TypeError('Document path is required')
    }
    const relative = path.replace(/^\/+/, '')
    const segments = relative.split('/')
    if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
      throw new TypeError(`Invalid document path: ${path}`)
    }
    return segments.join('/')
  }

  changeDocument(uri) {
    const version = this.documentVersions.get(uri)
    if (version === undefined) {
      throw new Error(`Document is not open: ${uri}`)
    }
    const next = version + 1
    this.documentVersions.set(uri, next)
    return next
  }

  closeDocument(uri) {
    this.documentVersions.delete(uri)
    this.diagnosticStatus.delete(uri)
  }

  setDiagnosticStatus(uri, diagnostics) {
    if (!this.documentVersions.has(uri)) {
      throw new Error(`Document is not open: ${uri}`)
    }
    // Status consumers receive the same producer label shown in CodeMirror's lint UI.
    this.diagnosticStatus.set(uri, diagnostics.map(diagnostic => ({
      ...diagnostic,
      source: diagnostic.source || 'Pyright',
    })))
  }

  snapshot() {
    // Return new maps so status consumers cannot mutate service-owned state.
    return {
      status: this.status,
      error: this.error,
      client: this.client,
      transport: this.transport,
      selectedStubBundle: this.selectedStubBundle,
      documentVersions: new Map(this.documentVersions),
      diagnosticStatus: new Map(this.diagnosticStatus),
    }
  }

  dispose() {
    if (this.status === 'disposed') { return }
    this.generation++
    this.status = 'disposed'
    this.closeResult({ client: this.client, transport: this.transport })
    this.client = null
    this.transport = null
    this.documentVersions.clear()
    this.diagnosticStatus.clear()
    this.editorBindings.clear()
    this.workspacePaths.clear()
    this.releaseWorkerBlob()
  }

  closeResult({ client, transport } = {}) {
    client?.disconnect()
    transport?.close()
  }

  releaseWorkerBlob() {
    if (!this.workerBlobUrl) { return }
    this.revokeObjectURL(this.workerBlobUrl)
    this.workerBlobUrl = null
  }
}
