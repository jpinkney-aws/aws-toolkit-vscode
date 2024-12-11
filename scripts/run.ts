/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Script for compiling/building/testing npm workspaces that allows
 * processes to fail fast, rather than continuing regardless of whether
 * or not the previous build failed, which is how npm currently works
 *
 * See: https://github.com/npm/rfcs/issues/575 for the rfcs that tracks
 * this for npm
 */

import { spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as yargs from 'yargs'

interface PackageJson {
    scripts?: Record<string, string>
}

const argv = yargs
    .usage('Usage: $0 <command> [options]')
    .option('w', {
        alias: 'workspace',
        type: 'array',
        description: 'Specify workspace packages to run the command against',
    })
    .option('if-present', {
        type: 'boolean',
        description: 'Run script only if it exists in the package.json',
        default: false,
    })
    .demandCommand(1)
    .help().argv as { w?: string[]; 'if-present': boolean; _: string[] }

const command = argv._[0]
const workspaces = argv.w
const ifPresent = argv['if-present']

function findPackageDirectories(): string[] {
    const packages: string[] = []

    const workspacePatterns = workspaces || ['packages/*']

    for (const pattern of workspacePatterns) {
        const baseDir = pattern.replace('/*', '')
        if (fs.existsSync(baseDir)) {
            const dirs = fs.readdirSync(baseDir)
            for (const dir of dirs) {
                const packagePath = path.join(baseDir, dir)
                if (fs.statSync(packagePath).isDirectory() && fs.existsSync(path.join(packagePath, 'package.json'))) {
                    packages.push(packagePath)
                }
            }
        }
    }

    return packages
}

/**
 * Check if scriptName exists in packageDir's package.json
 */
function hasScript(packageDir: string, scriptName: string): boolean {
    try {
        const packageJson: PackageJson = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf-8'))
        return !!(packageJson.scripts && packageJson.scripts[scriptName])
    } catch {
        return false
    }
}

/**
 * Run npm run @param command in packageDir
 */
function runCommand(packageDir: string, command: string): Promise<void> {
    return new Promise((resolve, reject) => {
        console.log(`\nExecuting "${command}" in ${packageDir}`)

        const proc = spawn('npm', ['run', command], {
            stdio: 'inherit',
            cwd: packageDir,
            shell: true,
        })

        proc.on('close', (code) => {
            if (code === 0) {
                resolve()
            } else {
                reject(new Error(`Command failed with exit code ${code}`))
            }
        })

        proc.on('error', (err) => {
            reject(err)
        })
    })
}

async function main() {
    try {
        let packages = findPackageDirectories()

        // Filter packages if -w option is provided
        if (workspaces && workspaces.length > 0) {
            packages = workspaces
        }

        console.log(`Found packages: ${packages.join(', ')}`)

        // Run command in each package
        for (const pkg of packages) {
            if (ifPresent && !hasScript(pkg, command)) {
                console.log(`Skipping ${pkg} - script "${command}" not found`)
                continue
            }

            try {
                await runCommand(pkg, command)
            } catch (error) {
                console.error(`Error executing command in ${pkg}:`, error)
                process.exit(1)
            }
        }
    } catch (error) {
        console.error('Error:', error)
        process.exit(1)
    }
}

main()
