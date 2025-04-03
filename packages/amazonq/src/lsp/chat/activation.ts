/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as vscode from 'vscode'
import { window } from 'vscode'
import { LanguageClient } from 'vscode-languageclient'
import { AmazonQChatViewProvider } from './webviewProvider'
import { registerCommands } from './commands'
import { registerLanguageServerEventListener, registerMessageListeners } from './messages'
import { globals, i18n, waitUntil } from 'aws-core-vscode/shared'
import { MynahIconsType, MynahUIDataModel, QuickActionCommand } from '@aws/mynah-ui'
import { LspClient, LspController } from 'aws-core-vscode/amazonq'
import path from 'path'
import { AuthUtil, CodeWhispererSettings } from 'aws-core-vscode/codewhisperer'

export async function activate(languageClient: LanguageClient, encryptionKey: Buffer, mynahUIPath: string) {
    const provider = new AmazonQChatViewProvider(mynahUIPath)

    globals.context.subscriptions.push(
        window.registerWebviewViewProvider(AmazonQChatViewProvider.viewType, provider, {
            webviewOptions: {
                retainContextWhenHidden: true,
            },
        })
    )

    /**
     * Commands are registered independent of the webview being open because when they're executed
     * they focus the webview
     **/
    registerCommands(provider)
    registerLanguageServerEventListener(languageClient, provider)

    // start the workspace indexing language server
    await LspController.instance.trySetupLsp(globals.context, {
        startUrl: AuthUtil.instance.startUrl,
        maxIndexSize: CodeWhispererSettings.instance.getMaxIndexSize(),
        isVectorIndexEnabled: CodeWhispererSettings.instance.isLocalIndexEnabled(),
    })

    const onAdd = async (filePaths: string[]) => {
        const indexSeqNum = await LspClient.instance.getIndexSequenceNumber()
        await LspClient.instance.updateIndex(filePaths, 'add')
        await waitUntil(
            async () => {
                const newIndexSeqNum = await LspClient.instance.getIndexSequenceNumber()
                if (newIndexSeqNum > indexSeqNum) {
                    await processContextCommandUpdateMessage(provider)
                    return true
                }
                return false
            },
            { interval: 500, timeout: 5_000, truthy: true }
        )
    }
    const onRemove = async (filePaths: string[]) => {
        const indexSeqNum = await LspClient.instance.getIndexSequenceNumber()
        await LspClient.instance.updateIndex(filePaths, 'remove')
        await waitUntil(
            async () => {
                const newIndexSeqNum = await LspClient.instance.getIndexSequenceNumber()
                if (newIndexSeqNum > indexSeqNum) {
                    await processContextCommandUpdateMessage(provider)
                    return true
                }
                return false
            },
            { interval: 500, timeout: 5_000, truthy: true }
        )
    }

    globals.context.subscriptions.push(
        vscode.workspace.onDidCreateFiles(async (e) => {
            await onAdd(e.files.map((f) => f.fsPath))
        }),
        vscode.workspace.onDidDeleteFiles(async (e) => {
            await onRemove(e.files.map((f) => f.fsPath))
        }),
        vscode.workspace.onDidRenameFiles(async (e) => {
            await onRemove(e.files.map((f) => f.oldUri.fsPath))
            await onAdd(e.files.map((f) => f.newUri.fsPath))
        })
    )

    provider.onDidResolveWebview(() => {
        registerMessageListeners(languageClient, provider, encryptionKey)
        void processContextCommandUpdateMessage(provider)
    })
}

