/*
 * SPDX-FileCopyrightText: 2026 Jos Verlinde
 * SPDX-License-Identifier: MIT
 */

function diagnosticCounts(diagnosticStatus) {
    const counts = { errors: 0, warnings: 0 }
    const seen = new Set()
    for (const [documentUri, diagnostics] of diagnosticStatus?.entries?.() || []) {
        for (const diagnostic of diagnostics) {
            const key = [
                diagnostic.uri || documentUri,
                diagnostic.line,
                diagnostic.character,
                diagnostic.message,
                diagnostic.severity,
            ].join('\0')
            if (seen.has(key)) { continue }
            seen.add(key)
            if (diagnostic.severity === 'error') { counts.errors++ }
            if (diagnostic.severity === 'warning') { counts.warnings++ }
        }
    }
    return counts
}

export function typecheckingStatusPresentation(snapshot, enabled) {
    const state = enabled ? snapshot.status : 'disabled'
    const board = snapshot.selectedStubBundle?.id || snapshot.selectedStubBundle || 'standard'
    const mode = snapshot.typeCheckingMode || 'standard'
    const counts = diagnosticCounts(snapshot.diagnosticStatus)

    switch (state) {
    case 'starting':
        return {
            state,
            label: 'Type check: Starting',
            title: 'Pyright is starting.',
            busy: true,
        }
    case 'switching':
        return {
            state,
            label: 'Type check: Switching',
            title: 'Pyright is loading type information for the connected device.',
            busy: true,
        }
    case 'ready': {
        const summary = `${counts.errors} error${counts.errors === 1 ? '' : 's'}, ` +
            `${counts.warnings} warning${counts.warnings === 1 ? '' : 's'}`
        return {
            state,
            label: `Type check: ${counts.errors ? `${counts.errors} error${counts.errors === 1 ? '' : 's'}` : 'Ready'}`,
            title: `Pyright is ready in ${mode} mode with ${board} stubs (${summary}). Click to disable.`,
            busy: false,
        }
    }
    case 'error':
        return {
            state,
            label: 'Type check: Error',
            title: `Pyright failed: ${snapshot.error?.message || snapshot.error || 'Unknown error'}. ` +
                'Click to disable; enable it again to retry.',
            busy: false,
        }
    case 'disposed':
        return {
            state,
            label: 'Type check: Closed',
            title: 'Pyright has been closed.',
            busy: true,
        }
    default:
        return {
            state: 'disabled',
            label: 'Type check: Off',
            title: 'Pyright is disabled. Click to enable.',
            busy: false,
        }
    }
}

export function renderTypecheckingStatus(button, checkbox, snapshot, enabled) {
    const presentation = typecheckingStatusPresentation(snapshot, enabled)
    button.dataset.state = presentation.state
    button.textContent = presentation.label
    button.title = presentation.title
    button.disabled = presentation.busy
    button.setAttribute('aria-pressed', String(enabled))
    button.setAttribute('aria-label', presentation.title)
    checkbox.disabled = presentation.busy
    return presentation
}
