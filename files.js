const jsesc = require('jsesc')
const sanitize = require('sanitize-filename')
const TypedFastBitSet = require('typedfastbitset')
const { readFile, writeFile } = require('atomic-file-rw')
const toBuffer = require('typedarray-to-buffer')
const { crc32 } = require('hash-wasm')

const FIELD_SIZE = 4 // bytes

/*
 * ## File format for tarr files
 *
 * Each header field is 4 bytes in size.
 *
 * | offset (bytes) | name    | type     |
 * |----------------|---------|----------|
 * | 0              | version | UInt32LE |
 * | 4              | offset  | UInt32LE |
 * | 8              | count   | UInt32LE |
 * | 12             | crc     | UInt32LE |
 * | 16             | body    | Buffer   |
 */

function calculateCRCAndWriteFile(b, filename, cb) {
  crc32(b)
    .then((crc) => {
      b.writeUInt32LE(parseInt(crc, 16), 3 * FIELD_SIZE)
      writeFile(filename, b, cb)
    })
    .catch(cb)
}

function saveTypedArrayFile(filename, version, offset, count, tarr, cb) {
  if (!cb)
    cb = (err) => {
      if (err) console.error(err)
    }

  const dataBuffer = toBuffer(tarr)
  // we try to save an extra 10% so we don't have to immediately grow
  // after loading and adding again
  const saveSize = Math.min(count * 1.1, tarr.length)
  const b = Buffer.alloc(4 * FIELD_SIZE + saveSize * tarr.BYTES_PER_ELEMENT)
  b.writeUInt32LE(version, 0)
  b.writeUInt32LE(offset, FIELD_SIZE)
  b.writeUInt32LE(count, 2 * FIELD_SIZE)
  dataBuffer.copy(b, 4 * FIELD_SIZE)

  calculateCRCAndWriteFile(b, filename, cb)
}

function loadTypedArrayFile(filename, Type, cb) {
  readFile(filename, (err, buf) => {
    if (err) return cb(err)

    const crcFile = buf.readUInt32LE(3 * FIELD_SIZE)
    buf.writeUInt32LE(0, 3 * FIELD_SIZE)

    crc32(buf)
      .then((crc) => {
        if (crcFile !== 0 && parseInt(crc, 16) !== crcFile)
          return cb('crc check failed')

        const version = buf.readUInt32LE(0)
        const offset = buf.readUInt32LE(FIELD_SIZE)
        const count = buf.readUInt32LE(2 * FIELD_SIZE)
        const body = buf.slice(4 * FIELD_SIZE)

        cb(null, {
          version,
          offset,
          count,
          tarr: new Type(
            body.buffer,
            body.offset,
            body.byteLength / (Type === Float64Array ? 8 : 4)
          ),
        })
      })
      .catch(cb)
  })
}

function savePrefixMapFile(filename, version, offset, count, map, cb) {
  if (!cb)
    cb = (err) => {
      if (err) console.error(err)
    }

  const jsonMap = JSON.stringify(map)
  const b = Buffer.alloc(4 * FIELD_SIZE + jsonMap.length)
  b.writeUInt32LE(version, 0)
  b.writeUInt32LE(offset, FIELD_SIZE)
  b.writeUInt32LE(count, 2 * FIELD_SIZE)
  Buffer.from(jsonMap).copy(b, 4 * FIELD_SIZE)

  calculateCRCAndWriteFile(b, filename, cb)
}

function loadPrefixMapFile(filename, cb) {
  readFile(filename, (err, buf) => {
    if (err) return cb(err)

    const crcFile = buf.readUInt32LE(3 * FIELD_SIZE)
    buf.writeUInt32LE(0, 3 * FIELD_SIZE)

    crc32(buf)
      .then((crc) => {
        if (crcFile !== 0 && parseInt(crc, 16) !== crcFile)
          return cb('crc check failed')

        const version = buf.readUInt32LE(0)
        const offset = buf.readUInt32LE(FIELD_SIZE)
        const count = buf.readUInt32LE(2 * FIELD_SIZE)
        const body = buf.slice(4 * FIELD_SIZE)
        const map = JSON.parse(body)

        cb(null, {
          version,
          offset,
          count,
          map,
        })
      })
      .catch(cb)
  })
}

function saveBitsetFile(filename, version, offset, bitset, cb) {
  bitset.trim()
  const count = bitset.words.length
  saveTypedArrayFile(filename, version, offset, count, bitset.words, cb)
}

function loadBitsetFile(filename, cb) {
  loadTypedArrayFile(filename, Uint32Array, (err, data) => {
    if (err) return cb(err)

    const { version, offset, count, tarr } = data
    const bitset = new TypedFastBitSet()
    bitset.words = tarr
    cb(null, { version, offset, bitset })
  })
}

function listFilesIDB(dir, cb) {
  const IdbKvStore = require('idb-kv-store')
  const store = new IdbKvStore(dir, { disableBroadcast: true })
  store.keys(cb)
}

function listFilesFS(dir, cb) {
  const fs = require('fs')
  const mkdirp = require('mkdirp')
  mkdirp(dir).then(() => {
    fs.readdir(dir, cb)
  }, cb)
}

function safeFilename(filename) {
  // in general we want to escape wierd characters
  let result = jsesc(filename)
  // sanitize will remove special characters, which means that two
  // indexes might end up with the same name so lets replace those
  // with jsesc escapeEverything values
  result = result.replace(/\./g, 'x2E')
  result = result.replace(/\//g, 'x2F')
  result = result.replace(/\?/g, 'x3F')
  result = result.replace(/\</g, 'x3C')
  result = result.replace(/\>/g, 'x3E')
  result = result.replace(/\:/g, 'x3A')
  result = result.replace(/\*/g, 'x2A')
  result = result.replace(/\|/g, 'x7C')
  // finally sanitize
  return sanitize(result)
}

module.exports = {
  saveTypedArrayFile,
  loadTypedArrayFile,
  savePrefixMapFile,
  loadPrefixMapFile,
  saveBitsetFile,
  loadBitsetFile,
  listFilesIDB,
  listFilesFS,
  safeFilename,
}
