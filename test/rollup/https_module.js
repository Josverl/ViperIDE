/*
 * SPDX-FileCopyrightText: 2026 Jos Verlinde
 * SPDX-License-Identifier: MIT
 */

import { assert } from 'chai'
import { rollup } from 'rollup'
import resolve from '@rollup/plugin-node-resolve'

import { httpsModuleLoader } from '../../scripts/rollup_https_module.js'

const BASE = 'https://cdn.jsdelivr.net/gh/Josverl/stubs_playground@lsp-client-v0.2.3/'
const ENTRY = `${BASE}packages/lsp-client/src/index.js`

function response(body, {
    status = 200,
    contentType = 'application/javascript; charset=utf-8',
    url = ENTRY,
} = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        url,
        headers: new Headers({ 'content-type': contentType }),
        text: async () => body,
    }
}

async function build(sources, entry = ENTRY) {
    const requests = []
    const fetch = async (url) => {
        requests.push(url)
        const value = sources[url]
        return value || response('not found', { status: 404, url })
    }
    const bundle = await rollup({
        input: entry,
        plugins: [
            httpsModuleLoader({ baseUrl: BASE, fetch }),
            resolve(),
        ],
    })
    const { output } = await bundle.generate({ format: 'es' })
    await bundle.close()
    return { code: output[0].code, requests }
}

async function rejects(promise, match) {
    let error
    try {
        await promise
    } catch (caught) {
        error = caught
    }
    assert.instanceOf(error, Error, 'expected promise to reject')
    assert.match(error.message, match)
}

describe('Rollup HTTPS module loader', () => {
    it('bundles ViperIDE type checking with tagged client and local CodeMirror', async function () {
        this.timeout(30000)
        const bundle = await rollup({
            input: 'src/typechecking.js',
            plugins: [
                httpsModuleLoader({ baseUrl: BASE }),
                resolve(),
            ],
            onwarn(warning) {
                throw new Error(warning.message)
            },
        })
        const moduleIds = [...bundle.cache.modules].map(module => module.id)
        const { output } = await bundle.generate({ format: 'es' })
        await bundle.close()

        assert.include(moduleIds, ENTRY)
        assert.isTrue(moduleIds.some(id =>
            id.includes('/node_modules/@codemirror/state/dist/index.js')))
        assert.notMatch(output[0].code, /from ['"]@codemirror\//)
    })

    it('resolves relative modules on the configured immutable tag', async () => {
        const child = `${BASE}packages/lsp-client/src/child.js`
        const { code, requests } = await build({
            [ENTRY]: response("import { value } from './child.js'; export { value }"),
            [child]: response('export const value = 42', { url: child }),
        })

        assert.deepEqual(requests, [ENTRY, child])
        assert.include(code, 'const value = 42')
    })

    it('rejects mutable or non-jsDelivr base URLs', () => {
        assert.throws(
            () => httpsModuleLoader({
                baseUrl: 'https://cdn.jsdelivr.net/gh/Josverl/stubs_playground@main/',
            }),
            /immutable/,
        )
        assert.throws(
            () => httpsModuleLoader({
                baseUrl: 'https://example.com/gh/Josverl/stubs_playground@lsp-client-v0.2.3/',
            }),
            /jsdelivr/,
        )
    })

    it('rejects absolute and relative imports outside the configured base', async () => {
        await rejects(build({
            [ENTRY]: response("import 'https://example.com/client.js'"),
        }), /outside the configured immutable base/)

        await rejects(build({
            [ENTRY]: response("import '../../../../../outside.js'"),
        }), /outside the configured immutable base/)
    })

    it('rejects failed and non-JavaScript responses', async () => {
        await rejects(build({
            [ENTRY]: response('missing', { status: 404 }),
        }), /HTTP 404/)

        await rejects(build({
            [ENTRY]: response('<html></html>', { contentType: 'text/html' }),
        }), /non-JavaScript content-type "text\/html"/)

        await rejects(build({
            [ENTRY]: response('export const value = 1', { contentType: '' }),
        }), /non-JavaScript content-type "\(missing\)"/)
    })

    it('reports fetch failures with the module URL', async () => {
        const bundle = rollup({
            input: ENTRY,
            plugins: [
                httpsModuleLoader({
                    baseUrl: BASE,
                    fetch: async () => { throw new Error('network unavailable') },
                }),
            ],
        })

        await rejects(bundle, new RegExp(
            `Failed to fetch remote module ${ENTRY}.*network unavailable`,
        ))
    })

    it('rejects redirects outside the immutable base', async () => {
        await rejects(build({
            [ENTRY]: response('export const value = 1', {
                url: 'https://cdn.jsdelivr.net/gh/Josverl/stubs_playground@main/index.js',
            }),
        }), /redirected outside/)
    })

    it('resolves bare CodeMirror imports from ViperIDE dependencies', async () => {
        const { code, requests } = await build({
            [ENTRY]: response(
                "import { EditorState } from '@codemirror/state'; " +
                "export const state = EditorState.create({ doc: 'locked' })",
            ),
        })

        assert.deepEqual(requests, [ENTRY])
        assert.include(code, 'class EditorState')
        assert.include(code, "doc: 'locked'")
    })
})
