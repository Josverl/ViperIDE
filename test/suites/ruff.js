/*
 * SPDX-FileCopyrightText: 2024 Volodymyr Shymanskyy
 * SPDX-License-Identifier: MIT
 *
 * Smoke tests for the Ruff linter/formatter (ruff-wasm-web).
 *
 * The wasm-bindgen web build works under Node when initialized synchronously
 * with the .wasm bytes via initSync().
 */

import { assert } from 'chai'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Workspace, PositionEncoding, initSync } from '@astral-sh/ruff-wasm-web'

const require = createRequire(import.meta.url)
const wasmPath = require.resolve('@astral-sh/ruff-wasm-web/ruff_wasm_bg.wasm')

describe('Ruff linter', () => {

    before(() => {
        const wasmBytes = readFileSync(wasmPath)
        initSync({ module: wasmBytes })
    })

    it('reports a version string', () => {
        const ver = Workspace.version()
        assert.isString(ver)
        assert.match(ver, /^\d+\.\d+\.\d+/, 'version looks like semver')
    })

    it('detects an unused import', () => {
        const ws = new Workspace({}, PositionEncoding.Utf16)
        const diagnostics = ws.check('import os\nx = 1\n')
        assert.isArray(diagnostics)
        const codes = diagnostics.map(d => d.code)
        assert.include(codes, 'F401', 'unused import detected')
        ws.free()
    })

    it('reports no issues for clean code', () => {
        const ws = new Workspace({}, PositionEncoding.Utf16)
        const diagnostics = ws.check('x = 1\nprint(x)\n')
        assert.isArray(diagnostics)
        assert.isEmpty(diagnostics, 'clean code has no diagnostics')
        ws.free()
    })

    it('formats code', () => {
        const ws = new Workspace({ 'line-length': 80 }, PositionEncoding.Utf16)
        const ugly = 'x=1+2\ny =   3\n'
        const formatted = ws.format(ugly)
        assert.isString(formatted)
        assert.notStrictEqual(formatted, ugly, 'formatting changed the code')
        assert.include(formatted, 'x = 1 + 2', 'spaces around operators')
        ws.free()
    })

    it('respects configuration options', () => {
        const ws = new Workspace({
            lint: { ignore: ['F401'] },
        }, PositionEncoding.Utf16)
        const diagnostics = ws.check('import os\nx = 1\n')
        const codes = diagnostics.map(d => d.code)
        assert.notInclude(codes, 'F401', 'ignored rule is suppressed')
        ws.free()
    })

    it('diagnostics include location information', () => {
        const ws = new Workspace({}, PositionEncoding.Utf16)
        const diagnostics = ws.check('import os\n')
        assert.isAbove(diagnostics.length, 0, 'has at least one diagnostic')
        const d = diagnostics[0]
        assert.property(d, 'start_location')
        assert.property(d, 'end_location')
        assert.property(d.start_location, 'row')
        assert.property(d.start_location, 'column')
        ws.free()
    })
})
