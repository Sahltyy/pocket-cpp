// Pocket C++ worker. Bundles wasm-clang's shared.js (Apache-2.0, Copyright 2020 WebAssembly Community Group participants), modified.
let ctx2d = null;
/*
 * Copyright 2020 WebAssembly Community Group participants
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

function sleep(ms) {
  return new Promise((resolve, _) => setTimeout(resolve, ms));
}

function readStr(u8, o, len = -1) {
  let str = '';
  let end = u8.length;
  if (len != -1)
    end = o + len;
  for (let i = o; i < end && u8[i] != 0; ++i)
    str += String.fromCharCode(u8[i]);
  return str;
}

function debounceLazy(f, ms) {
  let waiting = 0;
  let running = false;

  const wait = async () => {
    ++waiting;
    await sleep(ms);
    return --waiting === 0;
  };

  const wrapped = async (...args) => {
    if (await wait()) {
      while (running) await wait();
      running = true;
      try {
        await f(...args);
      } finally {
        running = false;
      }
    }
  };
  return wrapped;
}

const API = (function() {

class ProcExit extends Error {
  constructor(code) {
    super(`process exited with code ${code}.`);
    this.code = code;
  }
};

class NotImplemented extends Error {
  constructor(modname, fieldname) {
    super(`${modname}.${fieldname} not implemented.`);
  }
}

class AbortError extends Error {
  constructor(msg = 'abort') { super(msg); }
}

class AssertError extends Error {
  constructor(msg) { super(msg); }
}

function assert(cond) {
  if (!cond) {
    throw new AssertError('assertion failed.');
  }
}

function getInstance(module, imports) {
  return WebAssembly.instantiate(module, imports);
}

function getImportObject(obj, names) {
  const result = {};
  for (let name of names) {
    result[name] = obj[name].bind(obj);
  }
  return result;
}

function msToSec(start, end) {
  return ((end - start) / 1000).toFixed(2);
}

const ESUCCESS = 0;

class Memory {
  constructor(memory) {
    this.memory = memory;
    this.buffer = this.memory.buffer;
    this.u8 = new Uint8Array(this.buffer);
    this.u32 = new Uint32Array(this.buffer);
  }

  check() {
    if (this.buffer.byteLength === 0) {
      this.buffer = this.memory.buffer;
      this.u8 = new Uint8Array(this.buffer);
      this.u32 = new Uint32Array(this.buffer);
    }
  }

  read8(o) { return this.u8[o]; }
  read32(o) { return this.u32[o >> 2]; }
  write8(o, v) { this.u8[o] = v; }
  write32(o, v) { this.u32[o >> 2] = v; }
  write64(o, vlo, vhi = 0) { this.write32(o, vlo); this.write32(o + 4, vhi); }

  readStr(o, len) {
    return readStr(this.u8, o, len);
  }

  // Null-terminated string.
  writeStr(o, str) {
    o += this.write(o, str);
    this.write8(o, 0);
    return str.length + 1;
  }

  write(o, buf) {
    if (buf instanceof ArrayBuffer) {
      return this.write(o, new Uint8Array(buf));
    } else if (typeof buf === 'string') {
      return this.write(o, buf.split('').map(x => x.charCodeAt(0)));
    } else {
      const dst = new Uint8Array(this.buffer, o, buf.length);
      dst.set(buf);
      return buf.length;
    }
  }
};

class MemFS {
  constructor(options) {
    const compileStreaming = options.compileStreaming;
    this.hostWrite = options.hostWrite;
    this.stdinStr = options.stdinStr || "";
    this.stdinStrPos = 0;
    this.memfsFilename = options.memfsFilename;

    this.hostMem_ = null;  // Set later when wired up to application.

    // Imports for memfs module.
    const env = getImportObject(
        this, [ 'abort', 'host_write', 'host_read', 'memfs_log', 'copy_in', 'copy_out' ]);

    this.ready = compileStreaming(this.memfsFilename)
                     .then(module => WebAssembly.instantiate(module, {env}))
                     .then(instance => {
                       this.instance = instance;
                       this.exports = instance.exports;
                       this.mem = new Memory(this.exports.memory);
                       this.exports.init();
                     })
  }

  set hostMem(mem) {
    this.hostMem_ = mem;
  }

  setStdinStr(str) {
    this.stdinStr = str;
    this.stdinStrPos = 0;
  }

  addDirectory(path) {
    this.mem.check();
    this.mem.write(this.exports.GetPathBuf(), path);
    this.exports.AddDirectoryNode(path.length);
  }

  addFile(path, contents) {
    const length =
        contents instanceof ArrayBuffer ? contents.byteLength : contents.length;
    this.mem.check();
    this.mem.write(this.exports.GetPathBuf(), path);
    const inode = this.exports.AddFileNode(path.length, length);
    const addr = this.exports.GetFileNodeAddress(inode);
    this.mem.check();
    this.mem.write(addr, contents);
  }

  getFileContents(path) {
    this.mem.check();
    this.mem.write(this.exports.GetPathBuf(), path);
    const inode = this.exports.FindNode(path.length);
    const addr = this.exports.GetFileNodeAddress(inode);
    const size = this.exports.GetFileNodeSize(inode);
    return new Uint8Array(this.mem.buffer, addr, size);
  }

  abort() { throw new AbortError(); }

  host_write(fd, iovs, iovs_len, nwritten_out) {
    this.hostMem_.check();
    assert(fd <= 2);
    let size = 0;
    let str = '';
    for (let i = 0; i < iovs_len; ++i) {
      const buf = this.hostMem_.read32(iovs);
      iovs += 4;
      const len = this.hostMem_.read32(iovs);
      iovs += 4;
      str += this.hostMem_.readStr(buf, len);
      size += len;
    }
    this.hostMem_.write32(nwritten_out, size);
    this.hostWrite(str, fd);
    return ESUCCESS;
  }

  host_read(fd, iovs, iovs_len, nread) {
    this.hostMem_.check();
    assert(fd === 0);
    let size = 0;
    for (let i = 0; i < iovs_len; ++i) {
      const buf = this.hostMem_.read32(iovs);
      iovs += 4;
      const len = this.hostMem_.read32(iovs);
      iovs += 4;
      const lenToWrite = Math.min(len, (this.stdinStr.length - this.stdinStrPos));
      if(lenToWrite === 0){
        break;
      }
      this.hostMem_.write(buf, this.stdinStr.substr(this.stdinStrPos, lenToWrite));
      size += lenToWrite;
      this.stdinStrPos += lenToWrite;
      if(lenToWrite !== len){
        break;
      }
    }
    // For logging
    // this.hostWrite("Read "+ size + "bytes, pos: "+ this.stdinStrPos + "\n");
    this.hostMem_.write32(nread, size);
    return ESUCCESS;
  }

  memfs_log(buf, len) {
    this.mem.check();
    console.log(this.mem.readStr(buf, len));
  }

  copy_out(clang_dst, memfs_src, size) {
    this.hostMem_.check();
    const dst = new Uint8Array(this.hostMem_.buffer, clang_dst, size);
    this.mem.check();
    const src = new Uint8Array(this.mem.buffer, memfs_src, size);
    // console.log(`copy_out(${clang_dst.toString(16)}, ${memfs_src.toString(16)}, ${size})`);
    dst.set(src);
  }

  copy_in(memfs_dst, clang_src, size) {
    this.mem.check();
    const dst = new Uint8Array(this.mem.buffer, memfs_dst, size);
    this.hostMem_.check();
    const src = new Uint8Array(this.hostMem_.buffer, clang_src, size);
    // console.log(`copy_in(${memfs_dst.toString(16)}, ${clang_src.toString(16)}, ${size})`);
    dst.set(src);
  }
}

const RAF_PROC_EXIT_CODE = 0xC0C0A;

class App {
  constructor(module, memfs, name, ...args) {
    this.argv = [name, ...args];
    this.environ = {USER : 'alice'};
    this.memfs = memfs;
    this.allowRequestAnimationFrame = true;
    this.handles = new Map();
    this.nextHandle = 0;

    const env = getImportObject(this, [
      'canvas_arc',
      'canvas_arcTo',
      'canvas_beginPath',
      'canvas_bezierCurveTo',
      'canvas_clearRect',
      'canvas_clip',
      'canvas_closePath',
      'canvas_createImageData',
      'canvas_destroyHandle',
      'canvas_ellipse',
      'canvas_fill',
      'canvas_fillRect',
      'canvas_fillText',
      'canvas_imageDataSetData',
      'canvas_lineTo',
      'canvas_measureText',
      'canvas_moveTo',
      'canvas_putImageData',
      'canvas_quadraticCurveTo',
      'canvas_rect',
      'canvas_requestAnimationFrame',
      'canvas_restore',
      'canvas_rotate',
      'canvas_save',
      'canvas_scale',
      'canvas_setFillStyle',
      'canvas_setFont',
      'canvas_setGlobalAlpha',
      'canvas_setHeight',
      'canvas_setLineCap',
      'canvas_setLineDashOffset',
      'canvas_setLineJoin',
      'canvas_setLineWidth',
      'canvas_setMiterLimit',
      'canvas_setShadowBlur',
      'canvas_setShadowColor',
      'canvas_setShadowOffsetX',
      'canvas_setShadowOffsetY',
      'canvas_setStrokeStyle',
      'canvas_setTextAlign',
      'canvas_setTextBaseline',
      'canvas_setTransform',
      'canvas_setWidth',
      'canvas_stroke',
      'canvas_strokeRect',
      'canvas_strokeText',
      'canvas_transform',
      'canvas_translate',
    ]);

    const wasi_unstable = getImportObject(this, [
      'proc_exit', 'environ_sizes_get', 'environ_get', 'args_sizes_get',
      'args_get', 'random_get', 'clock_time_get', 'poll_oneoff'
    ]);

    // Fill in some WASI implementations from memfs.
    Object.assign(wasi_unstable, this.memfs.exports);

    // Fill any other imports the program needs (e.g. exception hooks).
    for (const imp of WebAssembly.Module.imports(module)) {
      if (imp.module !== 'env' || imp.kind !== 'function' || imp.name in env) continue;
      const hook = App.resolveImport ? App.resolveImport(this, imp.name) : null;
      env[imp.name] = hook || (() => { throw new Error(`missing function ${imp.name}`); });
    }

    this.ready = getInstance(module, {wasi_unstable, env}).then(instance => {
      this.instance = instance;
      this.exports = this.instance.exports;
      this.mem = new Memory(this.exports.memory);
      this.memfs.hostMem = this.mem;
    });
  }

  async run() {
    await this.ready;
    try {
      this.exports._start();
    } catch (exn) {
      if (exn instanceof ProcExit && exn.code === 0) return false;
      throw exn;
    }
    return false;
  }

  proc_exit(code) {
    throw new ProcExit(code);
  }

  environ_sizes_get(environ_count_out, environ_buf_size_out) {
    this.mem.check();
    let size = 0;
    const names = Object.getOwnPropertyNames(this.environ);
    for (const name of names) {
      const value = this.environ[name];
      // +2 to account for = and \0 in "name=value\0".
      size += name.length + value.length + 2;
    }
    this.mem.write64(environ_count_out, names.length);
    this.mem.write64(environ_buf_size_out, size);
    return ESUCCESS;
  }

  environ_get(environ_ptrs, environ_buf) {
    this.mem.check();
    const names = Object.getOwnPropertyNames(this.environ);
    for (const name of names) {
      this.mem.write32(environ_ptrs, environ_buf);
      environ_ptrs += 4;
      environ_buf +=
          this.mem.writeStr(environ_buf, `${name}=${this.environ[name]}`);
    }
    this.mem.write32(environ_ptrs, 0);
    return ESUCCESS;
  }

  args_sizes_get(argc_out, argv_buf_size_out) {
    this.mem.check();
    let size = 0;
    for (let arg of this.argv) {
      size += arg.length + 1;  // "arg\0".
    }
    this.mem.write64(argc_out, this.argv.length);
    this.mem.write64(argv_buf_size_out, size);
    return ESUCCESS;
  }

  args_get(argv_ptrs, argv_buf) {
    this.mem.check();
    for (let arg of this.argv) {
      this.mem.write32(argv_ptrs, argv_buf);
      argv_ptrs += 4;
      argv_buf += this.mem.writeStr(argv_buf, arg);
    }
    this.mem.write32(argv_ptrs, 0);
    return ESUCCESS;
  }

  random_get(buf, buf_len) {
    const data = new Uint8Array(this.mem.buffer, buf, buf_len);
    for (let i = 0; i < buf_len; ++i) {
      data[i] = (Math.random() * 256) | 0;
    }
  }

  clock_time_get(clock_id, precision, time_out) {
    throw new NotImplemented('wasi_unstable', 'clock_time_get');
  }

  poll_oneoff(in_ptr, out_ptr, nsubscriptions, nevents_out) {
    throw new NotImplemented('wasi_unstable', 'poll_oneoff');
  }

  canvas_destroyHandle(handle) {
    this.handles.delete(handle);
  }

  // Canvas API
  canvas_setWidth(width) { if (canvas) canvas.width = width; }
  canvas_setHeight(height) { if (canvas) canvas.height = height; }
  canvas_requestAnimationFrame() {
    if (this.allowRequestAnimationFrame) {
      requestAnimationFrame(ms => {
        if (this.allowRequestAnimationFrame) {
          this.exports.canvas_loop(ms);
        }
      });
    }
  }

  // ImageData stuff
  canvas_createImageData(w, h) {
    if (ctx2d) {
      const imageData = ctx2d.createImageData(w, h);
      const handle = this.nextHandle++;
      this.handles.set(handle, imageData);
      return handle;
    }
    return -1;
  }
  canvas_putImageData(handle, x, y) {
    if (ctx2d) {
      const imageData = this.handles.get(handle);
      if (imageData) {
        ctx2d.putImageData(imageData, x, y);
      }
    }
  }
  canvas_imageDataSetData(handle, buffer, offset, size) {
    const imageData = this.handles.get(handle);
    if (imageData) {
      this.mem.check();
      const src = new Uint8Array(this.mem.buffer, buffer, size);
      imageData.data.set(src, offset);
    }
  }

  // Other Canvas methods.
  canvas_arc(...args) { if (ctx2d) ctx2d.arc(...args); }
  canvas_arcTo(...args) { if (ctx2d) ctx2d.arcTo(...args); }
  canvas_beginPath(...args) { if (ctx2d) ctx2d.beginPath(...args); }
  canvas_bezierCurveTo(...args) { if (ctx2d) ctx2d.bezierCurveTo(...args); }
  canvas_clearRect(...args) { if (ctx2d) ctx2d.clearRect(...args); }
  canvas_clip(value) { if (ctx2d) ctx2d.clip(['nonzero', 'evenodd'][value]); }
  canvas_closePath(...args) { if (ctx2d) ctx2d.closePath(...args); }
  canvas_ellipse(...args) { if (ctx2d) ctx2d.ellipse(...args); }
  canvas_fill(value) { if (ctx2d) ctx2d.fill(['nonzero', 'evenodd'][value]); }
  canvas_fillRect(...args) { if (ctx2d) ctx2d.fillRect(...args); }
  canvas_fillText(text, text_len, x, y) {  // TODO: maxwidth
    this.mem.check();
    if (ctx2d) ctx2d.fillText(this.mem.readStr(text, text_len), x, y);
  }
  canvas_lineTo(...args) { if (ctx2d) ctx2d.lineTo(...args); }
  canvas_measureText(text, text_len) {
    this.mem.check();
    if (ctx2d) return ctx2d.measureText(this.mem.readStr(text, text_len)).width;
    return 0;
  }
  canvas_moveTo(...args) { if (ctx2d) ctx2d.moveTo(...args); }
  canvas_quadraticCurveTo(...args) { if (ctx2d) ctx2d.quadraticCurveTo(...args); }
  canvas_rect(...args) { if (ctx2d) ctx2d.rect(...args); }
  canvas_restore(...args) { if (ctx2d) ctx2d.restore(...args); }
  canvas_rotate(...args) { if (ctx2d) ctx2d.rotate(...args); }
  canvas_save(...args) { if (ctx2d) ctx2d.save(...args); }
  canvas_scale(...args) { if (ctx2d) ctx2d.scale(...args); }
  canvas_setTransform(...args) { if (ctx2d) ctx2d.setTransform(...args); }
  canvas_stroke(...args) { if (ctx2d) ctx2d.stroke(...args); }
  canvas_strokeRect(...args) { if (ctx2d) ctx2d.strokeRect(...args); }
  canvas_strokeText(text, text_len, x, y) {  // TODO: maxwidth
    this.mem.check();
    if (ctx2d) ctx2d.strokeText(this.mem.readStr(text, text_len), x, y);
  }
  canvas_transform(...args) { if (ctx2d) ctx2d.transform(...args); }
  canvas_translate(...args) { if (ctx2d) ctx2d.translate(...args); }

  // Canvas properties.
  canvas_setFillStyle(buf, len) {
    this.mem.check();
    if (ctx2d) ctx2d.fillStyle = this.mem.readStr(buf, len);
  }
  canvas_setFont(buf, len) {
    this.mem.check();
    if (ctx2d) ctx2d.font = this.mem.readStr(buf, len);
  }
  canvas_setGlobalAlpha(value) { if (ctx2d) ctx2d.globalAlpha = value; }
  canvas_setLineCap(value) {
    if (ctx2d) ctx2d.lineCap = ['butt', 'round', 'square'][value];
  }
  canvas_setLineDashOffset(value) { if (ctx2d) ctx2d.lineDashOffset = value; }
  canvas_setLineJoin(value) {
    if (ctx2d) ctx2d.lineJoin = ['bevel', 'round', 'miter'][value];
  }
  canvas_setLineWidth(value) { if (ctx2d) ctx2d.lineWidth = value; }
  canvas_setMiterLimit(value) { if (ctx2d) ctx2d.miterLimit = value; }
  canvas_setShadowBlur(value) { if (ctx2d) ctx2d.shadowBlur = value; }
  canvas_setShadowColor(buf, len) {
    this.mem.check();
    if (ctx2d) ctx2d.shadowColor = this.mem.readStr(buf, len);
  }
  canvas_setShadowOffsetX(value) { if (ctx2d) ctx2d.setShadowOffsetX = value; }
  canvas_setShadowOffsetY(value) { if (ctx2d) ctx2d.setShadowOffsetY = value; }
  canvas_setStrokeStyle(buf, len) {
    this.mem.check();
    if (ctx2d) ctx2d.strokeStyle = this.mem.readStr(buf, len);
  }
  canvas_setTextAlign(value) {
    if (ctx2d)
      ctx2d.textAlign = ['left', 'right', 'center', 'start', 'end'][value];
  }
  canvas_setTextBaseline(value) {
    if (ctx2d)
      ctx2d.textBaseline = [
        'top', 'hanging', 'middle', 'alphabetic', 'ideographic', 'bottom'
      ][value];
  }
}

class Tar {
  constructor(buffer) {
    this.u8 = new Uint8Array(buffer);
    this.offset = 0;
  }

  readStr(len) {
    const result = readStr(this.u8, this.offset, len);
    this.offset += len;
    return result;
  }

  readOctal(len) {
    return parseInt(this.readStr(len), 8);
  }

  alignUp() {
    this.offset = (this.offset + 511) & ~511;
  }

  readEntry() {
    if (this.offset + 512 > this.u8.length) {
      return null;
    }

    const entry = {
      filename : this.readStr(100),
      mode : this.readOctal(8),
      owner : this.readOctal(8),
      group : this.readOctal(8),
      size : this.readOctal(12),
      mtim : this.readOctal(12),
      checksum : this.readOctal(8),
      type : this.readStr(1),
      linkname : this.readStr(100),
    };

    if (this.readStr(8) !== 'ustar  ') {
      return null;
    }

    entry.ownerName = this.readStr(32);
    entry.groupName = this.readStr(32);
    entry.devMajor = this.readStr(8);
    entry.devMinor = this.readStr(8);
    entry.filenamePrefix = this.readStr(155);
    this.alignUp();

    if (entry.type === '0') {        // Regular file.
      entry.contents = this.u8.subarray(this.offset, this.offset + entry.size);
      this.offset += entry.size;
      this.alignUp();
    } else if (entry.type !== '5') { // Directory.
      console.log('type', entry.type);
      assert(false);
    }
    return entry;
  }

  untar(memfs) {
    let entry;
    while (entry = this.readEntry()) {
      switch (entry.type) {
      case '0': // Regular file.
        memfs.addFile(entry.filename, entry.contents);
        break;
      case '5':
        memfs.addDirectory(entry.filename);
        break;
      }
    }
  }
}

class API {
  constructor(options) {
    this.moduleCache = {};
    this.readBuffer = options.readBuffer;
    this.compileStreaming = options.compileStreaming;
    this.hostWrite = options.hostWrite;
    this.clangFilename = options.clang || 'clang';
    this.lldFilename = options.lld || 'lld';
    this.sysrootFilename = options.sysroot || 'sysroot.tar';
    this.showTiming = options.showTiming || false;

    this.clangCommonArgs = [
      '-disable-free',
      '-isysroot', '/',
      '-internal-isystem', '/include/c++/v1',
      '-internal-isystem', '/include',
      '-internal-isystem', '/lib/clang/8.0.1/include',
      '-ferror-limit', '19',
      '-fmessage-length', '0',
    ];

    this.memfs = new MemFS({
      compileStreaming : this.compileStreaming,
      hostWrite : this.hostWrite,
      memfsFilename : options.memfs || 'memfs',
    });
    this.ready = this.memfs.ready.then(
        () => { return this.untar(this.memfs, this.sysrootFilename); });
  }

  hostLog(message) {
    const yellowArrow = '\x1b[1;93m>\x1b[0m ';
    this.hostWrite(`${yellowArrow}${message}`);
  }

  async hostLogAsync(message, promise) {
    const start = +new Date();
    this.hostLog(`${message}...`);
    const result = await promise;
    const end = +new Date();
    this.hostWrite(' done.');
    if (this.showTiming) {
      const green = '\x1b[92m';
      const normal = '\x1b[0m';
      this.hostWrite(` ${green}(${msToSec(start, end)}s)${normal}\n`);
    }
    this.hostWrite('\n');
    return result;
  }

  async getModule(name) {
    if (this.moduleCache[name]) return this.moduleCache[name];
    const module = await this.hostLogAsync(`Fetching and compiling ${name}`,
                                           this.compileStreaming(name));
    this.moduleCache[name] = module;
    return module;
  }

  async untar(memfs, filename) {
    await this.memfs.ready;
    const promise = (async () => {
      const tar = new Tar(await this.readBuffer(filename));
      tar.untar(this.memfs);
    })();
    await this.hostLogAsync(`Untarring ${filename}`, promise);
  }

  async compile(options) {
    const input = options.input;
    const contents = options.contents;
    const obj = options.obj;
    const opt = options.opt || '2';

    await this.ready;
    this.memfs.addFile(input, contents);
    const clang = await this.getModule(this.clangFilename);
    return await this.run(clang, 'clang', '-cc1', '-emit-obj',
                          ...this.clangCommonArgs, ...(options.flags || ['-O2']), '-o', obj, '-x',
                          'c++', input);
  }

  async compileToAssembly(options) {
    const input = options.input;
    const output = options.output;
    const contents = options.contents;
    const obj = options.obj;
    const triple = options.triple || 'x86_64';
    const opt = options.opt || '2';

    await this.ready;
    this.memfs.addFile(input, contents);
    const clang = await this.getModule(this.clangFilename);
    await this.run(clang, 'clang', '-cc1', '-S', ...this.clangCommonArgs,
                          `-triple=${triple}`, '-mllvm',
                          '--x86-asm-syntax=intel', `-O${opt}`,
                          '-o', output, '-x', 'c++', input);
    return this.memfs.getFileContents(output);
  }

  async compileTo6502(options) {
    const input = options.input;
    const output = options.output;
    const contents = options.contents;
    const flags = options.flags;

    await this.ready;
    this.memfs.addFile(input, contents);
    const vasm = await this.getModule('vasm6502_oldstyle');
    await this.run(vasm, 'vasm6502_oldstyle', ...flags, '-o', output, input);
    return this.memfs.getFileContents(output);
  }

  async link(obj, wasm) {
    const stackSize = 1024 * 1024;

    const libdir = 'lib/wasm32-wasi';
    const crt1 = `${libdir}/crt1.o`;
    await this.ready;
    const lld = await this.getModule(this.lldFilename);
    return await this.run(
        lld, 'wasm-ld', '--no-threads',
        '--export-dynamic',  // TODO required?
        '-z', `stack-size=${stackSize}`, `-L${libdir}`, crt1, obj, '-lc',
        '-lc++', '-lc++abi', '-lcanvas', ...(this.extraLinkArgs || []), '-o', wasm)
  }

  async run(module, ...args) {
    this.hostLog(`${args.join(' ')}\n`);
    const start = +new Date();
    const app = new App(module, this.memfs, ...args);
    const instantiate = +new Date();
    const stillRunning = await app.run();
    const end = +new Date();
    this.hostWrite('\n');
    if (this.showTiming) {
      const green = '\x1b[92m';
      const normal = '\x1b[0m';
      let msg = `${green}(${msToSec(start, instantiate)}s`;
      msg += `/${msToSec(instantiate, end)}s)${normal}\n`;
      this.hostWrite(msg);
    }
    return stillRunning ? app : null;
  }

  async compileLinkRun(contents) {
    const input = `test.cc`;
    const obj = `test.o`;
    const wasm = `test.wasm`;
    await this.compile({input, contents, obj});
    await this.link(obj, wasm);

    const buffer = this.memfs.getFileContents(wasm);
    const testMod = await this.hostLogAsync(`Compiling ${wasm}`,
                                            WebAssembly.compile(buffer));
    return await this.run(testMod, wasm);
  }
}

API.App = App;
API.MemFS = MemFS;
API.ProcExit = ProcExit;
return API;

})();


// Downloads a gzipped asset published next to the page, keeps a copy in the
// Cache API when it is available, and returns the decompressed bytes.
const ASSET_CACHE = 'pocket-cpp-assets';

async function openAssetCache() {
  try {
    if (typeof caches === 'undefined') return null;
    return await caches.open(ASSET_CACHE);
  } catch (e) {
    return null;
  }
}

// Drop compiler files from older versions so they don't pile up.
async function pruneAssetCache(keepNames) {
  try {
    if (typeof caches === 'undefined') return;
    await caches.delete('pocket-cpp-v1');
    const cache = await caches.open(ASSET_CACHE);
    const keep = new Set(keepNames.map((n) => new URL(n, self.location.href).href));
    for (const req of await cache.keys()) {
      if (!keep.has(req.url)) await cache.delete(req);
    }
  } catch (e) {}
}

async function fetchAsset(url, onBytes) {
  const cache = await openAssetCache();
  let res = null;
  if (cache) {
    try { res = await cache.match(url); } catch (e) { res = null; }
  }
  if (!res) {
    res = await fetch(url);
    if (!res.ok) throw new Error(`Could not download ${url} (HTTP ${res.status}).`);
    if (cache) cache.put(url, res.clone()).catch(() => {});
  }
  let packed;
  if (res.body && res.body.getReader) {
    const reader = res.body.getReader();
    const chunks = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      if (onBytes) onBytes(value.length);
    }
    packed = new Blob(chunks);
  } else {
    packed = await res.blob();
    if (onBytes) onBytes(packed.size);
  }
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser is too old to unpack the compiler. Update iOS and try again.');
  }
  const stream = packed.stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).arrayBuffer();
}

// Compiler worker: downloads clang + lld + headers once, then compiles and
// links main.cpp into a WebAssembly program on request.
const ASSETS = {
  clang: ['clang-c678a55c.gz.wasm', 10519136],
  lld: ['lld-c2fd0d83.gz.wasm', 6705467],
  sysroot: ['sysroot-19178e84.gz.wasm', 1802255],
  memfs: ['memfs-d9523d8c.gz.wasm', 18558],
};
const TOTAL_BYTES = Object.values(ASSETS).reduce((n, a) => n + a[1], 0);

// Symbols for throw/try that the playground supplies at run time.
const EXCEPTION_SYMBOLS = [
  '__cxa_allocate_exception', '__cxa_throw', '__cxa_begin_catch', '__cxa_end_catch',
  '__cxa_free_exception', '__cxa_rethrow', '__gxx_personality_v0', '_Unwind_Resume',
  '__cxa_call_unexpected', '__cxa_get_exception_ptr', '__cxa_current_exception_type',
  '__cxa_uncaught_exceptions', '__cxa_uncaught_exception', '__resumeException',
  'llvm_eh_typeid_for', 'getTempRet0', 'setTempRet0',
  // Called from the exception-enabled parts of libc++ (string, vector).
  "__cxa_find_matching_catch_2",
  "__cxa_find_matching_catch_3",
  "__invoke_%\"class.std::__2::basic_string\"*_%\"class.std::__2::basic_string\"*_i32_i8",
  "__invoke_%\"class.std::__2::basic_string.2\"*_%\"class.std::__2::basic_string.2\"*_i32_i32",
  "__invoke_%\"class.std::length_error\"*_%\"class.std::length_error\"*_i8*",
  "__invoke_%\"class.std::logic_error\"*_%\"class.std::logic_error\"*_%\"class.std::__2::basic_string\"*",
  "__invoke_%\"class.std::out_of_range\"*_%\"class.std::out_of_range\"*_i8*",
  "__invoke_double_i32*_i32**",
  "__invoke_float_i32*_i32**",
  "__invoke_fp128_i32*_i32**",
  "__invoke_i32*_i32*_i32*_i32",
  "__invoke_i32*_i32*_i32_i32",
  "__invoke_i32_i32*_i32**_i32",
  "__invoke_i32_i32*_i32_i32*_...",
  "__invoke_i64_i32*_i32**_i32",
  "__invoke_i8*_i32",
  "__invoke_void",
  "__invoke_void_%\"class.std::__2::__basic_string_common\"*",
  "__invoke_void_%\"class.std::__2::basic_string\"*_%\"class.std::__2::basic_string\"*_i8*",
  "__invoke_void_%\"class.std::__2::basic_string\"*_i32_i32_i32_i32_i32_i32_i8*",
  "__invoke_void_i8*",
  "__invoke_void_i8*_i8*_i8*",
].join('\n') + '\n';

// Names a compiled main.o may need from the exception runtime.
const EH_IMPORT = /^(__invoke_|__cxa_|__resumeException$|llvm_eh_typeid_for$|getTempRet0$|setTempRet0$)/;

function readLeb(b, o) {
  let r = 0, s = 0, x;
  do { x = b[o++]; r |= (x & 0x7f) << s; s += 7; } while (x & 0x80);
  return [r >>> 0, o];
}

// Function imports of a relocatable wasm object (its undefined functions).
function objectImports(bytes) {
  const b = bytes;
  const names = [];
  const dec = new TextDecoder();
  let o = 8;
  while (o < b.length) {
    const id = b[o];
    const [size, body] = readLeb(b, o + 1);
    if (id === 2) {
      let [count, p] = readLeb(b, body);
      for (let i = 0; i < count; i++) {
        let n;
        [n, p] = readLeb(b, p); p += n;                    // module
        [n, p] = readLeb(b, p);
        const field = dec.decode(b.subarray(p, p + n)); p += n;
        const kind = b[p++];
        if (kind === 0) { [, p] = readLeb(b, p); names.push(field); }
        else if (kind === 1) { p++; const f = b[p++]; [, p] = readLeb(b, p); if (f & 1) [, p] = readLeb(b, p); }
        else if (kind === 2) { const f = b[p++]; [, p] = readLeb(b, p); if (f & 1) [, p] = readLeb(b, p); }
        else if (kind === 3) { p += 2; }
      }
      break;
    }
    o = body + size;
  }
  return names;
}

let api = null;
let log = '';
let loaded = 0;
let lastProgress = 0;

function post(msg, transfer) { self.postMessage(msg, transfer || []); }

function onBytes(n) {
  loaded += n;
  const now = Date.now();
  if (now - lastProgress > 120 || loaded >= TOTAL_BYTES) {
    lastProgress = now;
    post({ type: 'progress', loaded: Math.min(loaded, TOTAL_BYTES), total: TOTAL_BYTES });
  }
}

let readyPromise = null;
function prepare() {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    const [clangBytes, lldBytes, sysrootBytes, memfsBytes] = await Promise.all([
      fetchAsset(ASSETS.clang[0], onBytes),
      fetchAsset(ASSETS.lld[0], onBytes),
      fetchAsset(ASSETS.sysroot[0], onBytes),
      fetchAsset(ASSETS.memfs[0], onBytes),
    ]);
    post({ type: 'progress', loaded: TOTAL_BYTES, total: TOTAL_BYTES });
    post({ type: 'preparing' });
    const [clangMod, lldMod, memfsMod] = await Promise.all([
      WebAssembly.compile(clangBytes),
      WebAssembly.compile(lldBytes),
      WebAssembly.compile(memfsBytes),
    ]);
    const modules = { clang: clangMod, lld: lldMod, memfs: memfsMod };
    api = new API({
      readBuffer: async () => sysrootBytes,
      compileStreaming: async (name) => modules[name],
      hostWrite: (s) => { log += s; },
    });
    api.hostLog = () => {};
    api.hostLogAsync = async (_msg, promise) => promise;
    api.moduleCache = { clang: clangMod, lld: lldMod };
    await api.ready;
    api.memfs.addFile('exceptions.syms', EXCEPTION_SYMBOLS);
    api.extraLinkArgs = [
      'lib/wasm32-wasi/compiler-rt-tf.o', 'lib/wasm32-wasi/pocket-eh.o', 'lib/wasm32-wasi/pocket-threw.o',
      '--allow-undefined-file=exceptions.syms', '--export-table',
      '--export=malloc', '--export=free', '--export=setThrew', '--export=__pocket_can_catch',
      '--export=__pocket_is_pointer_type', '--export=__pocket_what', '--export=__pocket_type_name',
    ];
    post({ type: 'ready' });
    pruneAssetCache(Object.values(ASSETS).map((a) => a[0]));
  })();
  return readyPromise;
}

function isExit(err) {
  return err && typeof err.code === 'number' && /process exited/.test(err.message || '');
}

self.onmessage = async (event) => {
  const msg = event.data;
  if (msg.type === 'init') {
    try { await prepare(); } catch (err) {
      post({ type: 'fatal', message: String((err && err.message) || err) });
    }
    return;
  }
  if (msg.type === 'build') {
    try { await prepare(); } catch (err) {
      post({ type: 'fatal', message: String((err && err.message) || err) });
      return;
    }
    const t0 = performance.now();
    let stage = 'compile';
    let compileLog = '';
    log = '';
    try {
      // Real try/catch costs a little speed, so only turn it on when used.
      const flags = ['-mthread-model', 'single', ...msg.flags];
      if (/\btry\b/.test(msg.code)) flags.push('-mllvm', '-enable-emscripten-cxx-exceptions');
      await api.compile({ input: 'main.cpp', contents: new TextEncoder().encode(msg.code), obj: 'main.o', flags });
      compileLog = log;
      const extra = objectImports(api.memfs.getFileContents('main.o')).filter((n) => EH_IMPORT.test(n));
      api.memfs.addFile('exceptions.syms', EXCEPTION_SYMBOLS + extra.join('\n') + '\n');
      log = '';
      stage = 'link';
      await api.link('main.o', 'main.wasm');
      const bytes = api.memfs.getFileContents('main.wasm').slice();
      post({
        type: 'built', id: msg.id, ok: true, compileLog, linkLog: log,
        ms: performance.now() - t0, wasm: bytes.buffer,
      }, [bytes.buffer]);
    } catch (err) {
      if (stage === 'compile') compileLog = log;
      post({
        type: 'built', id: msg.id, ok: false, stage, compileLog,
        linkLog: stage === 'link' ? log : '',
        crash: isExit(err) ? null : String((err && err.message) || err),
        ms: performance.now() - t0,
      });
    }
  }
};
