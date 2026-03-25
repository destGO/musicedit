/**
 * AudioCraft Pro — app.js  (v3 — ES module imports for WaveSurfer)
 *
 * Key fix: WaveSurfer + RegionsPlugin imported as proper ES modules
 * so the global UMD reference issue is eliminated entirely.
 * wireEvents() is always called even if WaveSurfer init fails.
 */

'use strict';

// ─── ES Module Imports ────────────────────────────────────────────────
import WaveSurfer    from 'https://unpkg.com/wavesurfer.js@7/dist/wavesurfer.esm.js';
import RegionsPlugin from 'https://unpkg.com/wavesurfer.js@7/dist/plugins/regions.esm.js';

// ─── State ────────────────────────────────────────────────────────────
const state = {
  ffmpeg: null,
  ffmpegLoaded: false,
  ffmpegLoading: false,
  ffmpegCancelRequested: false,
  audioCtx: null,
  wavesurfer: null,
  regionsPlugin: null,
  clips: [],
  activeClipId: null,
  currentBuffer: null,
  activeRegion: null,
  pitchSemitones: 0,
  vocalStrength: 1.0,
  bladeMode: false,
  bladeStartPos: null,
};

let clipIdCounter = 0;

// ─── DOM refs ─────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const els = {
  overlay:          $('ffmpeg-overlay'),
  ffmpegProgress:   $('ffmpeg-progress'),
  ffmpegStatusMsg:  $('ffmpeg-status-msg'),
  btnCancelFfmpeg:  $('btn-cancel-ffmpeg'),
  fileInput:        $('file-input'),
  btnImport:        $('btn-import'),
  btnExportWav:     $('btn-export-wav'),
  btnExportMp3:     $('btn-export-mp3'),
  btnExportWma:     $('btn-export-wma'),
  clipList:         $('clip-list'),
  waveformDrop:     $('waveform-drop-zone'),
  placeholder:      $('waveform-placeholder'),
  waveformLoad:     $('waveform-loading'),
  loadingLabel:     $('loading-label'),
  regionInfo:       $('region-info'),
  regionStart:      $('region-start'),
  regionEnd:        $('region-end'),
  btnTrim:          $('btn-trim'),
  btnDeleteRegion:  $('btn-delete-region'),
  btnBladeMode:     $('btn-blade-mode'),
  bladeHint:        $('blade-hint'),
  btnKeepRegion:    $('btn-keep-region'),
  btnSplit:         $('btn-split'),
  btnPlay:          $('btn-play'),
  btnStop:          $('btn-stop'),
  timeCurrent:      $('time-current'),
  timeTotal:        $('time-total'),
  volumeSlider:     $('volume-slider'),
  toggleVocal:      $('toggle-vocal'),
  vocalStrength:    $('vocal-strength'),
  vocalStrengthVal: $('vocal-strength-val'),
  btnApplyVocal:    $('btn-apply-vocal'),
  togglePitch:      $('toggle-pitch'),
  pitchSlider:      $('pitch-slider'),
  pitchValue:       $('pitch-value'),
  pitchDown:        $('pitch-down'),
  pitchUp:          $('pitch-up'),
  btnApplyPitch:    $('btn-apply-pitch'),
  btnMerge:         $('btn-merge'),
  btnMerge2:        $('btn-merge2'),
  statusMsg:        $('status-msg'),
  fileInfo:         $('file-info'),
};

// ─── Utilities ────────────────────────────────────────────────────────
const formatTime = s => {
  const m   = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1).padStart(4, '0');
  return `${m}:${sec}`;
};
const setStatus = msg => { if(els.statusMsg) els.statusMsg.textContent = msg; };

const setExportEnabled = yes => {
  els.btnExportWav.disabled = !yes;
  els.btnExportMp3.disabled = !yes;
  els.btnExportWma.disabled = !yes;
};

const setEditEnabled = yes => {
  els.btnPlay.disabled       = !yes;
  els.btnStop.disabled       = !yes;
  els.pitchSlider.disabled   = !yes;
  els.pitchDown.disabled     = !yes;
  els.pitchUp.disabled       = !yes;
  els.btnApplyVocal.disabled = !yes;
  els.btnApplyPitch.disabled = !yes;
  els.btnSplit.disabled      = !yes;
  els.btnBladeMode.disabled  = !yes;
  els.btnKeepRegion.disabled = !yes;
};

