/*
 * SPDX-FileCopyrightText: 2026 Jos Verlinde
 * SPDX-License-Identifier: MIT
 */

// Owns the application-wide LSP lifecycle and state independently of editor and device UI.
export class TypecheckingService {
  constructor({ createLSPClient, revokeObjectURL = URL.revokeObjectURL.bind(URL) }) {
    if (typeof createLSPClient !== 'function') {
      throw new TypeError('TypecheckingService requires createLSPClient')
    }
    this.createLSPClient = createLSPClient
    this.revokeObjectURL = revokeObjectURL
    this.client = null
    this.transport = null
    this.workerBlobUrl = null
    this.selectedStubBundle = null
    this.documentVersions = new Map()
    this.diagnosticStatus = new Map()
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
    if (!config?.workerUrl) {
      return Promise.reject(new TypeError('TypecheckingService requires config.workerUrl'))
    }

    // A generation change prevents a late worker handshake from surviving disposal.
    const generation = this.generation
    this.status = 'starting'
    this.error = null
    this.workerBlobUrl = config.workerBlobUrl || null
    this.selectedStubBundle = config.stubBundle || null

    this.initializing = this.createLSPClient(config).then(result => {
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
