#!/usr/bin/env node
// Smoke-test the package as npm will ship it, not the source tree.
//
// Packs the current build into a temp folder, installs the tarball into an
// empty project (dependencies come from the registry), then for every subpath
// in `exports`: `require` it, `import` it, and typecheck an import of it
// against the shipped .d.ts. 0.1.0 and 0.1.1 both needed fixes for artifacts
// that tests against `src` could not catch.
//
// Usage: npm run build && node scripts/smoke-pack.mjs

import { execFileSync, execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = process.cwd()
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const subpaths = Object.keys(pkg.exports)
    .filter((p) => p !== './package.json')
    .map((p) => (p === '.' ? pkg.name : `${pkg.name}/${p.slice(2)}`))
const tsc = createRequire(join(root, 'package.json')).resolve('typescript/bin/tsc')

const dir = mkdtempSync(join(tmpdir(), `${pkg.name}-smoke-`))
const run = (cmd) => execSync(cmd, { cwd: dir, stdio: ['ignore', 'pipe', 'inherit'] })
const node = (args) => execFileSync(process.execPath, args, { cwd: dir, stdio: 'inherit' })

try {
    const packed = JSON.parse(
        execSync(`npm pack --json --pack-destination "${dir}"`, { cwd: root }).toString()
    )
    const tarball = join(dir, packed[0].filename)
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ private: true }))
    run(`npm install --no-audit --no-fund "${tarball}" @types/node@22`)

    const cjs = subpaths.map((s) => `require(${JSON.stringify(s)})`).join(';')
    node(['-e', cjs])
    console.log(`require ok: ${subpaths.join(', ')}`)

    const esm = subpaths.map((s) => `await import(${JSON.stringify(s)})`).join(';')
    node(['--input-type=module', '-e', esm])
    console.log('import ok')

    // .cts resolves through the `require` condition, .mts through `import`.
    const check = subpaths
        .map((s, i) => `import * as m${i} from ${JSON.stringify(s)}\nvoid m${i}`)
        .join('\n')
    writeFileSync(join(dir, 'check.cts'), check)
    writeFileSync(join(dir, 'check.mts'), check)
    writeFileSync(
        join(dir, 'tsconfig.json'),
        JSON.stringify({
            compilerOptions: {
                module: 'nodenext',
                moduleResolution: 'nodenext',
                target: 'es2022',
                strict: true,
                noEmit: true,
                skipLibCheck: false,
                types: ['node']
            },
            files: ['check.cts', 'check.mts']
        })
    )
    node([tsc, '-p', dir])
    console.log('types ok')
} finally {
    rmSync(dir, { recursive: true, force: true })
}
