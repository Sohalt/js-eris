const crypto = require('./crypto.js')
const base32 = require('./base32.js')

function ContentAddressableStorage (put, get) {
  this.put = put
  this.get = get
}

/* Dummy Content-addressable storage that does not store anything
 */
function NullContentAddressableStorage () {
  ContentAddressableStorage.call(
    this,
    async function (block) {
      return crypto.hash(block)
    }, async function (ref) {
      throw new Error('can not retrieve block')
    }
  )
}

/* A in-memory content-addressable storage backed by a Map
 * */
function MapContentAddressableStorage () {
  this._map = new Map()
  ContentAddressableStorage.call(
    this,
    async function (block) {
      const ref = await crypto.hash(block)
      const key = base32.encode(ref)
      this._map.set(key, block)
      return ref
    }, async function (ref) {
      const key = base32.encode(ref)
      return this._map.get(key)
    }
  )
}

/* Helper to read blocks from a buffer
 */
function * blockGenerator (buffer, blockSize = 4096) {
  // yield blocks
  while (buffer.byteLength >= blockSize) {
    const block = buffer.slice(0, blockSize)
    buffer = buffer.slice(blockSize)
    yield block
  }

  // yield remaining buffer if not empty
  if (buffer.lenght > 0) yield buffer
}

function baseEncode (n, encoded = []) {
  if (n > 0) {
    const r = n % 128
    encoded.push(r)
    return baseEncode((n - r) / 128, encoded)
  } else {
    return encoded.reverse()
  }
}

/* Compute nonce from node position (level and count)
 */
function nodeNonce (level, count) {
  const baseEncoded = baseEncode(count)
  const levelShift = new Array(level - 1).fill(255)
  const padding = new Array(12 - level + 1 - baseEncoded.length).fill(0)

  return Uint8Array.from(padding.concat(baseEncoded).concat(levelShift))
}

async function buildMerkleTree (input, verificationKey, cas) {

  // Helper to increment level counter
  function incrementLevelCount (state, level) {
    state.levelCount.set(level, (state.levelCount.get(level) || 0) + 1)
  }

  // Helper to add a reference to a level
  function addRefToLevel (state, ref, level) {
    if (state.levels.has(level)) {
      state.levels.get(level).push(ref)
    } else {
      state.levels.set(level, [ref])
    }
    incrementLevelCount(state, level)
  }

  // Helper to create a node from array of references
  function createNode (refs) {
    const node = new Uint8Array(4096)

    for (const i in refs) {
      node.set(refs[i], 32 * i)
    }

    return node
  }

  // Collect all reference at level into a single node at level above
  async function forceCollect (state, level) {
    const nodeLevel = level + 1
    const nodeCount = state.levelCount.get(nodeLevel) || 0

    // compute nonce from node position
    const nonce = nodeNonce(nodeLevel, nodeCount)

    // create node
    const node = createNode(state.levels.get(level))

    // encrypt node
    const nodeEncrypted = await crypto.stream_xor(node, nonce, verificationKey)

    // put encrypted node in content-addressable storage
    const ref = await cas.put(nodeEncrypted)

    // add reference to level
    addRefToLevel(state, ref, nodeLevel)

    // clear the current level
    state.levels.delete(level)
  }

  // Collect references at a level if there are enough to fill a node and recurse up
  async function collect (state, level) {
    const levelRefs = state.levels.get(level)
    if (levelRefs && levelRefs.length >= 128) {
      await forceCollect(state, level)
      await collect(state, level + 1)
    }
  }

  // Finalize remaining levels to a single root reference
  async function finalize (state, level) {
    const topLevel = Array.from(state.levels.keys()).reduce((a, b) => Math.max(a, b))
    const currentLevel = state.levels.get(level) || []

    if ((level === topLevel) && (currentLevel.length === 1)) {
      // If current level is top level and there is only one ref,
      // then it is the root reference
      return { level: level, rootReference: currentLevel[0] }
    } else if (currentLevel.length > 0) {
      // if current level is non-empty, collect level and finalize at next level
      await forceCollect(state, level)
      return finalize(state, level + 1)
    } else if (currentLevel.length === 0) {
      // if current level is empty, finalize at next level
      return finalize(state, level + 1)
    }
  }

  // Initalize state
  const state = {
    levels: new Map(),
    levelCount: new Map()
  }

  // Get data blocks from input
  for (const dataBlock of blockGenerator(input)) {
    // put data block in content-addressable storage
    const dataBlockRef = await cas.put(dataBlock)

    // add the reference to level 0 of the tree
    addRefToLevel(state, dataBlockRef, 0)

    // collect references from level 0 to a node
    await collect(state, 0)
  }

  // return a single root reference
  return finalize(state, 0)
}

