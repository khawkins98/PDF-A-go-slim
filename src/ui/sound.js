// --- Classic Mac OS Sound System ---
// Sound pack: MacOS Classic Sound Pack v1.5 curated by Steven Jay Cohen,
// with Karl Laurent and Ginger Lindsey.

// --- localStorage helpers (duplicated from appearance.js to avoid circular deps) ---
function getLS(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function setLS(key, val) {
  try { localStorage.setItem(key, val); } catch { /* quota */ }
}

// --- Sound catalog ---
const SOUNDS = [
  { id: 'bip',          label: 'Bip' },
  { id: 'boing',        label: 'Boing' },
  { id: 'chutoy',       label: 'ChuToy' },
  { id: 'clink-klank',  label: 'Clink-Klank' },
  { id: 'droplet',      label: 'Droplet' },
  { id: 'indigo',       label: 'Indigo' },
  { id: 'laugh',        label: 'Laugh' },
  { id: 'logjam',       label: 'Logjam' },
  { id: 'monkey',       label: 'Monkey' },
  { id: 'moof',         label: 'Moof' },
  { id: 'newbip',       label: 'New Bip' },
  { id: 'pong2003',     label: 'Pong 2003' },
  { id: 'quack',        label: 'Quack' },
  { id: 'single-click', label: 'Single Click' },
  { id: 'sosumi',       label: 'Sosumi' },
  { id: 'temple',       label: 'Temple' },
  { id: 'uh-oh',        label: 'Uh Oh' },
  { id: 'voltage',      label: 'Voltage' },
  { id: 'whit',         label: 'Whit' },
  { id: 'wild-eep',     label: 'Wild Eep' },
];

// --- Sound events with curated suggestions per event ---
const SOUND_EVENTS = [
  { id: 'startup', label: 'Startup', default: 'sosumi',   curated: ['sosumi', 'indigo', 'voltage', 'moof', 'boing', 'chutoy'], allowSynth: true },
  { id: 'drop',    label: 'Drop',    default: 'droplet',  curated: ['droplet', 'single-click', 'bip', 'whit', 'pong2003'] },
  { id: 'success', label: 'Success', default: 'indigo',   curated: ['indigo', 'whit', 'pong2003', 'single-click', 'droplet', 'temple'] },
  { id: 'error',   label: 'Error',   default: 'wild-eep', curated: ['wild-eep', 'boing', 'uh-oh', 'monkey', 'quack', 'sosumi'] },
];

// --- Audio engine (singleton AudioContext, buffer cache) ---
let audioCtx = null;
let gainNode = null;
const bufferCache = new Map();

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    gainNode = audioCtx.createGain();
    gainNode.connect(audioCtx.destination);
    applyVolume();
  }
  // Resume if suspended (autoplay policy)
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function applyVolume() {
  if (!gainNode) return;
  const vol = parseInt(getLS('pdfa-sound-volume') || '70', 10);
  gainNode.gain.value = vol / 100;
}

function soundUrl(id) {
  const base = typeof import.meta !== 'undefined' ? import.meta.env.BASE_URL : '/';
  return `${base}sounds/${id}.mp3`;
}

async function loadBuffer(id) {
  if (bufferCache.has(id)) return bufferCache.get(id);
  const ctx = getAudioContext();
  const resp = await fetch(soundUrl(id));
  const arrayBuf = await resp.arrayBuffer();
  const audioBuf = await ctx.decodeAudioData(arrayBuf);
  bufferCache.set(id, audioBuf);
  return audioBuf;
}

function playBuffer(audioBuf) {
  const ctx = getAudioContext();
  applyVolume();
  const source = ctx.createBufferSource();
  source.buffer = audioBuf;
  source.connect(gainNode);
  source.start(0);
}

