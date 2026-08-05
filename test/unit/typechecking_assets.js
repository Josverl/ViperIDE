/*
 * SPDX-FileCopyrightText: 2026 Jos Verlinde
 * SPDX-License-Identifier: MIT
 */

import { assert } from 'chai'

import { TypecheckingAssets } from '../../src/typechecking_assets.js'

const manifest = {
    default: 'esp32',
    boards: [
        { id: 'esp32', file: 'stubs-esp32.zip', package: 'esp32-stubs' },
        { id: 'cpython', file: null, package: 'No Stubs' },
    ],
}

function response({ json, bytes, status = 200 }) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => json,
        arrayBuffer: async () => bytes,
    }
}

async function rejects(promise, match) {
    let error
    try {
        await promise
    } catch (caught) {
        error = caught
    }
    assert.instanceOf(error, Error, 'expected promise to reject')
    assert.match(error.message, match)
}

describe('TypecheckingAssets', () => {
    it('binds the default browser fetch implementation to the global object', async () => {
        const originalFetch = globalThis.fetch
        globalThis.fetch = async function(url) {
            assert.strictEqual(this, globalThis)
            assert.match(url, /stubs-manifest\.json$/)
            return response({ json: manifest })
        }

        try {
            const assets = new TypecheckingAssets()
            assert.strictEqual(await assets.loadManifest(), manifest)
        } finally {
            globalThis.fetch = originalFetch
        }
    })

    it('loads the manifest and selected stubs from the pinned tag', async () => {
        const requests = []
        const stubs = new Uint8Array([1, 2, 3]).buffer
        const assets = new TypecheckingAssets({
            fetch: async url => {
                requests.push(url)
                return url.endsWith('stubs-manifest.json')
                    ? response({ json: manifest })
                    : response({ bytes: stubs })
            },
            Blob: class FakeBlob {
                constructor(parts, options) {
                    this.parts = parts
                    this.type = options.type
                }
            },
            createObjectURL: blob => {
                assert.include(blob.parts[0], 'pyright-worker-v0.2.1')
                return 'blob:worker'
            },
        })

        const runtime = await assets.prepare()

        assert.strictEqual(runtime.workerUrl, 'blob:worker')
        assert.strictEqual(runtime.workerBlobUrl, 'blob:worker')
        assert.strictEqual(runtime.boardStubs, stubs)
        assert.strictEqual(runtime.stubBundle.id, 'esp32')
        assert.lengthOf(requests, 2)
        assert.match(requests[0], /pyright-worker-v0\.2\.1.*stubs-manifest\.json$/)
        assert.match(requests[1], /pyright-worker-v0\.2\.1.*stubs-esp32\.zip$/)
    })

    it('creates one worker Blob URL and caches immutable assets', async () => {
        let fetchCalls = 0
        let blobUrls = 0
        const assets = new TypecheckingAssets({
            fetch: async url => {
                fetchCalls++
                return url.endsWith('stubs-manifest.json')
                    ? response({ json: manifest })
                    : response({ bytes: new ArrayBuffer(1) })
            },
            createObjectURL: () => `blob:worker-${++blobUrls}`,
        })

        const first = await assets.prepare('esp32')
        const second = await assets.prepare('esp32')

        assert.strictEqual(first.workerUrl, second.workerUrl)
        assert.strictEqual(blobUrls, 1)
        assert.strictEqual(fetchCalls, 2)
    })

    it('uses false for a manifest entry without a stub archive', async () => {
        const assets = new TypecheckingAssets({
            fetch: async () => response({ json: manifest }),
            createObjectURL: () => 'blob:worker',
        })

        const runtime = await assets.prepare('cpython')

        assert.isFalse(runtime.boardStubs)
        assert.strictEqual(runtime.stubBundle.id, 'cpython')
    })

    it('reports unknown boards and failed asset responses', async () => {
        const assets = new TypecheckingAssets({
            fetch: async () => response({ json: manifest }),
        })
        await rejects(assets.prepare('unknown'), /Unknown type-checking stub bundle/)

        const failed = new TypecheckingAssets({
            fetch: async () => response({ status: 503 }),
        })
        await rejects(failed.prepare(), /stub manifest: HTTP 503/)
    })
})
