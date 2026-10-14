# Pocket C++

A real C++17 compiler that runs in your phone's browser. Write code, tap **Run**, see the output. It works offline after the first load, and nothing is sent to a server.

**Open it:** https://shade711.github.io/pocket-cpp/

On iPhone, open the link in Safari, tap **Share**, then **Add to Home Screen**. It opens full screen like any other app.

## What it does

- Compiles with clang 8 and libc++, built for WebAssembly, right on the device
- `cin` input box, colored output, and exit codes
- Compiler errors in plain English, with a button that jumps to the line
- `try` / `catch` / `throw`, including exceptions from `stoi` and `.at()`
- Explains crashes like division by zero, bad memory access, and stack overflow
- A symbol key row (`{ } ; << >> ::`) so you don't have to dig through the phone keyboard
- Saved programs, examples, and C++11/14/17 settings

## How it works

The browser downloads `clang`, `lld` and the C++ standard library once (about 19 MB, compressed). After that, the app compiles `main.cpp` into a WebAssembly program in a background worker and runs it in a second worker that can be stopped at any time.

`try`/`catch` uses LLVM's Emscripten-style exception lowering, plus a small JavaScript runtime that matches thrown types using libc++abi's own type rules. The parts of libc++ that throw (`std::string`, `std::vector`, `stoi`) were rebuilt with exceptions turned on.

## Credits

- [wasm-clang](https://github.com/binji/wasm-clang) by Ben Smith (Apache 2.0)
- [LLVM](https://llvm.org): clang, lld, libc++, libc++abi, compiler-rt (Apache 2.0 with LLVM exceptions)
- [CodeMirror 5](https://codemirror.net/5/) (MIT)
- Fonts: Martian Mono, Overpass (SIL Open Font License), Ubuntu Mono (Ubuntu Font License)

Full license texts are in `licenses.txt`.
