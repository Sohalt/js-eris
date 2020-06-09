const ERIS = require('js-eris')

async function main () {
  console.log('Hail ERIS!')

  // a TextEncoder for encoding strings as UTF-8 encoded Uint8Array
  const encoder = new TextEncoder()

  // get elements from dom
  const inputTextarea = document.getElementById('input-textarea')
  const controlsEncode = document.getElementById('controls-encode')
  const encodedErisUrn = document.getElementById('encoded-eris-urn')

  controlsEncode.onclick = async function (e) {
    const input = inputTextarea.value
    const erisUrn = await ERIS.put(encoder.encode(input))
    encodedErisUrn.value = erisUrn
  }
}

window.onload = () => {
  main()
}
