import { strict as assert } from 'node:assert'

import {
    collectConsoleErrors,
    configureTypechecking,
    pyrightRows,
} from '../browser/helpers.mjs'

describe('browser test helpers', () => {
    it('configures the baseline settings with overrides', async () => {
        let initScript
        let settings
        const page = {
            addInitScript(script, value) {
                initScript = script
                settings = value
            },
        }

        await configureTypechecking(page, { 'typecheck-scope': 'openFilesOnly' })

        assert.equal(typeof initScript, 'function')
        assert.deepEqual(settings, {
            'typecheck-enabled': true,
            'typecheck-viper-tools-stubs': true,
            'typecheck-mode': 'standard',
            'typecheck-scope': 'openFilesOnly',
            'typecheck-autodetect': false,
            'typecheck-stub-family': 'micropython',
            'typecheck-stub-version': '1.28.0',
            'typecheck-stub-port': 'esp32',
            'typecheck-stub-board': 'GENERIC',
        })
    })

    it('collects only console errors', () => {
        let listener
        const page = { on(_event, callback) { listener = callback } }
        const errors = collectConsoleErrors(page)

        listener({ type: () => 'log', text: () => 'ignored' })
        listener({ type: () => 'error', text: () => 'failure' })

        assert.deepEqual(errors, ['failure'])
    })

    it('filters diagnostic rows to the requested path and Pyright source', () => {
        const source = {}
        const filtered = {}
        const page = {
            locator(selector, options) {
                if (selector === '.diagnostic-source') {
                    assert.deepEqual(options, { hasText: 'Pyright' })
                    return source
                }
                assert.equal(selector, '#diagnostics-list .diagnostic-item[data-path="/main.py"]')
                return {
                    filter(filterOptions) {
                        assert.deepEqual(filterOptions, { has: source })
                        return filtered
                    },
                }
            },
        }

        assert.equal(pyrightRows(page, '/main.py'), filtered)
    })
})