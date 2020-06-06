const sodium = require('libsodium-wrappers-sumo')

const ERIS_BLOCKSIZE = 4096

module.exports = {

  hash: async function (message, key) {
    await sodium.ready
    return sodium.crypto_generichash(32, message, key)
  },

  pad: async function (buf) {
    await sodium.ready
    return sodium.pad(buf, ERIS_BLOCKSIZE)
  },

  unpad: async function (buf) {
    await sodium.ready
    return sodium.unpad(buf, ERIS_BLOCKSIZE)
  },

  stream_xor: async function (input, nonce, key) {
    await sodium.ready
    return sodium.crypto_stream_chacha20_ietf_xor(input, nonce, key)
  },

  stream_xor_noncebytes: 12,

  derive_verification_key: async function (readKey) {
    await sodium.ready
    return sodium.crypto_kdf_derive_from_key(32, 1, 'eris.key', readKey)
  },

  is_zero: async function (buf) {
    await sodium.ready
    return sodium.is_zero(buf)
  }

}
