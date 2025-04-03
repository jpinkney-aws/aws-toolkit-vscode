/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
    EventEmitter,
    CancellationToken,
    Webview,
    WebviewView,
    WebviewViewProvider,
    WebviewViewResolveContext,
    Uri,
} from 'vscode'
import { QuickActionCommandGroup } from '@aws/mynah-ui'
import { globals, isSageMaker, LanguageServerResolver } from 'aws-core-vscode/shared'
import path from 'path'
import { AuthUtil } from 'aws-core-vscode/codewhisperer'
import { featureConfig } from 'aws-core-vscode/amazonq'

export class AmazonQChatViewProvider implements WebviewViewProvider {
    public static readonly viewType = 'aws.amazonq.AmazonQChatView'
    private readonly onDidResolveWebviewEmitter = new EventEmitter<void>()
    public readonly onDidResolveWebview = this.onDidResolveWebviewEmitter.event

    webview: Webview | undefined

    private readonly quickActionCommands: QuickActionCommandGroup[] = [
        {
            groupName: 'Quick Actions',
            commands: [
                {
                    command: '/help',
                    icon: 'help',
                    description: 'Learn more about Amazon Q',
                },
                {
                    command: '/clear',
                    icon: 'trash',
                    description: 'Clear this session',
                },
            ],
        },
    ]

    constructor(private readonly mynahUIPath: string) {}

    public async resolveWebviewView(
        webviewView: WebviewView,
        context: WebviewViewResolveContext,
        _token: CancellationToken
    ) {
        this.webview = webviewView.webview

        const lspDir = Uri.parse(LanguageServerResolver.defaultDir)
        const dist = Uri.joinPath(globals.context.extensionUri, 'dist')
        const foo = Uri.parse('/Users/jpink/workplace/language-servers/chat-client/build/') // TODO remove this, only for testing
        webviewView.webview.options = {
            enableScripts: true,
            enableCommandUris: true,
            localResourceRoots: [lspDir, dist, foo],
        }

        const source = 'vue/src/amazonq/webview/ui/amazonq-ui-connector-adapter.js' // Sent to dist/vue folder in webpack.
        const serverHostname = process.env.WEBPACK_DEVELOPER_SERVER
        const connectorAdapterPath =
            serverHostname !== undefined
                ? Uri.parse(serverHostname)
                      .with({ path: `/${source}` })
                      .toString()
                : webviewView.webview.asWebviewUri(Uri.parse(path.join(dist.fsPath, source))).toString()
        const uiPath = webviewView.webview.asWebviewUri(Uri.parse(this.mynahUIPath)).toString()
        webviewView.webview.html = await this.getWebviewContent(uiPath, connectorAdapterPath)

        this.onDidResolveWebviewEmitter.fire()
    }

    private async getWebviewContent(mynahUIPath: string, hybridChatConnector: string) {
        const featureConfigData = await featureConfig.getFeatureConfigs()
        // const featureConfigs = featureConfig.serialize(featureConfigData)
        const disabledCommands = isSageMaker() ? `['/dev', '/transform']` : '[]'
        const disclaimerAcknowledged = globals.globalState.tryGet('aws.amazonq.disclaimerAcknowledged', Boolean, false)
        const welcomeCount = globals.globalState.tryGet('aws.amazonq.welcomeChatShowCount', Number, 0)
        const entrypoint = process.env.WEBPACK_DEVELOPER_SERVER
            ? 'http: localhost'
            : 'https: file+.vscode-resources.vscode-cdn.net'

        const contentPolicy = `default-src ${entrypoint} data: blob: 'unsafe-inline';
            script-src ${entrypoint} filesystem: ws: wss: 'unsafe-inline';`

        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta http-equiv="Content-Security-Policy" content="${contentPolicy}">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Chat</title>
            <style>
                body,
                html {
                    background-color: var(--mynah-color-bg);
                    color: var(--mynah-color-text-default);
                    height: 100%;
                    width: 100%;
                    overflow: hidden;
                    margin: 0;
                    padding: 0;
                }
            </style>
        </head>
        <body>
            <script type="text/javascript" src="${mynahUIPath.toString()}" defer onload="init()"></script>
            <script type="text/javascript" src="${hybridChatConnector.toString()}"></script>
            <script type="text/javascript">
                const init = () => {
                    const hybridChatConnector = new HybridChatAdapter(${(await AuthUtil.instance.getChatAuthState()).amazonQ === 'connected'},${featureConfigData},${welcomeCount},${disclaimerAcknowledged},${disabledCommands})
                    const connectorsConfig = {
                        quickActionCommands: [hybridChatConnector.initialQuickActions[0]]
                    }
                    amazonQChat.createChat(acquireVsCodeApi(), {disclaimerAcknowledged: false, quickActionCommands: ${JSON.stringify(this.quickActionCommands)}}, connectorsConfig, hybridChatConnector);
                }
            </script>
        </body>
        </html>`
    }
}
