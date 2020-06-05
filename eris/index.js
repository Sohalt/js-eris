const crypto = require('./crypto.js')

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

/* Helper to read blocks from a buffer
 */
async function * blockGenerator (buffer, blockSize = 4096) {
  // yield blocks
  while (buffer.byteLength >= blockSize) {
    const block = buffer.slice(0, blockSize)
    buffer = buffer.slice(blockSize)
    yield block
  }

  // yield remaining buffer if not empty
  if (buffer.lenght > 0) yield buffer
}

/* Compute nonce from node position (level and count)
 */
function nodeNonce (level, count) {
  // TODO
  return new Uint8Array(12)
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
  for await (const dataBlock of blockGenerator(input)) {
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

  return buildMerkleTree(paddedAndEncrypted, verificationKey, cas)
}

module.exports = {
  ContentAddressableStorage: ContentAddressableStorage,
  NullContentAddressableStorage: NullContentAddressableStorage,
  put: put
}
