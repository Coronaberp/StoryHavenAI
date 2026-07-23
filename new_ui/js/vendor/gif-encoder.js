"use strict";

// Animated WebP muxer — builds a RIFF/WEBP ANIM container from an array of
// single-frame WebP blobs (produced by the browser's own native
// canvas.toBlob("image/webp")), instead of re-encoding pixels ourselves.
// Adapted from "Animated-WebP-Encoder" by Valentin Schmidt (MIT license,
// https://github.com/59de44955ebd/Animated-WebP-Encoder) — the original
// hardcodes an infinite loop count and expresses timing via a constant fps;
// this version takes an explicit per-animation delay (ms) and loop count so
// it lines up with this app's existing "frame delay"/"loop forever" controls.
const MAGIC_VP8X = 0x56503858;
const MAGIC_ICCP = 0x49434350;

function _writeStr(arr, pos, str) {
  for (let i = 0; i < str.length; i++) arr[pos + i] = str.charCodeAt(i);
}

async function encodeAnimatedWebp({ width, height, blobs, delayMs, loopCount }) {
  if (!blobs.length) throw new Error("No frames to encode");

  const chunks = [];
  let size = 0;

  const header = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  chunks.push(header.buffer);
  size += 12;

  const vp8x = new Uint8Array([0x56, 0x50, 0x38, 0x58, 0x0a, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const vp8xView = new DataView(vp8x.buffer);
  vp8xView.setUint16(12, width - 1, true);
  vp8xView.setUint16(15, height - 1, true);
  chunks.push(vp8x.buffer);
  size += 18;

  const anim = new Uint8Array([0x41, 0x4e, 0x49, 0x4d, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  new DataView(anim.buffer).setUint16(12, loopCount, true);
  chunks.push(anim.buffer);
  size += 14;

  for (const blob of blobs) {
    if (blob.type !== "image/webp") throw new Error("Frame blob has the wrong mime type");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    let offsetImage;
    if (view.getUint32(12) === MAGIC_VP8X) {
      offsetImage = view.getUint32(30) === MAGIC_ICCP ? 30 + 8 + view.getUint32(34, true) : 30;
    } else {
      offsetImage = 12;
    }

    const anmf = new Uint8Array(24);
    const anmfView = new DataView(anmf.buffer);
    _writeStr(anmf, 0, "ANMF");
    anmfView.setUint32(4, 16 + bytes.byteLength - offsetImage, true);
    anmfView.setUint32(8, 0, true);
    anmfView.setUint32(11, 0, true);
    anmfView.setUint32(14, width - 1, true);
    anmfView.setUint32(17, height - 1, true);
    anmfView.setUint32(20, Math.round(delayMs), true);
    anmfView.setUint8(23, 3);
    chunks.push(anmf.buffer);
    size += 24;

    const imageData = bytes.slice(offsetImage);
    chunks.push(imageData.buffer);
    size += imageData.byteLength;
  }

  const headerView = new DataView(chunks[0]);
  headerView.setUint32(4, size - 8, true);
  return new Blob(chunks, { type: "image/webp" });
}

function frameToWebpBlob(imageData, width, height, quality) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.putImageData(imageData, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("This browser can't encode WebP frames")), "image/webp", quality);
  });
}

window.GifEncoder = {
  async encode({ width, height, frames, delayMs, loop, boomerang }) {
    let frameList = frames.slice();
    if (boomerang && frameList.length > 2) {
      frameList = frameList.concat(frameList.slice(1, -1).reverse());
    }
    const blobs = await Promise.all(frameList.map((frame) => frameToWebpBlob(frame, width, height, 0.85)));
    const blob = await encodeAnimatedWebp({ width, height, blobs, delayMs, loopCount: loop ? 0 : 1 });
    return new Uint8Array(await blob.arrayBuffer());
  },
};
