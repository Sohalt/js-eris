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

module.exports = {
  encode: encode
}