function makeCapability(type, level, rootReference, readKey) {
  const cap = new Uint8Array(67)

  // Set version to 0
  cap.set([0], 0)

  // Set type
  cap.set([0], type)

  // Set level
  cap.set([level], 2)

  // Set root reference
  cap.set(rootReference, 3)

  // Set key
  cap.set(readKey, 35)

  return 'urn:erisx:'.concat(base32.encode(cap))
}

function decodeCapability (cap) {
  if (cap.substring(0, 10) === 'urn:erisx:') {
    const buffer = base32.decode(cap.substring(10))
    const view = new Uint8Array(buffer)

    const version = view[0]
    if (version !== 0) throw new Error('Capability has unsupported ERIS version')

    const type = view[1]
    if (!(type === 0 || type === 1)) throw new Error('Unknown capability type')

    const level = view[2]

    const rootReference = view.slice(3,35)
    if (rootReference.length !== 32) throw new Error('Could not extract root reference from ERIS capability')

    const key = view.slice(35, 67)
    if (key.length !== 32) throw new Error('Could not extract key from ERIS capability')
   
    return {
      version: version,
      type: type,
      level: level,
      rootReference: rootReference,
      key: key
    }
  } else {
    throw new Error('Can not decode ERIS URN.')
  }
}

async function put (content, cas = new NullContentAddressableStorage()) {
  // read key is the hash of the content
  const readKey = await crypto.hash(content)

  // pad the content to evenly fit into 4kB blocks
  const padded = await crypto.pad(content)

  // encrypt padded content with read key and 0 nonce
  const nonce = new Uint8Array(crypto.stream_xor_noncebytes)
  const paddedAndEncrypted = await crypto.stream_xor(padded, nonce, readKey)

  // derive the verification key from the read key
  const verificationKey = await crypto.derive_verification_key(readKey)

  const tree = await buildMerkleTree(paddedAndEncrypted, verificationKey, cas)

  return makeCapability(0, tree.level, tree.rootReference, readKey)
}

async function * decodeTree (cas, verificationKey, ref, nodeLevel, nodeCount) {

  // Get block from cas
  const block = await cas.get(ref)
  if (block === undefined) throw new Error('Can not get block: ' + base32.encode(ref))

  // check integrity of block
  const blockHash = await crypto.hash(block)
  if (!await crypto.memcmp(ref, blockHash)) throw new Error('Block is corrupted: ' + base32.encode(ref))

  if (nodeLevel === 0) {
    // if level 0, then it is a data block
    yield block
  } else {
    // decode node
    const nonce = nodeNonce(nodeLevel, nodeCount)
    const decodedBlock = await crypto.stream_xor(block, nonce, verificationKey)

    // Counter for children
    var i = 0

    // read child refs from decoded blocks
    for (const childRef of blockGenerator(decodedBlock, 32)) {
      if (!(await crypto.is_zero(childRef))) {
        const childLevel = nodeLevel - 1
        const childCount = (128 * nodeCount) + i

        // decode sub-tree
        yield * decodeTree(cas, verificationKey, childRef, childLevel, childCount)

        // increment the child counter
        i++
      }
    }
  }
}

async function concatBlocks (iterable) {
  const blocks = []
  for await (const block of iterable) {
    blocks.push(block)
  }

  const out = new Uint8Array(blocks.length * 4096)

  for (const i in blocks) {
    out.set(blocks[i], i * 4096)
  }

  return out
}

async function get (capability, cas) {
  capability = decodeCapability(capability)

  if (capability.type !== 0) {
    throw new Error('Not a read capability')
  }

  const verificationKey = await crypto.derive_verification_key(capability.key)

  const blockGenerator = decodeTree(cas, verificationKey, capability.rootReference, capability.level, 0)

  const encrypted = await concatBlocks(blockGenerator)

  const nonce = new Uint8Array(crypto.stream_xor_noncebytes)
  const padded = await crypto.stream_xor(encrypted, nonce, capability.key)

  const unpadded = await crypto.unpad(padded)

  return unpadded
}

async function verify (capability, cas) {
  capability = decodeCapability(capability)

  var verificationKey

  if (capability.type !== 0) {
    verificationKey = await crypto.derive_verification_key(capability.key)
  } else {
    verificationKey = capability.key
  }

  const blockGenerator = decodeTree(cas, verificationKey, capability.rootReference, capability.level, 0)

  await concatBlocks(blockGenerator)

  return true
}

async function deriveVerificationCapability (capability) {
  capability = decodeCapability(capability)

  if (capability.type !== 0) {
    throw new Error('Not a read capability')
  }

  const verificationKey = await crypto.derive_verification_key(capability.key)
  return makeCapability(1, capability.level, capability.rootReference, verificationKey)
}

module.exports = {
  ContentAddressableStorage: ContentAddressableStorage,
  NullContentAddressableStorage: NullContentAddressableStorage,
  MapContentAddressableStorage: MapContentAddressableStorage,

  put: put,
  get: get,
  verify: verify,

  deriveVerificationCapability: deriveVerificationCapability
}