// --- Synthesized startup chime (legacy, kept as an option) ---
function playSynthesizedChime() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const vol = parseInt(getLS('pdfa-sound-volume') || '70', 10) / 100;
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      g.gain.setValueAtTime((0.12 - i * 0.02) * vol, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.8);
    });
  } catch { /* AudioContext not available */ }
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// --- Public API ---

/** Play the sound assigned to a given event. Respects master toggle, volume, and reduced-motion. */
export async function playSound(eventId) {
  if (getLS('pdfa-sound-enabled') !== 'true') return;
  if (prefersReducedMotion()) return;
  const soundId = getLS(`pdfa-sound-${eventId}`) || 'none';
  if (soundId === 'none') return;
  if (soundId === 'synthesized') { playSynthesizedChime(); return; }
  try {
    const buf = await loadBuffer(soundId);
    playBuffer(buf);
  } catch { /* network or decode error — fail silently */ }
}

/** Preview a specific sound by ID. Used by the preview button in the UI. */
export async function previewSound(soundId) {
  if (prefersReducedMotion()) return;
  if (soundId === 'synthesized') { playSynthesizedChime(); return; }
  if (soundId === 'none') return;
  try {
    const buf = await loadBuffer(soundId);
    playBuffer(buf);
  } catch { /* fail silently */ }
}

/** Migrate old pdfa-easter-chime key to new sound system keys. */
export function initSound() {
  const oldChime = getLS('pdfa-easter-chime');
  if (oldChime === 'true') {
    setLS('pdfa-sound-enabled', 'true');
    if (!getLS('pdfa-sound-startup') || getLS('pdfa-sound-startup') === 'none') {
      setLS('pdfa-sound-startup', 'sosumi');
    }
  }
  try { localStorage.removeItem('pdfa-easter-chime'); } catch { /* */ }
}

// --- Speaker icon SVG for preview button ---
const SPEAKER_SVG = `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M3 5.5h2l3-3v11l-3-3H3a.5.5 0 01-.5-.5V6a.5.5 0 01.5-.5z" fill="currentColor"/>
<path d="M10.5 4.5c1.3 1 2 2.2 2 3.5s-.7 2.5-2 3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" fill="none"/>
</svg>`;

