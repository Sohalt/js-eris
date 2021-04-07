// SPDX-FileCopyrightText: 2021 pukkamustard <pukkamustard@posteo.net>
//
// SPDX-License-Identifier: LGPL-3.0-or-later

const sodium = require('libsodium-wrappers-sumo')

const nullNonce = new Uint8Array(12)

module.exports = {

  blake2b: async function (message, key) {
    await sodium.ready
    return sodium.crypto_generichash(32, message, key)
  },

  chacha20: async function (input, key) {
    await sodium.ready
    return sodium.crypto_stream_chacha20_ietf_xor(input, nullNonce, key)
  },

  pad: async function (buf, blockSize) {
    await sodium.ready
    return sodium.pad(buf, blockSize)
  },

  unpad: async function (buf, blockSize) {
    await sodium.ready
    return sodium.unpad(buf, blockSize)
  },

  is_zero: async function (buf) {
    await sodium.ready
    return sodium.is_zero(buf)
  },

  memcmp: async function (a, b) {
    await sodium.ready
    return sodium.memcmp(a,b)
  }

}
