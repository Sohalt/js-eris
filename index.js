const eris2 = require('./src/eris2.js')
const base32 = require('./src/base32.js')

async function main () {
  const encoded = await eris2.encodeToMap('Hello world!', 1024)

  const getBlock = (reference) => encoded.blocks.get(base32.encode(reference))

  for await (const value of eris2.decode(encoded.urn, getBlock)) {
    console.log(value)
  }

  console.log(await eris2.decodeToString(encoded.urn, getBlock))
}

main()
