const IPFS = require('ipfs')
const ERIS = require('js-eris')
const CID = require('cids')
const multihash = require('multihashes')
const fs = require('fs').promises

function IPFSContentAddressableStorage (ipfs) {
  ERIS.ContentAddressableStorage.call(
    this,
    async function (block) {
      // put block in IPFS
      const ipfsBlock = await ipfs.block.put(Buffer.from(block), {
        version: 1, // CIDv1
        format: 'raw', // don't do any tricks IPFS
        mhtype: 'blake2b-256' // use BLAKE2b (256bit)
      })

      // decode the multihash
      const mhash = await multihash.decode(ipfsBlock.cid.multihash)

      // return the digest
      return Uint8Array.from(mhash.digest)
    },
    async function (ref) {
      // encode ref as mhash
      const mhash = multihash.encode(Buffer.from(ref), 'blake2b-256')
      // and as cid
      const cid = new CID(1, 'raw', mhash)

      // get block from IPFS
      const block = await ipfs.block.get(cid)

      return Uint8Array.from(block.data)
    }
  )
}

async function main () {
  const node = await IPFS.create()
  const version = await node.version()

  console.log('JS-IPFS Version:', version.version)

  // Create a Content-addressable storage for ERIS backed by IPFS
  const cas = new IPFSContentAddressableStorage(node)

  // read the duck-rabbit.png file
  const file = await fs.open('../duck-rabbit.png')
  const input = await file.readFile()
  await file.close()

  // Encode the file using ERIS and place blocks in IPFS
  const urn = await ERIS.put(input, cas)

  console.log('\nduck-rabbit.png stored.\nERIS URN: ', urn)

  // Decode content with ERIS from IPFS
  const content = await ERIS.get(urn, cas)

  await node.stop()
}

main().catch(console.error)
