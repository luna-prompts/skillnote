import assert from 'node:assert/strict'
import minimatch, { Minimatch, minimatch as namedMinimatch } from './index.cjs'

assert.equal(typeof minimatch, 'function')
assert.equal(typeof namedMinimatch, 'function')
assert.equal(typeof Minimatch, 'function')
assert.equal(minimatch('src/app.ts', 'src/*.ts'), true)
assert.equal(namedMinimatch('src/app.ts', 'src/*.ts'), true)
assert.equal(new Minimatch('src/*.ts').match('src/app.ts'), true)
