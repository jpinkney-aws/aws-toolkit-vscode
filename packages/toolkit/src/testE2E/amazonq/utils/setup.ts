/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { AuthUtil, getChatAuthState } from '../../../codewhisperer/util/authUtil'

export async function loginToIdC() {
    const authState = await getChatAuthState()
    if (process.env['AWS_TOOLKIT_AUTOMATION'] === 'local') {
        if (authState.amazonQ !== 'connected') {
            throw new Error('You will need to login manually before running tests.')
        }
        return
    }

    const startUrl = process.env['AWS_TOOLKIT_TEST_START_URL']
    const region = process.env['AWS_TOOLKIT_TEST_START_URL_REGION']

    if (!startUrl || !region) {
        throw new Error(
            'AWS_TOOLKIT_TEST_START_URL and AWS_TOOLKIT_TEST_START_URL_REGION are required environment variables when running Amazon Q E2E tests'
        )
    }

    await AuthUtil.instance.connectToEnterpriseSso(startUrl, region)
}
