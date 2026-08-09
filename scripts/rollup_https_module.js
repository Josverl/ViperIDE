/*
 * SPDX-FileCopyrightText: 2026 Jos Verlinde
 * SPDX-License-Identifier: MIT
 */

import path from 'node:path'
import process from 'node:process'

const JAVASCRIPT_CONTENT_TYPES = new Set([
    'application/ecmascript',
    'application/javascript',
    'text/ecmascript',
    'text/javascript',
])

const JSDELIVR_ORIGIN = 'https://cdn.jsdelivr.net'
const IMMUTABLE_TAG = /^lsp-client-v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

// Validate once at configuration time so the plugin can never become a general URL loader.
function parseAllowedBase(baseUrl) {
    const url = new URL(baseUrl)
    if (url.origin !== JSDELIVR_ORIGIN || url.search || url.hash) {
        throw new Error(`HTTPS module base must be an unmodified ${JSDELIVR_ORIGIN} URL`)
    }

    const match = url.pathname.match(/^\/gh\/[^/@]+\/[^/@]+@([^/]+)\/$/)
    if (!match || !IMMUTABLE_TAG.test(match[1])) {
        throw new Error('HTTPS module base must end at an immutable lsp-client-v<semver> jsDelivr tag')
    }
    return url
}

function isWithinBase(url, base) {
    return url.origin === base.origin && url.pathname.startsWith(base.pathname) &&
        !url.search && !url.hash
}

function remoteUrl(id) {
    if (!id || !id.startsWith('https://')) {
        return null
    }
    return new URL(id)
}

function isBareCodeMirrorImport(source) {
    return /^@codemirror\/[^/]+$/.test(source)
}

export function httpsModuleLoader({ baseUrl, fetch: fetchModule = globalThis.fetch }) {
    const base = parseAllowedBase(baseUrl)
    if (typeof fetchModule !== 'function') {
        throw new Error('HTTPS module loader requires fetch')
    }

    return {
        name: 'restricted-https-modules',

        async resolveId(source, importer) {
            const importerUrl = remoteUrl(importer)
            // Resolve CodeMirror from ViperIDE to preserve a single editor module graph.
            if (isBareCodeMirrorImport(source) && importerUrl && isWithinBase(importerUrl, base)) {
                return this.resolve(source, path.join(process.cwd(), 'package.json'), {
                    skipSelf: true,
                })
            }

            let resolved
            if (source.startsWith('https://')) {
                resolved = new URL(source)
            } else if (importerUrl && isWithinBase(importerUrl, base) &&
                       (source.startsWith('./') || source.startsWith('../'))) {
                resolved = new URL(source, importer)
            } else {
                return null
            }

            if (!isWithinBase(resolved, base)) {
                throw new Error(`Remote module is outside the configured immutable base: ${resolved.href}`)
            }
            return resolved.href
        },

        async load(id) {
            if (!id.startsWith('https://')) {
                return null
            }

            const url = new URL(id)
            if (!isWithinBase(url, base)) {
                throw new Error(`Remote module is outside the configured immutable base: ${url.href}`)
            }

            let response
            try {
                response = await fetchModule(url.href)
            } catch (error) {
                throw new Error(`Failed to fetch remote module ${url.href}: ${error.message}`, {
                    cause: error,
                })
            }
            if (!response.ok) {
                throw new Error(`Failed to fetch remote module ${url.href}: HTTP ${response.status}`)
            }

            const responseUrl = new URL(response.url || url.href)
            // fetch follows redirects, so validate the final URL as well as the requested URL.
            if (!isWithinBase(responseUrl, base)) {
                throw new Error(`Remote module redirected outside the configured immutable base: ${responseUrl.href}`)
            }

            const contentType = (response.headers.get('content-type') || '').split(';', 1)[0].
                trim().toLowerCase()
            if (!JAVASCRIPT_CONTENT_TYPES.has(contentType)) {
                throw new Error(`Remote module ${url.href} returned non-JavaScript content-type ` +
                    `"${contentType || '(missing)'}"`)
            }
            return response.text()
        },
    }
}
