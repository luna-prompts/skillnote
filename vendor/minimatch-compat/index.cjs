'use strict'

const modern = require('minimatch-modern')

function minimatchCompat(...args) {
  return modern.minimatch(...args)
}

module.exports = minimatchCompat
module.exports.minimatch = modern.minimatch
module.exports.sep = modern.sep
module.exports.GLOBSTAR = modern.GLOBSTAR
module.exports.filter = modern.filter
module.exports.defaults = modern.defaults
module.exports.braceExpand = modern.braceExpand
module.exports.match = modern.match
module.exports.Minimatch = modern.Minimatch
module.exports.escape = modern.escape
module.exports.unescape = modern.unescape
