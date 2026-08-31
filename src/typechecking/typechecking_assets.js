/*
 * SPDX-FileCopyrightText: 2026 Jos Verlinde
 * SPDX-License-Identifier: MIT
 */

const PACKAGE_BASE = new URL(
  'assets/pyright-worker/',
  globalThis.document?.baseURI || 'http://localhost:10001/',
).href

/** Runtime manifest URL derived from the deployed copied worker assets. */
const DEFAULT_RUNTIME_MANIFEST_URL = `${PACKAGE_BASE}assets/runtime-manifest.json`

/** Origin of the deployed assets, permitted for manifest and runtime asset fetches. */
const DEFAULT_RUNTIME_ALLOWED_ORIGINS = [new URL(PACKAGE_BASE).origin]

/** Cache Storage namespace for last-known-good runtime selection. */
const DEFAULT_RUNTIME_CACHE_NAME = 'viperide-pyright-runtime'

/** localStorage key for last-known-good runtime metadata. */
const DEFAULT_RUNTIME_STORAGE_KEY = 'viperide-pyright-runtime-lkg'

/**
 * Load worker metadata from the npm package assets copied into the ViperIDE build.
 *
 * When a `runtimeManifestUrl` is configured the reusable client selects a
 * compatible immutable runtime at startup.  The copied npm worker URL is
 * always supplied as the bundled fallback so ViperIDE works offline and
 * when no compatible runtime is available.
 */
export class TypecheckingAssets {
  /**
   * @param {object} [dependencies={}] Browser API overrides for tests or custom hosts.
   * @param {typeof fetch} [dependencies.fetch] Fetch implementation.
   * @param {string} [dependencies.packageBase] Public URL of the copied worker package.
   * @param {string} [dependencies.runtimeManifestUrl] Runtime manifest URL for dynamic selection.
   *   Defaults to the deployed `assets/runtime-manifest.json` relative to `packageBase`.
   *   Pass `null` to disable manifest loading (bundled-only mode).
   * @param {string[]} [dependencies.runtimeAllowedOrigins] Permitted origins for manifest/assets.
   *   Defaults to the `packageBase` origin.
   * @param {string} [dependencies.runtimeCacheName] Cache Storage namespace.
   * @param {string} [dependencies.runtimeStorageKey] localStorage last-known-good key.
   */
  constructor({
    // Browser fetch implementations may require their global object as the receiver.
    fetch: fetchAsset = globalThis.fetch?.bind(globalThis),
    packageBase = PACKAGE_BASE,
    runtimeManifestUrl = DEFAULT_RUNTIME_MANIFEST_URL,
    runtimeAllowedOrigins = DEFAULT_RUNTIME_ALLOWED_ORIGINS,
    runtimeCacheName = DEFAULT_RUNTIME_CACHE_NAME,
    runtimeStorageKey = DEFAULT_RUNTIME_STORAGE_KEY,
  } = {}) {
    if (typeof fetchAsset !== 'function') {
      throw new TypeError('TypecheckingAssets requires fetch')
    }
    this.fetchAsset = fetchAsset
    this.packageBase = packageBase.endsWith('/') ? packageBase : `${packageBase}/`
    this.manifestPromise = null
    this.runtimeManifestUrl = runtimeManifestUrl || null
    this.runtimeAllowedOrigins = runtimeAllowedOrigins || null
    this.runtimeCacheName = runtimeCacheName
    this.runtimeStorageKey = runtimeStorageKey
  }

  /**
   * Resolve a board ID to the reusable client's runtime configuration.
   *
   * The returned config includes `workerUrl` (the bundled fallback) and,
   * when a runtime manifest URL is configured, the `runtimeManifestUrl`,
   * `runtimeAllowedOrigins`, `runtimeCacheName`, and `runtimeStorageKey`
   * fields that `createLSPClient` uses to select a compatible immutable
   * runtime without an app rebuild.
   *
   * @param {string|{boardId?: string}} [config={}] Requested board or configuration.
   * @returns {Promise<object>} Worker URL, runtime options, board package/fallback, and manifest entry.
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
      ...this.runtimeOptions(),
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
   * Build the runtime manifest options passed through to `createLSPClient`.
   *
   * Returns an empty object when no manifest URL is configured, preserving
   * the bundled-only startup path.
   *
   * @returns {object} Runtime manifest options or `{}`.
   */
  runtimeOptions() {
    if (!this.runtimeManifestUrl) { return {} }
    return {
      runtimeManifestUrl: this.runtimeManifestUrl,
      ...(this.runtimeAllowedOrigins
        ? { runtimeAllowedOrigins: this.runtimeAllowedOrigins }
        : {}),
      runtimeCacheName: this.runtimeCacheName,
      runtimeStorageKey: this.runtimeStorageKey,
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