// --- Build Sound section UI for the Appearance panel ---
export function buildSoundContent() {
  const sec = document.createElement('div');
  sec.className = 'appearance-section';

  const title = document.createElement('div');
  title.className = 'appearance-section__title';
  title.textContent = 'Sound';
  sec.appendChild(title);

  // Master toggle
  const masterRow = document.createElement('label');
  masterRow.className = 'appearance-check';
  const masterCb = document.createElement('input');
  masterCb.type = 'checkbox';
  masterCb.checked = getLS('pdfa-sound-enabled') === 'true';
  masterRow.appendChild(masterCb);
  masterRow.appendChild(document.createTextNode(' Enable sounds'));
  sec.appendChild(masterRow);

  // Container for volume + events (hidden when master is off)
  const details = document.createElement('div');
  details.className = 'sound-details';
  if (!masterCb.checked) details.classList.add('sound-details--disabled');

  // Volume slider
  const volRow = document.createElement('div');
  volRow.className = 'sound-volume-row';
  const volLabel = document.createElement('span');
  volLabel.textContent = 'Volume';
  const volSlider = document.createElement('input');
  volSlider.type = 'range';
  volSlider.min = '0';
  volSlider.max = '100';
  volSlider.value = getLS('pdfa-sound-volume') || '70';
  const volValue = document.createElement('span');
  volValue.className = 'sound-volume-value';
  volValue.textContent = volSlider.value;
  volSlider.addEventListener('input', () => {
    volValue.textContent = volSlider.value;
    setLS('pdfa-sound-volume', volSlider.value);
    applyVolume();
  });
  volRow.appendChild(volLabel);
  volRow.appendChild(volSlider);
  volRow.appendChild(volValue);
  details.appendChild(volRow);

  // Event rows
  const eventsWrap = document.createElement('div');
  eventsWrap.className = 'sound-events';

  SOUND_EVENTS.forEach((evt) => {
    const row = document.createElement('div');
    row.className = 'sound-event-row';

    const label = document.createElement('span');
    label.className = 'sound-event-label';
    label.textContent = evt.label;
    row.appendChild(label);

    const select = document.createElement('select');
    select.className = 'sound-event-select';
    select.dataset.event = evt.id;

    // "None" option
    const noneOpt = document.createElement('option');
    noneOpt.value = 'none';
    noneOpt.textContent = 'None';
    select.appendChild(noneOpt);

    // "Synthesized" option (startup only)
    if (evt.allowSynth) {
      const synthOpt = document.createElement('option');
      synthOpt.value = 'synthesized';
      synthOpt.textContent = 'Synthesized';
      select.appendChild(synthOpt);
    }

    // Suggested group
    const suggestedGroup = document.createElement('optgroup');
    suggestedGroup.label = 'Suggested';
    evt.curated.forEach((id) => {
      const s = SOUNDS.find((snd) => snd.id === id);
      if (!s) return;
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.label;
      suggestedGroup.appendChild(opt);
    });
    select.appendChild(suggestedGroup);

    // All sounds group (excluding those already in curated)
    const curatedSet = new Set(evt.curated);
    const remaining = SOUNDS.filter((s) => !curatedSet.has(s.id));
    if (remaining.length > 0) {
      const allGroup = document.createElement('optgroup');
      allGroup.label = 'All Sounds';
      remaining.forEach((s) => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.label;
        allGroup.appendChild(opt);
      });
      select.appendChild(allGroup);
    }

    // Restore saved value
    const saved = getLS(`pdfa-sound-${evt.id}`) || 'none';
    select.value = saved;

    select.addEventListener('change', () => {
      setLS(`pdfa-sound-${evt.id}`, select.value);
    });
    row.appendChild(select);

    // Preview button
    const previewBtn = document.createElement('button');
    previewBtn.type = 'button';
    previewBtn.className = 'sound-preview-btn';
    previewBtn.title = 'Preview';
    previewBtn.innerHTML = SPEAKER_SVG;
    previewBtn.addEventListener('click', () => {
      previewSound(select.value);
    });
    row.appendChild(previewBtn);

    eventsWrap.appendChild(row);
  });

  details.appendChild(eventsWrap);
  sec.appendChild(details);

  // Master toggle behavior — populate defaults on first enable
  masterCb.addEventListener('change', () => {
    setLS('pdfa-sound-enabled', masterCb.checked ? 'true' : 'false');
    details.classList.toggle('sound-details--disabled', !masterCb.checked);
    if (masterCb.checked) {
      // Set defaults for any events that are still 'none' / unset
      SOUND_EVENTS.forEach((evt) => {
        const key = `pdfa-sound-${evt.id}`;
        if (!getLS(key) || getLS(key) === 'none') {
          setLS(key, evt.default);
          // Sync the corresponding <select>
          const sel = eventsWrap.querySelector(`select[data-event="${evt.id}"]`);
          if (sel) sel.value = evt.default;
        }
      });
      // Play the startup sound as confirmation
      const startupSound = getLS('pdfa-sound-startup') || 'sosumi';
      previewSound(startupSound);
    }
  });

  // Attribution
  const attr = document.createElement('div');
  attr.className = 'sound-attribution';
  const attrLink = document.createElement('a');
  attrLink.href = 'https://code.google.com/archive/p/stevenjaycohen/downloads';
  attrLink.target = '_blank';
  attrLink.rel = 'noopener';
  attrLink.textContent = 'MacOS Classic Sound Pack v1.5';
  attr.appendChild(document.createTextNode('Sounds: '));
  attr.appendChild(attrLink);
  attr.appendChild(document.createTextNode(' curated by Steven Jay Cohen'));
  sec.appendChild(attr);

  return sec;
}
