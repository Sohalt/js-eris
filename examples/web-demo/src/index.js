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
        throw error
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
  const inputLoadSampleVocabulary = document.getElementById('input-load-sample-vocabulary')
  const controlsEncode = document.getElementById('controls-encode')
  const controlsInputType = document.getElementById('controls-input-type')
  const encodedErisUrn = document.getElementById('encoded-eris-urn')
  const encodedData = document.getElementById('encoded-data')

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

  async function encode () {
    // get input as Uint8Array
    const input = await getInputAsUint8Array()
    encodedData.innerHTML = utf8Decoder.decode(input)
    return ERIS.put(input)
  }

  controlsEncode.onclick = function (e) {
    encode().then((urn) => {
      encodedErisUrn.value = urn
    }).catch((e) => {
      console.error(e)
      encodedErisUrn.value = 'ERROR (see console)'
    })
  }

  inputLoadSampleVocabulary.onclick = function (e) {
    inputTextarea.value = signify
    controlsInputType.value = 'text/turtle'
  }
}

window.onload = () => {
  main()
}
