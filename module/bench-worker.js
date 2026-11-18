// InfoHardware · uma medição do teste de desempenho no Linux (roda numa thread separada).
// "cpu": a mesma unidade de trabalho do motor do Windows (Mandelbrot + bloco de inteiros), em unidades por segundo.
//        Os inteiros usam 32 bits (o JavaScript não tem inteiro de 64 bits rápido): a nota fica perto, não idêntica.
// "memory": cópia de blocos de 64 MB, em GB/s.
"use strict";
const { parentPort, workerData } = require("worker_threads");

function unit(state) {
  let acc = 0;
  for (let py = 0; py < 16; py++) {
    const ci = -1.2 + py * 0.15;
    for (let px = 0; px < 16; px++) {
      const cr = -2.0 + px * 0.16;
      let zr = 0, zi = 0, n = 0;
      while (n < 64 && zr * zr + zi * zi < 4) { const t = zr * zr - zi * zi + cr; zi = 2 * zr * zi + ci; zr = t; n++; }
      acc += n;
    }
  }
  let x = state.seed;
  for (let i = 0; i < 2048; i++) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    x = (Math.imul(x, 1103515245) + 12345) | 0;
    acc += ((x >>> 7) % 1009);
  }
  state.seed = x;
  return acc;
}

function cpu(ms) {
  const state = { seed: 0x9e3779b9 ^ (Math.random() * 0xffffffff) }; let done = 0, sink = 0;
  const t0 = performance.now();
  while (performance.now() - t0 < ms) { sink += unit(state); done++; }
  if (sink === -1) console.log(sink); // não deixa o cálculo ser descartado
  return done / ((performance.now() - t0) / 1000);
}

function memory(ms) {
  const size = 64 * 1024 * 1024, a = new Uint8Array(size), b = new Uint8Array(size);
  for (let i = 0; i < size; i += 4096) a[i] = i & 255;
  b.set(a);
  let bytes = 0;
  const t0 = performance.now();
  while (performance.now() - t0 < ms) { b.set(a); a.set(b); bytes += 2 * size * 2; }
  return bytes / ((performance.now() - t0) / 1000) / 1e9;
}

parentPort.postMessage(workerData.kind === "memory" ? memory(workerData.ms) : cpu(workerData.ms));
