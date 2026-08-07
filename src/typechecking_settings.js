/*
 * SPDX-FileCopyrightText: 2026 Jos Verlinde
 * SPDX-License-Identifier: MIT
 */

import { stubTargetForDevice } from './typechecking_service.js'

export const DEFAULT_TYPECHECKING_MODE = 'standard'
export const DEFAULT_TYPECHECKING_SCOPE = 'workspace'
export const AUTO_TYPECHECKING_BOARD = 'auto'

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

export function normalizeTypecheckingMode(value) {
    return TYPECHECKING_MODES.has(value) ? value : DEFAULT_TYPECHECKING_MODE
}

export function normalizeTypecheckingScope(value) {
    return TYPECHECKING_SCOPES.has(value) ? value : DEFAULT_TYPECHECKING_SCOPE
}

export function normalizeTypecheckingBoard(value) {
    return TYPECHECKING_BOARDS.has(value) ? value : AUTO_TYPECHECKING_BOARD
}

export function resolveTypecheckingBoard(value, devInfo) {
    const board = normalizeTypecheckingBoard(value)
    if (board !== AUTO_TYPECHECKING_BOARD) { return board }
    return devInfo ? stubTargetForDevice(devInfo) : undefined
}

export function simpleStubVersion(version) {
    if (typeof version !== 'string' || !version.trim()) { return '' }
    return `v${version.trim().replace(/\.post\d+.*$/, '')}`
}

export function typecheckingBoardOptions(manifest) {
    return (manifest?.boards || []).
        filter(board => TYPECHECKING_BOARD_LABELS.has(board.id)).
        map(board => {
            const version = simpleStubVersion(board.package_version)
            return {
                id: board.id,
                label: `${TYPECHECKING_BOARD_LABELS.get(board.id)}${version ? ` (${version})` : ''}`,
            }
        })
}

export function typecheckingRuntimeConfig({ mode, scope, board, devInfo, extraPaths = [] }) {
    const boardId = resolveTypecheckingBoard(board, devInfo)
    return {
        extraPaths,
        diagnosticMode: normalizeTypecheckingScope(scope),
        typeCheckingMode: normalizeTypecheckingMode(mode),
        ...(boardId ? { boardId } : {}),
    }
}
