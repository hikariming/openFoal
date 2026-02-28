try {
  const web = require("node:stream/web");
  if (typeof global.TransformStream === "undefined") global.TransformStream = web.TransformStream;
  if (typeof global.ReadableStream === "undefined") global.ReadableStream = web.ReadableStream;
  if (typeof global.WritableStream === "undefined") global.WritableStream = web.WritableStream;
} catch {}

try {
  const crypto = require("node:crypto");
  if (
    crypto.webcrypto &&
    (typeof global.crypto === "undefined" || typeof global.crypto.getRandomValues !== "function")
  ) {
    global.crypto = crypto.webcrypto;
  }
} catch {}

try {
  const { Blob } = require("buffer");
  if (typeof global.Blob === "undefined") global.Blob = Blob;
  if (typeof global.File === "undefined") {
    global.File = class File extends Blob {
      constructor(parts, name, options = {}) {
        super(parts, options);
        this.name = String(name || "");
        this.lastModified = typeof options.lastModified === "number" ? options.lastModified : Date.now();
      }
    };
  }
} catch {}

if (typeof global.DOMException === "undefined") {
  global.DOMException = class DOMException extends Error {
    constructor(message = "", name = "Error") {
      super(message);
      this.name = name;
    }
  };
}
