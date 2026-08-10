/*
 * SPDX-FileCopyrightText: 2026 Jos Verlinde
 * SPDX-License-Identifier: MIT
 */

import { assert } from 'chai'

import {
    renderTypecheckingStatus,
    typecheckingStatusPresentation,
} from '../../../src/typechecking/typechecking_status.js'

function snapshot(status, options = {}) {
    return {
        status,
        error: options.error || null,
        selectedStubBundle: options.stubBundle || null,
        typeCheckingMode: options.typeCheckingMode || 'standard',
        diagnosticStatus: options.diagnosticStatus || new Map(),
    }
}

function control() {
    return {
        dataset: {},
        attributes: {},
        setAttribute(name, value) { this.attributes[name] = value },
    }
}

describe('type-checking status UI', () => {
    it('describes ready, busy, error, and disabled states', () => {
        const diagnostics = [{
            uri: 'file:///workspace/main.py',
            line: 4,
            character: 11,
            message: 'bad type',
            severity: 'error',
        }]
        const duplicateDiagnostics = new Map([
            ['main.py', diagnostics],
            ['other.py', diagnostics],
        ])

        assert.deepInclude(typecheckingStatusPresentation(
            snapshot('ready', {
                stubBundle: { id: 'esp32' },
                typeCheckingMode: 'strict',
                diagnosticStatus: duplicateDiagnostics,
            }),
            true,
        ), {
            state: 'ready',
            label: 'Type check: 1 error',
            busy: false,
        })
        assert.include(typecheckingStatusPresentation(
            snapshot('ready', { stubBundle: { id: 'esp32' }, typeCheckingMode: 'strict' }),
            true,
        ).title, 'strict mode with esp32 stubs')
        assert.deepInclude(typecheckingStatusPresentation(snapshot('starting'), true), {
            state: 'starting',
            label: 'Type check: Starting',
            busy: true,
        })
        assert.include(
            typecheckingStatusPresentation(snapshot('error', { error: new Error('worker failed') }), true).title,
            'worker failed',
        )
        assert.deepInclude(typecheckingStatusPresentation(snapshot('ready'), false), {
            state: 'disabled',
            label: 'Type check: Off',
            busy: false,
        })
    })

    it('renders accessible state and locks controls during transitions', () => {
        const statusElement = control()
        const checkbox = control()

        const rendered = renderTypecheckingStatus(
            statusElement,
            checkbox,
            snapshot('switching'),
            true,
        )

        assert.strictEqual(rendered.state, 'switching')
        assert.strictEqual(statusElement.dataset.state, 'switching')
        assert.strictEqual(statusElement.attributes['aria-busy'], 'true')
        assert.include(statusElement.attributes['aria-label'], 'connected device')
        assert.isTrue(checkbox.disabled)
    })
})