const setRegionBtnsEnabled = yes => {
  if (els.btnTrim)         els.btnTrim.disabled         = !yes;
  if (els.btnDeleteRegion) els.btnDeleteRegion.disabled = !yes;
  if (els.btnKeepRegion)   els.btnKeepRegion.disabled   = !yes;
};

// ─── AudioContext ─────────────────────────────────────────────────────
function getAudioCtx() {
  if (!state.audioCtx) state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (state.audioCtx.state === 'suspended') state.audioCtx.resume();
  return state.audioCtx;
}

// ─── FFmpeg — lazy on-demand loader ───────────────────────────────────
async function ensureFFmpeg() {
  if (state.ffmpegLoaded) return true;
  if (state.ffmpegLoading) {
    while (state.ffmpegLoading) await new Promise(r => setTimeout(r, 200));
    return state.ffmpegLoaded;
  }

  state.ffmpegLoading = true;
  state.ffmpegCancelRequested = false;
  els.overlay.style.display = 'flex';
  els.ffmpegProgress.style.width = '0%';

  try {
    const { FFmpeg }    = await import('https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js');
    const { toBlobURL } = await import('https://unpkg.com/@ffmpeg/util@0.12.1/dist/esm/index.js');

    if (state.ffmpegCancelRequested) throw new Error('cancelled');

    const ff = new FFmpeg();
    ff.on('progress', ({ progress }) => {
      els.ffmpegProgress.style.width = `${Math.round(progress * 100)}%`;
    });
    ff.on('log', ({ message }) => {
      if (message) els.ffmpegStatusMsg.textContent = message.slice(0, 80);
    });

    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
    els.ffmpegStatusMsg.textContent = '正在下載 ffmpeg-core.js...';

    if (state.ffmpegCancelRequested) throw new Error('cancelled');

    await ff.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`,   'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });

    state.ffmpeg       = ff;
    state.ffmpegLoaded = true;
    setStatus('✅ FFmpeg 載入完成');
    return true;
  } catch (e) {
    if (e.message === 'cancelled') {
      setStatus('⚠ FFmpeg 載入已取消');
    } else {
      console.warn('FFmpeg load failed:', e);
      setStatus('⚠ FFmpeg 載入失敗 — WMA 功能不可用，請改用 WAV 或 MP3 匯出');
    }
    return false;
  } finally {
    state.ffmpegLoading = false;
    els.overlay.style.display = 'none';
    els.ffmpegProgress.style.width = '0%';
    els.ffmpegStatusMsg.textContent = '正在下載 FFmpeg.wasm，僅需首次下載...';
  }
}

// ─── File decode ──────────────────────────────────────────────────────
async function fileToAudioBuffer(file) {
  const ctx = getAudioCtx();
  const ext = file.name.split('.').pop().toLowerCase();

  if (ext === 'wma') {
    setStatus('WMA 需要 FFmpeg，正在載入模組...');
    const ok = await ensureFFmpeg();
    if (!ok) throw new Error('無法載入 FFmpeg，請改用 MP3 格式');

    const { fetchFile } = await import('https://unpkg.com/@ffmpeg/util@0.12.1/dist/esm/index.js');
    const ff = state.ffmpeg;
    setStatus('正在解碼 WMA...');
    await ff.writeFile('input.wma', await fetchFile(file));
    await ff.exec(['-i', 'input.wma', '-ar', '44100', '-ac', '2', 'output.wav']);
    const data = await ff.readFile('output.wav');
    return await ctx.decodeAudioData(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  }

  // MP3 / WAV / OGG — native browser decode
  const arrayBuf = await file.arrayBuffer();
  return await ctx.decodeAudioData(arrayBuf);
}

// ─── AudioBuffer → WAV Blob ───────────────────────────────────────────
function audioBufferToWavBlob(buffer) {
  const numCh  = buffer.numberOfChannels;
  const sr     = buffer.sampleRate;
  const len    = buffer.length;
  const pcmLen = len * numCh * 2;
  const ab     = new ArrayBuffer(44 + pcmLen);
  const view   = new DataView(ab);

  const ws = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  const cl = v => Math.max(-1, Math.min(1, v));

  ws(0, 'RIFF'); view.setUint32(4, 36 + pcmLen, true);
  ws(8, 'WAVE'); ws(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true); view.setUint32(24, sr, true);
  view.setUint32(28, sr * numCh * 2, true); view.setUint16(32, numCh * 2, true);
  view.setUint16(34, 16, true); ws(36, 'data'); view.setUint32(40, pcmLen, true);

  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      const s = cl(buffer.getChannelData(ch)[i]);
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([ab], { type: 'audio/wav' });
}

// ─── Export Helper (File System Access API) ───────────────────────────
async function promptFilePicker(defaultName, typeMap) {
  try {
    if (!('showSaveFilePicker' in window)) return null;
    return await window.showSaveFilePicker({
      suggestedName: defaultName,
      types: [{ description: 'Audio File', accept: typeMap }]
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e; // User cancelled
    return null; // Fallback
  }
}

async function writeBlobToHandle(handle, blob, defaultName) {
  if (handle) {
    try {
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch(e) { return false; }
  } else {
    // Fallback normal download
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = defaultName; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  }
}

// ─── Export WAV (native, instant) ─────────────────────────────────────
async function exportWav(buffer) {
  if (!buffer) return;
  const defaultName = 'AudioCraft_Export.wav';
  let handle;
  try { handle = await promptFilePicker(defaultName, { 'audio/wav': ['.wav'] }); } 
  catch(e) { return; /* cancelled */ }

  const blob = audioBufferToWavBlob(buffer);
  const saved = await writeBlobToHandle(handle, blob, defaultName);
  if (saved) setStatus('✅ WAV 匯出成功');
}

// ─── Export MP3 via lamejs ─────────────────────────────────────────────
async function exportMp3(buffer) {
  if (!buffer) return;
  if (typeof lamejs === 'undefined') {
    setStatus('⚠ MP3 編碼器尚未載入，請先嘗試 WAV 匯出');
    return;
  }
  
  // 1. Prompt exactly during click event gesture
  const defaultName = 'AudioCraft_Export.mp3';
  let handle;
  try { handle = await promptFilePicker(defaultName, { 'audio/mpeg': ['.mp3'] }); } 
  catch(e) { return; /* cancelled */ }

  setStatus('正在編碼 MP3... (因為是高品質壓縮，可能需要幾秒鐘)');
  els.btnExportMp3.disabled = true;

  try {
    const sr     = buffer.sampleRate;
    const numCh  = buffer.numberOfChannels;
    const mp3enc = new lamejs.Mp3Encoder(numCh, sr, 128); // 128kbps HQ
    const chunks = [];
    const block  = 1152;

    const toI16 = f32 => {
      const i16 = new Int16Array(f32.length);
      for (let i = 0; i < f32.length; i++) {
        const v = Math.max(-1, Math.min(1, f32[i]));
        i16[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
      }
      return i16;
    };

    const l16 = toI16(buffer.getChannelData(0));
    const r16 = numCh > 1 ? toI16(buffer.getChannelData(1)) : l16;

    // 2. Loop with async yielding to prevent UI freeze!
    for (let i = 0; i < l16.length; i += block) {
      if (i % (block * 200) === 0) await new Promise(r => setTimeout(r, 0)); // yield UI thread
      
      const enc = numCh > 1
        ? mp3enc.encodeBuffer(l16.subarray(i, i + block), r16.subarray(i, i + block))
        : mp3enc.encodeBuffer(l16.subarray(i, i + block));
      if (enc.length) chunks.push(new Uint8Array(enc));
    }
    const tail = mp3enc.flush();
    if (tail.length) chunks.push(new Uint8Array(tail));

    const blob = new Blob(chunks, { type: 'audio/mpeg' });
    const saved = await writeBlobToHandle(handle, blob, defaultName);
    if (saved) setStatus('✅ MP3 匯出成功');
  } finally {
    els.btnExportMp3.disabled = false;
  }
}

// ─── Export WMA via FFmpeg ─────────────────────────────────────────────
async function exportWma(buffer) {
  if (!buffer) return;
  const defaultName = 'AudioCraft_Export.wma';
  let handle;
  try { handle = await promptFilePicker(defaultName, { 'audio/x-ms-wma': ['.wma'] }); }
  catch(e) { return; /* cancelled */ }

  setStatus('WMA 匯出需要 FFmpeg，正在載入...');
  const ok = await ensureFFmpeg();
  if (!ok) { setStatus('⚠ FFmpeg 未能載入，請改用 WAV 或 MP3 匯出'); return; }

  const { fetchFile } = await import('https://unpkg.com/@ffmpeg/util@0.12.1/dist/esm/index.js');
  const ff = state.ffmpeg;
  setStatus('正在編碼 WMA...');
  const wavBlob = audioBufferToWavBlob(buffer);
  await ff.writeFile('export_in.wav', new Uint8Array(await wavBlob.arrayBuffer()));
  await ff.exec(['-i', 'export_in.wav', '-codec:a', 'wmav2', '-b:a', '192k', 'export_out.wma']);
  const data = await ff.readFile('export_out.wma');
  const blob = new Blob([data.buffer], { type: 'audio/x-ms-wma' });
  const saved = await writeBlobToHandle(handle, blob, defaultName);
  if (saved) setStatus('✅ WMA 匯出成功');
}

// ─── Vocal Removal ────────────────────────────────────────────────────
//
// Uses standard Mid-Side (karaoke) technique:
//   Mid  = (L + R) * 0.5  ← centre content (vocals, bass drum centre hits)
//   Side = (L - R) * 0.5  ← stereo-difference content (instruments, reverb)
//
// Output sample = Side * strength + Mid * (1 - strength)
//   strength=1.0 → pure Side (vocals removed as much as possible)
//   strength=0.0 → pure Mid  (original mono centre)
//   In between   → smooth blend
//
// MONO-COMPATIBLE OUTPUT (critical for Bluetooth headphones):
//   Both output channels carry the SAME value.
//   If a BT device sums L+R to mono, it doubles instead of cancelling.
//   The "true stereo" approach (outL=+side, outR=-side) cancels to zero
//   in mono — that is why the user heard silence.
//
// PEAK NORMALISATION:
//   After processing, scan for the maximum amplitude and scale to 0.95
//   so the signal is loud and clear without clipping on export.
async function removeVocals(buffer, strength = 1.0) {
  if (buffer.numberOfChannels < 2) {
    setStatus('⚠ 人聲去除需要立體聲（Stereo）檔案，此音軌為單聲道，已保留原音');
    return buffer;
  }

  const ctx = getAudioCtx();
  const sr  = buffer.sampleRate;
  const len = buffer.length;

  const L = buffer.getChannelData(0);
  const R = buffer.getChannelData(1);

  // Temporary float array (process into this, then normalise)
  const tmp = new Float32Array(len);

  // ── Pass 1: compute output samples & track peak ──────────────────────
  let peak = 0;
  const CHUNK = 65536;
  for (let i = 0; i < len; i += CHUNK) {
    const end = Math.min(i + CHUNK, len);
    for (let j = i; j < end; j++) {
      const mid  = (L[j] + R[j]) * 0.5;
      const side = (L[j] - R[j]) * 0.5;
      // Blend side (accompaniment) and mid according to strength
      const s = side * strength + mid * (1.0 - strength);
      tmp[j] = s;
      const abs = s < 0 ? -s : s;
      if (abs > peak) peak = abs;
    }
    if (((i / CHUNK) % 4) === 0) await new Promise(r => setTimeout(r, 0));
  }

  // ── Pass 2: normalise to 0.95 and write stereo output ────────────────
  const gain = peak > 0.001 ? 0.95 / peak : 1.0;
  const out  = ctx.createBuffer(2, len, sr);
  const outL = out.getChannelData(0);
  const outR = out.getChannelData(1);
  for (let j = 0; j < len; j++) {
    const v = tmp[j] * gain;
    outL[j] = v;   // Same value on both channels → mono-compatible
    outR[j] = v;   // BT headphones sum L+R → doubles (loud & clear, not silent)
  }

  return out;
}


// ─── Pitch Shift ───────────────────────────────────────────────────────
async function pitchShiftBuffer(buffer, semitones) {
  if (semitones === 0) return buffer;
  const rate   = Math.pow(2, semitones / 12);
  const newLen = Math.round(buffer.length / rate);
  const offCtx = new OfflineAudioContext(buffer.numberOfChannels, Math.max(1, newLen), buffer.sampleRate);
  const src    = offCtx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = rate;
  src.connect(offCtx.destination);
  src.start(0);
  return await offCtx.startRendering();
}

// ─── Trim helpers ─────────────────────────────────────────────────────
function trimBuffer(buffer, start, end) {
  const ctx = getAudioCtx();
  const sr  = buffer.sampleRate;
  const s   = Math.floor(start * sr);
  const e   = Math.min(Math.ceil(end * sr), buffer.length);
  const out = ctx.createBuffer(buffer.numberOfChannels, Math.max(1, e - s), sr);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++)
    out.getChannelData(ch).set(buffer.getChannelData(ch).subarray(s, e));
  return out;
}

function deleteRegion(buffer, start, end) {
  const ctx = getAudioCtx();
  const sr  = buffer.sampleRate;
  const s   = Math.floor(start * sr);
  const e   = Math.min(Math.ceil(end * sr), buffer.length);
  const len = buffer.length - (e - s);
  const out = ctx.createBuffer(buffer.numberOfChannels, Math.max(1, len), sr);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    out.getChannelData(ch).set(src.subarray(0, s), 0);
    out.getChannelData(ch).set(src.subarray(e), s);
  }
  return out;
}

// ─── Merge ────────────────────────────────────────────────────────────
function mergeBuffers(buffers) {
  if (!buffers.length) return null;
  const ctx   = getAudioCtx();
  const sr    = buffers[0].sampleRate;
  const numCh = Math.max(...buffers.map(b => b.numberOfChannels));
  const total = buffers.reduce((s, b) => s + b.length, 0);
  const out   = ctx.createBuffer(numCh, total, sr);
  let off = 0;
  for (const buf of buffers) {
    for (let ch = 0; ch < numCh; ch++) {
      const src = ch < buf.numberOfChannels ? buf.getChannelData(ch) : new Float32Array(buf.length);
      out.getChannelData(ch).set(src, off);
    }
    off += buf.length;
  }
  return out;
}

// ─── WaveSurfer init ─────────────────────────────────────────────────
function initWaveSurfer() {
  console.log('initWaveSurfer start. state.wavesurfer is:', state.wavesurfer);
  // RegionsPlugin is a proper ES module import — guaranteed to work
  state.regionsPlugin = RegionsPlugin.create();

  state.wavesurfer = WaveSurfer.create({
    container:     '#waveform',
    waveColor:     'rgba(99,179,237,0.6)',
    progressColor: '#63b3ed',
    cursorColor:   '#9f7aea',
    cursorWidth:   2,
    height:        140,
    normalize:     true,
    interact:      true,
    plugins:       [state.regionsPlugin],
  });

  // Drag-to-select regions
  state.regionsPlugin.enableDragSelection({ color: 'rgba(237,137,54,0.2)' });

  state.regionsPlugin.on('region-created', r => onRegion(r));
  state.regionsPlugin.on('region-updated', r => onRegion(r));
  state.regionsPlugin.on('region-removed', () => {
    state.activeRegion = null;
    els.regionInfo.style.display = 'none';
    setRegionBtnsEnabled(false);
  });

  state.wavesurfer.on('timeupdate', cur => {
    els.timeCurrent.textContent = formatTime(cur);
    els.timeTotal.textContent   = formatTime(state.wavesurfer.getDuration() || 0);
  });
  state.wavesurfer.on('play',   () => { if(els.btnPlay) { els.btnPlay.textContent = '⏸'; els.btnPlay.classList.add('playing'); }});
  state.wavesurfer.on('pause',  () => { if(els.btnPlay) { els.btnPlay.textContent = '▶'; els.btnPlay.classList.remove('playing'); }});
  state.wavesurfer.on('finish', () => { if(els.btnPlay) { els.btnPlay.textContent = '▶'; els.btnPlay.classList.remove('playing'); }});

  // ─── Blade Mode Click Listener ────────────────────────────────────────
  state.wavesurfer.on('click', (relativeX) => {
    if (!state.bladeMode || !state.currentBuffer) return;
    const time = relativeX * state.wavesurfer.getDuration();
    
    if (state.bladeStartPos === null) {
      // First cut
      state.bladeStartPos = time;
      els.bladeHint.textContent = `狀態：已標記起點 (${time.toFixed(1)}s)，請點擊第二刀 (終點)...`;
      state.regionsPlugin.addRegion({
        id: 'blade-mark',
        start: time,
        end: time + 0.05,
        color: 'rgba(255, 0, 0, 0.8)',
        drag: false, resize: false
      });
    } else {
      // Second cut -> Delete and Merge instantaneously!
      const s = Math.min(state.bladeStartPos, time);
      const e = Math.max(state.bladeStartPos, time);
      
      // Reset blade mode
      state.bladeMode = false;
      state.bladeStartPos = null;
      els.btnBladeMode.textContent = '🔪 啟用刀片切割模式';
      els.bladeHint.style.display = 'none';
      state.regionsPlugin.clearRegions();

      // Perform processing
      updateActiveClipBuffer(deleteRegion(state.currentBuffer, s, e));
      setStatus(`✅ 已使用刀片神速切除並合併：${s.toFixed(1)}s — ${e.toFixed(1)}s`);
    }
  });
  console.log('initWaveSurfer end. state.wavesurfer is:', state.wavesurfer);
}

function onRegion(r) {
  // Keep only the newest region
  state.regionsPlugin.getRegions().filter(x => x !== r).forEach(x => x.remove());
  state.activeRegion = r;
  els.regionStart.textContent  = r.start.toFixed(2) + 's';
  els.regionEnd.textContent    = r.end.toFixed(2) + 's';
  els.regionInfo.style.display = 'flex';
  setRegionBtnsEnabled(true);
}

// ─── Load buffer into WaveSurfer ──────────────────────────────────────
async function loadBufferIntoWaveSurfer(buffer) {
  console.log('loadBufferIntoWaveSurfer called. state.wavesurfer is:', state.wavesurfer);
  const blob = audioBufferToWavBlob(buffer);
  const url  = URL.createObjectURL(blob);
  if (!state.wavesurfer) {
    throw new Error('state.wavesurfer is absolutely null inside loadBufferIntoWaveSurfer');
  }
  await state.wavesurfer.load(url);
  // revoke after a short delay
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  state.currentBuffer = buffer;
  els.placeholder.classList.add('hidden');
  els.timeTotal.textContent = formatTime(buffer.duration);
  setEditEnabled(true);
  setExportEnabled(true);
  updateMergeBtn();
}

// ─── Clip management ─────────────────────────────────────────────────
function addClip(name, buffer) {
  const id = ++clipIdCounter;
  state.clips.push({ id, name, buffer });
  renderClipList();
  setActiveClip(id);
  updateMergeBtn();
}

function removeClip(id) {
  state.clips = state.clips.filter(c => c.id !== id);
  if (state.activeClipId === id) {
    state.activeClipId  = null;
    state.currentBuffer = null;
    if (state.wavesurfer) state.wavesurfer.empty();
    els.placeholder.classList.remove('hidden');
    setEditEnabled(false);
    setExportEnabled(false);
    if (state.clips.length) setActiveClip(state.clips[state.clips.length - 1].id);
  }
  renderClipList();
  updateMergeBtn();
}

function setActiveClip(id) {
  state.activeClipId = id;
  const clip = state.clips.find(c => c.id === id);
  if (!clip) return;
  renderClipList();
  els.waveformLoad.style.display = 'flex';
  els.loadingLabel.textContent   = '渲染波形中...';

  loadBufferIntoWaveSurfer(clip.buffer)
    .then(() => {
      state.currentBuffer = clip.buffer;
      els.waveformLoad.style.display = 'none';
      els.fileInfo.textContent =
        `${clip.name}  |  ${clip.buffer.duration.toFixed(2)}s  |  ${clip.buffer.sampleRate}Hz`;
      setStatus(`已載入：${clip.name}`);
      state.activeRegion = null;
      els.regionInfo.style.display = 'none';
      setRegionBtnsEnabled(false);
    })
    .catch(e => {
      console.error(e);
      els.waveformLoad.style.display = 'none';
      setStatus('⚠ 波形渲染失敗：' + e.message);
    });
}

function updateActiveClipBuffer(newBuf) {
  const clip = state.clips.find(c => c.id === state.activeClipId);
  if (clip) { clip.buffer = newBuf; setActiveClip(state.activeClipId); }
}

function renderClipList() {
  els.clipList.innerHTML = '';
  if (!state.clips.length) {
    els.clipList.innerHTML = `<div class="empty-state">
      <div class="empty-icon">🎼</div>
      <p>尚無音軌</p>
      <p class="empty-hint">點選「匯入檔案」<br/>或拖放音訊到此處</p>
    </div>`;
    return;
  }
  state.clips.forEach(clip => {
    const div = document.createElement('div');
    div.className = 'clip-item' + (clip.id === state.activeClipId ? ' active' : '');
    div.innerHTML = `
      <div class="clip-name" title="${clip.name}">${clip.name}</div>
      <div class="clip-dur">${clip.buffer.duration.toFixed(2)}s</div>
      <button class="clip-remove" title="移除此音軌">✕</button>`;
    div.querySelector('.clip-remove').addEventListener('click', e => { e.stopPropagation(); removeClip(clip.id); });
    div.addEventListener('click', () => setActiveClip(clip.id));
    els.clipList.appendChild(div);
  });
}

function updateMergeBtn() {
  const ok = state.clips.length >= 2;
  els.btnMerge.disabled  = !ok;
  els.btnMerge2.disabled = !ok;
}

// ─── Import ───────────────────────────────────────────────────────────
async function importFiles(files) {
  for (const file of files) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['mp3', 'wma', 'wav', 'ogg', 'm4a', 'aac'].includes(ext)) {
      setStatus(`⚠ 不支援的格式：${file.name}（請使用 MP3 / WMA / WAV）`);
      continue;
    }
    els.waveformLoad.style.display = 'flex';
    els.loadingLabel.textContent   = `載入 ${file.name}...`;
    try {
      const buffer = await fileToAudioBuffer(file);
      addClip(file.name.replace(/\.[^/.]+$/, ''), buffer);
    } catch (e) {
      console.error('Import error:', e);
      els.waveformLoad.style.display = 'none';
      setStatus(`⚠ 載入失敗：${file.name} — ${e.message}`);
    }
  }
}

// ─── Event Wiring ─────────────────────────────────────────────────────
function wireEvents() {

  // Cancel FFmpeg overlay
  els.btnCancelFfmpeg.addEventListener('click', () => { state.ffmpegCancelRequested = true; });

  // ── Import button ──
  els.btnImport.addEventListener('click', () => {
    // Resume AudioContext (must be inside user gesture)
    getAudioCtx();
    els.fileInput.click();
  });
  els.fileInput.addEventListener('change', e => {
    if (e.target.files.length) importFiles(Array.from(e.target.files));
    e.target.value = '';   // allow re-selecting the same file
  });

  // Drag & drop
  document.body.addEventListener('dragover', e => {
    e.preventDefault();
    els.waveformDrop.classList.add('drag-over');
  });
  document.body.addEventListener('dragleave', () => {
    els.waveformDrop.classList.remove('drag-over');
  });
  document.body.addEventListener('drop', e => {
    e.preventDefault();
    els.waveformDrop.classList.remove('drag-over');
    if (e.dataTransfer.files.length) importFiles(Array.from(e.dataTransfer.files));
  });

  // Transport
  els.btnPlay.addEventListener('click', () => { getAudioCtx(); state.wavesurfer?.playPause(); });
  els.btnStop.addEventListener('click', () => state.wavesurfer?.stop());
  els.volumeSlider.addEventListener('input', () => state.wavesurfer?.setVolume(+els.volumeSlider.value));

  // Export
  els.btnExportWav.addEventListener('click', () => exportWav(state.currentBuffer));
  els.btnExportMp3.addEventListener('click', () => exportMp3(state.currentBuffer));
  els.btnExportWma.addEventListener('click', () => exportWma(state.currentBuffer));

  // ── Vocal Removal ──
  els.vocalStrength.addEventListener('input', () => {
    state.vocalStrength = +els.vocalStrength.value;
    els.vocalStrengthVal.textContent = Math.round(state.vocalStrength * 100) + '%';
  });

  els.btnApplyVocal.addEventListener('click', async () => {
    if (!state.currentBuffer) return;
    setStatus('正在去除人聲...');
    els.btnApplyVocal.disabled = true;
    try {
      updateActiveClipBuffer(await removeVocals(state.currentBuffer, state.vocalStrength));
      setStatus('✅ 人聲去除完成');
    } finally { els.btnApplyVocal.disabled = false; }
  });

  // ── Pitch ──
  const refreshPitch = () => {
    const v = state.pitchSemitones;
    els.pitchValue.textContent = v > 0 ? `+${v}` : `${v}`;
    els.pitchSlider.value = v;
  };

  els.pitchSlider.addEventListener('input', () => { state.pitchSemitones = +els.pitchSlider.value; refreshPitch(); });
  els.pitchDown.addEventListener('click', () => { if (state.pitchSemitones > -12) { state.pitchSemitones--; refreshPitch(); } });
  els.pitchUp.addEventListener('click',   () => { if (state.pitchSemitones <  12) { state.pitchSemitones++; refreshPitch(); } });

  els.btnApplyPitch.addEventListener('click', async () => {
    if (!state.currentBuffer) return;
    if (state.pitchSemitones === 0) { setStatus('⚠ KEY 未改變（目前為 0 半音）'); return; }
    const sign = state.pitchSemitones > 0 ? '+' : '';
    setStatus(`正在變調 ${sign}${state.pitchSemitones} 半音...`);
    els.btnApplyPitch.disabled = true;
    try {
      updateActiveClipBuffer(await pitchShiftBuffer(state.currentBuffer, state.pitchSemitones));
      setStatus(`✅ 變調完成：${sign}${state.pitchSemitones} 半音`);
    } finally { els.btnApplyPitch.disabled = false; }
  });

  // ── Region actions ──
  const doKeep = () => {
    if (!state.activeRegion || !state.currentBuffer) return;
    const { start, end } = state.activeRegion;
    updateActiveClipBuffer(trimBuffer(state.currentBuffer, start, end));
    setStatus(`✅ 已保留區域 ${start.toFixed(2)}s — ${end.toFixed(2)}s`);
  };
  const doDel = () => {
    if (!state.activeRegion || !state.currentBuffer) return;
    const { start, end } = state.activeRegion;
    updateActiveClipBuffer(deleteRegion(state.currentBuffer, start, end));
    setStatus(`✅ 已刪除區域 ${start.toFixed(2)}s — ${end.toFixed(2)}s`);
  };
  
  if (els.btnTrim) els.btnTrim.addEventListener('click', doKeep);
  if (els.btnKeepRegion) els.btnKeepRegion.addEventListener('click', doKeep);
  if (els.btnDeleteRegion) els.btnDeleteRegion.addEventListener('click', doDel);

  // Blade Toggle
  els.btnBladeMode.addEventListener('click', () => {
    if (!state.currentBuffer) return;
    if (state.bladeMode) {
      // Cancel
      state.bladeMode = false;
      state.bladeStartPos = null;
      els.btnBladeMode.textContent = '🔪 啟用刀片切割模式';
      els.bladeHint.style.display = 'none';
      if(state.regionsPlugin) state.regionsPlugin.clearRegions();
    } else {
      // Activate
      state.bladeMode = true;
      state.bladeStartPos = null;
      els.btnBladeMode.textContent = '❌ 取消刀片切割';
      els.bladeHint.style.display = 'block';
      els.bladeHint.textContent = '狀態：等待點擊第一刀 (起點)...';
      if(state.regionsPlugin) state.regionsPlugin.clearRegions();
    }
  });

  // Split at playhead
  els.btnSplit.addEventListener('click', () => {
    if (!state.currentBuffer || !state.wavesurfer) return;
    const cur  = state.wavesurfer.getCurrentTime();
    const dur  = state.currentBuffer.duration;
    if (cur <= 0.01 || cur >= dur - 0.01) {
      setStatus('⚠ 請先移動播放頭到音軌中間位置再分割');
      return;
    }
    const clip  = state.clips.find(c => c.id === state.activeClipId);
    if (!clip) return;
    const left  = trimBuffer(state.currentBuffer, 0, cur);
    const right = trimBuffer(state.currentBuffer, cur, dur);
    state.clips = state.clips.filter(c => c.id !== state.activeClipId);
    state.clips.push({ id: ++clipIdCounter, name: clip.name + '_左', buffer: left  });
    state.clips.push({ id: ++clipIdCounter, name: clip.name + '_右', buffer: right });
    renderClipList();
    setActiveClip(state.clips[state.clips.length - 2].id);
    updateMergeBtn();
    setStatus(`✅ 已在 ${cur.toFixed(2)}s 分割`);
  });

  // Merge
  const doMerge = () => {
    if (state.clips.length < 2) return;
    const merged = mergeBuffers(state.clips.map(c => c.buffer));
    state.clips  = [{ id: ++clipIdCounter, name: '合併音軌', buffer: merged }];
    renderClipList();
    setActiveClip(state.clips[0].id);
    updateMergeBtn();
    setStatus('✅ 所有音軌已合併');
  };
  els.btnMerge.addEventListener('click', doMerge);
  els.btnMerge2.addEventListener('click', doMerge);
}

// ─── Main ─────────────────────────────────────────────────────────────
async function main() {
  // Wire events FIRST — so import button always works regardless of other errors
  wireEvents();

  try {
    initWaveSurfer();
    setStatus('就緒 — 請匯入 MP3 或 WMA 音訊檔案');
  } catch (e) {
    console.error('WaveSurfer init failed:', e);
    setStatus('⚠ 波形顯示器初始化失敗，但匯入功能仍可使用：' + e.message);
  }
}

main();
