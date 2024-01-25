/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { getLogger } from '../shared/logger/logger'
import { runTests } from '../test/testRunner'

export function run(): Promise<void> {
    getLogger().info(`Starting to run tests in ${process.env.E2E_TEST_DIRECTORY}`)
    return runTests(process.env.E2E_TEST_DIRECTORY ?? 'src/testE2E', ['src/testInteg/globalSetup.test.ts'])
}
