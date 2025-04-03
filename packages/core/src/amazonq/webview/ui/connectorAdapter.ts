/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ChatPrompt, MynahUI, QuickActionCommandGroup } from '@aws/mynah-ui'
import { isTabType } from './storages/tabsStorage'
// import { Connector } from './connector'
import { ObjectHandler } from './main'
import { FeatureContext } from '../../../shared/featureConfig'
import { TabDataGenerator } from './tabs/generator'

export interface ConnectorAdapter {
    mynahUI?: MynahUI
    createIdeConnector(mynahUIRef: { mynahUI: MynahUI | undefined }, ideApiPostMessage: (msg: any) => void): any // TODO: return type
    isSupportedTab(tabId: string): boolean
    handleMessageReceive(message: MessageEvent): void
    handleQuickAction(prompt: ChatPrompt, tabId: string, eventId: string | undefined): void
}

export class HybridChatAdapter implements ConnectorAdapter {
    private enableAgents: boolean
    private featureConfigsSerialized: [string, FeatureContext][]
    private welcomeCount: number
    private disclaimerAcknowledged: boolean
    private disabledCommands: string[]

    // private connector?: Connector
    private objectHandler?: ObjectHandler

    private _mynahUI?: MynahUI

    constructor(
        enableAgents: boolean,
        featureConfigsSerialized: [string, FeatureContext][],
        welcomeCount: number,
        disclaimerAcknowledged: boolean,
        disabledCommands: string[]
    ) {
        this.enableAgents = enableAgents
        this.featureConfigsSerialized = featureConfigsSerialized
        this.welcomeCount = welcomeCount
        this.disclaimerAcknowledged = disclaimerAcknowledged
        this.disabledCommands = disabledCommands
    }

    createIdeConnector(mynahUIRef: { mynahUI: MynahUI }, ideApiPostMessage: (msg: any) => void): any {
        this.mynahUI = mynahUIRef.mynahUI

        this.objectHandler = new ObjectHandler(
            ideApiPostMessage,
            this.mynahUI,
            this.enableAgents,
            this.featureConfigsSerialized,
            this.welcomeCount,
            this.disclaimerAcknowledged,
            this.disabledCommands
        )

        /**
         * By default its spawed by the same handler that was created in the old mynah ui; we need to swap it with the new one that routes messages
         * to both flare or the old implementation depending on the feature
         */
        this.objectHandler.mynahUI = mynahUIRef.mynahUI

        return {
            mynahUI: mynahUIRef.mynahUI,
            mynahUIProps: this.objectHandler.mynahUIProps,
            ideApiPostMessage: ideApiPostMessage,
        }
    }

    isSupportedTab(tabId: string): boolean {
        const tabType = this.objectHandler?.tabsStorage.getTab(tabId)?.type
        if (!tabType) {
            return false
        }
        return isTabType(tabType) && tabType !== 'cwc'
    }

    async handleMessageReceive(message: MessageEvent): Promise<void> {
        // eslint-disable-next-line aws-toolkits/no-console-log
        console.log('received message: %O', message)
        // eslint-disable-next-line aws-toolkits/no-console-log
        console.log(this.objectHandler)
        if (this.objectHandler) {
            return this.objectHandler?.connector?.handleMessageReceive(message)
        }

        // eslint-disable-next-line aws-toolkits/no-console-log
        console.error('unknown message')
    }

    handleQuickAction(prompt: ChatPrompt, tabId: string, eventId: string | undefined): void {
        return this.objectHandler?.quickActionHandler?.handle(prompt, tabId, eventId)
    }

    set mynahUI(mynahUI: MynahUI | undefined) {
        this._mynahUI = mynahUI
        if (this.objectHandler) {
            this.objectHandler.mynahUI = mynahUI
        }
    }

    get mynahUI(): MynahUI | undefined {
        return this._mynahUI
    }

    get initialQuickActions(): QuickActionCommandGroup[] {
        const tabDataGenerator = new TabDataGenerator({
            isDocEnabled: this.enableAgents,
            isFeatureDevEnabled: this.enableAgents,
            isGumbyEnabled: this.enableAgents,
            isScanEnabled: this.enableAgents,
            isTestEnabled: this.enableAgents,
            disabledCommands: this.disabledCommands,
            commandHighlight: this.featureConfigsSerialized.find(([name]) => name === 'highlightCommand')?.[1],
        })
        return tabDataGenerator.quickActionsGenerator.generateForTab('cwc') ?? []
    }
}
