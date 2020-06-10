const ERIS = require('js-eris')
const rdfParser = require('rdf-parse').default
const Streamify = require('streamify-string')
const FragmentGraph = require('./rdf/fragment-graph.js')
const IPFS = require('ipfs')
const CID = require('cids')
const multihash = require('multihashes')
const base32 = require('../../../src/base32.js')
const crypto = require('../../../src/crypto.js')

const signify = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix voaf: <http://purl.org/vocommons/voaf#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .

<>
    a owl:Ontology ;
    a voaf:Vocabulary ;
    dcterms:title "RDF Signify" ;
    rdfs:label "RDF Signify";
    rdfs:comment "A vocabulary for cryptographic signatures using Ed25519."@en .

<#PublicKey>
    a rdfs:Class ;
    rdfs:label "Public Key" ;
    rdfs:comment "An Ed25519 public key" .

<#publicKey>
    a rdfs:Property ;
    rdfs:range <#PublicKey> ;
    rdfs:label "Public Key" ;
    rdfs:comment "An associated Ed25519 public key" .

<#SecretKey>
    a rdfs:Class ;
    rdfs:label "Secret Key" ;
    rdfs:comment "An Ed25519 secret key" .

<#Signature>
    a rdfs:Class ;
    rdfs:label "Signature" ;
    rdfs:comment "An Ed25519 signature" .

<#message>
   a rdf:Property ;
   rdfs:label "Signed Message" ;
   rdfs:domain <#Signature> .
`

const alyssa = `
{"@context": "https://www.w3.org/ns/activitystreams",
 "type": "Person",
 "id": "https://social.example/alyssa/",
 "name": "Alyssa P. Hacker",
 "preferredUsername": "alyssa",
 "summary": "Lisp enthusiast hailing from MIT",
 "inbox": "https://social.example/alyssa/inbox/",
 "outbox": "https://social.example/alyssa/outbox/",
 "followers": "https://social.example/alyssa/followers/",
 "following": "https://social.example/alyssa/following/",
 "liked": "https://social.example/alyssa/liked/"}
