'use strict'

const assert = require('node:assert/strict')
const minimatch = require('./index.cjs')

assert.equal(typeof minimatch, 'function')
assert.equal(typeof minimatch.minimatch, 'function')
assert.equal(typeof minimatch.Minimatch, 'function')
assert.equal(minimatch('src/app.ts', 'src/*.ts'), true)
assert.equal(minimatch.minimatch('src/app.ts', 'src/*.ts'), true)
assert.equal(new minimatch.Minimatch('src/*.ts').match('src/app.ts'), true)
assert.equal(minimatch.defaults({ dot: true })('.env', '*'), true)
