/*
 * SPDX-FileCopyrightText: 2026 Jos Verlinde
 * SPDX-License-Identifier: MIT
 */

import { assert } from 'chai'

import {
    normalizeTypecheckingBoard,
    normalizeTypecheckingMode,
    resolveTypecheckingBoard,
    simpleStubVersion,
    typecheckingBoardOptions,
    typecheckingRuntimeConfig,
} from '../../src/typechecking_settings.js'

describe('type-checking settings', () => {
    it('normalizes persisted modes and board overrides', () => {
        assert.strictEqual(normalizeTypecheckingMode('strict'), 'strict')
        assert.strictEqual(normalizeTypecheckingMode(undefined), 'standard')
        assert.strictEqual(normalizeTypecheckingMode('invalid'), 'standard')
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

    it('uses the connected platform only when the board setting is automatic', () => {
        assert.strictEqual(resolveTypecheckingBoard('auto', { platform: 'rp2' }), 'rp2')
        assert.strictEqual(resolveTypecheckingBoard('esp32', { platform: 'rp2' }), 'esp32')
        assert.isUndefined(resolveTypecheckingBoard('auto', null))
    })

    it('builds the worker configuration from persisted settings', () => {
        assert.deepEqual(typecheckingRuntimeConfig({
            mode: 'strict',
            board: 'rp2',
            devInfo: { platform: 'esp32' },
            extraPaths: ['/workspace/lib'],
        }), {
            typeCheckingMode: 'strict',
            boardId: 'rp2',
            extraPaths: ['/workspace/lib'],
        })
    })
})
