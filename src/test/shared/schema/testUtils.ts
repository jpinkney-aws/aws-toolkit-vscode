/*!
 * Copyright 2022 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as assert from 'assert'
import { FakeExtensionContext } from '../../fakeExtensionContext'
import { getDefaultSchemas } from '../../../shared/schemas'
import { fromFile } from '../../testUtil'

export type JSONValue = string | boolean | number | null | JSONValue[] | JSONObject

export interface JSONObject {
    [key: string]: JSONValue
}

export interface TestSchemas {
    samSchema: JSONObject
    cfnSchema: JSONObject
}

export async function getTestSchemas(): Promise<TestSchemas> {
    const fakeContext = await FakeExtensionContext.create()

    const schemas = await getDefaultSchemas(fakeContext)
    if (schemas === undefined) {
        throw new Error('An error occured when fetching the schemas. View the logs for more information.')
    }

    const samSchemaFile = fromFile(schemas.sam.fsPath)
    const samSchema = JSON.parse(samSchemaFile)

    const cfnSchemaFile = fromFile(schemas.cfn.fsPath)
    const cfnSchema = JSON.parse(cfnSchemaFile)

    return {
        samSchema,
        cfnSchema,
    }
}

/**
 * Assert whether or not name exists under definitionName in the JSON schema
 * @param schema The JSON schema
 * @param definitionName The name of the definition to use
 * @param name The name of the property to look for
 */
export function assertDefinitionProperty(schema: JSONObject, definitionName: string, name: string): void | never {
    const definitionProperties = unmarshal(schema, 'definitions', definitionName, 'properties')
    assertProperty(definitionProperties, name)
}

/**
 * Assert whether name exists at an arbitary location in the JSON schema
 * @param arbitrarySchemaLocation An arbitary location in the JSON schema
 * @param name The name of the property to look for
 */
export function assertProperty(arbitrarySchemaLocation: JSONObject, name: string): void | never {
    assert.ok(name in arbitrarySchemaLocation, `Property ${name} was not found in the "Properties" object`)
}

/**
 * Assert whether a reference exists at definitionLocation to referenceName in the JSON Schema
 * @param definitionLocation A location in the JSON schema
 * @param referenceName A name of a reference to look for
 */
export function assertRef(definitionLocation: JSONObject, referenceName: string): void | never {
    const definitionRef = definitionLocation['$ref']
    if (definitionRef !== `#/definitions/AWS::Serverless::${referenceName}`) {
        assert.fail(`The reference for ${definitionRef} did not point to ${referenceName}`)
    }
}

/**
 * Assert that definitionName is in the JSON schemas definitions
 * @param schema The JSON schema to use
 * @param definitionName The name of the definition to check
 */
export function assertDefinition(schema: JSONObject, definitionName: string): void | never {
    if (!(definitionName in (schema['definitions'] as JSONObject))) {
        assert.fail(`Definition for ${definitionName} not found`)
    }
}

/**
 * Traverse through the initial JSON object, visiting all of the properties.
 * Only suitable for accessing JSON objects.
 * @param initialObject the object you want to start the traversal at
 * @param properties the properties you want to visit and traverse into
 * @returns The location in initialObject after visiting all of properties
 */
export function unmarshal(initialObject: JSONObject, ...properties: string[]) {
    let processedObject = initialObject
    for (const propertyName of properties) {
        processedObject = processedObject[propertyName] as JSONObject
    }
    return processedObject
}
