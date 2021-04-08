const fs = require('fs')
const base32 = require('../src/base32.js')
const ERIS = require('../src/eris.js')
const crypto = require('../src/crypto.js')

const testVectors = [
  'eris-test-vector-00.json',
  'eris-test-vector-01.json',
  'eris-test-vector-02.json',
  'eris-test-vector-03.json',
  'eris-test-vector-04.json',
  'eris-test-vector-05.json',
  'eris-test-vector-06.json',
  'eris-test-vector-07.json',
  'eris-test-vector-08.json',
  'eris-test-vector-09.json',
  'eris-test-vector-10.json',
  'eris-test-vector-11.json',
  'eris-test-vector-12.json'
]

function readTestVector (tv) {
  const raw = fs.readFileSync('./test/test-vectors/' + tv)
  return JSON.parse(raw)
}

async function runTestVector (testVector) {
  const content = new Uint8Array(base32.decode(testVector.content))
  const convergenceSecret = new Uint8Array(base32.decode(testVector['convergence-secret']))
  const blockSize = testVector['block-size']
  const urn = testVector.urn

  // encode and check URN
  const urnCheck = await ERIS.encodeToUrn(content, blockSize, convergenceSecret)

  if (urnCheck !== urn) {
    throw new Error('encode test failed - URN does not match')
  }

  // decode content from blocks
  const getBlock = (ref) => {
    const base32Ref = base32.encode(ref)
    const base32Block = testVector.blocks[base32Ref]
    return new Uint8Array(base32.decode(base32Block))
  }

  const contentCheck = await ERIS.decodeToUint8Array(urn, getBlock)

  if (!(await crypto.memcmp(contentCheck, content))) {
    throw new Error('decode test failed')
  }
}

async function runTestVectors () {
  console.log(0 + '..' + (testVectors.length - 1))
  let failed = 0
  for (const tv of testVectors) {
    const testVector = readTestVector(tv)
    try {
      await runTestVector(testVector)
      console.log('ok ' + testVector.id + ' ' + testVector.description + '')
    } catch (error) {
      console.log('not ok ' + testVector.id + ' ' + testVector.description + ': ' + error.message)
      failed = failed + 1
    }
  }
  return failed
}

async function main() {
  const failed = await runTestVectors()
  process.exit(failed)
}

main()
