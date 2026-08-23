/*
 * SPDX-FileCopyrightText: 2026 Jos Verlinde
 * SPDX-License-Identifier: MIT
 */

import { stubTargetForDevice } from './typechecking_service.js'

export const DEFAULT_TYPECHECKING_MODE = 'standard'
export const DEFAULT_TYPECHECKING_SCOPE = 'openFilesOnly'
export const AUTO_TYPECHECKING_BOARD = 'auto'
export const MICROPYTHON_TYPESHED_PATH = '/typeshed-micropython'

const TYPECHECKING_MODES = new Set(['basic', 'standard', 'strict'])
const TYPECHECKING_SCOPES = new Set(['openFilesOnly', 'workspace'])
const TYPECHECKING_BOARD_LABELS = new Map([
    ['esp32', 'MP ESP32'],
    ['rp2', 'MP RP2'],
    ['stm32', 'MP STM32'],
    ['samd', 'MP SAMD'],
    ['webassembly', 'MP WebAssembly'],
    ['circuitpython', 'CircuitPython'],
])
const TYPECHECKING_BOARDS = new Set([
    AUTO_TYPECHECKING_BOARD,
    'esp32',
    'rp2',
    'stm32',
    'samd',
    'webassembly',
    'circuitpython',
])

/** @param {string} value @returns {'basic'|'standard'|'strict'} */
export function normalizeTypecheckingMode(value) {
    return TYPECHECKING_MODES.has(value) ? value : DEFAULT_TYPECHECKING_MODE
}

/** @param {string} value @returns {'openFilesOnly'|'workspace'} */
export function normalizeTypecheckingScope(value) {
    return TYPECHECKING_SCOPES.has(value) ? value : DEFAULT_TYPECHECKING_SCOPE
}

/** @param {string} value @returns {string} Supported board ID or `auto`. */
export function normalizeTypecheckingBoard(value) {
    return TYPECHECKING_BOARDS.has(value) ? value : AUTO_TYPECHECKING_BOARD
}

/**
 * @param {string} value Configured board ID.
 * @param {object} [devInfo] Connected-device metadata used for automatic selection.
 * @returns {string|undefined} Effective board ID.
 */
export function resolveTypecheckingBoard(value, devInfo) {
    const board = normalizeTypecheckingBoard(value)
    if (board !== AUTO_TYPECHECKING_BOARD) { return board }
    return devInfo ? stubTargetForDevice(devInfo) : undefined
}

/** @param {unknown} version Package version. @returns {string} Compact display version. */
export function simpleStubVersion(version) {
    if (typeof version !== 'string' || !version.trim()) { return '' }
    return `v${version.trim().replace(/\.post\d+.*$/, '')}`
}

function normalizePackageName(value) {
    return String(value || '').trim().toLowerCase().replace(/[-_.]+/g, '-')
}

/**
 * Parse a PyPI distribution plus an optional version constraint.
 *
 * @param {unknown} value User-entered package specifier.
 * @returns {{packageName: string, versionSpecifier: string}} Normalized request.
 * @throws {Error} If the package or constraint syntax is invalid.
 */
export function parseStubPackageSpecifier(value) {
    const match = /^([A-Za-z0-9][A-Za-z0-9._-]*)(.*)$/.exec(String(value || '').trim())
    if (!match) { throw new Error('Invalid package specifier') }
    const versionSpecifier = match[2].trim()
    if (versionSpecifier && !/^(==|!=|~=|>=|<=|>|<)/.test(versionSpecifier)) {
        throw new Error('Invalid stub package version constraint')
    }
    return {
        packageName: normalizePackageName(match[1]),
        versionSpecifier,
    }
}

/**
 * Build board selector options from the manifest and active cached packages.
 *
 * @param {{boards?: object[]}} manifest Worker stub manifest.
 * @param {object[]} [installedPackages=[]] Cached package metadata.
 * @returns {{id: string, label: string}[]} Supported board options.
 */
export function typecheckingBoardOptions(manifest, installedPackages = []) {
    const installedVersions = new Map(
        installedPackages.
            filter(entry => entry?.active).
            map(entry => [normalizePackageName(entry.packageName), entry.version]),
    )
    return (manifest?.boards || []).
        filter(board => TYPECHECKING_BOARD_LABELS.has(board.id)).
        map(board => {
            const installedVersion = installedVersions.get(normalizePackageName(board.package))
            const version = simpleStubVersion(installedVersion || board.package_version)
            return {
                id: board.id,
                label: `${TYPECHECKING_BOARD_LABELS.get(board.id)}${version ? ` (${version})` : ''}`,
            }
        })
}

/**
 * Convert persisted ViperIDE settings to reusable LSP client configuration.
 *
 * @param {object} settings Runtime settings.
 * @returns {{extraPaths: string[], diagnosticMode: string, typeCheckingMode: string, typeshedPath: string, boardId?: string}}
 */
export function typecheckingRuntimeConfig({ mode, scope, board, devInfo, extraPaths = [] }) {
    const boardId = resolveTypecheckingBoard(board, devInfo)
    return {
        extraPaths,
        diagnosticMode: normalizeTypecheckingScope(scope),
        typeCheckingMode: normalizeTypecheckingMode(mode),
        // MicroPython stdlib stubs; the client would otherwise default to CPython typeshed.
        typeshedPath: MICROPYTHON_TYPESHED_PATH,
        ...(boardId ? { boardId } : {}),
    }
}

/**
 * Build runtime stub selection from a published catalog target.
 *
 * @param {object} settings Typechecking and selected package settings.
 * @returns {object} Worker runtime configuration.
 */
export function catalogTypecheckingRuntimeConfig({
    mode,
    scope,
    family,
    port,
    stubPackage,
    extraPaths = [],
}) {
    const boardId = family === 'circuitpython' ? 'circuitpython' : port
    return {
        extraPaths,
        diagnosticMode: normalizeTypecheckingScope(scope),
        typeCheckingMode: normalizeTypecheckingMode(mode),
        typeshedPath: MICROPYTHON_TYPESHED_PATH,
        ...(boardId ? { boardId } : {}),
        ...(stubPackage?.packageName ? {
            boardStubPackage: {
                packageName: stubPackage.packageName,
                ...(stubPackage.version ? { version: stubPackage.version } : {}),
                fallbackToBundled: true,
            },
        } : {}),
    }
}