async function processContextCommandUpdateMessage(provider: AmazonQChatViewProvider) {
    // when UI is ready, refresh the context commands
    const contextCommand: MynahUIDataModel['contextCommands'] = [
        {
            commands: [
                {
                    command: i18n('AWS.amazonq.context.folders.title'),
                    children: [
                        {
                            groupName: i18n('AWS.amazonq.context.folders.title'),
                            commands: [],
                        },
                    ],
                    description: i18n('AWS.amazonq.context.folders.description'),
                    icon: 'folder' as MynahIconsType,
                },
                {
                    command: i18n('AWS.amazonq.context.files.title'),
                    children: [
                        {
                            groupName: i18n('AWS.amazonq.context.files.title'),
                            commands: [],
                        },
                    ],
                    description: i18n('AWS.amazonq.context.files.description'),
                    icon: 'file' as MynahIconsType,
                },
                {
                    command: i18n('AWS.amazonq.context.code.title'),
                    children: [
                        {
                            groupName: i18n('AWS.amazonq.context.code.title'),
                            commands: [],
                        },
                    ],
                    description: i18n('AWS.amazonq.context.code.description'),
                    icon: 'code-block' as MynahIconsType,
                },
                {
                    command: i18n('AWS.amazonq.context.prompts.title'),
                    children: [
                        {
                            groupName: i18n('AWS.amazonq.context.prompts.title'),
                            commands: [],
                        },
                    ],
                    description: i18n('AWS.amazonq.context.prompts.description'),
                    icon: 'magic' as MynahIconsType,
                },
            ],
        },
    ]

    const symbolsCmd: QuickActionCommand = contextCommand[0].commands?.[2]
    const promptsCmd: QuickActionCommand = contextCommand[0].commands?.[3]

    // Add create prompt button to the bottom of the prompts list
    promptsCmd.children?.[0].commands.push({
        command: i18n('AWS.amazonq.savedPrompts.action'),
        id: 'create-saved-prompt',
        icon: 'list-add' as MynahIconsType,
    })

    const lspClientReady = await LspClient.instance.waitUntilReady()
    if (lspClientReady) {
        const contextCommandItems = await LspClient.instance.getContextCommandItems()
        const folderCmd: QuickActionCommand = contextCommand[0].commands?.[1]
        const filesCmd: QuickActionCommand = contextCommand[0].commands?.[2]

        for (const contextCommandItem of contextCommandItems) {
            const wsFolderName = path.basename(contextCommandItem.workspaceFolder)
            if (contextCommandItem.type === 'file') {
                filesCmd.children?.[0].commands.push({
                    command: path.basename(contextCommandItem.relativePath),
                    description: path.join(wsFolderName, contextCommandItem.relativePath),
                    route: [contextCommandItem.workspaceFolder, contextCommandItem.relativePath],
                    label: 'file',
                    id: contextCommandItem.id,
                    icon: 'file' as MynahIconsType,
                })
            } else if (contextCommandItem.type === 'folder') {
                folderCmd.children?.[0].commands.push({
                    command: path.basename(contextCommandItem.relativePath),
                    description: path.join(wsFolderName, contextCommandItem.relativePath),
                    route: [contextCommandItem.workspaceFolder, contextCommandItem.relativePath],
                    label: 'folder',
                    id: contextCommandItem.id,
                    icon: 'folder' as MynahIconsType,
                })
            }
            // TODO: Remove the limit of 25k once the performance issue of mynahUI in webview is fixed.
            else if (
                contextCommandItem.symbol &&
                symbolsCmd.children &&
                symbolsCmd.children[0].commands.length < 25_000
            ) {
                symbolsCmd.children?.[0].commands.push({
                    command: contextCommandItem.symbol.name,
                    description: `${contextCommandItem.symbol.kind}, ${path.join(wsFolderName, contextCommandItem.relativePath)}, L${contextCommandItem.symbol.range.start.line}-${contextCommandItem.symbol.range.end.line}`,
                    route: [contextCommandItem.workspaceFolder, contextCommandItem.relativePath],
                    label: 'code',
                    id: contextCommandItem.id,
                    icon: 'code-block' as MynahIconsType,
                })
            }
        }
    }

    void provider.webview?.postMessage({
        command: 'UPDATE_WORKSPACE_CONTEXT',
        params: contextCommand,
    })

    // this.messenger.sendContextCommandData(contextCommand)
    void LspController.instance.updateContextCommandSymbolsOnce()
}
