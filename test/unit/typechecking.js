import { assert } from 'chai'

import { TypecheckingService } from '../../src/typechecking.js'

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
