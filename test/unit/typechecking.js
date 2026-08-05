/*
 * SPDX-FileCopyrightText: 2026 Jos Verlinde
 * SPDX-License-Identifier: MIT
 */

import { assert } from 'chai'

import { TypecheckingService } from '../../src/typechecking_service.js'

function deferred() {
    let resolve
    let reject
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise
        reject = rejectPromise
    })
    return { promise, resolve, reject }
}

function resources() {
    return {
        client: {
            disconnectCalls: 0,
            disconnect() { this.disconnectCalls++ },
        },
        transport: {
            closeCalls: 0,
            close() { this.closeCalls++ },
        },
    }
}

describe('TypecheckingService', () => {
    it('initializes one client and reports owned state', async () => {
        const result = resources()
        let calls = 0
        const service = new TypecheckingService({
            createLSPClient: async () => { calls++; return result },
            revokeObjectURL: () => assert.fail('should not revoke before disposal'),
        })

        it('prepares the pinned runtime before creating the client', async () => {
            const result = resources()
            let receivedConfig
            const service = new TypecheckingService({
                prepareRuntime: async config => ({
                    workerUrl: 'blob:worker',
                    workerBlobUrl: 'blob:worker',
                    boardStubs: new ArrayBuffer(1),
                    stubBundle: { id: config.boardId },
                }),
                createLSPClient: async config => {
                    receivedConfig = config
                    return result
                },
            })

            await service.initialize({ boardId: 'esp32', timeout: 1000 })

            assert.strictEqual(receivedConfig.workerUrl, 'blob:worker')
            assert.strictEqual(receivedConfig.timeout, 1000)
            assert.strictEqual(service.selectedStubBundle.id, 'esp32')
        })

        const [first, second] = await Promise.all([
            service.initialize({
                workerUrl: 'blob:worker',
                workerBlobUrl: 'blob:worker',
                stubBundle: 'esp32',
            }),
            service.initialize({ workerUrl: 'ignored' }),
        ])

        assert.strictEqual(calls, 1)
        assert.strictEqual(first.status, 'ready')
        assert.strictEqual(second.client, result.client)
        assert.strictEqual(first.selectedStubBundle, 'esp32')
    })

    it('owns document versions and diagnostic status', () => {
        const service = new TypecheckingService({ createLSPClient: async () => resources() })
        const uri = 'file:///workspace/main.py'

        assert.strictEqual(service.openDocument(uri), 1)
        assert.strictEqual(service.changeDocument(uri), 2)
        service.setDiagnosticStatus(uri, [{ message: 'bad type' }])

        const state = service.snapshot()
        assert.strictEqual(state.documentVersions.get(uri), 2)
        assert.deepEqual(state.diagnosticStatus.get(uri), [{ message: 'bad type' }])

        service.closeDocument(uri)
        assert.isFalse(service.snapshot().documentVersions.has(uri))
        assert.throws(() => service.changeDocument(uri), /not open/)
    })

    it('binds an editor with an encoded workspace URI', async () => {
        const result = resources()
        const configured = []
        let pluginOptions
        const service = new TypecheckingService({
            createLSPClient: async () => result,
            createLSPPlugin: (_client, _view, options) => {
                pluginOptions = options
                return ['lsp-extension']
            },
            configureEditor: (view, extensions) => {
                configured.push({ view, extensions })
                return true
            },
        })
        await service.initialize({ workerUrl: 'blob:worker' })
        const view = { state: { doc: { toString: () => 'print(1)' } } }

        const uri = await service.bindEditor(view, '/lib/my file.py')

        assert.strictEqual(uri, 'file:///workspace/lib/my%20file.py')
        assert.strictEqual(pluginOptions.fileUri, uri)
        assert.strictEqual(pluginOptions.initialContent, 'print(1)')
        assert.deepEqual(configured, [{ view, extensions: ['lsp-extension'] }])
        assert.strictEqual(service.documentVersions.get(uri), 1)
    })

    it('rejects invalid document paths and unsupported editors', async () => {
        const service = new TypecheckingService({
            createLSPClient: async () => resources(),
            createLSPPlugin: () => [],
            configureEditor: () => false,
        })
        await service.initialize({ workerUrl: 'blob:worker' })
        const view = { state: { doc: { toString: () => '' } } }

        assert.throws(() => service.uriForPath('../main.py'), /Invalid document path/)
        let caught
        try {
            await service.bindEditor(view, 'main.py')
        } catch (error) {
            caught = error
        }
        assert.match(caught.message, /does not support type checking/)
    })

    it('validates editor integration configuration', () => {
        const service = new TypecheckingService({ createLSPClient: async () => resources() })

        assert.throws(() => service.setEditorIntegration(null), /editor configurator/)
        assert.doesNotThrow(() => service.setEditorIntegration(() => true))
    })

    it('surfaces initialization errors and releases its Blob URL', async () => {
        const revoked = []
        const failure = new Error('worker failed')
        const service = new TypecheckingService({
            createLSPClient: async () => { throw failure },
            revokeObjectURL: url => revoked.push(url),
        })

        let caught
        try {
            await service.initialize({
                workerUrl: 'blob:failed',
                workerBlobUrl: 'blob:failed',
            })
        } catch (error) {
            caught = error
        }

        assert.strictEqual(caught, failure)
        assert.strictEqual(service.status, 'error')
        assert.strictEqual(service.error, failure)
        assert.deepEqual(revoked, ['blob:failed'])
    })

    it('disconnects resources, clears state, and revokes the Blob URL once', async () => {
        const result = resources()
        const revoked = []
        const service = new TypecheckingService({
            createLSPClient: async () => result,
            revokeObjectURL: url => revoked.push(url),
        })
        await service.initialize({
            workerUrl: 'blob:worker',
            workerBlobUrl: 'blob:worker',
        })
        service.openDocument('file:///workspace/main.py')

        service.dispose()
        service.dispose()

        assert.strictEqual(result.client.disconnectCalls, 1)
        assert.strictEqual(result.transport.closeCalls, 1)
        assert.deepEqual(revoked, ['blob:worker'])
        assert.strictEqual(service.status, 'disposed')
        assert.strictEqual(service.snapshot().documentVersions.size, 0)
    })

    it('closes resources that finish initializing after disposal', async () => {
        const pending = deferred()
        const result = resources()
        const revoked = []
        const service = new TypecheckingService({
            createLSPClient: () => pending.promise,
            revokeObjectURL: url => revoked.push(url),
        })
        const initialization = service.initialize({
            workerUrl: 'blob:worker',
            workerBlobUrl: 'blob:worker',
        })

        // Let runtime preparation enter createLSPClient before simulating teardown.
        await Promise.resolve()
        service.dispose()
        pending.resolve(result)

        let caught
        try {
            await initialization
        } catch (error) {
            caught = error
        }
        assert.match(caught.message, /disposed during initialization/)
        assert.strictEqual(result.client.disconnectCalls, 1)
        assert.strictEqual(result.transport.closeCalls, 1)
        assert.deepEqual(revoked, ['blob:worker'])
    })
})
