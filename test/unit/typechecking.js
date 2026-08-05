/*
 * SPDX-FileCopyrightText: 2026 Jos Verlinde
 * SPDX-License-Identifier: MIT
 */

import { assert } from 'chai'

import { stubTargetForDevice, TypecheckingService } from '../../src/typechecking_service.js'

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
            syncWorkspaceFile() {},
            deleteWorkspaceFile() {},
            close() { this.closeCalls++ },
        },
    }
}

function editor(text = 'print(1)') {
    return { state: { doc: { toString: () => text } } }
}

describe('TypecheckingService', () => {
    it('maps device metadata to the closest available stub target', () => {
        assert.strictEqual(stubTargetForDevice({ machine: 'ESP32 module' }), 'esp32')
        assert.strictEqual(stubTargetForDevice({ machine: 'Raspberry Pi Pico W with RP2040' }), 'rp2')
        assert.strictEqual(stubTargetForDevice({ sysname: 'pyboard', mpy_arch: 'armv7emsp' }), 'stm32')
        assert.strictEqual(stubTargetForDevice({ version: 'CircuitPython 10.2.0' }), 'circuitpython')
        assert.strictEqual(stubTargetForDevice({ machine: 'webassembly' }), 'webassembly')
    })

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
        assert.deepEqual(state.diagnosticStatus.get(uri), [{
            message: 'bad type',
            source: 'Pyright',
        }])

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
        const view = editor()

        const uri = await service.bindEditor(view, '/lib/my file.py')

        assert.strictEqual(uri, 'file:///workspace/lib/my%20file.py')
        assert.strictEqual(pluginOptions.fileUri, uri)
        assert.strictEqual(pluginOptions.initialContent, 'print(1)')
        assert.strictEqual(pluginOptions.diagnosticDelayMs, 750)
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
        const view = editor('')

        assert.throws(() => service.uriForPath('../main.py'), /Invalid document path/)
        let caught
        try {
            await service.bindEditor(view, 'main.py')
        } catch (error) {
            caught = error
        }
        assert.match(caught.message, /does not support type checking/)
    })

    it('changes, renames, and closes bound documents', async () => {
        const result = resources()
        result.transport.synced = []
        result.transport.deleted = []
        result.transport.syncWorkspaceFile = (path, content) =>
            result.transport.synced.push({ path, content })
        result.transport.deleteWorkspaceFile = path => result.transport.deleted.push(path)
        const changes = []
        const closes = []
        const configured = []
        const service = new TypecheckingService({
            createLSPClient: async () => result,
            createLSPPlugin: (_client, _view, options) => [`lsp:${options.fileUri}`],
            configureEditor: (_view, extensions) => {
                configured.push(extensions)
                return true
            },
            notifyDocumentChange: (_client, uri, content, version) =>
                changes.push({ uri, content, version }),
            notifyDocumentClose: (_client, uri) => closes.push(uri),
        })
        await service.initialize({ workerUrl: 'blob:worker' })
        const view = editor('updated')
        await service.bindEditor(view, 'lib/main.py')

        assert.isTrue(service.changeEditor(view, 'changed'))
        service.renamePath('lib', 'src')
        assert.isTrue(service.unbindEditor(view))

        assert.deepEqual(changes, [{
            uri: 'file:///workspace/lib/main.py',
            content: 'changed',
            version: 2,
        }])
        assert.deepEqual(closes, [
            'file:///workspace/lib/main.py',
            'file:///workspace/src/main.py',
        ])
        assert.deepEqual(result.transport.deleted, ['lib/main.py'])
        assert.deepEqual(result.transport.synced, [
            { path: 'lib/main.py', content: 'updated' },
            { path: 'lib/main.py', content: 'changed' },
            { path: 'src/main.py', content: 'updated' },
        ])
        assert.deepEqual(configured.at(-1), [])
    })

    it('deletes known workspace files below a removed directory', async () => {
        const result = resources()
        result.transport.deleted = []
        result.transport.syncWorkspaceFile = () => {}
        result.transport.deleteWorkspaceFile = path => result.transport.deleted.push(path)
        const service = new TypecheckingService({
            createLSPClient: async () => result,
            createLSPPlugin: () => [],
            configureEditor: () => true,
            notifyDocumentClose: () => {},
        })
        await service.initialize({ workerUrl: 'blob:worker' })
        await service.bindEditor(editor(), 'lib/a.py')
        await service.bindEditor(editor(), 'lib/nested/b.py')

        service.removePath('lib', true)

        assert.deepEqual(result.transport.deleted.sort(), ['lib/a.py', 'lib/nested/b.py'])
        assert.strictEqual(service.editorBindings.size, 0)
    })

    it('hydrates only uncached Python workspace files without opening them', async () => {
        const result = resources()
        const synced = []
        result.transport.syncWorkspaceFile = (path, content) => synced.push({ path, content })
        const service = new TypecheckingService({ createLSPClient: async () => result })
        await service.initialize({ workerUrl: 'blob:worker' })

        const first = service.hydrateWorkspace({
            'lib/helper.py': 'answer = 42',
            'README.md': '# ignored',
            'data.py': new Uint8Array([1]),
        })

        const second = service.hydrateWorkspace({ 'lib/helper.py': 'answer = 43' })

        assert.strictEqual(first, 1)
        assert.strictEqual(second, 0)
        assert.deepEqual(synced, [{ path: 'lib/helper.py', content: 'answer = 42' }])
        assert.strictEqual(service.documentVersions.size, 0)
    })

    it('switches changed device stubs and rebinds open editors once', async () => {
        const first = resources()
        first.transport.syncWorkspaceFile = () => {}
        const second = resources()
        second.transport.synced = []
        second.transport.syncWorkspaceFile = (path, content) =>
            second.transport.synced.push({ path, content })
        let switches = 0
        const configured = []
        const service = new TypecheckingService({
            createLSPClient: async () => first,
            prepareRuntime: async config => ({
                workerUrl: 'blob:worker',
                stubBundle: { id: config.boardId || 'stdlib' },
                boardStubs: new ArrayBuffer(1),
            }),
            switchBoard: async () => { switches++; return second },
            createLSPPlugin: (_client, _view, options) => [`lsp:${options.fileUri}`],
            configureEditor: (_view, extensions) => {
                configured.push(extensions)
                return true
            },
        })
        await service.initialize({ boardId: 'stdlib' })
        await service.bindEditor(editor('draft'), 'main.py')

        assert.isTrue(await service.selectDevice({ machine: 'ESP32 module' }))
        assert.isFalse(await service.selectDevice({ machine: 'ESP32 module' }))

        assert.strictEqual(switches, 1)
        assert.strictEqual(service.selectedStubBundle.id, 'esp32')
        assert.deepEqual(second.transport.synced, [{ path: 'main.py', content: 'draft' }])
        assert.strictEqual(service.documentVersions.get('file:///workspace/main.py'), 1)
        assert.deepEqual(configured.at(-1), ['lsp:file:///workspace/main.py'])
    })

    it('waits for a device switch before binding a newly opened editor', async () => {
        const first = resources()
        const replacement = resources()
        const replacementReady = deferred()
        const switchStarted = deferred()
        const synced = []
        first.transport.syncWorkspaceFile = () => {
            if (first.transport.closeCalls) {
                throw new Error('WorkerTransport: not connected')
            }
        }
        replacement.transport.syncWorkspaceFile = (path, content) =>
            synced.push({ path, content })
        const service = new TypecheckingService({
            createLSPClient: async () => first,
            prepareRuntime: async config => ({
                workerUrl: 'blob:worker',
                stubBundle: { id: config.boardId || 'stdlib' },
            }),
            switchBoard: async current => {
                current.transport.close()
                switchStarted.resolve()
                await replacementReady.promise
                return replacement
            },
            createLSPPlugin: () => ['lsp-extension'],
            configureEditor: () => true,
        })
        await service.initialize({ boardId: 'stdlib' })

        const switching = service.selectDevice({ machine: 'ESP32 module' })
        await switchStarted.promise
        const binding = service.bindEditor(editor('opened quickly'), 'fast.py')

        assert.strictEqual(service.status, 'switching')
        assert.deepEqual(synced, [])

        replacementReady.resolve()
        await switching
        const uri = await binding

        assert.strictEqual(service.status, 'ready')
        assert.strictEqual(uri, 'file:///workspace/fast.py')
        assert.deepEqual(synced, [{ path: 'fast.py', content: 'opened quickly' }])
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
