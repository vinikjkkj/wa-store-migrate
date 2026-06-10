#!/usr/bin/env node
// Strip the redundant .js files emitted into a declaration-only build tree.
//
// The types build (tsconfig.types.json) deliberately emits .js next to the
// .d.ts so tsc-alias can rewrite path aliases (@ir, @codec, …) to relative
// `.js` specifiers — it resolves them by probing for sibling .js files, which
// a declaration-only tree wouldn't have. Once tsc-alias has run, those .js are
// dead weight; this removes them so only the .d.ts ship.
//
// Usage: node scripts/strip-js.mjs <dir>

import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const target = process.argv[2]

if (!target) {
    console.error('usage: node scripts/strip-js.mjs <dir>')
    process.exit(1)
}

let removed = 0

const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith('.js')) {
            rmSync(full)
            removed += 1
        }
    }
}

walk(target)
console.log(`strip-js: removed ${removed} .js file(s) from ${target}`)
