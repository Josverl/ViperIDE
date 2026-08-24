/*
 * SPDX-FileCopyrightText: 2026 Jos Verlinde
 * SPDX-License-Identifier: MIT
 */

const PACKAGE_BASE = new URL(
  'assets/pyright-worker/',
  globalThis.document?.baseURI || 'http://localhost:10001/',
).href

/**
 * Load worker metadata from the npm package assets copied into the ViperIDE build.
 */
export class TypecheckingAssets {
  /**
   * @param {object} [dependencies={}] Browser API overrides for tests or custom hosts.
   * @param {typeof fetch} [dependencies.fetch] Fetch implementation.
   * @param {string} [dependencies.packageBase] Public URL of the copied worker package.
   */
  constructor({
    // Browser fetch implementations may require their global object as the receiver.
    fetch: fetchAsset = globalThis.fetch?.bind(globalThis),
    packageBase = PACKAGE_BASE,
  } = {}) {
    if (typeof fetchAsset !== 'function') {
      throw new TypeError('TypecheckingAssets requires fetch')
    }
    this.fetchAsset = fetchAsset
    this.packageBase = packageBase.endsWith('/') ? packageBase : `${packageBase}/`
    this.manifestPromise = null
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
    const board = manifest.boards.find(item => item.id === selectedId) ||
      (config.boardStubPackage && manifest.boards.find(item => item.id === manifest.default))
    if (!board) {
      throw new Error(`Unknown type-checking stub bundle: ${selectedId}`)
    }

    return {
      workerUrl: `${this.packageBase}dist/pyright_worker.js`,
      boardStubs: board.file ? undefined : false,
      ...(board.file ? { boardStubsUrl: `${this.packageBase}assets/${board.file}` } : {}),
      ...(config.boardStubPackage || (board.file && board.package)
        ? {
            boardStubPackage: config.boardStubPackage || {
                packageName: board.package,
                fallbackToBundled: true,
              },
          }
        : {}),
      stubBundle: Object.freeze({ ...board, id: selectedId }),
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
      this.manifestPromise = this.fetchAsset(`${this.packageBase}assets/stubs-manifest.json`).
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
}

export const typecheckingAssets = new TypecheckingAssets()
