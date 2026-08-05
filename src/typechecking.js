/*
 * SPDX-FileCopyrightText: 2026 Jos Verlinde
 * SPDX-License-Identifier: MIT
 */

import { createLSPClient } from
  'https://cdn.jsdelivr.net/gh/Josverl/stubs_playground@lsp-client-v0.2.1/packages/lsp-client/src/index.js'

import { TypecheckingService } from './typechecking_service.js'

// One service instance owns the worker and all editor bindings for this application session.
export const typechecking = new TypecheckingService({ createLSPClient })
