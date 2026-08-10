/*
 * SPDX-FileCopyrightText: 2024 Volodymyr Shymanskyy
 * SPDX-License-Identifier: MIT
 *
 * Smoke tests for mpy-cross-wasm: compiles Python source to .mpy bytecode.
 */

import { assert } from 'chai'
import { compile, abiVersions, defaultAbi } from '@vshymanskyy/mpy-cross-wasm'

describe('mpy-cross-wasm', () => {

    it('compiles a trivial script', async () => {
        const result = await compile('test.py', 'print("hello")\n')
        assert.strictEqual(result.status, 0, 'exit status is 0')
        assert.isNotNull(result.mpy, '.mpy output exists')
        assert.isAbove(result.mpy.length, 0, '.mpy is not empty')
    })

    it('the .mpy starts with the M header byte', async () => {
        const result = await compile('test.py', 'x = 1 + 2\n')
        assert.strictEqual(result.mpy[0], 0x4D, 'magic byte is M')
    })

    it('rejects a syntax error', async () => {
        const result = await compile('bad.py', 'def f(\n')
        assert.notStrictEqual(result.status, 0, 'exit status is non-zero')
        assert.isAbove(result.err.length, 0, 'stderr has content')
    })

    it('compiles with an explicit ABI version', async () => {
        const abi = abiVersions[0]
        const result = await compile('test.py', 'x = 42\n', { abi })
        assert.strictEqual(result.status, 0, `compiles for ABI ${abi}`)
        assert.strictEqual(result.mpy[0], 0x4D, 'magic byte')
    })

    it('compiles a multi-function module', async () => {
        const source = `
def add(a, b):
    return a + b

def greet(name):
    return "Hello, " + name

class Counter:
    def __init__(self):
        self.n = 0
    def inc(self):
        self.n += 1
`
        const result = await compile('module.py', source)
        assert.strictEqual(result.status, 0, 'compiles successfully')
        assert.isAbove(result.mpy.length, 10, '.mpy has meaningful size')
    })

    it('exposes ABI metadata', () => {
        assert.isArray(abiVersions, 'abiVersions is an array')
        assert.isAbove(abiVersions.length, 0, 'at least one ABI is available')
        assert.isString(defaultAbi, 'defaultAbi is a string')
        assert.include(abiVersions, defaultAbi, 'defaultAbi is in the list')
    })
})
