/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { DefaultAmazonQAppInitContext } from '../../amazonq/apps/initContext'
import { Messenger } from '../../amazonqFeatureDev/controllers/chat/messenger/messenger'
import { AppToWebViewMessageDispatcher } from '../../amazonqFeatureDev/views/connector/connector'

describe('Test Amazon Q Feature Dev', function () {
    it('Create a new feature dev tab', async () => {
        const context = DefaultAmazonQAppInitContext.instance

        // TODO: Create the equivalent of this but for testing, it's currently just using the
        const testMessenger = new Messenger(
            new AppToWebViewMessageDispatcher(context.getAppsToWebViewMessagePublisher())
        )

        // Create the tab
        testMessenger.newTab()

        // Listen until we get a tab added event
        const tabID = await Promise.resolve(resolve => {
            context.getAppsToWebViewMessageListener().onMessage(event => {
                // This command needs to be implemented
                if (event.command === 'tab-added') {
                    resolve(event.tabID)
                }
            })
        })

        // Send a prompt to the current tab
        testMessenger.sendPrompt(tabID, '/dev')

        testMessenger.clickFollowUp(tabID, 'examples')

        // This is fire and forget so we initiate the request and then wait for a response after
        testMessenger.getLastMessage(tabID)

        // Listen for the last tab message
        const lastMessage = await Promise.resolve(resolve => {
            context.getAppsToWebViewMessageListener().onMessage(event => {
                // This command needs to be implemented
                if (event.command === 'last-message') {
                    resolve(event.lastMessage)
                }
            })
        })

        assert.deepStrictEqual(lastMessage, 'you can do x,y,z with featuredev')

        testMessenger.sendPrompt(tabID, 'I want to implement fibonacci in in typescript')

        // Wait for a response
        testMessenger.waitForLoadingToFinish(tabID)

        await Promise.resolve(resolve => {
            context.getAppsToWebViewMessageListener().onMessage(event => {
                // This command needs to be implemented
                if (event.command === 'loading-finished') {
                    resolve()
                }
            })
        })

        testMessenger.clickFollowUp(tabID, 'New plan')
    })
})
