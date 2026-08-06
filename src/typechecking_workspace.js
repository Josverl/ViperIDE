/*
 * SPDX-FileCopyrightText: 2026 Jos Verlinde
 * SPDX-License-Identifier: MIT
 */

function decodePython(bytes) {
    if (typeof bytes === 'string') { return bytes }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

export async function readDevicePythonWorkspace(raw, fsCache, isSpecialPath) {
    const files = {}
    const errors = []

    // Raw-mode commands are serialized, so device reads must remain sequential.
    for (const path of fsCache.knownPaths()) {
        const entry = fsCache.get(path)
        if (!path.endsWith('.py') || entry?.isDir || isSpecialPath(path)) { continue }
        try {
            files[path] = decodePython(await fsCache.readFile(raw, path))
        } catch (error) {
            errors.push({ path, error })
        }
    }

    return { files, errors }
}
