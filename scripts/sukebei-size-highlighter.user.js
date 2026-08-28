// ==UserScript==
// @name         Sukebei Size Highlighter
// @namespace    https://sukebei.nyaa.si/
// @version      1.1
// @description  Highlight the Size column based on relative magnitude — larger values get more eye-catching colors.
// @match        *://sukebei.nyaa.si/*
// @include      *://sukebei.nyaa.si/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';
console.log("runrun");
  const UNIT_BYTES = {
    KiB: 1024,
    MiB: 1024 ** 2,
    GiB: 1024 ** 3,
    TiB: 1024 ** 4,
  };

  const SIZE_RE = /^([\d.]+)\s*(KiB|MiB|GiB|TiB)$/i;

  function parseSize(text) {
    const m = text.trim().match(SIZE_RE);
    if (!m) return null;
    return parseFloat(m[1]) * (UNIT_BYTES[m[2]] || 1);
  }

  function findSizeColIndex(table) {
    const sizeTh = table.querySelector('th.hdr-size');
    if (!sizeTh) return -1;
    const ths = table.querySelectorAll('thead > tr > th');
    let visualCol = 0;
    for (const th of ths) {
      if (th === sizeTh) return visualCol;
      visualCol += parseInt(th.getAttribute('colspan') || '1', 10);
    }
    return -1;
  }

  function findSizeTdIndex(table, targetVisualCol) {
    const firstRow = table.querySelector('tbody > tr');
    if (!firstRow) return -1;
    const tds = firstRow.querySelectorAll('td');
    let visualCol = 0;
    for (let i = 0; i < tds.length; i++) {
      const span = parseInt(tds[i].getAttribute('colspan') || '1', 10);
      if (visualCol === targetVisualCol) return i;
      visualCol += span;
    }
    return -1;
  }

  function run() {
    const table = document.querySelector('table.torrent-list');
    if (!table) return;

    const visualCol = findSizeColIndex(table);
    if (visualCol === -1) return;

    const tdIdx = findSizeTdIndex(table, visualCol);
    if (tdIdx === -1) return;

    const rows = table.querySelectorAll('tbody > tr');
    const cells = [];
    const values = [];

    rows.forEach((tr) => {
      const tds = tr.querySelectorAll('td');
      if (tds.length <= tdIdx) return;
      const td = tds[tdIdx];
      const bytes = parseSize(td.textContent);
      if (bytes === null) return;
      cells.push(td);
      values.push(bytes);
    });

    if (!values.length) return;

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    cells.forEach((td, i) => {
      const ratio = (values[i] - min) / range;
      const hue = (1 - ratio) * 120;
      const t = 1 - Math.abs(hue - 45) / 75;
      const sat = 90 + t * 10;
      const bgL = 82 - t * 14;
      const txL = 25 - t * 7;
      td.style.color = `hsl(${hue}, ${sat}%, ${txL}%)`;
      td.style.backgroundColor = `hsl(${hue}, ${sat}%, ${bgL}%)`;
      td.style.fontWeight = ratio > 0.7 ? 'bold' : 'normal';
    });

  }

  setTimeout(run, 100);
})();
