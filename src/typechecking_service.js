/*
 * SPDX-FileCopyrightText: 2026 Jos Verlinde
 * SPDX-License-Identifier: MIT
 */

// Owns the application-wide LSP lifecycle and state independently of editor and device UI.
export class TypecheckingService {
  constructor({
    createLSPClient,
    createLSPPlugin = null,
    configureEditor = null,
    prepareRuntime = null,
    revokeObjectURL = URL.revokeObjectURL.bind(URL),
  }) {
    if (typeof createLSPClient !== 'function') {
      throw new TypeError('TypecheckingService requires createLSPClient')
    }
    this.createLSPClient = createLSPClient
    this.createLSPPlugin = createLSPPlugin
    this.configureEditor = configureEditor
    this.prepareRuntime = prepareRuntime
    this.revokeObjectURL = revokeObjectURL
    this.client = null
    this.transport = null
    this.workerBlobUrl = null
    this.selectedStubBundle = null
    this.documentVersions = new Map()
    this.diagnosticStatus = new Map()
    this.editorBindings = new WeakMap()
    this.status = 'idle'
    this.error = null
    this.initializing = null
    this.generation = 0
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

  async bindEditor(editorView, path) {
    if (this.initializing) {
      await this.initializing
    }
    if (this.status !== 'ready') {
      throw new Error(`TypecheckingService is not ready: ${this.status}`)
    }
    if (!this.createLSPPlugin || !this.configureEditor) {
      throw new Error('TypecheckingService editor integration is not configured')
    }

    const uri = this.uriForPath(path)
    const content = editorView.state.doc.toString()
    this.openDocument(uri)
    const extensions = this.createLSPPlugin(this.client, editorView, {
      fileUri: uri,
      languageId: 'python',
      initialContent: content,
      onDiagnosticsChange: diagnostics => this.setDiagnosticStatus(uri, diagnostics),
    })
    if (!this.configureEditor(editorView, extensions)) {
      this.closeDocument(uri)
      throw new Error(`Editor does not support type checking: ${path}`)
    }
    this.editorBindings.set(editorView, { uri })
    return uri
  }

  uriForPath(path) {
    if (typeof path !== 'string' || !path.trim()) {
      throw new TypeError('Document path is required')
    }
    const relative = path.replace(/^\/+/, '')
    const segments = relative.split('/')
    if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
      throw new TypeError(`Invalid document path: ${path}`)
    }
    return `file:///workspace/${segments.map(encodeURIComponent).join('/')}`
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
    this.diagnosticStatus.set(uri, [...diagnostics])
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
    this.editorBindings = new WeakMap()
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
