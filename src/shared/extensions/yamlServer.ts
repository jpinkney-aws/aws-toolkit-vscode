/*!
 * Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/*!
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 */

import {
    createConnection,
    IConnection,
    InitializeParams,
    InitializeResult,
    ServerCapabilities,
    TextDocuments,
    TextDocumentSyncKind,
} from 'vscode-languageserver'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { formatError, runSafeAsync } from '../../shared/languageServer/utils/runner'
import { TextDocumentValidator } from '../../shared/languageServer/utils/validator'
import { readFileSync } from 'fs-extra'
// import { getLogger } from '../logger/logger'
// import { getIdeProperties } from '../extensionUtilities'
import { getLanguageService, WorkspaceContextService } from 'yaml-language-server'
import { SettingsState } from 'yaml-language-server/lib/umd/yamlSettings'

// Create a connection for the server
const connection: IConnection = createConnection()

process.on('unhandledRejection', (e: any) => {
    console.error(formatError('Unhandled exception', e))
})
process.on('uncaughtException', (e: any) => {
    console.error(formatError('Unhandled exception', e))
})

console.log = connection.console.log.bind(connection.console)
console.error = connection.console.error.bind(connection.console)

// Create a text document manager.
const documents = new TextDocuments(TextDocument)

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection)

// After the server has started the client sends an initialize request. The server receives
// in the passed params the rootPath of the workspace plus the client capabilities.
connection.onInitialize((params: InitializeParams): InitializeResult => {
    const capabilities: ServerCapabilities = {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        completionProvider: { triggerCharacters: ['"'] },
        hoverProvider: true,
    }

    return { capabilities }
})

const resolver = (uri: string): Promise<string> => {
    try {
        // TODO decode? maybe
        const tempUri = uri.replace('file://', '').replace('%20', ' ')
        return Promise.resolve(readFileSync(tempUri).toString())
    } catch (e) {
        throw new Error(e as unknown as any) //todo
        // getLogger().error(`YAML Service: failed to read schema URI "${uri}": ${e}`)
        // throw new Error(`${getIdeProperties().company} Toolkit could not parse JSON schema URI: ${uri}`)
    }
}

interface Settings {
    aws?: {
        yaml?: {
            schemas?: []
            customTags?: string[]
        }
    }
}

const workspaceContext = {
    resolveRelativePath: (path: string, resource: string) => '',
} as WorkspaceContextService

const settings = new SettingsState()

// eslint-disable-next-line no-null/no-null
const yamlService = getLanguageService(resolver, workspaceContext, connection as any, null as any, settings)
yamlService.configure({
    completion: true,
    validate: true,
    hover: true,
    customTags: [],
    schemas: [],
})

connection.onDidChangeConfiguration(change => {
    const settings = <Settings>change.settings

    const customTags = !settings.aws?.yaml?.customTags ? settings.aws?.yaml?.customTags : []
    const schemas = !settings.aws?.yaml?.schemas ? [] : settings.aws?.yaml?.schemas

    yamlService.configure({
        completion: true,
        validate: true,
        hover: true,
        customTags: customTags,
        schemas: schemas,
    })
})

const validator = new TextDocumentValidator(async (document: TextDocument) => {
    const diagnostics = await yamlService.doValidation(document, false)
    connection.sendDiagnostics({ uri: document.uri, diagnostics })
}, 200)

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent(change => {
    validator.triggerValidation(change.document)
})

// a document has closed: clear all diagnostics
documents.onDidClose(event => {
    validator.cleanPendingValidation(event.document)
    connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] })
})

connection.onCompletion((textDocumentPosition, token) => {
    return runSafeAsync(
        async () => {
            const textDocument = documents.get(textDocumentPosition.textDocument.uri)
            if (!textDocument) {
                return []
            }
            return yamlService.doComplete(textDocument, textDocumentPosition.position, false)
        },
        undefined,
        `Error while computing completions for ${textDocumentPosition.textDocument.uri}`,
        token
    )
})

connection.onHover((textDocumentPositionParams, token) => {
    return runSafeAsync(
        async () => {
            const textDocument = documents.get(textDocumentPositionParams.textDocument.uri)
            if (!textDocument) {
                // eslint-disable-next-line no-null/no-null
                return null
            }
            return yamlService.doHover(textDocument, textDocumentPositionParams.position)
        },
        undefined,
        `Error while computing hover for ${textDocumentPositionParams.textDocument.uri}`,
        token
    )
})

// Listen on the connection
connection.listen()
