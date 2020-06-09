const ERIS = require('js-eris')
const CID = require('cids')
const multihash = require('multihashes')

module.exports = function (ipfs) {
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
