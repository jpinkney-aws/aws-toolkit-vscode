/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as vscode from 'vscode'
import sinon from 'sinon'
import assert from 'assert'
import { closeAllEditors, TestFolder, toTextEditor, stubUtilities } from 'aws-core-vscode/test'
import { RecommendationHandler } from 'aws-core-vscode/codewhisperer'
import { Commands, waitUntil } from 'aws-core-vscode/shared'

describe('Codewhisperer e2e', async function () {
    let sandbox: sinon.SinonSandbox
    let tempFolder: string

    beforeEach(async function () {
        sandbox = sinon.createSandbox()
        const folder = await TestFolder.create()
        tempFolder = folder.path
        await closeAllEditors()
    })

    afterEach(async function () {
        sinon.reset()
        sandbox.restore()
        await closeAllEditors()
    })

    async function setupEditor({ name, contents }: { name?: string; contents?: string } = {}) {
        const fileName = name ?? 'test.ts'
        const textContents =
            contents ??
            `function fib() {


}`
        const editor = await toTextEditor(textContents, fileName, tempFolder)
        const position = new vscode.Position(1, 4)
        editor.selection = new vscode.Selection(position, position)
        return editor
    }

    async function waitForRecommendations() {
        const recommendationsSpy = sandbox.spy(RecommendationHandler.instance, 'showRecommendation')
        const completionSpy = stubUtilities.createPersistentStub(
            RecommendationHandler.instance,
            'inlineCompletionProvider'
        )
        await waitUntil(
            async () => recommendationsSpy.called && completionSpy.stub.called && completionSpy.value().length > 0,
            {
                interval: 500,
                timeout: 5000,
            }
        )
    }

    for (const [name, invokeCompletion] of [
        ['manual', async () => Commands.tryExecute('aws.amazonq.invokeInlineCompletion')],
        ['automatic', async () => vscode.commands.executeCommand('type', { text: '\n' })],
    ] as const) {
        describe(`${name} invoke`, async function () {
            let originalEditorContents: string | undefined

            describe('supported filetypes', () => {
                beforeEach(async () => {
                    await setupEditor()
                    await invokeCompletion()
                    originalEditorContents = vscode.window.activeTextEditor?.document.getText()

                    // wait until the ghost text appears
                    await waitForRecommendations()
                })

                it(`${name} invoke accept`, async function () {
                    /**
                     * keep accepting the suggestion until the text contents change
                     * this is required because we have no access to the inlineSuggest panel
                     **/
                    const acceptSuggestion = await waitUntil(
                        async () => {
                            // Accept the suggestion
                            await vscode.commands.executeCommand('editor.action.inlineSuggest.commit')
                            return vscode.window.activeTextEditor?.document.getText() !== originalEditorContents
                        },
                        {
                            interval: 250,
                            timeout: 5000,
                        }
                    )

                    assert.ok(acceptSuggestion, 'Editor contents should have changed')
                })

                it(`${name} invoke reject`, async function () {
                    // Reject the suggestion
                    await vscode.commands.executeCommand('aws.amazonq.rejectCodeSuggestion')

                    // Contents haven't changed
                    assert.deepStrictEqual(vscode.window.activeTextEditor?.document.getText(), originalEditorContents)
                })

                it(`${name} invoke discard`, async function () {
                    // Discard the suggestion by moving it back to the original position
                    const position = new vscode.Position(1, 4)
                    const editor = vscode.window.activeTextEditor
                    if (!editor) {
                        assert.fail('Could not find text editor')
                    }
                    editor.selection = new vscode.Selection(position, position)

                    // Contents are the same
                    assert.deepStrictEqual(vscode.window.activeTextEditor?.document.getText(), originalEditorContents)
                })
            })

            it(`${name} invoke on unsupported filetype`, async function () {
                await setupEditor({
                    name: 'test.zig',
                    contents: `fn doSomething() void {


}`,
                })

                await invokeCompletion()

                // there shouldn't be any completions
                await waitForRecommendations()
            })
        })
    }
})
