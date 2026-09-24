"use strict";
// Paints terrain chunks off the main thread (see TerrainGen.paint).
importScripts('terrain.js');

let mapKey = '';
onmessage = e => {
  const {id, ix0, iy0, w, h, scale} = e.data;
  const key = JSON.stringify(e.data.map);
  if(key !== mapKey){ mapKey = key; TerrainGen.setMap(e.data.map); }
  const data = new Uint8ClampedArray(w * h * 4);
  TerrainGen.paint(data, w, h, ix0, iy0, scale);
  postMessage({id, data}, [data.buffer]);
};
