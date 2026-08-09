/*
 * SPDX-FileCopyrightText: 2026 Jos Verlinde
 * SPDX-License-Identifier: MIT
 */

import { escapeHTML } from './utils.js'

export const DIAGNOSTIC_SEVERITIES = ['error', 'warning', 'info']

export function normalizeDiagnosticsFilters(filters = {}) {
    const requested = filters.severities instanceof Set
        ? [...filters.severities]
        : Array.isArray(filters.severities) ? filters.severities : DIAGNOSTIC_SEVERITIES
    return {
        file: typeof filters.file === 'string' ? filters.file : '',
        severities: new Set(requested.filter(severity => DIAGNOSTIC_SEVERITIES.includes(severity))),
    }
}

/**
 * Flatten diagnostics collected from every open editor into a stable list.
 */
export function buildDiagnosticEntries(openEditors = []) {
    const entries = []
    const seen = new Set()
    for (const { path, diagnostics = [] } of openEditors) {
        const fileName = path.replace(/^\/+/, '')
        for (const diagnostic of diagnostics) {
            const severity = diagnostic.severity === 'hint' ? 'info' : diagnostic.severity
            if (!DIAGNOSTIC_SEVERITIES.includes(severity)) { continue }
            const entry = {
                ...diagnostic,
                path,
                fileName,
                severity,
                line: diagnostic.line || 1,
                character: diagnostic.character || 1,
            }
            const key = [path, entry.line, entry.character, severity, entry.message, entry.source].join('\0')
            if (seen.has(key)) { continue }
            seen.add(key)
            entries.push(entry)
        }
    }
    return entries.sort((a, b) =>
        a.fileName.localeCompare(b.fileName) ||
        a.line - b.line ||
        a.character - b.character)
}

export function listDiagnosticFiles(entries) {
    const files = new Map()
    for (const entry of entries) {
        files.set(entry.path, entry.fileName)
    }
    return [...files].map(([path, fileName]) => ({ path, fileName })).
        sort((a, b) => a.fileName.localeCompare(b.fileName))
}

export function filterDiagnosticEntries(entries, filters) {
    const normalized = normalizeDiagnosticsFilters(filters)
    return entries.filter(entry =>
        (!normalized.file || entry.path === normalized.file) &&
        normalized.severities.has(entry.severity))
}

export function diagnosticsPanelPresentation(openEditors, filters) {
    const entries = buildDiagnosticEntries(openEditors)
    const files = listDiagnosticFiles(entries)
    const normalized = normalizeDiagnosticsFilters(filters)
    if (normalized.file && !files.some(file => file.path === normalized.file)) {
        normalized.file = ''
        filters.file = ''
    }
    const filtered = filterDiagnosticEntries(entries, normalized)
    const counts = entries.reduce((result, entry) => {
        result[entry.severity]++
        return result
    }, { error: 0, warning: 0, info: 0 })
    return {
        entries,
        files,
        filtered,
        counts,
        emptyMessage: entries.length
            ? 'No diagnostics match the current filters.'
            : 'No problems detected.',
    }
}

function diagnosticRow(entry) {
    const location = `${entry.fileName}:${entry.line}:${entry.character}`
    return `<button class="diagnostic-item" data-severity="${escapeHTML(entry.severity)}" ` +
        `data-path="${escapeHTML(entry.path)}" data-line="${entry.line}" data-character="${entry.character}">` +
        `<span class="diagnostic-severity">${escapeHTML(entry.severity)}</span>` +
        `<span class="diagnostic-location">${escapeHTML(location)}</span>` +
        `<span class="diagnostic-message">${escapeHTML(entry.message)}</span>` +
        `${entry.source ? `<span class="diagnostic-source">${escapeHTML(entry.source)}</span>` : ''}` +
        `</button>`
}

export function renderDiagnosticsPanel(elements, presentation, filters) {
    const { badgeEl, fileSelectEl, listEl } = elements
    const normalized = normalizeDiagnosticsFilters(filters)
    const { counts, files, filtered, emptyMessage } = presentation
    const total = counts.error + counts.warning + counts.info
    const severity = counts.error ? 'error' : (counts.warning ? 'warning' : (counts.info ? 'info' : ''))

    badgeEl.textContent = total ? String(total) : ''
    badgeEl.dataset.severity = severity
    badgeEl.title = `${counts.error} errors, ${counts.warning} warnings, ${counts.info} info`

    fileSelectEl.replaceChildren(new Option('All files', ''))
    for (const file of files) {
        fileSelectEl.add(new Option(file.fileName, file.path))
    }
    fileSelectEl.value = normalized.file

    listEl.innerHTML = filtered.length
        ? filtered.map(diagnosticRow).join('')
        : `<div class="diagnostics-empty">${escapeHTML(emptyMessage)}</div>`
}
