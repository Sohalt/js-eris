// SPDX-FileCopyrightText: 2021 pukkamustard <pukkamustard@posteo.net>
//
// SPDX-License-Identifier: LGPL-3.0-or-later

const Blake2b = require('blake2b')
var Chacha20 = require('chacha20-universal')

const nullNonce = new Uint8Array(12)

module.exports = {

  blake2b: async function (message, key) {
    const hash = Blake2b(32, key)

    hash.update(message)
    var output = new Uint8Array(32)
    hash.digest(output)

    return output
  },

  chacha20: async function (input, key) {
    var xor = new Chacha20(nullNonce, key)

    var output = new Uint8Array(input.length)
    xor.update(output, input)

    return output
  },

  pad: async function (buf, blockSize) {
    // number of blocks required
    const n = Math.floor(buf.length / blockSize) + 1

    var output = new Uint8Array(n * blockSize)

    // place original data at start of output
    output.set(buf)

    // set the magic byte 0x80
    output[buf.length] = 0x80

    return output
  },

  unpad: async function (buf, blockSize) {
    var n = buf.reduceRight((acc, byte, index) => {
      if (acc) {
        return acc
      } else if (byte === 0) {
        return acc
      } else if (byte === 0x80) {
        return index
      }
    }, false)

    return buf.slice(0, n)
  },

  stream_xor: async function (input, nonce, key) {
  },

  is_zero: async function (buf) {
    return buf.reduce((acc, byte) => (byte === 0) && acc, true)
  },

  memcmp: async function (a, b) {
    return (a.length === b.length) && a.reduce((acc, byte, index) => (byte === b[index]) && acc, true)
  }
}
