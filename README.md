# js-eris

This is a JavaScript implementation of [the Encoding for Robust Immutable Storage (ERIS)](http://purl.org/eris).

## Usage

The `js-eris` module exports functions for encoding and decoding.

### Encoding

- `encode(content: BufferOrGenerator, blockSize: number, convergenceSecret?: Uint8Array): AsyncGenerator<>`: Returns an async generator that yields encrypted blocks as objects with field `reference` and `block` and a string containing the read capability as URN. The `content` argument can be either a generator of blocks of size `blockSize` of content to be encoded or an Uint8Array or a string.
- `encodeToUrn(content: BufferOrGenerator, blockSize: number, convergenceSecret?: Uint8Array): Promise<string>`: Returns a promise containing the read capability as string. Encoded blocks are discarded. This is useful for verifying ERIS encoded content.
- `encodeToMap(content: BufferOrGenerator, blockSize: number, convergenceSecret?: Uint8Array): Promise<Object>`: Returns an object containing the fields `urn` and `blocks`. The field `urn` contains the read capability of the encoded content as string. The `field` blocks contains a `Map` where keys are Base32 encoded references and values are blocks.

### Decoding

- `decode(urn: string, getBlock: Function<>): AsyncGenerator<Uint8Array>`: Returns an async generator that yields decoded content. `urn` is the read capability and `getBlock` is an async function that returns the block for a given reference.
- `decodeToUint8Array(urn: string, getBlock: Function<>): Promise<Uint8Array>`: Decode content directly into a Uint8Array.
- `decodeToString(urn: string, getBlock: Function<>): Promise<string>`: Decode content into a string.

## Examples

``` javascript

const ERIS = require('js-eris')

const content = new Uint8Array(16384)

const urn = await ERIS.encodeToUrn(content, 1024)
// urn = 'urn:erisx2:AABEZG4QWRGMP3BIRI453W4XAQRPVDH7RZ52OOAYV24QL4KB5BSZVBM4R3YA43PTS6OW7NRMNUFQNJOTJJUR54VGBB47RRCOHY225N7W3Q'

const encoded = await ERIS.encodeToMap(content, 1024)
// encoded is an object with the field `urn` and `blocks`

// function that returns block content for given reference
const getBlock = (reference) => encoded.blocks.get(base32.encode(reference))

// decode the content
const originalContent = await ERIS.decodeToUint8Array(encoded.urn, getBlock)
```

See also the [examples](./examples) folder for a demo web application.

## Dependencies

js-eris requires [`libsodium-wrapper-sump`](https://www.npmjs.com/package/libsodium-wrappers-sumo) which wraps the libsodium library for the Web via Emscripten and WebAssembly.

An alternative implementation using pure JavaScript implementations of the required cryptographic primitives (Blake2b and Chacha20) is available in the `no-sodium` branch.

## Acknowledgments

js-eris was initially developed for the [openEngiadina](https://openengiadina.net) project and has been supported by the [NLNet Foundation](https://nlnet.nl/) trough the [NGI0 Discovery Fund](https://nlnet.nl/discovery/).

## License

[LGPL-3.0-or-later](./LICENSES/LGPL-3.0-or-later.txt)
