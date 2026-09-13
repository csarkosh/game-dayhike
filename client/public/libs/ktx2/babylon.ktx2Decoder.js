var KTX2DECODER = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // node_modules/@babylonjs/ktx2decoder/index.js
  var index_exports = {};
  __export(index_exports, {
    DataReader: () => DataReader,
    KTX2Decoder: () => KTX2Decoder,
    KTX2FileReader: () => KTX2FileReader,
    LiteTranscoder: () => LiteTranscoder,
    LiteTranscoder_UASTC_ASTC: () => LiteTranscoder_UASTC_ASTC,
    LiteTranscoder_UASTC_BC7: () => LiteTranscoder_UASTC_BC7,
    LiteTranscoder_UASTC_R8_UNORM: () => LiteTranscoder_UASTC_R8_UNORM,
    LiteTranscoder_UASTC_RG8_UNORM: () => LiteTranscoder_UASTC_RG8_UNORM,
    LiteTranscoder_UASTC_RGBA_SRGB: () => LiteTranscoder_UASTC_RGBA_SRGB,
    LiteTranscoder_UASTC_RGBA_UNORM: () => LiteTranscoder_UASTC_RGBA_UNORM,
    MSCTranscoder: () => MSCTranscoder,
    SupercompressionScheme: () => SupercompressionScheme,
    Transcoder: () => Transcoder,
    TranscoderManager: () => TranscoderManager,
    WASMMemoryManager: () => WASMMemoryManager,
    ZSTDDecoder: () => ZSTDDecoder
  });

  // node_modules/@babylonjs/core/Materials/Textures/ktx2decoderTypes.js
  var SourceTextureFormat;
  (function(SourceTextureFormat2) {
    SourceTextureFormat2[SourceTextureFormat2["ETC1S"] = 0] = "ETC1S";
    SourceTextureFormat2[SourceTextureFormat2["UASTC4x4"] = 1] = "UASTC4x4";
  })(SourceTextureFormat || (SourceTextureFormat = {}));
  var TranscodeTarget;
  (function(TranscodeTarget2) {
    TranscodeTarget2[TranscodeTarget2["ASTC_4X4_RGBA"] = 0] = "ASTC_4X4_RGBA";
    TranscodeTarget2[TranscodeTarget2["ASTC_4x4_RGBA"] = 0] = "ASTC_4x4_RGBA";
    TranscodeTarget2[TranscodeTarget2["BC7_RGBA"] = 1] = "BC7_RGBA";
    TranscodeTarget2[TranscodeTarget2["BC3_RGBA"] = 2] = "BC3_RGBA";
    TranscodeTarget2[TranscodeTarget2["BC1_RGB"] = 3] = "BC1_RGB";
    TranscodeTarget2[TranscodeTarget2["PVRTC1_4_RGBA"] = 4] = "PVRTC1_4_RGBA";
    TranscodeTarget2[TranscodeTarget2["PVRTC1_4_RGB"] = 5] = "PVRTC1_4_RGB";
    TranscodeTarget2[TranscodeTarget2["ETC2_RGBA"] = 6] = "ETC2_RGBA";
    TranscodeTarget2[TranscodeTarget2["ETC1_RGB"] = 7] = "ETC1_RGB";
    TranscodeTarget2[TranscodeTarget2["RGBA32"] = 8] = "RGBA32";
    TranscodeTarget2[TranscodeTarget2["R8"] = 9] = "R8";
    TranscodeTarget2[TranscodeTarget2["RG8"] = 10] = "RG8";
  })(TranscodeTarget || (TranscodeTarget = {}));
  var EngineFormat;
  (function(EngineFormat2) {
    EngineFormat2[EngineFormat2["COMPRESSED_RGBA_BPTC_UNORM_EXT"] = 36492] = "COMPRESSED_RGBA_BPTC_UNORM_EXT";
    EngineFormat2[EngineFormat2["COMPRESSED_RGBA_ASTC_4X4_KHR"] = 37808] = "COMPRESSED_RGBA_ASTC_4X4_KHR";
    EngineFormat2[EngineFormat2["COMPRESSED_RGB_S3TC_DXT1_EXT"] = 33776] = "COMPRESSED_RGB_S3TC_DXT1_EXT";
    EngineFormat2[EngineFormat2["COMPRESSED_RGBA_S3TC_DXT5_EXT"] = 33779] = "COMPRESSED_RGBA_S3TC_DXT5_EXT";
    EngineFormat2[EngineFormat2["COMPRESSED_RGBA_PVRTC_4BPPV1_IMG"] = 35842] = "COMPRESSED_RGBA_PVRTC_4BPPV1_IMG";
    EngineFormat2[EngineFormat2["COMPRESSED_RGB_PVRTC_4BPPV1_IMG"] = 35840] = "COMPRESSED_RGB_PVRTC_4BPPV1_IMG";
    EngineFormat2[EngineFormat2["COMPRESSED_RGBA8_ETC2_EAC"] = 37496] = "COMPRESSED_RGBA8_ETC2_EAC";
    EngineFormat2[EngineFormat2["COMPRESSED_RGB8_ETC2"] = 37492] = "COMPRESSED_RGB8_ETC2";
    EngineFormat2[EngineFormat2["COMPRESSED_RGB_ETC1_WEBGL"] = 36196] = "COMPRESSED_RGB_ETC1_WEBGL";
    EngineFormat2[EngineFormat2["RGBA8Format"] = 32856] = "RGBA8Format";
    EngineFormat2[EngineFormat2["R8Format"] = 33321] = "R8Format";
    EngineFormat2[EngineFormat2["RG8Format"] = 33323] = "RG8Format";
  })(EngineFormat || (EngineFormat = {}));

  // node_modules/@babylonjs/ktx2decoder/Misc/dataReader.js
  var DataReader = class {
    /**
     * The current byte offset from the beginning of the data buffer.
     */
    get byteOffset() {
      return this._dataByteOffset;
    }
    /**
     * Constructor
     * @param buffer The buffer to set
     * @param byteOffset The starting offset in the buffer
     * @param byteLength The byte length of the buffer
     */
    constructor(buffer, byteOffset, byteLength) {
      if (buffer.buffer) {
        this._dataView = new DataView(buffer.buffer, buffer.byteOffset + (byteOffset ?? 0), byteLength ?? buffer.byteLength);
      } else {
        this._dataView = new DataView(buffer, byteOffset ?? 0, byteLength ?? buffer.byteLength);
      }
      this._dataByteOffset = 0;
    }
    /**
     * Read a unsigned 8-bit integer from the currently loaded data range.
     * @returns The 8-bit integer read
     */
    readUint8() {
      const value = this._dataView.getUint8(this._dataByteOffset);
      this._dataByteOffset += 1;
      return value;
    }
    /**
     * Read a signed 8-bit integer from the currently loaded data range.
     * @returns The 8-bit integer read
     */
    readInt8() {
      const value = this._dataView.getInt8(this._dataByteOffset);
      this._dataByteOffset += 1;
      return value;
    }
    /**
     * Read a unsigned 16-bit integer from the currently loaded data range.
     * @returns The 16-bit integer read
     */
    readUint16() {
      const value = this._dataView.getUint16(this._dataByteOffset, true);
      this._dataByteOffset += 2;
      return value;
    }
    /**
     * Read a signed 16-bit integer from the currently loaded data range.
     * @returns The 16-bit integer read
     */
    readInt16() {
      const value = this._dataView.getInt16(this._dataByteOffset, true);
      this._dataByteOffset += 2;
      return value;
    }
    /**
     * Read a unsigned 32-bit integer from the currently loaded data range.
     * @returns The 32-bit integer read
     */
    readUint32() {
      const value = this._dataView.getUint32(this._dataByteOffset, true);
      this._dataByteOffset += 4;
      return value;
    }
    /**
     * Read a signed 32-bit integer from the currently loaded data range.
     * @returns The 32-bit integer read
     */
    readInt32() {
      const value = this._dataView.getInt32(this._dataByteOffset, true);
      this._dataByteOffset += 4;
      return value;
    }
    /**
     * Read a unsigned 32-bit integer from the currently loaded data range.
     * @returns The 32-bit integer read
     */
    readUint64() {
      const left = this._dataView.getUint32(this._dataByteOffset, true);
      const right = this._dataView.getUint32(this._dataByteOffset + 4, true);
      const combined = left + 2 ** 32 * right;
      this._dataByteOffset += 8;
      return combined;
    }
    /**
     * Read a byte array from the currently loaded data range.
     * @param byteLength The byte length to read
     * @returns The byte array read
     */
    readUint8Array(byteLength) {
      const value = new Uint8Array(this._dataView.buffer, this._dataView.byteOffset + this._dataByteOffset, byteLength);
      this._dataByteOffset += byteLength;
      return value;
    }
    /**
     * Skips the given byte length the currently loaded data range.
     * @param byteLength The byte length to skip
     * @returns This instance
     */
    skipBytes(byteLength) {
      this._dataByteOffset += byteLength;
      return this;
    }
  };

  // node_modules/@babylonjs/ktx2decoder/ktx2FileReader.js
  var SupercompressionScheme;
  (function(SupercompressionScheme2) {
    SupercompressionScheme2[SupercompressionScheme2["None"] = 0] = "None";
    SupercompressionScheme2[SupercompressionScheme2["BasisLZ"] = 1] = "BasisLZ";
    SupercompressionScheme2[SupercompressionScheme2["ZStandard"] = 2] = "ZStandard";
    SupercompressionScheme2[SupercompressionScheme2["ZLib"] = 3] = "ZLib";
  })(SupercompressionScheme || (SupercompressionScheme = {}));
  var DFDModel;
  (function(DFDModel2) {
    DFDModel2[DFDModel2["ETC1S"] = 163] = "ETC1S";
    DFDModel2[DFDModel2["UASTC"] = 166] = "UASTC";
  })(DFDModel || (DFDModel = {}));
  var DFDChannel_ETC1S;
  (function(DFDChannel_ETC1S2) {
    DFDChannel_ETC1S2[DFDChannel_ETC1S2["RGB"] = 0] = "RGB";
    DFDChannel_ETC1S2[DFDChannel_ETC1S2["RRR"] = 3] = "RRR";
    DFDChannel_ETC1S2[DFDChannel_ETC1S2["GGG"] = 4] = "GGG";
    DFDChannel_ETC1S2[DFDChannel_ETC1S2["AAA"] = 15] = "AAA";
  })(DFDChannel_ETC1S || (DFDChannel_ETC1S = {}));
  var DFDChannel_UASTC;
  (function(DFDChannel_UASTC2) {
    DFDChannel_UASTC2[DFDChannel_UASTC2["RGB"] = 0] = "RGB";
    DFDChannel_UASTC2[DFDChannel_UASTC2["RGBA"] = 3] = "RGBA";
    DFDChannel_UASTC2[DFDChannel_UASTC2["RRR"] = 4] = "RRR";
    DFDChannel_UASTC2[DFDChannel_UASTC2["RRRG"] = 5] = "RRRG";
  })(DFDChannel_UASTC || (DFDChannel_UASTC = {}));
  var DFDTransferFunction;
  (function(DFDTransferFunction2) {
    DFDTransferFunction2[DFDTransferFunction2["linear"] = 1] = "linear";
    DFDTransferFunction2[DFDTransferFunction2["sRGB"] = 2] = "sRGB";
  })(DFDTransferFunction || (DFDTransferFunction = {}));
  var KTX2FileReader = class _KTX2FileReader {
    /**
     * Will throw an exception if the file can't be parsed
     * @param data
     */
    constructor(data) {
      this._data = data;
    }
    get data() {
      return this._data;
    }
    get header() {
      return this._header;
    }
    get levels() {
      return this._levels;
    }
    get dfdBlock() {
      return this._dfdBlock;
    }
    get supercompressionGlobalData() {
      return this._supercompressionGlobalData;
    }
    isValid() {
      return _KTX2FileReader.IsValid(this._data);
    }
    parse() {
      let offsetInFile = 12;
      const hdrReader = new DataReader(this._data, offsetInFile, 17 * 4);
      const header = this._header = {
        vkFormat: hdrReader.readUint32(),
        typeSize: hdrReader.readUint32(),
        pixelWidth: hdrReader.readUint32(),
        pixelHeight: hdrReader.readUint32(),
        pixelDepth: hdrReader.readUint32(),
        layerCount: hdrReader.readUint32(),
        faceCount: hdrReader.readUint32(),
        levelCount: hdrReader.readUint32(),
        supercompressionScheme: hdrReader.readUint32(),
        dfdByteOffset: hdrReader.readUint32(),
        dfdByteLength: hdrReader.readUint32(),
        kvdByteOffset: hdrReader.readUint32(),
        kvdByteLength: hdrReader.readUint32(),
        sgdByteOffset: hdrReader.readUint64(),
        sgdByteLength: hdrReader.readUint64()
      };
      if (header.pixelDepth > 0) {
        throw new Error(`Failed to parse KTX2 file - Only 2D textures are currently supported.`);
      }
      if (header.layerCount > 1) {
        throw new Error(`Failed to parse KTX2 file - Array textures are not currently supported.`);
      }
      if (header.faceCount > 1) {
        throw new Error(`Failed to parse KTX2 file - Cube textures are not currently supported.`);
      }
      offsetInFile += hdrReader.byteOffset;
      let levelCount = Math.max(1, header.levelCount);
      const levelReader = new DataReader(this._data, offsetInFile, levelCount * 3 * (2 * 4));
      const levels = this._levels = [];
      while (levelCount--) {
        levels.push({
          byteOffset: levelReader.readUint64(),
          byteLength: levelReader.readUint64(),
          uncompressedByteLength: levelReader.readUint64()
        });
      }
      const dfdReader = new DataReader(this._data, header.dfdByteOffset, header.dfdByteLength);
      const dfdBlock = this._dfdBlock = {
        vendorId: dfdReader.skipBytes(
          4
          /* skip totalSize */
        ).readUint16(),
        descriptorType: dfdReader.readUint16(),
        versionNumber: dfdReader.readUint16(),
        descriptorBlockSize: dfdReader.readUint16(),
        colorModel: dfdReader.readUint8(),
        colorPrimaries: dfdReader.readUint8(),
        transferFunction: dfdReader.readUint8(),
        flags: dfdReader.readUint8(),
        texelBlockDimension: {
          x: dfdReader.readUint8() + 1,
          y: dfdReader.readUint8() + 1,
          z: dfdReader.readUint8() + 1,
          w: dfdReader.readUint8() + 1
        },
        bytesPlane: [
          dfdReader.readUint8(),
          dfdReader.readUint8(),
          dfdReader.readUint8(),
          dfdReader.readUint8(),
          dfdReader.readUint8(),
          dfdReader.readUint8(),
          dfdReader.readUint8(),
          dfdReader.readUint8()
        ],
        numSamples: 0,
        samples: new Array()
      };
      dfdBlock.numSamples = (dfdBlock.descriptorBlockSize - 24) / 16;
      for (let i = 0; i < dfdBlock.numSamples; i++) {
        const sample = {
          bitOffset: dfdReader.readUint16(),
          bitLength: dfdReader.readUint8() + 1,
          channelType: dfdReader.readUint8(),
          channelFlags: 0,
          samplePosition: [
            dfdReader.readUint8(),
            dfdReader.readUint8(),
            dfdReader.readUint8(),
            dfdReader.readUint8()
          ],
          sampleLower: dfdReader.readUint32(),
          sampleUpper: dfdReader.readUint32()
        };
        sample.channelFlags = (sample.channelType & 240) >> 4;
        sample.channelType = sample.channelType & 15;
        dfdBlock.samples.push(sample);
      }
      const sgd = this._supercompressionGlobalData = {};
      if (header.sgdByteLength > 0) {
        const sgdReader = new DataReader(this._data, header.sgdByteOffset, header.sgdByteLength);
        sgd.endpointCount = sgdReader.readUint16();
        sgd.selectorCount = sgdReader.readUint16();
        sgd.endpointsByteLength = sgdReader.readUint32();
        sgd.selectorsByteLength = sgdReader.readUint32();
        sgd.tablesByteLength = sgdReader.readUint32();
        sgd.extendedByteLength = sgdReader.readUint32();
        sgd.imageDescs = [];
        const imageCount = this._getImageCount();
        for (let i = 0; i < imageCount; i++) {
          sgd.imageDescs.push({
            imageFlags: sgdReader.readUint32(),
            rgbSliceByteOffset: sgdReader.readUint32(),
            rgbSliceByteLength: sgdReader.readUint32(),
            alphaSliceByteOffset: sgdReader.readUint32(),
            alphaSliceByteLength: sgdReader.readUint32()
          });
        }
        const endpointsByteOffset = header.sgdByteOffset + sgdReader.byteOffset;
        const selectorsByteOffset = endpointsByteOffset + sgd.endpointsByteLength;
        const tablesByteOffset = selectorsByteOffset + sgd.selectorsByteLength;
        const extendedByteOffset = tablesByteOffset + sgd.tablesByteLength;
        sgd.endpointsData = new Uint8Array(this._data.buffer, this._data.byteOffset + endpointsByteOffset, sgd.endpointsByteLength);
        sgd.selectorsData = new Uint8Array(this._data.buffer, this._data.byteOffset + selectorsByteOffset, sgd.selectorsByteLength);
        sgd.tablesData = new Uint8Array(this._data.buffer, this._data.byteOffset + tablesByteOffset, sgd.tablesByteLength);
        sgd.extendedData = new Uint8Array(this._data.buffer, this._data.byteOffset + extendedByteOffset, sgd.extendedByteLength);
      }
    }
    _getImageCount() {
      let layerPixelDepth = Math.max(this._header.pixelDepth, 1);
      for (let i = 1; i < this._header.levelCount; i++) {
        layerPixelDepth += Math.max(this._header.pixelDepth >> i, 1);
      }
      return Math.max(this._header.layerCount, 1) * this._header.faceCount * layerPixelDepth;
    }
    get textureFormat() {
      return this._dfdBlock.colorModel === 166 ? SourceTextureFormat.UASTC4x4 : SourceTextureFormat.ETC1S;
    }
    get hasAlpha() {
      const tformat = this.textureFormat;
      switch (tformat) {
        case SourceTextureFormat.ETC1S:
          return this._dfdBlock.numSamples === 2 && (this._dfdBlock.samples[0].channelType === 15 || this._dfdBlock.samples[1].channelType === 15);
        case SourceTextureFormat.UASTC4x4:
          return this._dfdBlock.samples[0].channelType === 3;
      }
      return false;
    }
    get needZSTDDecoder() {
      return this._header.supercompressionScheme === SupercompressionScheme.ZStandard;
    }
    get isInGammaSpace() {
      return this._dfdBlock.transferFunction === 2;
    }
    static IsValid(data) {
      if (data.byteLength >= 12) {
        const identifier = new Uint8Array(data.buffer, data.byteOffset, 12);
        if (identifier[0] === 171 && identifier[1] === 75 && identifier[2] === 84 && identifier[3] === 88 && identifier[4] === 32 && identifier[5] === 50 && identifier[6] === 48 && identifier[7] === 187 && identifier[8] === 13 && identifier[9] === 10 && identifier[10] === 26 && identifier[11] === 10) {
          return true;
        }
      }
      return false;
    }
  };

  // node_modules/@babylonjs/ktx2decoder/wasmMemoryManager.js
  var WASMMemoryManager = class _WASMMemoryManager {
    static async LoadWASM(path) {
      if (this.LoadBinariesFromCurrentThread) {
        return await new Promise((resolve, reject) => {
          fetch(path).then(async (response) => {
            if (response.ok) {
              return await response.arrayBuffer();
            }
            throw new Error(`Could not fetch the wasm component from "${path}": ${response.status} - ${response.statusText}`);
          }).then((wasmBinary) => resolve(wasmBinary)).catch((reason) => {
            reject(reason);
          });
        });
      }
      const id = this._RequestId++;
      return await new Promise((resolve) => {
        const wasmLoadedHandler = (msg) => {
          if (msg.data.action === "wasmLoaded" && msg.data.id === id) {
            self.removeEventListener("message", wasmLoadedHandler);
            resolve(msg.data.wasmBinary);
          }
        };
        self.addEventListener("message", wasmLoadedHandler);
        postMessage({ action: "loadWASM", path, id });
      });
    }
    constructor(initialMemoryPages = _WASMMemoryManager.InitialMemoryPages) {
      this._numPages = initialMemoryPages;
      this._memory = new WebAssembly.Memory({ initial: this._numPages });
      this._memoryViewByteLength = this._numPages << 16;
      this._memoryViewOffset = 0;
      this._memoryView = new Uint8Array(this._memory.buffer, this._memoryViewOffset, this._memoryViewByteLength);
    }
    get wasmMemory() {
      return this._memory;
    }
    getMemoryView(numPages, offset = 0, byteLength) {
      byteLength = byteLength ?? numPages << 16;
      if (this._numPages < numPages) {
        this._memory.grow(numPages - this._numPages);
        this._numPages = numPages;
        this._memoryView = new Uint8Array(this._memory.buffer, offset, byteLength);
        this._memoryViewByteLength = byteLength;
        this._memoryViewOffset = offset;
      } else {
        this._memoryView = new Uint8Array(this._memory.buffer, offset, byteLength);
        this._memoryViewByteLength = byteLength;
        this._memoryViewOffset = offset;
      }
      return this._memoryView;
    }
  };
  WASMMemoryManager.LoadBinariesFromCurrentThread = true;
  WASMMemoryManager.InitialMemoryPages = 1 * 1024 * 1024 >> 16;
  WASMMemoryManager._RequestId = 0;

  // node_modules/@babylonjs/ktx2decoder/transcoderManager.js
  var TranscoderManager = class _TranscoderManager {
    static RegisterTranscoder(transcoder) {
      _TranscoderManager._Transcoders.push(transcoder);
    }
    findTranscoder(src, dst, isInGammaSpace, bypass) {
      let transcoder = null;
      const key = SourceTextureFormat[src] + "_" + TranscodeTarget[dst];
      for (let i = 0; i < _TranscoderManager._Transcoders.length; ++i) {
        if (_TranscoderManager._Transcoders[i].CanTranscode(src, dst, isInGammaSpace) && (!bypass || bypass.indexOf(_TranscoderManager._Transcoders[i].Name) < 0)) {
          transcoder = this._getExistingTranscoder(key, _TranscoderManager._Transcoders[i].Name);
          if (!transcoder) {
            transcoder = new _TranscoderManager._Transcoders[i]();
            transcoder.initialize();
            if (transcoder.needMemoryManager()) {
              if (!this._wasmMemoryManager) {
                this._wasmMemoryManager = new WASMMemoryManager();
              }
              transcoder.setMemoryManager(this._wasmMemoryManager);
            }
            if (!_TranscoderManager._TranscoderInstances[key]) {
              _TranscoderManager._TranscoderInstances[key] = [];
            }
            _TranscoderManager._TranscoderInstances[key].push(transcoder);
          }
          break;
        }
      }
      return transcoder;
    }
    _getExistingTranscoder(key, transcoderName) {
      const transcoders = _TranscoderManager._TranscoderInstances[key];
      if (transcoders) {
        for (let t = 0; t < transcoders.length; ++t) {
          const transcoder = transcoders[t];
          if (transcoderName === transcoder.getName()) {
            return transcoder;
          }
        }
      }
      return null;
    }
  };
  TranscoderManager._Transcoders = [];
  TranscoderManager._TranscoderInstances = {};

  // node_modules/@babylonjs/ktx2decoder/transcoder.js
  var Transcoder = class _Transcoder {
    static CanTranscode(src, dst, isInGammaSpace) {
      return false;
    }
    static GetWasmUrl(wasmUrl) {
      if (wasmUrl.startsWith(_Transcoder._DefaultCdnUrl)) {
        if (_Transcoder.WasmBaseUrl) {
          const baseUrl = _Transcoder.WasmBaseUrl.endsWith("/") ? _Transcoder.WasmBaseUrl.slice(0, -1) : _Transcoder.WasmBaseUrl;
          wasmUrl = wasmUrl.replace(_Transcoder._DefaultCdnUrl, baseUrl);
        } else if (_Transcoder.CdnVersion) {
          const versionedBase = `${_Transcoder._DefaultCdnUrl}/v${_Transcoder.CdnVersion}`;
          if (!wasmUrl.startsWith(versionedBase)) {
            wasmUrl = wasmUrl.replace(_Transcoder._DefaultCdnUrl, versionedBase);
          }
        }
      }
      return wasmUrl;
    }
    getName() {
      return _Transcoder.Name;
    }
    initialize() {
    }
    needMemoryManager() {
      return false;
    }
    setMemoryManager(memoryMgr) {
    }
    async transcode(src, dst, level, width, height, uncompressedByteLength, ktx2Reader, imageDesc, encodedData) {
      return null;
    }
  };
  Transcoder.Name = "Transcoder";
  Transcoder.WasmBaseUrl = "";
  Transcoder.CdnVersion = "9.18.0";
  Transcoder._DefaultCdnUrl = "https://cdn.babylonjs.com";

  // node_modules/@babylonjs/ktx2decoder/Transcoders/liteTranscoder.js
  var LiteTranscoder = class extends Transcoder {
    constructor() {
      super(...arguments);
      this._wasmBinary = null;
    }
    async _instantiateWebAssemblyAsync(wasmBinary) {
      return await WebAssembly.instantiate(wasmBinary, { env: { memory: this._memoryManager.wasmMemory } }).then((moduleWrapper) => {
        return { module: moduleWrapper.instance.exports };
      });
    }
    async _loadModuleAsync(wasmBinary = this._wasmBinary) {
      this._modulePromise = this._modulePromise || // eslint-disable-next-line github/no-then
      (wasmBinary ? Promise.resolve(wasmBinary) : WASMMemoryManager.LoadWASM(this._modulePath)).then(async (wasmBinary2) => {
        return await this._instantiateWebAssemblyAsync(wasmBinary2);
      });
      return await this._modulePromise;
    }
    // eslint-disable-next-line @typescript-eslint/naming-convention
    get memoryManager() {
      return this._memoryManager;
    }
    // eslint-disable-next-line @typescript-eslint/naming-convention
    setModulePath(modulePath, wasmBinary) {
      this._modulePath = Transcoder.GetWasmUrl(modulePath);
      this._wasmBinary = wasmBinary;
    }
    initialize() {
      this._transcodeInPlace = true;
    }
    needMemoryManager() {
      return true;
    }
    setMemoryManager(memoryMgr) {
      this._memoryManager = memoryMgr;
    }
    // eslint-disable-next-line @typescript-eslint/naming-convention
    async transcode(src, dst, level, width, height, uncompressedByteLength, ktx2Reader, imageDesc, encodedData) {
      return await this._loadModuleAsync().then((moduleWrapper) => {
        const transcoder = moduleWrapper.module;
        const [textureView, uncompressedTextureView, nBlocks] = this._prepareTranscoding(width, height, uncompressedByteLength, encodedData);
        return transcoder.transcode(nBlocks) === 0 ? this._transcodeInPlace ? textureView.slice() : uncompressedTextureView.slice() : null;
      });
    }
    _prepareTranscoding(width, height, uncompressedByteLength, encodedData, uncompressedNumComponents) {
      const nBlocks = (width + 3 >> 2) * (height + 3 >> 2);
      if (uncompressedNumComponents !== void 0) {
        uncompressedByteLength = width * (height + 3 >> 2) * 4 * uncompressedNumComponents;
      }
      const texMemoryPages = (nBlocks * 16 + 65535 + (this._transcodeInPlace ? 0 : uncompressedByteLength) >> 16) + 1;
      const textureView = this.memoryManager.getMemoryView(texMemoryPages, 65536, nBlocks * 16);
      const uncompressedTextureView = this._transcodeInPlace ? null : new Uint8Array(this._memoryManager.wasmMemory.buffer, 65536 + nBlocks * 16, uncompressedNumComponents !== void 0 ? width * height * uncompressedNumComponents : uncompressedByteLength);
      textureView.set(encodedData);
      return [textureView, uncompressedTextureView, nBlocks];
    }
  };

  // node_modules/@babylonjs/ktx2decoder/Transcoders/liteTranscoder_UASTC_ASTC.js
  var LiteTranscoder_UASTC_ASTC = class _LiteTranscoder_UASTC_ASTC extends LiteTranscoder {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    static CanTranscode(src, dst, isInGammaSpace) {
      return src === SourceTextureFormat.UASTC4x4 && dst === TranscodeTarget.ASTC_4X4_RGBA;
    }
    getName() {
      return _LiteTranscoder_UASTC_ASTC.Name;
    }
    initialize() {
      super.initialize();
      this.setModulePath(_LiteTranscoder_UASTC_ASTC.WasmModuleURL, _LiteTranscoder_UASTC_ASTC.WasmBinary);
    }
  };
  LiteTranscoder_UASTC_ASTC.WasmModuleURL = "https://cdn.babylonjs.com/ktx2Transcoders/1/uastc_astc.wasm";
  LiteTranscoder_UASTC_ASTC.WasmBinary = null;
  LiteTranscoder_UASTC_ASTC.Name = "UniversalTranscoder_UASTC_ASTC";

  // node_modules/@babylonjs/ktx2decoder/Transcoders/liteTranscoder_UASTC_BC7.js
  var LiteTranscoder_UASTC_BC7 = class _LiteTranscoder_UASTC_BC7 extends LiteTranscoder {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    static CanTranscode(src, dst, isInGammaSpace) {
      return src === SourceTextureFormat.UASTC4x4 && dst === TranscodeTarget.BC7_RGBA;
    }
    getName() {
      return _LiteTranscoder_UASTC_BC7.Name;
    }
    initialize() {
      super.initialize();
      this.setModulePath(_LiteTranscoder_UASTC_BC7.WasmModuleURL, _LiteTranscoder_UASTC_BC7.WasmBinary);
    }
  };
  LiteTranscoder_UASTC_BC7.WasmModuleURL = "https://cdn.babylonjs.com/ktx2Transcoders/1/uastc_bc7.wasm";
  LiteTranscoder_UASTC_BC7.WasmBinary = null;
  LiteTranscoder_UASTC_BC7.Name = "UniversalTranscoder_UASTC_BC7";

  // node_modules/@babylonjs/ktx2decoder/Transcoders/liteTranscoder_UASTC_RGBA_UNORM.js
  var LiteTranscoder_UASTC_RGBA_UNORM = class _LiteTranscoder_UASTC_RGBA_UNORM extends LiteTranscoder {
    static CanTranscode(src, dst, isInGammaSpace) {
      return src === SourceTextureFormat.UASTC4x4 && dst === TranscodeTarget.RGBA32 && !isInGammaSpace;
    }
    getName() {
      return _LiteTranscoder_UASTC_RGBA_UNORM.Name;
    }
    initialize() {
      super.initialize();
      this._transcodeInPlace = false;
      this.setModulePath(_LiteTranscoder_UASTC_RGBA_UNORM.WasmModuleURL, _LiteTranscoder_UASTC_RGBA_UNORM.WasmBinary);
    }
    // eslint-disable-next-line @typescript-eslint/naming-convention
    async transcode(src, dst, level, width, height, uncompressedByteLength, ktx2Reader, imageDesc, encodedData) {
      const moduleWrapper = await this._loadModuleAsync();
      const transcoder = moduleWrapper.module;
      const [, uncompressedTextureView] = this._prepareTranscoding(width, height, uncompressedByteLength, encodedData, 4);
      return transcoder.decode(width, height) === 0 ? uncompressedTextureView.slice() : null;
    }
  };
  LiteTranscoder_UASTC_RGBA_UNORM.WasmModuleURL = "https://cdn.babylonjs.com/ktx2Transcoders/1/uastc_rgba8_unorm_v2.wasm";
  LiteTranscoder_UASTC_RGBA_UNORM.WasmBinary = null;
  LiteTranscoder_UASTC_RGBA_UNORM.Name = "UniversalTranscoder_UASTC_RGBA_UNORM";

  // node_modules/@babylonjs/ktx2decoder/Transcoders/liteTranscoder_UASTC_RGBA_SRGB.js
  var LiteTranscoder_UASTC_RGBA_SRGB = class _LiteTranscoder_UASTC_RGBA_SRGB extends LiteTranscoder {
    static CanTranscode(src, dst, isInGammaSpace) {
      return src === SourceTextureFormat.UASTC4x4 && dst === TranscodeTarget.RGBA32 && isInGammaSpace;
    }
    getName() {
      return _LiteTranscoder_UASTC_RGBA_SRGB.Name;
    }
    initialize() {
      super.initialize();
      this._transcodeInPlace = false;
      this.setModulePath(_LiteTranscoder_UASTC_RGBA_SRGB.WasmModuleURL, _LiteTranscoder_UASTC_RGBA_SRGB.WasmBinary);
    }
    // eslint-disable-next-line @typescript-eslint/naming-convention
    async transcode(src, dst, level, width, height, uncompressedByteLength, ktx2Reader, imageDesc, encodedData) {
      const moduleWrapper = await this._loadModuleAsync();
      const transcoder = moduleWrapper.module;
      const [, uncompressedTextureView] = this._prepareTranscoding(width, height, uncompressedByteLength, encodedData, 4);
      return transcoder.decode(width, height) === 0 ? uncompressedTextureView.slice() : null;
    }
  };
  LiteTranscoder_UASTC_RGBA_SRGB.WasmModuleURL = "https://cdn.babylonjs.com/ktx2Transcoders/1/uastc_rgba8_srgb_v2.wasm";
  LiteTranscoder_UASTC_RGBA_SRGB.WasmBinary = null;
  LiteTranscoder_UASTC_RGBA_SRGB.Name = "UniversalTranscoder_UASTC_RGBA_SRGB";

  // node_modules/@babylonjs/ktx2decoder/Transcoders/liteTranscoder_UASTC_R8_UNORM.js
  var LiteTranscoder_UASTC_R8_UNORM = class _LiteTranscoder_UASTC_R8_UNORM extends LiteTranscoder {
    static CanTranscode(src, dst, isInGammaSpace) {
      return src === SourceTextureFormat.UASTC4x4 && dst === TranscodeTarget.R8;
    }
    getName() {
      return _LiteTranscoder_UASTC_R8_UNORM.Name;
    }
    initialize() {
      super.initialize();
      this._transcodeInPlace = false;
      this.setModulePath(_LiteTranscoder_UASTC_R8_UNORM.WasmModuleURL, _LiteTranscoder_UASTC_R8_UNORM.WasmBinary);
    }
    // eslint-disable-next-line @typescript-eslint/naming-convention
    async transcode(src, dst, level, width, height, uncompressedByteLength, ktx2Reader, imageDesc, encodedData) {
      const moduleWrapper = await this._loadModuleAsync();
      const transcoder = moduleWrapper.module;
      const [, uncompressedTextureView] = this._prepareTranscoding(width, height, uncompressedByteLength, encodedData, 1);
      return transcoder.decode(width, height) === 0 ? uncompressedTextureView.slice() : null;
    }
  };
  LiteTranscoder_UASTC_R8_UNORM.WasmModuleURL = "https://cdn.babylonjs.com/ktx2Transcoders/1/uastc_r8_unorm.wasm";
  LiteTranscoder_UASTC_R8_UNORM.WasmBinary = null;
  LiteTranscoder_UASTC_R8_UNORM.Name = "UniversalTranscoder_UASTC_R8_UNORM";

  // node_modules/@babylonjs/ktx2decoder/Transcoders/liteTranscoder_UASTC_RG8_UNORM.js
  var LiteTranscoder_UASTC_RG8_UNORM = class _LiteTranscoder_UASTC_RG8_UNORM extends LiteTranscoder {
    static CanTranscode(src, dst, isInGammaSpace) {
      return src === SourceTextureFormat.UASTC4x4 && dst === TranscodeTarget.RG8;
    }
    getName() {
      return _LiteTranscoder_UASTC_RG8_UNORM.Name;
    }
    initialize() {
      super.initialize();
      this._transcodeInPlace = false;
      this.setModulePath(_LiteTranscoder_UASTC_RG8_UNORM.WasmModuleURL, _LiteTranscoder_UASTC_RG8_UNORM.WasmBinary);
    }
    // eslint-disable-next-line @typescript-eslint/naming-convention
    async transcode(src, dst, level, width, height, uncompressedByteLength, ktx2Reader, imageDesc, encodedData) {
      const moduleWrapper = await this._loadModuleAsync();
      const transcoder = moduleWrapper.module;
      const [, uncompressedTextureView] = this._prepareTranscoding(width, height, uncompressedByteLength, encodedData, 2);
      return transcoder.decode(width, height) === 0 ? uncompressedTextureView.slice() : null;
    }
  };
  LiteTranscoder_UASTC_RG8_UNORM.WasmModuleURL = "https://cdn.babylonjs.com/ktx2Transcoders/1/uastc_rg8_unorm.wasm";
  LiteTranscoder_UASTC_RG8_UNORM.WasmBinary = null;
  LiteTranscoder_UASTC_RG8_UNORM.Name = "UniversalTranscoder_UASTC_RG8_UNORM";

  // node_modules/@babylonjs/ktx2decoder/Transcoders/mscTranscoder.js
  var MSCTranscoder = class _MSCTranscoder extends Transcoder {
    getName() {
      return _MSCTranscoder.Name;
    }
    async _getMSCBasisTranscoder() {
      if (this._mscBasisTranscoderPromise) {
        return await this._mscBasisTranscoderPromise;
      }
      this._mscBasisTranscoderPromise = (_MSCTranscoder.WasmBinary ? Promise.resolve(_MSCTranscoder.WasmBinary) : WASMMemoryManager.LoadWASM(Transcoder.GetWasmUrl(_MSCTranscoder.WasmModuleURL))).then(async (wasmBinary) => {
        if (_MSCTranscoder.JSModule) {
          globalThis.MSC_TRANSCODER = _MSCTranscoder.JSModule;
        } else {
          if (_MSCTranscoder.UseFromWorkerThread) {
            importScripts(Transcoder.GetWasmUrl(_MSCTranscoder.JSModuleURL));
          } else if (typeof MSC_TRANSCODER === "undefined") {
            return await new Promise((resolve, reject) => {
              const head = document.getElementsByTagName("head")[0];
              const script = document.createElement("script");
              script.setAttribute("type", "text/javascript");
              script.setAttribute("src", Transcoder.GetWasmUrl(_MSCTranscoder.JSModuleURL));
              script.onload = () => {
                if (typeof MSC_TRANSCODER === "undefined") {
                  reject("MSC_TRANSCODER script loaded but MSC_TRANSCODER is not defined.");
                  return;
                }
                MSC_TRANSCODER({ wasmBinary }).then((basisModule) => {
                  basisModule.initTranscoders();
                  this._mscBasisModule = basisModule;
                  resolve();
                });
              };
              script.onerror = () => {
                reject("Can not load MSC_TRANSCODER script.");
              };
              head.appendChild(script);
            });
          }
        }
        return await new Promise((resolve) => {
          MSC_TRANSCODER({ wasmBinary }).then((basisModule) => {
            basisModule.initTranscoders();
            this._mscBasisModule = basisModule;
            resolve();
          });
        });
      });
      return await this._mscBasisTranscoderPromise;
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    static CanTranscode(src, dst, isInGammaSpace) {
      return true;
    }
    // eslint-disable-next-line @typescript-eslint/naming-convention
    async transcode(src, dst, level, width, height, uncompressedByteLength, ktx2Reader, imageDesc, encodedData) {
      const isVideo = false;
      return await this._getMSCBasisTranscoder().then(() => {
        const basisModule = this._mscBasisModule;
        let transcoder;
        let imageInfo;
        let result;
        let textureData = null;
        try {
          transcoder = src === SourceTextureFormat.UASTC4x4 ? new basisModule.UastcImageTranscoder() : new basisModule.BasisLzEtc1sImageTranscoder();
          const texFormat = src === SourceTextureFormat.UASTC4x4 ? basisModule.TextureFormat.UASTC4x4 : basisModule.TextureFormat.ETC1S;
          imageInfo = new basisModule.ImageInfo(texFormat, width, height, level);
          const targetFormat = basisModule.TranscodeTarget[TranscodeTarget[dst]];
          if (!basisModule.isFormatSupported(targetFormat, texFormat)) {
            throw new Error(`MSCTranscoder: Transcoding from "${SourceTextureFormat[src]}" to "${TranscodeTarget[dst]}" not supported by current transcoder build.`);
          }
          if (src === SourceTextureFormat.ETC1S) {
            const sgd = ktx2Reader.supercompressionGlobalData;
            transcoder.decodePalettes(sgd.endpointCount, sgd.endpointsData, sgd.selectorCount, sgd.selectorsData);
            transcoder.decodeTables(sgd.tablesData);
            imageInfo.flags = imageDesc.imageFlags;
            imageInfo.rgbByteOffset = 0;
            imageInfo.rgbByteLength = imageDesc.rgbSliceByteLength;
            imageInfo.alphaByteOffset = imageDesc.alphaSliceByteOffset > 0 ? imageDesc.rgbSliceByteLength : 0;
            imageInfo.alphaByteLength = imageDesc.alphaSliceByteLength;
            result = transcoder.transcodeImage(targetFormat, encodedData, imageInfo, 0, isVideo);
          } else {
            imageInfo.flags = 0;
            imageInfo.rgbByteOffset = 0;
            imageInfo.rgbByteLength = uncompressedByteLength;
            imageInfo.alphaByteOffset = 0;
            imageInfo.alphaByteLength = 0;
            result = transcoder.transcodeImage(targetFormat, encodedData, imageInfo, 0, ktx2Reader.hasAlpha, isVideo);
          }
        } finally {
          if (transcoder) {
            transcoder.delete();
          }
          if (imageInfo) {
            imageInfo.delete();
          }
          if (result && result.transcodedImage) {
            textureData = result.transcodedImage.get_typed_memory_view().slice();
            result.transcodedImage.delete();
          }
        }
        return textureData;
      });
    }
  };
  MSCTranscoder.JSModuleURL = "https://cdn.babylonjs.com/ktx2Transcoders/1/msc_basis_transcoder.js";
  MSCTranscoder.WasmModuleURL = "https://cdn.babylonjs.com/ktx2Transcoders/1/msc_basis_transcoder.wasm";
  MSCTranscoder.WasmBinary = null;
  MSCTranscoder.JSModule = null;
  MSCTranscoder.UseFromWorkerThread = true;
  MSCTranscoder.Name = "MSCTranscoder";

  // node_modules/@babylonjs/ktx2decoder/zstddec.js
  var init;
  var instance;
  var heap;
  var IMPORT_OBJECT = {
    env: {
      emscripten_notify_memory_growth: function() {
        heap = new Uint8Array(instance.exports.memory.buffer);
      }
    }
  };
  var ZSTDDecoder = class _ZSTDDecoder {
    async init() {
      if (init) {
        return await init;
      }
      if (typeof fetch !== "undefined") {
        init = fetch(Transcoder.GetWasmUrl(_ZSTDDecoder.WasmModuleURL)).then(async (response) => {
          if (response.ok) {
            return await response.arrayBuffer();
          }
          throw new Error(`Could not fetch the wasm component for the Zstandard decompression lib: ${response.status} - ${response.statusText}`);
        }).then(async (arrayBuffer) => await WebAssembly.instantiate(arrayBuffer, IMPORT_OBJECT)).then(this._init);
      } else {
        init = WebAssembly.instantiateStreaming(fetch(_ZSTDDecoder.WasmModuleURL), IMPORT_OBJECT).then(this._init);
      }
      return await init;
    }
    _init(result) {
      instance = result.instance;
      IMPORT_OBJECT.env.emscripten_notify_memory_growth();
    }
    decode(array, uncompressedSize = 0) {
      if (!instance) {
        throw new Error(`ZSTDDecoder: Await .init() before decoding.`);
      }
      const compressedSize = array.byteLength;
      const compressedPtr = instance.exports.malloc(compressedSize);
      heap.set(array, compressedPtr);
      uncompressedSize = uncompressedSize || Number(instance.exports.ZSTD_findDecompressedSize(compressedPtr, compressedSize));
      const uncompressedPtr = instance.exports.malloc(uncompressedSize);
      const actualSize = instance.exports.ZSTD_decompress(uncompressedPtr, uncompressedSize, compressedPtr, compressedSize);
      const dec = heap.slice(uncompressedPtr, uncompressedPtr + actualSize);
      instance.exports.free(compressedPtr);
      instance.exports.free(uncompressedPtr);
      return dec;
    }
  };
  ZSTDDecoder.WasmModuleURL = "https://cdn.babylonjs.com/zstddec.wasm";

  // node_modules/@babylonjs/ktx2decoder/transcodeDecisionTree.js
  var DecisionTree = {
    ETC1S: {
      option: "forceRGBA",
      yes: {
        transcodeFormat: TranscodeTarget.RGBA32,
        engineFormat: 32856,
        roundToMultiple4: false
      },
      no: {
        cap: "etc2",
        yes: {
          alpha: true,
          yes: {
            transcodeFormat: TranscodeTarget.ETC2_RGBA,
            engineFormat: 37496
          },
          no: {
            transcodeFormat: TranscodeTarget.ETC1_RGB,
            engineFormat: 37492
          }
        },
        no: {
          cap: "etc1",
          alpha: false,
          yes: {
            transcodeFormat: TranscodeTarget.ETC1_RGB,
            engineFormat: 36196
          },
          no: {
            cap: "bptc",
            yes: {
              transcodeFormat: TranscodeTarget.BC7_RGBA,
              engineFormat: 36492
            },
            no: {
              cap: "s3tc",
              yes: {
                alpha: true,
                yes: {
                  transcodeFormat: TranscodeTarget.BC3_RGBA,
                  engineFormat: 33779
                },
                no: {
                  transcodeFormat: TranscodeTarget.BC1_RGB,
                  engineFormat: 33776
                }
              },
              no: {
                cap: "pvrtc",
                needsPowerOfTwo: true,
                yes: {
                  alpha: true,
                  yes: {
                    transcodeFormat: TranscodeTarget.PVRTC1_4_RGBA,
                    engineFormat: 35842
                  },
                  no: {
                    transcodeFormat: TranscodeTarget.PVRTC1_4_RGB,
                    engineFormat: 35840
                  }
                },
                no: {
                  transcodeFormat: TranscodeTarget.RGBA32,
                  engineFormat: 32856,
                  roundToMultiple4: false
                }
              }
            }
          }
        }
      }
    },
    UASTC: {
      option: "forceRGBA",
      yes: {
        transcodeFormat: TranscodeTarget.RGBA32,
        engineFormat: 32856,
        roundToMultiple4: false
      },
      no: {
        option: "forceR8",
        yes: {
          transcodeFormat: TranscodeTarget.R8,
          engineFormat: 33321,
          roundToMultiple4: false
        },
        no: {
          option: "forceRG8",
          yes: {
            transcodeFormat: TranscodeTarget.RG8,
            engineFormat: 33323,
            roundToMultiple4: false
          },
          no: {
            cap: "astc",
            yes: {
              transcodeFormat: TranscodeTarget.ASTC_4X4_RGBA,
              engineFormat: 37808
            },
            no: {
              cap: "bptc",
              yes: {
                transcodeFormat: TranscodeTarget.BC7_RGBA,
                engineFormat: 36492
              },
              no: {
                option: "useRGBAIfASTCBC7NotAvailableWhenUASTC",
                yes: {
                  transcodeFormat: TranscodeTarget.RGBA32,
                  engineFormat: 32856,
                  roundToMultiple4: false
                },
                no: {
                  cap: "etc2",
                  yes: {
                    alpha: true,
                    yes: {
                      transcodeFormat: TranscodeTarget.ETC2_RGBA,
                      engineFormat: 37496
                    },
                    no: {
                      transcodeFormat: TranscodeTarget.ETC1_RGB,
                      engineFormat: 37492
                    }
                  },
                  no: {
                    cap: "etc1",
                    yes: {
                      transcodeFormat: TranscodeTarget.ETC1_RGB,
                      engineFormat: 36196
                    },
                    no: {
                      cap: "s3tc",
                      yes: {
                        alpha: true,
                        yes: {
                          transcodeFormat: TranscodeTarget.BC3_RGBA,
                          engineFormat: 33779
                        },
                        no: {
                          transcodeFormat: TranscodeTarget.BC1_RGB,
                          engineFormat: 33776
                        }
                      },
                      no: {
                        cap: "pvrtc",
                        needsPowerOfTwo: true,
                        yes: {
                          alpha: true,
                          yes: {
                            transcodeFormat: TranscodeTarget.PVRTC1_4_RGBA,
                            engineFormat: 35842
                          },
                          no: {
                            transcodeFormat: TranscodeTarget.PVRTC1_4_RGB,
                            engineFormat: 35840
                          }
                        },
                        no: {
                          transcodeFormat: TranscodeTarget.RGBA32,
                          engineFormat: 32856,
                          roundToMultiple4: false
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  };
  var TranscodeDecisionTree = class _TranscodeDecisionTree {
    static _IsLeafNode(node) {
      return node.engineFormat !== void 0;
    }
    get transcodeFormat() {
      return this._transcodeFormat;
    }
    get engineFormat() {
      return this._engineFormat;
    }
    get roundToMultiple4() {
      return this._roundToMultiple4;
    }
    constructor(textureFormat, hasAlpha, isPowerOfTwo, caps, options) {
      this._textureFormat = textureFormat;
      this._hasAlpha = hasAlpha;
      this._isPowerOfTwo = isPowerOfTwo;
      this._caps = caps;
      this._options = options ?? {};
      this.parseTree(DecisionTree);
    }
    parseTree(tree) {
      const node = this._textureFormat === SourceTextureFormat.UASTC4x4 ? tree.UASTC : tree.ETC1S;
      if (node) {
        this._parseNode(node);
      }
      return node !== void 0;
    }
    _parseNode(node) {
      if (!node) {
        return;
      }
      if (_TranscodeDecisionTree._IsLeafNode(node)) {
        this._transcodeFormat = node.transcodeFormat;
        this._engineFormat = node.engineFormat;
        this._roundToMultiple4 = node.roundToMultiple4 ?? true;
      } else {
        let condition = true;
        if (node.cap !== void 0) {
          condition = condition && !!this._caps[node.cap];
        }
        if (node.option !== void 0) {
          condition = condition && !!this._options[node.option];
        }
        if (node.alpha !== void 0) {
          condition = condition && this._hasAlpha === node.alpha;
        }
        if (node.needsPowerOfTwo !== void 0) {
          condition = condition && this._isPowerOfTwo === node.needsPowerOfTwo;
        }
        if (node.transcodeFormat !== void 0) {
          if (Array.isArray(node.transcodeFormat)) {
            condition = condition && node.transcodeFormat.indexOf(this._transcodeFormat) !== -1;
          } else {
            condition = condition && node.transcodeFormat === this._transcodeFormat;
          }
        }
        this._parseNode(condition ? node.yes : node.no);
      }
    }
  };

  // node_modules/@babylonjs/ktx2decoder/ktx2Decoder.js
  var IsPowerOfTwo = (value) => {
    return (value & value - 1) === 0 && value !== 0;
  };
  var KTX2Decoder = class _KTX2Decoder {
    constructor() {
      this._transcoderMgr = new TranscoderManager();
    }
    // eslint-disable-next-line @typescript-eslint/naming-convention
    async decode(data, caps, options) {
      const finalOptions = { ...options, ..._KTX2Decoder.DefaultDecoderOptions };
      const kfr = new KTX2FileReader(data);
      if (!kfr.isValid()) {
        throw new Error("Invalid KT2 file: wrong signature");
      }
      kfr.parse();
      if (kfr.needZSTDDecoder) {
        if (!this._zstdDecoder) {
          this._zstdDecoder = new ZSTDDecoder();
        }
        await this._zstdDecoder.init();
        return await this._decodeDataAsync(kfr, caps, finalOptions);
      }
      return await this._decodeDataAsync(kfr, caps, finalOptions);
    }
    async _decodeDataAsync(kfr, caps, options) {
      const width = kfr.header.pixelWidth;
      const height = kfr.header.pixelHeight;
      const srcTexFormat = kfr.textureFormat;
      const decisionTree = new TranscodeDecisionTree(srcTexFormat, kfr.hasAlpha, IsPowerOfTwo(width) && IsPowerOfTwo(height), caps, options);
      if (options?.transcodeFormatDecisionTree) {
        decisionTree.parseTree(options?.transcodeFormatDecisionTree);
      }
      const transcodeFormat = decisionTree.transcodeFormat;
      const engineFormat = decisionTree.engineFormat;
      const roundToMultiple4 = decisionTree.roundToMultiple4;
      const transcoder = this._transcoderMgr.findTranscoder(srcTexFormat, transcodeFormat, kfr.isInGammaSpace, options?.bypassTranscoders);
      if (transcoder === null) {
        throw new Error(`no transcoder found to transcode source texture format "${SourceTextureFormat[srcTexFormat]}" to format "${TranscodeTarget[transcodeFormat]}"`);
      }
      const mipmaps = [];
      const dataPromises = [];
      const decodedData = {
        width: 0,
        height: 0,
        transcodedFormat: engineFormat,
        mipmaps,
        isInGammaSpace: kfr.isInGammaSpace,
        hasAlpha: kfr.hasAlpha,
        transcoderName: transcoder.getName()
      };
      let firstImageDescIndex = 0;
      for (let level = 0; level < kfr.header.levelCount; level++) {
        if (level > 0) {
          firstImageDescIndex += Math.max(kfr.header.layerCount, 1) * kfr.header.faceCount * Math.max(kfr.header.pixelDepth >> level - 1, 1);
        }
        const levelWidth = Math.floor(width / (1 << level)) || 1;
        const levelHeight = Math.floor(height / (1 << level)) || 1;
        const numImagesInLevel = kfr.header.faceCount;
        const levelImageByteLength = (levelWidth + 3 >> 2) * (levelHeight + 3 >> 2) * kfr.dfdBlock.bytesPlane[0];
        const levelUncompressedByteLength = kfr.levels[level].uncompressedByteLength;
        let levelDataBuffer = kfr.data.buffer;
        let levelDataOffset = kfr.levels[level].byteOffset + kfr.data.byteOffset;
        let imageOffsetInLevel = 0;
        if (kfr.header.supercompressionScheme === SupercompressionScheme.ZStandard) {
          levelDataBuffer = this._zstdDecoder.decode(new Uint8Array(levelDataBuffer, levelDataOffset, kfr.levels[level].byteLength), levelUncompressedByteLength);
          levelDataOffset = 0;
        }
        if (level === 0) {
          decodedData.width = roundToMultiple4 ? levelWidth + 3 & ~3 : levelWidth;
          decodedData.height = roundToMultiple4 ? levelHeight + 3 & ~3 : levelHeight;
        }
        for (let imageIndex = 0; imageIndex < numImagesInLevel; imageIndex++) {
          let encodedData;
          let imageDesc = null;
          if (kfr.header.supercompressionScheme === SupercompressionScheme.BasisLZ) {
            imageDesc = kfr.supercompressionGlobalData.imageDescs[firstImageDescIndex + imageIndex];
            encodedData = new Uint8Array(levelDataBuffer, levelDataOffset + imageDesc.rgbSliceByteOffset, imageDesc.rgbSliceByteLength + imageDesc.alphaSliceByteLength);
          } else {
            encodedData = new Uint8Array(levelDataBuffer, levelDataOffset + imageOffsetInLevel, levelImageByteLength);
            imageOffsetInLevel += levelImageByteLength;
          }
          const mipmap = {
            data: null,
            width: levelWidth,
            height: levelHeight
          };
          const transcodedData = transcoder.transcode(srcTexFormat, transcodeFormat, level, levelWidth, levelHeight, levelUncompressedByteLength, kfr, imageDesc, encodedData).then((data) => {
            mipmap.data = data;
            return data;
          }).catch((reason) => {
            decodedData.errors = decodedData.errors ?? "";
            decodedData.errors += reason + "\n" + reason.stack + "\n";
            return null;
          });
          dataPromises.push(transcodedData);
          mipmaps.push(mipmap);
        }
      }
      await Promise.all(dataPromises);
      return decodedData;
    }
  };
  KTX2Decoder.DefaultDecoderOptions = {};
  TranscoderManager.RegisterTranscoder(LiteTranscoder_UASTC_ASTC);
  TranscoderManager.RegisterTranscoder(LiteTranscoder_UASTC_BC7);
  TranscoderManager.RegisterTranscoder(LiteTranscoder_UASTC_RGBA_UNORM);
  TranscoderManager.RegisterTranscoder(LiteTranscoder_UASTC_RGBA_SRGB);
  TranscoderManager.RegisterTranscoder(LiteTranscoder_UASTC_R8_UNORM);
  TranscoderManager.RegisterTranscoder(LiteTranscoder_UASTC_RG8_UNORM);
  TranscoderManager.RegisterTranscoder(MSCTranscoder);
  return __toCommonJS(index_exports);
})();
