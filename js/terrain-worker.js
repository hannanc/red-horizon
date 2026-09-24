"use strict";
// Paints terrain chunks off the main thread (see TerrainGen.paint).
importScripts('terrain.js');

onmessage = e => {
  const {id, ix0, iy0, w, h, scale} = e.data;
  const data = new Uint8ClampedArray(w * h * 4);
  TerrainGen.paint(data, w, h, ix0, iy0, scale);
  postMessage({id, data}, [data.buffer]);
};
