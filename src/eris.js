// SPDX-FileCopyrightText: 2021 pukkamustard <pukkamustard@posteo.net>
//
// SPDX-License-Identifier: LGPL-3.0-or-later

const crypto = require('./crypto.js')
const base32 = require('./base32.js')

/* Helper to read blocks from a buffer
 */
function * blockGenerator (buffer, blockSize) {
  // yield blocks
  while (buffer.byteLength >= blockSize) {
    const block = buffer.slice(0, blockSize)
    buffer = buffer.slice(blockSize)
    yield block
  }

  // yield remaining buffer if not empty
  if (buffer.byteLength > 0) {
    yield buffer
  }
}

/* Pad the last buffer on a stream
 * */
async function * streamPad (stream, blockSize) {
  let last
  let cur = await stream.next()

  while (!cur.done) {
    if (last) { yield last }
    last = cur.value
    cur = await stream.next()
  }

  const padded = await crypto.pad(last, blockSize)
  yield * blockGenerator(padded, blockSize)
}

/* Unpad the last buffer on a stream
 * */
async function * streamUnpad (stream, blockSize) {
  let last
  let cur = await stream.next()

  while (!cur.done) {
    if (last) { yield last }
    last = cur.value
    cur = await stream.next()
  }

  const unpadded = await crypto.unpad(last, blockSize)
  yield unpadded
}

// Read capability
// ===============

function encodeReadCapability (arity, level, reference, key) {
  const cap = new Uint8Array(66)

  // set block size
  if (arity === 16) {
    cap.set([0], 0)
  } else if (arity === 512) {
    cap.set([1], 0)
  } else {
    throw new Error('Invalid arity')
  }

  // set level
  cap.set([level], 1)

  // set root reference
  cap.set(reference, 2)

  // set root key
  cap.set(key, 34)

  return 'urn:erisx2:'.concat(base32.encode(cap))
}

function decodeReadCapability (cap) {
  if (cap.substring(0, 11) === 'urn:erisx2:') {
    const buffer = base32.decode(cap.substring(11))
    const view = new Uint8Array(buffer)

    const blockSizeCode = view[0]

    let blockSize
    if (blockSizeCode === 0) {
      blockSize = 1024
    } else if (blockSizeCode === 1) {
      blockSize = 32768
    } else {
      throw new Error('Unknown block size')
    }

    const level = view[1]

    const rootReference = view.slice(2,34)
    if (rootReference.length !== 32) throw new Error('Could not extract root reference from ERIS capability')

    const key = view.slice(34, 66)
    if (key.length !== 32) throw new Error('Could not extract key from ERIS capability')

    return {
      blockSize: blockSize,
      level: level,
      rootReference: rootReference,
      key: key
    }
  }
}

// Encoding
// ========

async function encryptBlock (input, convergenceSecret) {
  const key = await crypto.blake2b(input, convergenceSecret)
  const encryptedBlock = await crypto.chacha20(input, key)
  const reference = await crypto.blake2b(encryptedBlock)
  return {
    encryptedBlock: encryptedBlock,
    reference: reference,
    key: key
  }
}

async function concatUint8Array (iterable) {
  const bufs = []
  let size = 0

  for await (const block of iterable) {
    bufs.push(block)
    size = size + block.byteLength
  }

  const out = new Uint8Array(size)

  let offset = 0
  for (const i in bufs) {
    out.set(bufs[i], offset)
    offset = offset + bufs[i].byteLength
  }

  return out
}

async function addRefKeyToLevels (levels, level, reference, key) {
  const refKey = {
    reference: reference,
    key: key
  }

  if (levels.has(level)) {
    levels.get(level).push(refKey)
  } else {
    levels.set(level, [refKey])
  }
}

async function * forceCollect (levels, level, arity, convergenceSecret) {
  // get the reference key pairs and concat them
  const rkPairs = levels.get(level).map(async function ({ reference, key }) {
    return concatUint8Array([reference, key])
  })

  // padding
  const padding = Array(arity - rkPairs.length).fill(new Uint8Array(arity * 64))

  // concat all reference-key pairs on level
  const node = await concatUint8Array(rkPairs.concat(padding))

  // clear the level
  levels.delete(level)

  // encrypt node
  const { encryptedBlock, reference, key } = await encryptBlock(node, convergenceSecret)

  // add reference-key to node in level above
  await addRefKeyToLevels(levels, level + 1, reference, key)

  // yield the encrypted node
  yield { block: encryptedBlock, reference: reference }
}

async function * collect (levels, level, arity, convergenceSecret) {
  if (levels.get(level).length >= arity) {
    // collect reference-key pairs at current level and yield blocks
    yield * forceCollect(levels, level, arity, convergenceSecret)
    // recursively go up ot next level
    yield * collect(levels, level + 1, arity, convergenceSecret)
  }
}

