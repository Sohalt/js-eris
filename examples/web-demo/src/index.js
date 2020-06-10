const ERIS = require('js-eris')
const rdfParser = require('rdf-parse').default
const Streamify = require('streamify-string')
const FragmentGraph = require('./rdf/fragment-graph.js')

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
  const controlsInputType = document.getElementById('controls-input-type')
  const controlsError = document.getElementById('controls-error')

  const encodedErisReadCap = document.getElementById('encoded-eris-read-cap')
  const encodedData = document.getElementById('encoded-data')

  // a ContentAddressableStorage based on a JavaScipt Map
  const cas = new ERIS.MapContentAddressableStorage()

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

  async function renderBlocks (cas) {
    for (const block of cas._map.entries()) {
      console.log(block)
    }
  }

  async function encode () {
    // get input as Uint8Array
    const input = await getInputAsUint8Array()
    encodedData.innerHTML = utf8Decoder.decode(input)
    return ERIS.put(input, cas)
  }

  async function decode () {
    const readCap = encodedErisReadCap.value
    return ERIS.get(readCap, cas)
  }

  function setError (err) {
    console.error(err)
    controlsError.innerText = err
  }

  function clearError () {
    controlsError.innerText = ''
  }

  controlsEncode.onclick = async function (e) {
    clearError()
    try {
      const urn = await encode()
      encodedErisReadCap.value = urn
      renderBlocks(cas)
    } catch (err) {
      console.error(err)
      setError(err)
    }
  }

  controlsDecode.onclick = async function (e) {
    clearError()
    try {
      const decoded = await decode()
      inputTextarea.value = utf8Decoder.decode(decoded)
    } catch (err) {
      setError(err)
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
