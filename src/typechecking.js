/*
 * SPDX-FileCopyrightText: 2026 Jos Verlinde
 * SPDX-License-Identifier: MIT
 */

import {
  createLSPClient,
  createLSPPlugin,
  notifyDocumentChange,
  notifyDocumentClose,
  switchBoard,
} from
  'https://cdn.jsdelivr.net/gh/Josverl/stubs_playground@lsp-client-v0.2.7/packages/lsp-client/src/index.js'

import { TypecheckingService } from './typechecking_service.js'
import { typecheckingAssets } from './typechecking_assets.js'

// One service instance owns the worker and all editor bindings for this application session.
export const typechecking = new TypecheckingService({
  createLSPClient,
  createLSPPlugin,
  notifyDocumentChange,
  notifyDocumentClose,
  switchBoard,
  prepareRuntime: config => typecheckingAssets.prepare(config.boardId),
  revokeObjectURL: url => {
    URL.revokeObjectURL(url)
    // Allow a later initialization attempt to create a fresh URL after failure.
    typecheckingAssets.releaseWorkerBlobUrl(url)
  },
})

export const loadTypecheckingStubManifest = () => typecheckingAssets.loadManifest()