async function * finalize (levels, level, arity, convergenceSecret) {
  const topLevel = Array.from(levels.keys()).reduce((a, b) => Math.max(a, b))
  const currentLevel = levels.get(level) || []

  if ((level === topLevel) && (currentLevel.length === 1)) {
    // If current level is top level and there is only one ref,
    // then it is the root reference
    const { reference, key } = currentLevel[0]

    yield encodeReadCapability(arity, level, reference, key)
  } else if (currentLevel.length > 0) {
    // if current level is non-empty, collect level and finalize at next level
    yield * forceCollect(levels, level, arity, convergenceSecret)
    yield * finalize(levels, level + 1, arity, convergenceSecret)
  } else if (currentLevel.length === 0) {
    // if current level is empty, finalize at next level
    yield * finalize(levels, level + 1, arity, convergenceSecret)
  }
}

async function * streamEncode (content, blockSize, convergenceSecret) {
  // stream of padded content
  const padded = streamPad(content, blockSize)

  // arity of Merkle Tree
  const arity = blockSize / 64

  // initialize the state
  const levels = new Map()

  for await (const block of padded) {
    // encrypt block
    const { encryptedBlock, reference, key } = await encryptBlock(block, convergenceSecret)

    // add reference-key pair to state
    await addRefKeyToLevels(levels, 0, reference, key)

    // yield encrypted block
    yield { block: encryptedBlock, reference: reference }

    // attempt to collect at lowest level
    yield * collect(levels, 0, arity, convergenceSecret)
  }

  // clear remaining reference-key pairs
  yield * finalize(levels, 0, arity, convergenceSecret)
}

function encode (content, blockSize, convergenceSecret = new Uint8Array(32)) {
  const prototype = Object.prototype.toString.call(content)

  if (prototype === '[object AsyncGenerator]' || prototype === '[object Generator]') {
    streamEncode(content, blockSize, convergenceSecret)
  } else if (prototype === '[object String]') {
    const utf8Encoder = new TextEncoder()
    const contentAsUint8 = utf8Encoder.encode(content)
    const blocks = blockGenerator(contentAsUint8, blockSize)
    return streamEncode(blocks, blockSize, convergenceSecret)
  } else if (prototype === '[object Uint8Array]') {
    const blocks = blockGenerator(content, blockSize)
    return streamEncode(blocks, blockSize, convergenceSecret)
  }
}

async function encodeToUrn (content, blockSize, convergenceSecret = new Uint8Array(32)) {
  for await (const value of encode(content, blockSize, convergenceSecret)) {
    if (typeof value === 'string') {
      return value
    }
  }
}

async function encodeToMap (content, blockSize, convergenceSecret = new Uint8Array(32)) {
  const blocks = new Map()
  for await (const value of encode(content, blockSize, convergenceSecret)) {
    if (typeof value === 'string') {
      return {
        urn: value,
        blocks: blocks
      }
    } else {
      blocks.set(base32.encode(value.reference), value.block)
    }
  }
}

// Decoding
// ========

async function * decodeRecurse (level, reference, key, getBlock) {
  const encrypted = await getBlock(reference)

  if (!encrypted) {
    throw new Error('Could not get block ' + base32.encode(reference))
  }

  // check integrity of block
  const refCheck = await crypto.blake2b(encrypted)
  if (!(await crypto.memcmp(reference, refCheck))) {
    throw new Error('Block ' + base32.encode(reference) + ' corrupted.')
  }

  const decrypted = await crypto.chacha20(encrypted, key)

  if (level === 0) {
    // yield content block
    yield decrypted
  } else {
    for await (const referenceKey of blockGenerator(decrypted, 64)) {

      const reference = referenceKey.slice(0, 32)
      const key = referenceKey.slice(32, 64)

      // reached padding
      if (await crypto.is_zero(reference)) {
        return
      }

      yield * decodeRecurse(level - 1, reference, key, getBlock)
    }
  }
}

async function * decode (urn, getBlock) {
  // decode the read capability
  const { blockSize, level, rootReference, key } = decodeReadCapability(urn)

  const padded = decodeRecurse(level, rootReference, key, getBlock)

  yield * streamUnpad(padded, blockSize)
}

async function decodeToUint8Array (urn, getBlock) {
  return concatUint8Array(decode(urn, getBlock))
}

async function decodeToString (urn, getBlock) {
  const buf = await concatUint8Array(decode(urn, getBlock))

  const utf8Decoder = new TextDecoder()
  return utf8Decoder.decode(buf)
}

module.exports = {
  encode: encode,
  encodeToUrn: encodeToUrn,
  encodeToMap: encodeToMap,

  decode: decode,
  decodeToUint8Array: decodeToUint8Array,
  decodeToString: decodeToString,

  encodeReadCapability: encodeReadCapability,
  decodeReadCapability: decodeReadCapability
}
