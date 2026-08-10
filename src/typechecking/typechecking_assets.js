/*
 * SPDX-FileCopyrightText: 2026 Jos Verlinde
 * SPDX-License-Identifier: MIT
 */

const WORKER_TAG = 'pyright-worker-v0.2.6'
const CDN_ROOT = `https://cdn.jsdelivr.net/gh/Josverl/stubs_playground@${WORKER_TAG}/`
const WORKER_URL = `${CDN_ROOT}packages/pyright-worker/dist/pyright_worker.js`
const ASSETS_BASE = `${CDN_ROOT}packages/pyright-worker/assets`

/**
 * Load immutable worker metadata and create the same-origin Blob shim required
 * to start a cross-origin CDN worker.
 */
export class TypecheckingAssets {
  /**
   * @param {object} [dependencies={}] Browser API overrides for tests or custom hosts.
   * @param {typeof fetch} [dependencies.fetch] Fetch implementation.
   * @param {typeof Blob} [dependencies.Blob] Blob constructor.
   * @param {(blob: Blob) => string} [dependencies.createObjectURL] Object URL factory.
   */
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

  /**
   * Resolve a board ID to the reusable client's runtime configuration.
   *
   * @param {string|{boardId?: string}} [config={}] Requested board or configuration.
   * @returns {Promise<object>} Worker URL, board package/fallback, and manifest entry.
   */
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

  /**
   * Load and memoize the worker stub manifest.
   *
   * Failed loads are not cached and may be retried.
   *
   * @returns {Promise<{default: string, boards: object[]}>} Stub manifest.
   */
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

  /**
   * Return one memoized same-origin Blob URL that imports the immutable CDN worker.
   *
   * @returns {string} Worker Blob URL.
   */
  getWorkerBlobUrl() {
    if (!this.workerBlobUrl) {
      const shim = `importScripts(${JSON.stringify(WORKER_URL)});`
      const blob = new this.BlobClass([shim], { type: 'application/javascript' })
      this.workerBlobUrl = this.createObjectURL(blob)
    }
    return this.workerBlobUrl
  }

  /**
   * Forget a released URL so a later initialization creates a fresh Blob URL.
   *
   * The caller remains responsible for calling `URL.revokeObjectURL`.
   *
   * @param {string} url Released object URL.
   * @returns {void}
   */
  releaseWorkerBlobUrl(url) {
    if (this.workerBlobUrl === url) {
      this.workerBlobUrl = null
    }
  }
}

export const typecheckingAssets = new TypecheckingAssets()
