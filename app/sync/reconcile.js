/* Pure synchronization decisions. No I/O: callers persist every transition atomically. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FinRoadSync = api;
})(globalThis, function () {
  'use strict';
  // base is the last remote version acknowledged locally, or null before first sync.
  // dirty means the local document contains changes since that acknowledgement.
  function decide({localExists, dirty, base, remote}) {
    if (typeof localExists !== 'boolean' || typeof dirty !== 'boolean') throw new TypeError('Invalid local state');
    if (!localExists && (dirty || base !== null)) throw new TypeError('Missing local document cannot be dirty or have a base');
    if (base !== null && (typeof base !== 'string' || !base)) throw new TypeError('Invalid base version');
    if (remote !== null && (typeof remote !== 'string' || !remote)) throw new TypeError('Invalid remote version');
    if (!localExists) return remote === null ? {action:'empty'} : {action:'download', version:remote};
    if (base === null) return remote === null ? {action:'upload', expected:null} : {action:'conflict', reason:'independent-documents'};
    if (remote === null) return {action:'conflict', reason:'remote-missing'};
    if (base !== remote) return dirty ? {action:'conflict', reason:'concurrent-changes'} : {action:'download', version:remote};
    return dirty ? {action:'upload', expected:base} : {action:'current'};
  }
  return {decide};
});
