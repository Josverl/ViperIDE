/*
 * SPDX-FileCopyrightText: 2026 Jos Verlinde
 * SPDX-License-Identifier: MIT
 */

import { assert } from 'chai'

import { TypecheckingAssets } from '../../../src/typechecking/typechecking_assets.js'

const manifest = {
    default: 'test-board',
    boards: [
        { id: 'test-board', file: 'stubs-test-board.zip', package: 'test-board-stubs' },
        { id: 'no-stubs', file: null, package: 'No Stubs' },
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

    it('loads the manifest and defers the selected fallback archive to the worker', async () => {
        const requests = []
        const assets = new TypecheckingAssets({
            packageBase: 'https://example.test/assets/pyright-worker/',
            fetch: async url => {
                requests.push(url)
                return response({ json: manifest })
            },
        })

        const runtime = await assets.prepare()

        assert.strictEqual(
            runtime.workerUrl,
            'https://example.test/assets/pyright-worker/dist/pyright_worker.js',
        )
        assert.isUndefined(runtime.boardStubs)
        assert.strictEqual(
            runtime.boardStubsUrl,
            'https://example.test/assets/pyright-worker/assets/stubs-test-board.zip',
        )
        assert.deepEqual(runtime.boardStubPackage, {
            packageName: 'test-board-stubs',
            fallbackToBundled: true,
        })
        assert.strictEqual(runtime.stubBundle.id, 'test-board')
        assert.lengthOf(requests, 1)
        assert.strictEqual(
            requests[0],
            'https://example.test/assets/pyright-worker/assets/stubs-manifest.json',
        )
    })

    it('uses one same-origin worker URL and caches package metadata', async () => {
        let fetchCalls = 0
        const assets = new TypecheckingAssets({
            fetch: async url => {
                fetchCalls++
                return url.endsWith('stubs-manifest.json')
                    ? response({ json: manifest })
                    : response({ bytes: new ArrayBuffer(1) })
            },
        })

        const first = await assets.prepare('test-board')
        const second = await assets.prepare('test-board')

        assert.strictEqual(first.workerUrl, second.workerUrl)
        assert.match(first.workerUrl, /assets\/pyright-worker\/dist\/pyright_worker\.js$/)
        assert.strictEqual(fetchCalls, 1)
    })

    it('uses false for a manifest entry without a stub archive', async () => {
        const assets = new TypecheckingAssets({
            fetch: async () => response({ json: manifest }),
        })

        const runtime = await assets.prepare('no-stubs')

        assert.isFalse(runtime.boardStubs)
        assert.strictEqual(runtime.stubBundle.id, 'no-stubs')
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
