/*
 * SPDX-FileCopyrightText: 2026 Jos Verlinde
 * SPDX-License-Identifier: MIT
 */

import { assert } from 'chai'

import { readDevicePythonWorkspace } from '../../src/typechecking_workspace.js'

describe('device type-checking workspace', () => {
    it('reads every regular Python file and reports unreadable or invalid files', async () => {
        const reads = []
        const entries = {
            '/main.py': { isDir: false },
            '/lib/foo.py': { isDir: false },
            '/folder.py': { isDir: true },
            '/proc/runtime.py': { isDir: false },
            '/README.md': { isDir: false },
            '/invalid.py': { isDir: false },
            '/missing.py': { isDir: false },
        }
        const contents = {
            '/main.py': new TextEncoder().encode('from lib.foo import foo'),
            '/lib/foo.py': 'foo = 1',
            '/invalid.py': new Uint8Array([0xff]),
        }
        const fsCache = {
            knownPaths: () => Object.keys(entries),
            get: path => entries[path],
            readFile: async (_raw, path) => {
                reads.push(path)
                if (path === '/missing.py') { throw new Error('read failed') }
                return contents[path]
            },
        }

        const result = await readDevicePythonWorkspace(
            {},
            fsCache,
            path => path.startsWith('/proc/'),
        )

        assert.deepEqual(result.files, {
            '/main.py': 'from lib.foo import foo',
            '/lib/foo.py': 'foo = 1',
        })
        assert.deepEqual(reads, ['/main.py', '/lib/foo.py', '/invalid.py', '/missing.py'])
        assert.deepEqual(result.errors.map(({ path }) => path), ['/invalid.py', '/missing.py'])
        assert.match(result.errors[1].error.message, /read failed/)
    })
})
