/*
 * SPDX-FileCopyrightText: 2026 Jos Verlinde
 * SPDX-License-Identifier: MIT
 */

import { assert } from 'chai'

import {
    normalizeTypecheckingBoard,
    normalizeTypecheckingMode,
    normalizeTypecheckingScope,
    parseStubPackageSpecifier,
    resolveTypecheckingBoard,
    simpleStubVersion,
    typecheckingBoardOptions,
    typecheckingRuntimeConfig,
} from '../../../src/typechecking/typechecking_settings.js'

describe('type-checking settings', () => {
    it('normalizes persisted modes and board overrides', () => {
        assert.strictEqual(normalizeTypecheckingMode('strict'), 'strict')
        assert.strictEqual(normalizeTypecheckingMode(undefined), 'standard')
        assert.strictEqual(normalizeTypecheckingMode('invalid'), 'standard')
        assert.strictEqual(normalizeTypecheckingScope('openFilesOnly'), 'openFilesOnly')
        assert.strictEqual(normalizeTypecheckingScope('workspace'), 'workspace')
        assert.strictEqual(normalizeTypecheckingScope('invalid'), 'workspace')
        assert.strictEqual(normalizeTypecheckingBoard('rp2'), 'rp2')
        assert.strictEqual(normalizeTypecheckingBoard('invalid'), 'auto')
    })

    it('lists only consumer stub bundles with simple versions', () => {
        const options = typecheckingBoardOptions({
            boards: [
                { id: 'stdlib', package_version: '1.28.0.post6' },
                { id: 'esp32', package_version: '1.28.0.post4' },
                { id: 'rp2', package_version: '1.28.0.post1' },
                { id: 'circuitpython', package_version: '10.2.1' },
                { id: 'cpython', package_version: '' },
            ],
        })

        assert.deepEqual(options, [
            { id: 'esp32', label: 'MP ESP32 (v1.28.0)' },
            { id: 'rp2', label: 'MP RP2 (v1.28.0)' },
            { id: 'circuitpython', label: 'CircuitPython (v10.2.1)' },
        ])
        assert.strictEqual(simpleStubVersion('1.28.0.post12'), 'v1.28.0')
        assert.strictEqual(simpleStubVersion(''), '')
    })

    it('uses active cached versions in board labels and parses install requests', () => {
        const options = typecheckingBoardOptions({
            boards: [{
                id: 'esp32',
                package: 'micropython-esp32-stubs',
                package_version: '1.27.0.post1',
            }],
        }, [{
            packageName: 'micropython-esp32-stubs',
            version: '1.28.0.post4',
            active: true,
        }])

        assert.deepEqual(options, [{ id: 'esp32', label: 'MP ESP32 (v1.28.0)' }])
        assert.deepEqual(parseStubPackageSpecifier('MicroPython_ESP32_Stubs==1.28.0.post4'), {
            packageName: 'micropython-esp32-stubs',
            versionSpecifier: '==1.28.0.post4',
        })
        assert.deepEqual(parseStubPackageSpecifier('types-requests~=2.32'), {
            packageName: 'types-requests',
            versionSpecifier: '~=2.32',
        })
        assert.throws(() => parseStubPackageSpecifier('package latest'), /Invalid/)
    })

    it('uses the connected platform only when the board setting is automatic', () => {
        assert.strictEqual(resolveTypecheckingBoard('auto', { platform: 'rp2' }), 'rp2')
        assert.strictEqual(resolveTypecheckingBoard('esp32', { platform: 'rp2' }), 'esp32')
        assert.isUndefined(resolveTypecheckingBoard('auto', null))
    })

    it('builds the worker configuration from persisted settings', () => {
        assert.deepEqual(typecheckingRuntimeConfig({
            mode: 'strict',
            scope: 'openFilesOnly',
            board: 'rp2',
            devInfo: { platform: 'esp32' },
            extraPaths: ['/workspace/lib'],
        }), {
            typeCheckingMode: 'strict',
            diagnosticMode: 'openFilesOnly',
            boardId: 'rp2',
            extraPaths: ['/workspace/lib'],
        })
    })
})
