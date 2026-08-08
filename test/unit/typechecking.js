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
            notify() {},
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
    it('uses MicroPython sys.platform as the authoritative stub target', () => {
        assert.strictEqual(stubTargetForDevice({
            platform: 'rp2',
            machine: 'Raspberry Pi Pico2 with RP2350',
        }), 'rp2')
        assert.strictEqual(stubTargetForDevice({
            platform: 'rp2',
            machine: 'misleading ESP32 description',
        }), 'rp2')
        assert.strictEqual(stubTargetForDevice({ platform: ' ESP32 ' }), 'esp32')
        assert.strictEqual(stubTargetForDevice({ platform: 'stm32' }), 'stm32')
        assert.strictEqual(stubTargetForDevice({ platform: 'samd' }), 'samd')
        assert.strictEqual(stubTargetForDevice({ platform: 'webassembly' }), 'webassembly')
        assert.isUndefined(stubTargetForDevice({
            platform: 'linux',
            machine: 'misleading ESP32 description',
        }))
    })

    it('detects CircuitPython but does not guess MicroPython ports from descriptive metadata', () => {
        assert.strictEqual(stubTargetForDevice({
            platform: 'rp2',
            version: 'CircuitPython 10.2.0',
        }), 'circuitpython')
        assert.isUndefined(stubTargetForDevice({ machine: 'ESP32 module' }))
        assert.isUndefined(stubTargetForDevice({ machine: 'Raspberry Pi Pico W with RP2040' }))
        assert.isUndefined(stubTargetForDevice({ sysname: 'pyboard', mpy_arch: 'armv7emsp' }))
        assert.isUndefined(stubTargetForDevice({ machine: 'webassembly' }))
    })

    it('initializes one client and reports owned state', async () => {
        const result = resources()
        let calls = 0
        const service = new TypecheckingService({
            createLSPClient: async () => { calls++; return result },
            revokeObjectURL: () => assert.fail('should not revoke before disposal'),
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

    it('prepares the runtime and collects diagnostics from unopened workspace files', async () => {
        const result = resources()
        const subscription = {
            destroyCalls: 0,
            destroy() { this.destroyCalls++ },
        }
        result.workspaceDiagnosticsSubscription = subscription
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

        await service.initialize({
            boardId: 'esp32',
            timeout: 1000,
            diagnosticMode: 'workspace',
        })
        receivedConfig.onWorkspaceDiagnosticsChange([{
            uri: 'file:///workspace/lib/unopened.py',
            fileName: 'lib/unopened.py',
            line: 2,
            character: 3,
            severity: 'error',
            message: 'Bad type',
            source: 'Pyright',
        }])

        assert.strictEqual(receivedConfig.workerUrl, 'blob:worker')
        assert.strictEqual(receivedConfig.timeout, 1000)
        assert.strictEqual(receivedConfig.diagnosticMode, 'workspace')
        assert.strictEqual(service.selectedStubBundle.id, 'esp32')
        assert.deepEqual(
            service.snapshot().diagnosticStatus.get('file:///workspace/lib/unopened.py'),
            [{
                uri: 'file:///workspace/lib/unopened.py',
                fileName: 'lib/unopened.py',
                line: 2,
                character: 3,
                severity: 'error',
                message: 'Bad type',
                source: 'Pyright',
            }],
        )
        service.dispose()
        assert.strictEqual(subscription.destroyCalls, 1)
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
        const notifications = []
        result.client.notify = (method, params) => notifications.push({ method, params })
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
        assert.strictEqual(pluginOptions.diagnosticDelayMs, 300)
        assert.deepEqual(configured, [{ view, extensions: ['lsp-extension'] }])
        assert.strictEqual(service.documentVersions.get(uri), 1)
        assert.deepEqual(notifications, [{
            method: 'workspace/didChangeWatchedFiles',
            params: {
                changes: [{ uri, type: 1 }],
            },
        }])
    })

    it('registers editors before startup and binds them when initialization completes', async () => {
        const result = resources()
        const configured = []
        const service = new TypecheckingService({
            createLSPClient: async () => result,
            createLSPPlugin: (_client, _view, options) => [`lsp:${options.fileUri}`],
            configureEditor: (_view, extensions) => {
                configured.push(extensions)
                return true
            },
        })
        const view = editor('draft')

        const uri = await service.bindEditor(view, 'main.py')
        await service.initialize({ workerUrl: 'blob:worker' })

        assert.strictEqual(uri, 'file:///workspace/main.py')
        assert.deepEqual(configured, [['lsp:file:///workspace/main.py']])
        assert.strictEqual(service.documentVersions.get(uri), 1)
    })

    it('disables and re-enables type checking without losing editor bindings', async () => {
        const first = resources()
        const second = resources()
        const results = [first, second]
        const configured = []
        const states = []
        const closes = []
        const service = new TypecheckingService({
            createLSPClient: async () => results.shift(),
            createLSPPlugin: (_client, _view, options) => [`lsp:${options.fileUri}`],
            configureEditor: (_view, extensions) => {
                configured.push(extensions)
                return true
            },
            notifyDocumentClose: (_client, uri) => closes.push(uri),
        })
        service.onStatusChange(state => states.push(state.status))
        await service.initialize({ workerUrl: 'blob:first' })
        const view = editor('draft')
        await service.bindEditor(view, 'main.py')
        service.replaceWorkspace({ 'cached.py': 'cached = True' })

        assert.isTrue(service.disable())
        assert.strictEqual(service.status, 'disabled')
        assert.strictEqual(service.editorBindings.size, 1)
        assert.strictEqual(service.documentVersions.size, 0)
        assert.strictEqual(service.workspaceFiles.get('cached.py'), 'cached = True')
        assert.deepEqual(configured.at(-1), [])
        assert.deepEqual(closes, ['file:///workspace/main.py'])
        assert.strictEqual(first.client.disconnectCalls, 1)
        assert.strictEqual(first.transport.closeCalls, 1)

        await service.initialize({ workerUrl: 'blob:second' })

        assert.strictEqual(service.status, 'ready')
        assert.strictEqual(service.documentVersions.get('file:///workspace/main.py'), 1)
        assert.deepEqual(configured.at(-1), ['lsp:file:///workspace/main.py'])
        assert.includeMembers(states, ['starting', 'ready', 'disabled'])
    })

    it('closes a failed runtime when a registered editor cannot be rebound', async () => {
        const result = resources()
        const service = new TypecheckingService({
            createLSPClient: async () => result,
            createLSPPlugin: () => ['lsp-extension'],
            configureEditor: () => false,
        })
        const view = editor('draft')
        await service.bindEditor(view, 'main.py')

        let caught
        try {
            await service.initialize({ workerUrl: 'blob:worker' })
        } catch (error) {
            caught = error
        }

        assert.match(caught.message, /do not support type checking: main.py/)
        assert.strictEqual(service.status, 'error')
        assert.strictEqual(service.client, null)
        assert.strictEqual(service.transport, null)
        assert.strictEqual(service.editorBindings.size, 0)
        assert.strictEqual(service.documentVersions.size, 0)
        assert.strictEqual(result.client.disconnectCalls, 1)
        assert.strictEqual(result.transport.closeCalls, 1)
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
            { path: 'src/main.py', content: 'changed' },
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

    it('hydrates new and changed Python workspace files without opening them', async () => {
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
        assert.strictEqual(second, 1)
        assert.deepEqual(synced, [
            { path: 'lib/helper.py', content: 'answer = 42' },
            { path: 'lib/helper.py', content: 'answer = 43' },
        ])
        assert.strictEqual(service.documentVersions.size, 0)
    })

    it('queues workspace files before initialization and replays them once ready', async () => {
        const result = resources()
        const synced = []
        result.transport.syncWorkspaceFile = (path, content) => synced.push({ path, content })
        const service = new TypecheckingService({ createLSPClient: async () => result })

        assert.deepEqual(service.replaceWorkspace({
            'main.py': 'from foo import foofoo',
            'foo.py': 'def foofoo(x: str): return 2 * x',
        }), { synced: 2, deleted: 0, total: 2 })
        await service.initialize({ workerUrl: 'blob:worker' })

        assert.deepEqual(synced, [
            { path: 'main.py', content: 'from foo import foofoo' },
            { path: 'foo.py', content: 'def foofoo(x: str): return 2 * x' },
        ])
    })

    it('replaces changed and removed device files while preserving open drafts', async () => {
        const result = resources()
        const synced = []
        const deleted = []
        const notifications = []
        result.transport.syncWorkspaceFile = (path, content) => synced.push({ path, content })
        result.transport.deleteWorkspaceFile = path => deleted.push(path)
        result.client.notify = (method, params) => notifications.push({ method, params })
        const service = new TypecheckingService({
            createLSPClient: async () => result,
            createLSPPlugin: () => [],
            configureEditor: () => true,
        })
        await service.initialize({ workerUrl: 'blob:worker' })
        service.replaceWorkspace({
            'main.py': 'device version',
            'foo.py': 'answer = 1',
            'removed.py': 'stale = True',
        })
        await service.bindEditor(editor('unsaved draft'), 'main.py')
        synced.length = 0
        notifications.length = 0

        const changes = service.replaceWorkspace({
            'main.py': 'new device version',
            'foo.py': 'answer = 2',
            'nested/helper.py': 'value = 3',
        })

        assert.deepEqual(changes, { synced: 2, deleted: 1, total: 3 })
        assert.deepEqual(synced, [
            { path: 'foo.py', content: 'answer = 2' },
            { path: 'nested/helper.py', content: 'value = 3' },
        ])
        assert.deepEqual(deleted, ['removed.py'])
        assert.deepEqual(notifications, [
            {
                method: 'workspace/didChangeWatchedFiles',
                params: {
                    changes: [{ uri: 'file:///workspace/removed.py', type: 3 }],
                },
            },
            {
                method: 'workspace/didChangeWatchedFiles',
                params: {
                    changes: [{ uri: 'file:///workspace/foo.py', type: 2 }],
                },
            },
            {
                method: 'workspace/didChangeWatchedFiles',
                params: {
                    changes: [{ uri: 'file:///workspace/nested/helper.py', type: 1 }],
                },
            },
        ])
        assert.strictEqual(service.snapshot().workspaceFiles.get('main.py'), 'unsaved draft')
    })

    it('preserves the previous mirror entry when a listed device file cannot be read', async () => {
        const result = resources()
        const deleted = []
        result.transport.deleteWorkspaceFile = path => deleted.push(path)
        const service = new TypecheckingService({ createLSPClient: async () => result })
        await service.initialize({ workerUrl: 'blob:worker' })
        service.replaceWorkspace({
            'main.py': 'import unreadable',
            'unreadable.py': 'previous valid content',
            'removed.py': 'gone',
        })

        const changes = service.replaceWorkspace(
            { 'main.py': 'import unreadable' },
            { preservePaths: ['/unreadable.py'] },
        )

        assert.deepEqual(changes, { synced: 0, deleted: 1, total: 2 })
        assert.deepEqual(deleted, ['removed.py'])
        assert.strictEqual(
            service.snapshot().workspaceFiles.get('unreadable.py'),
            'previous valid content',
        )
    })

    it('retargets bindings without closing their document during a worker switch', async () => {
        const result = resources()
        const service = new TypecheckingService({
            createLSPClient: async () => result,
            createLSPPlugin: () => [],
            configureEditor: () => true,
        })
        await service.initialize({ workerUrl: 'blob:worker' })
        const view = editor('draft')
        await service.bindEditor(view, 'old.py')
        service.status = 'switching'

        service.renamePath('old.py', 'new.py')

        assert.strictEqual(
            service.editorBindings.get(view).uri,
            'file:///workspace/new.py',
        )
        assert.isTrue(service.documentVersions.has('file:///workspace/old.py'))
        assert.strictEqual(service.snapshot().workspaceFiles.get('new.py'), 'draft')
    })

    it('switches changed device stubs and rebinds open editors once', async () => {
        const first = resources()
        first.workspaceDiagnosticsSubscription = { destroy() {} }
        first.transport.syncWorkspaceFile = () => {}
        const second = resources()
        second.transport.synced = []
        second.transport.syncWorkspaceFile = (path, content) =>
            second.transport.synced.push({ path, content })
        let switches = 0
        let switchCurrent
        const configured = []
        const service = new TypecheckingService({
            createLSPClient: async () => first,
            prepareRuntime: async config => ({
                workerUrl: 'blob:worker',
                stubBundle: { id: config.boardId || 'stdlib' },
                boardStubs: new ArrayBuffer(1),
            }),
            switchBoard: async current => {
                switches++
                switchCurrent = current
                return second
            },
            createLSPPlugin: (_client, _view, options) => [`lsp:${options.fileUri}`],
            configureEditor: (_view, extensions) => {
                configured.push(extensions)
                return true
            },
        })

        await service.initialize({ boardId: 'stdlib' })
        await service.bindEditor(editor('draft'), 'main.py')
        service.hydrateWorkspace({ 'foo.py': 'def foofoo(x: str): return 2 * x' })

        assert.isTrue(await service.selectDevice({ platform: 'esp32', machine: 'ESP32 module' }))
        assert.isFalse(await service.selectDevice({ platform: 'esp32', machine: 'ESP32 module' }))

        assert.strictEqual(switches, 1)
        assert.strictEqual(
            switchCurrent.workspaceDiagnosticsSubscription,
            first.workspaceDiagnosticsSubscription,
        )
        assert.strictEqual(service.selectedStubBundle.id, 'esp32')
        assert.deepEqual(second.transport.synced, [
            { path: 'main.py', content: 'draft' },
            { path: 'foo.py', content: 'def foofoo(x: str): return 2 * x' },
        ])
        assert.strictEqual(service.documentVersions.get('file:///workspace/main.py'), 1)
        assert.deepEqual(configured.at(-1), ['lsp:file:///workspace/main.py'])
    })

    it('switches directly to a manually selected stub bundle', async () => {
        const first = resources()
        const second = resources()
        const service = new TypecheckingService({
            createLSPClient: async () => first,
            prepareRuntime: async config => ({
                workerUrl: 'blob:worker',
                stubBundle: { id: config.boardId || 'stdlib' },
            }),
            switchBoard: async () => second,
            createLSPPlugin: () => ['lsp-extension'],
            configureEditor: () => true,
        })
        await service.initialize({ boardId: 'stdlib', typeCheckingMode: 'strict' })

        assert.isTrue(await service.selectStubBundle('rp2'))
        assert.strictEqual(service.snapshot().selectedStubBundle.id, 'rp2')
        assert.strictEqual(service.snapshot().typeCheckingMode, 'strict')
        assert.isFalse(await service.selectStubBundle('rp2'))
        await service.selectStubBundle('').then(
            () => assert.fail('empty stub bundle should fail'),
            error => assert.include(error.message, 'stub bundle ID is required'),
        )
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

        const switching = service.selectDevice({ platform: 'esp32', machine: 'ESP32 module' })
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
        result.workspaceDiagnosticsSubscription = {
            destroyCalls: 0,
            destroy() { this.destroyCalls++ },
        }
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
        assert.strictEqual(result.workspaceDiagnosticsSubscription.destroyCalls, 1)
        assert.deepEqual(revoked, ['blob:worker'])
    })
})
