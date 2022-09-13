/*!
 * Copyright 2021 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as vscode from 'vscode'
import { readFileSync } from 'fs-extra'
import { VSCODE_EXTENSION_ID } from '../extensions'
import { getLogger } from '../logger/logger'
import { getIdeProperties, isCloud9 } from '../extensionUtilities'
import { activateExtension } from '../utilities/vsCodeUtils'
import { AWS_SCHEME } from '../constants'
import { getLanguageService, LanguageService, SchemasSettings, WorkspaceContextService } from 'yaml-language-server'
import { SettingsState } from 'yaml-language-server/lib/umd/yamlSettings'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { createConverter as p2cConverter } from 'vscode-languageclient/lib/protocolConverter'
import { TextDocumentValidator } from '../languageServer/utils/validator'
import { CloudFormation } from '../cloudformation/cloudformation'
import {
    DidChangeConfigurationNotification,
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind,
} from 'vscode-languageclient'
import path = require('path')
import globals from '../extensionGlobals'

// sourced from https://github.com/redhat-developer/vscode-yaml/blob/3d82d61ea63d3e3a9848fe6b432f8f1f452c1bec/src/schema-extension-api.ts
// removed everything that is not currently being used
interface YamlExtensionApi {
    registerContributor(
        schema: string,
        requestSchema: (resource: string) => string | undefined,
        requestSchemaContent: (uri: string) => string,
        label?: string
    ): boolean
}

function applyScheme(scheme: string, path: vscode.Uri): vscode.Uri {
    return path.with({ scheme })
}

function evaluate(schema: vscode.Uri | (() => vscode.Uri)): vscode.Uri {
    return schema instanceof Function ? schema() : schema
}

export interface YamlExtension {
    assignSchema(path: vscode.Uri, schema: vscode.Uri | (() => vscode.Uri)): void
    removeSchema(path: vscode.Uri): void
    getSchema(path: vscode.Uri): vscode.Uri | undefined
}

export async function activateYAMLLanguageService(): Promise<LanguageService> {
    const resolver = (uri: string): Promise<string> => {
        try {
            return Promise.resolve(readFileSync(vscode.Uri.parse(uri).fsPath).toString())
        } catch (e) {
            getLogger().error(`YAML Service: failed to read schema URI "${uri}": ${e}`)
            throw new Error(`${getIdeProperties().company} Toolkit could not parse JSON schema URI: ${uri}`)
        }
    }

    const workspaceContext = {
        resolveRelativePath: (path: string, resource: string) => '',
    } as WorkspaceContextService

    const connection = {
        onRequest(method: string, handler: any) {},
    }

    const settings = new SettingsState()

    // eslint-disable-next-line no-null/no-null
    const yamlService = getLanguageService(resolver, workspaceContext, connection as any, null as any, settings)
    configureLanguageService(yamlService, new Map())

    const converter = p2cConverter()
    const selector = [{ language: 'yaml' }, { pattern: '*.y(a)ml' }]

    function asTextDocument(document: vscode.TextDocument): TextDocument {
        return TextDocument.create(document.uri.toString(), document.languageId, document.version, document.getText())
    }

    vscode.languages.registerCompletionItemProvider(selector, {
        async provideCompletionItems(document, position, token, context) {
            const completion = await yamlService.doComplete(asTextDocument(document), position, false)

            // completion results types are conflicting for InsertReplaceEdit so just cast as any.
            // It isn't ideal but InsertReplaceEdit isn't used in yaml-language-server
            return converter.asCompletionResult(completion as any)
        },
    })

    vscode.languages.registerHoverProvider(selector, {
        async provideHover(document, position, token) {
            const hoverItem = await yamlService.doHover(asTextDocument(document), position)
            return converter.asHover(hoverItem)
        },
    })

    const diagnosticCollection = vscode.languages.createDiagnosticCollection('YAML')
    const validator = new TextDocumentValidator(async (document: TextDocument) => {
        const diagnostics = await yamlService.doValidation(document, false)
        diagnosticCollection.set(vscode.Uri.parse(document.uri), converter.asDiagnostics(diagnostics))
    }, 200)

    vscode.workspace.onDidChangeTextDocument((event: vscode.TextDocumentChangeEvent) => {
        validator.triggerValidation(asTextDocument(event.document))
    })

    vscode.workspace.onDidCloseTextDocument((document: vscode.TextDocument) => {
        validator.cleanPendingValidation(asTextDocument(document))
        diagnosticCollection.set(document.uri, [])
    })

    return yamlService
}

function configureLanguageService(languageService: LanguageService, schemaMap: Map<string, vscode.Uri>): void {
    const schemaSettings: SchemasSettings[] = []
    for (const [filePath, schemaUri] of schemaMap) {
        schemaSettings.push({
            fileMatch: [filePath],
            uri: 'file://' + encodeURI(schemaUri.fsPath), // the file system path is encoded because os x has a space in the path and markdown will fail
        })
    }
    languageService.configure({
        completion: true,
        validate: true,
        hover: true,
        customTags: CloudFormation.cloudFormationTags,
        schemas: schemaSettings,
    })
}

export async function activate() {
    const toDispose = globals.context.subscriptions

    // The server is implemented in node
    const serverModule = globals.context.asAbsolutePath(path.join('dist/src/shared/extensions/', 'yamlServer.js'))
    // The debug options for the server
    // --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
    const debugOptions = { execArgv: ['--nolazy', '--inspect=6011'] }

    // If the extension is launch in debug mode the debug server options are use
    // Otherwise the run options are used
    const serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: { module: serverModule, transport: TransportKind.ipc, options: debugOptions },
    }

    const documentSelector = [{ language: 'yaml' }, { pattern: '*.y(a)ml' }]

    // Options to control the language client
    const clientOptions: LanguageClientOptions = {
        // Register the server for json documents
        documentSelector,
        initializationOptions: {
            handledSchemaProtocols: ['file', 'untitled'], // language server only loads file-URI. Fetching schemas with other protocols ('http'...) are made on the client.
        },
        synchronize: {},
    }

    // Create the language client and start the client.
    const client = new LanguageClient('yaml', 'yaml', serverOptions, clientOptions)

    const disposable = client.start()
    toDispose.push(disposable)

    await client.onReady()

    return client
}

function onSettingsChanged(client: LanguageClient, schemaMap: Map<string, vscode.Uri>) {
    const schemaSettings: SchemasSettings[] = []
    for (const [filePath, schemaUri] of schemaMap) {
        schemaSettings.push({
            fileMatch: [filePath],
            uri: 'file://' + encodeURI(schemaUri.fsPath), // the file system path is encoded because os x has a space in the path and markdown will fail
        })
    }

    client.sendNotification(DidChangeConfigurationNotification.type, {
        // eslint-disable-next-line no-null/no-null
        settings: {
            // eslint-disable-next-line no-null/no-null
            aws: {
                yaml: {
                    schemas: schemaSettings,
                },
            },
        },
    })
}

export async function activateYamlExtension(): Promise<YamlExtension | undefined> {
    const schemaMap = new Map<string, vscode.Uri>()

    if (!isCloud9()) {
        // const languageService = await activateYAMLLanguageService()
        const languageClient = await activate()
        return {
            assignSchema: async (path, schema) => {
                schemaMap.set(path.toString(), evaluate(schema))
                onSettingsChanged(languageClient, schemaMap)
                // configureLanguageService(languageService, schemaMap)
            },
            removeSchema: path => {
                schemaMap.delete(path.toString())
                onSettingsChanged(languageClient, schemaMap)
                // configureLanguageService(languageService, schemaMap)
            },
            getSchema: path => schemaMap.get(path.toString()),
        }
    }

    const yamlExt = await activateExtension<YamlExtensionApi>(VSCODE_EXTENSION_ID.yaml)
    if (!yamlExt) {
        return undefined
    }
    yamlExt.exports.registerContributor(
        AWS_SCHEME,
        resource => {
            return schemaMap.get(resource)?.toString()
        },
        uri => {
            try {
                return readFileSync(vscode.Uri.parse(uri).fsPath).toString()
            } catch (e) {
                getLogger().error(`YAML Extension: failed to read schema URI "${uri}": ${e}`)
                throw new Error(`${getIdeProperties().company} Toolkit could not parse JSON schema URI: ${uri}`)
            }
        }
    )
    return {
        assignSchema: (path, schema) => schemaMap.set(path.toString(), applyScheme(AWS_SCHEME, evaluate(schema))),
        removeSchema: path => schemaMap.delete(path.toString()),
        getSchema: path => schemaMap.get(path.toString()),
    }
}