`

function MapAndIPFSContentAddressableStorage () {
  this._map = new Map()

  this._ipfsPut = async function (block) {
    // put block in IPFS
    const ipfsBlock = await this._ipfs.block.put(Buffer.from(block), {
      version: 1, // CIDv1
      format: 'raw', // don't do any tricks IPFS
      mhtype: 'blake2b-256', // use BLAKE2b (256bit)
      timeout: 2000
    })

    console.log('Put block on IPFS: ' + ipfsBlock.cid.toString())

    // decode the multihash
    const mhash = await multihash.decode(ipfsBlock.cid.multihash)

    // return the digest
    return Uint8Array.from(mhash.digest)
  }

  this._ipfsGet = async function (ref) {
    // encode ref as mhash
    const mhash = multihash.encode(Buffer.from(ref), 'blake2b-256')
    // and as cid
    const cid = new CID(1, 'raw', mhash)

    // get block from IPFS (timeout after 5s)
    const block = await this._ipfs.block.get(cid, { timeout: 2000 })

    return Uint8Array.from(block.data)
  }

  this.activateIPFS = async function () {
    const ipfs = await IPFS.create({
      config: {
        Addresses: {
          Swarm: [
            // This is a public webrtc-star server
            // '/dns4/star-signal.cloud.ipfs.team/wss/p2p-webrtc-star'
          ]
        }
      },
      repo: 'ipfs-eris',
      relay: {
        enabled: true,
        hop: {
          enabled: true
        }
      }
    })
    this._ipfs = ipfs
    const version = await ipfs.version()
    console.log('JS-IPFS Version:', version.version)
    return version
  }

  this.deactivateIPFS = async function () {
    await this._ipfs.stop()
    delete this._ipfs
  }

  ERIS.ContentAddressableStorage.call(
    this,
    async function (block) {
      const ref = await crypto.hash(block)
      const key = base32.encode(ref)
      this._map.set(key, block)

      if (this._ipfs) {
        await this._ipfsPut(block)
      }

      return ref
    }, async function (ref) {
      const key = base32.encode(ref)

      if (this._map.has(key)) {
        return this._map.get(key)
      } else if (this._ipfs) {
        return this._ipfsGet(key)
      }
    }
  )
}

function rdfParse (input, contentType) {
  return new Promise((resolve, reject) => {
    const textStream = Streamify(input)
    var fg
    rdfParser.parse(textStream, { contentType: contentType, baseIRI: 'urn:dummy' })
      .on('data', (quad) => {
        if (fg === undefined) {
          fg = new FragmentGraph(quad.subject)
          fg.addQuad(quad)
        } else {
          fg.addQuad(quad)
        }
      })
      .on('error', (error) => {
        reject(error)
      })
      .on('end', () => {
        resolve(fg.toCanonicalForm())
      })
  })
}

async function main () {
  console.log('Hail ERIS!')

  // get elements from dom
  const inputTextarea = document.getElementById('input-textarea')
  const inputLoadAliceInWonderland = document.getElementById('input-load-alice-in-wonderland')
  const inputLoadSampleVocabulary = document.getElementById('input-load-sample-vocabulary')
  const inputLoadSampleActor = document.getElementById('input-load-sample-actor')

  const controlsEncode = document.getElementById('controls-encode')
  const controlsDecode = document.getElementById('controls-decode')
  const controlsVerify = document.getElementById('controls-verify')
  const controlsInputType = document.getElementById('controls-input-type')
  const controlsError = document.getElementById('controls-error')
  const controlsSuccess = document.getElementById('controls-success')

  const encodedErisReadCap = document.getElementById('encoded-eris-read-cap')
  const encodedErisVerificationCap = document.getElementById('encoded-eris-verification-cap')
  const blockContainer = document.getElementById('block-container')
  const checkBoxEnableIPFS = document.getElementById('checkbox-enable-ipfs')

  // a ContentAddressableStorage based on a JavaScript Map and optionally on IPFS
  const cas = new MapAndIPFSContentAddressableStorage()

  // a TextEncoder for encoding strings as UTF-8 encoded Uint8Array
  const utf8Encoder = new TextEncoder()
  const utf8Decoder = new TextDecoder()

  function selectedInputType () {
    return controlsInputType.options[controlsInputType.selectedIndex].value
  }

  // Returns a Uint8Array
  async function getInputAsUint8Array () {
    const rawInput = inputTextarea.value

    switch (selectedInputType()) {
      case 'text/plain':
        return utf8Encoder.encode(rawInput)
      case 'text/turtle':
        return rdfParse(rawInput, 'text/turtle')
      case 'application/ld+json':
        return rdfParse(rawInput, 'application/ld+json')
    }
  }

  function createBlockDiv (block, cas) {
    const blockDiv = document.createElement('div')
    blockDiv.className = 'block'

    const blockTitle = document.createTextNode(block)

    const blockRemove = document.createElement('button')
    blockRemove.innerText = 'remove'
    blockRemove.onclick = function (e) {
      cas._map.delete(block)
      renderBlocks(cas)
    }

    const blockCorrupt = document.createElement('button')
    blockCorrupt.innerText = 'randomize'
    blockCorrupt.onclick = function (e) {
      const randomBytes = new Uint8Array(32)
      window.crypto.getRandomValues(randomBytes)
      cas._map.set(block, randomBytes)
    }

    blockDiv.appendChild(blockTitle)
    blockDiv.appendChild(blockRemove)
    blockDiv.appendChild(blockCorrupt)

    return blockDiv
  }

  async function renderBlocks (cas) {
    blockContainer.innerHTML = ''
    for (const block of cas._map.keys()) {
      const blockDiv = createBlockDiv(block, cas)
      blockContainer.appendChild(blockDiv)
    }
  }

  async function encode () {
    // get input as Uint8Array
    const input = await getInputAsUint8Array()
    return ERIS.put(input, cas)
  }

  async function decode () {
    const readCap = encodedErisReadCap.value
    return ERIS.get(readCap, cas)
  }

  function setError (err) {
    console.error(err)
    controlsSuccess.innerText = ''
    controlsError.innerText = err
  }

  function setSuccess (msg) {
    controlsError.innerText = ''
    controlsSuccess.innerText = msg
  }

  function disableControls () {
    controlsEncode.disabled = true
    controlsDecode.disabled = true
    controlsVerify.disabled = true
  }

  function enableControls () {
    controlsEncode.disabled = false
    controlsDecode.disabled = false
    controlsVerify.disabled = false
  }

  controlsEncode.onclick = async function (e) {
    setSuccess('')
    disableControls()
    try {
      const urn = await encode()
      encodedErisReadCap.value = urn
      const verifyUrn = await ERIS.deriveVerificationCapability(urn)
      encodedErisVerificationCap.value = verifyUrn
      renderBlocks(cas)
      setSuccess('Encoded!')
      enableControls()
    } catch (err) {
      console.error(err)
      setError(err)
      enableControls()
    }
  }

  controlsDecode.onclick = async function (e) {
    setSuccess('')
    disableControls()
    try {
      const decoded = await decode()
      inputTextarea.value = utf8Decoder.decode(decoded)
      setSuccess('Decoded!')
      enableControls()
    } catch (err) {
      setError(err)
      enableControls()
    }
  }

  controlsVerify.onclick = async function (e) {
    setSuccess('')
    disableControls()
    try {
      const verificationCap = encodedErisVerificationCap.value
      await ERIS.verify(verificationCap, cas)
      setSuccess('Verification passed!')
      enableControls()
    } catch (err) {
      setError(err)
      enableControls()
    }
  }

  checkBoxEnableIPFS.onchange = async function (e) {
    setSuccess('')
    disableControls()
    if (checkBoxEnableIPFS.checked) {
      try {
        await cas.activateIPFS()
        setSuccess('IPFS enabled!')
        enableControls()
      } catch (err) {
        setError(err)
        enableControls()
      }
    } else {
      try {
        await cas.deactivateIPFS()
        setSuccess('IPFS disabled')
        enableControls()
      } catch (err) {
        setError(err)
        enableControls()
      }
    }
  }

  inputLoadSampleVocabulary.onclick = function (e) {
    inputTextarea.value = signify
    controlsInputType.value = 'text/turtle'
  }

  inputLoadSampleActor.onclick = function (e) {
    inputTextarea.value = alyssa
    controlsInputType.value = 'application/ld+json'
  }

  inputLoadAliceInWonderland.onclick = async function (e) {
    const response = await fetch('alice-in-wonderland.txt')
    inputTextarea.value = await response.text()
    controlsInputType.value = 'text/plain'
  }
}

window.onload = () => {
  main()
}
