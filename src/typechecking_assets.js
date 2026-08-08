/*
 * SPDX-FileCopyrightText: 2026 Jos Verlinde
 * SPDX-License-Identifier: MIT
 */

const WORKER_TAG = 'pyright-worker-v0.2.4'
const CDN_ROOT = `https://cdn.jsdelivr.net/gh/Josverl/stubs_playground@${WORKER_TAG}/`
const WORKER_URL = `${CDN_ROOT}packages/pyright-worker/dist/pyright_worker.js`
const ASSETS_BASE = `${CDN_ROOT}packages/pyright-worker/assets`

// Loads immutable worker assets and creates the same-origin Blob shim required by Worker.
export class TypecheckingAssets {
  constructor({
    // Browser fetch implementations may require their global object as the receiver.
    fetch: fetchAsset = globalThis.fetch?.bind(globalThis),
    Blob: BlobClass = globalThis.Blob,
    createObjectURL = URL.createObjectURL.bind(URL),
  } = {}) {
    if (typeof fetchAsset !== 'function') {
      throw new TypeError('TypecheckingAssets requires fetch')
    }
    this.fetchAsset = fetchAsset
    this.BlobClass = BlobClass
    this.createObjectURL = createObjectURL
    this.manifestPromise = null
    this.workerBlobUrl = null
  }

  async prepare(config = {}) {
    const manifest = await this.loadManifest()
    const boardId = typeof config === 'string' ? config : config.boardId
    const selectedId = boardId || manifest.default
    const board = manifest.boards.find(item => item.id === selectedId)
    if (!board) {
      throw new Error(`Unknown type-checking stub bundle: ${selectedId}`)
    }

    return {
      workerUrl: this.getWorkerBlobUrl(),
      workerBlobUrl: this.workerBlobUrl,
      boardStubs: board.file ? undefined : false,
      ...(board.file ? { boardStubsUrl: `${ASSETS_BASE}/${board.file}` } : {}),
      ...(board.file && board.package
        ? {
            boardStubPackage: {
              packageName: board.package,
              fallbackToBundled: true,
            },
          }
        : {}),
      stubBundle: Object.freeze({ ...board }),
    }
  }

  loadManifest() {
    if (!this.manifestPromise) {
      this.manifestPromise = this.fetchAsset(`${ASSETS_BASE}/stubs-manifest.json`).
        then(response => this.requireResponse(response, 'stub manifest')).
        then(response => response.json()).
        then(manifest => {
          if (!manifest?.default || !Array.isArray(manifest.boards)) {
            throw new Error('Type-checking stub manifest is invalid')
          }
          return manifest
        }).
        catch(error => {
          // A failed request may be retried when initialization is attempted again.
          this.manifestPromise = null
          throw error
        })
    }
    return this.manifestPromise
  }

  requireResponse(response, description) {
    if (!response.ok) {
      throw new Error(`Failed to load type-checking ${description}: HTTP ${response.status}`)
    }
    return response
  }

  getWorkerBlobUrl() {
    if (!this.workerBlobUrl) {
      const shim = `importScripts(${JSON.stringify(WORKER_URL)});`
      const blob = new this.BlobClass([shim], { type: 'application/javascript' })
      this.workerBlobUrl = this.createObjectURL(blob)
    }
    return this.workerBlobUrl
  }

  releaseWorkerBlobUrl(url) {
    if (this.workerBlobUrl === url) {
      this.workerBlobUrl = null
    }
  }
}

export const typecheckingAssets = new TypecheckingAssets()
