import './style.css';

// --- State ---
let blobUrls = [];

// --- DOM refs ---
const dropZone = document.getElementById('drop-zone');
const dropArea = dropZone.querySelector('.drop-area');
const fileInput = document.getElementById('file-input');
const processingSection = document.getElementById('processing');
const fileList = document.getElementById('file-list');
const resultsSection = document.getElementById('results');
const resultsBody = document.getElementById('results-body');
const btnDownloadAll = document.getElementById('btn-download-all');
const btnStartOver = document.getElementById('btn-start-over');

// --- Helpers ---
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function showState(state) {
  dropZone.hidden = state !== 'idle';
  processingSection.hidden = state !== 'processing';
  resultsSection.hidden = state !== 'results';
}

function revokeBlobUrls() {
  blobUrls.forEach((url) => URL.revokeObjectURL(url));
  blobUrls = [];
}

// --- Worker management ---
function processFile(file) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    const reader = new FileReader();

    reader.onload = () => {
      const buffer = reader.result;
      worker.postMessage({ type: 'optimize', buffer }, [buffer]);
    };

    worker.onmessage = (e) => {
      const { type, progress, pass, result, stats, error } = e.data;
      if (type === 'progress') {
        resolve({ type: 'progress', progress, pass });
      } else if (type === 'result') {
        worker.terminate();
        resolve({ type: 'result', result, stats });
      } else if (type === 'error') {
        worker.terminate();
        reject(new Error(error));
      }
    };

    worker.onerror = (err) => {
      worker.terminate();
      reject(err);
    };

    reader.readAsArrayBuffer(file);
  });
}

function processFileWithProgress(file, progressCb) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    const reader = new FileReader();

    reader.onload = () => {
      const buffer = reader.result;
      worker.postMessage({ type: 'optimize', buffer }, [buffer]);
    };

    worker.onmessage = (e) => {
      const { type, progress, pass, result, stats, error } = e.data;
      if (type === 'progress') {
        progressCb(progress, pass);
      } else if (type === 'result') {
        worker.terminate();
        resolve({ result, stats });
      } else if (type === 'error') {
        worker.terminate();
        reject(new Error(error));
      }
    };

    worker.onerror = (err) => {
      worker.terminate();
      reject(err);
    };

    reader.readAsArrayBuffer(file);
  });
}

// --- Main flow ---
async function handleFiles(files) {
  const pdfFiles = Array.from(files).filter(
    (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
  );
  if (pdfFiles.length === 0) return;

  showState('processing');
  fileList.innerHTML = '';

  const results = [];

  for (const file of pdfFiles) {
    const li = document.createElement('li');
    li.className = 'file-item';
    li.innerHTML = `
      <span class="file-item__name">${file.name}</span>
      <span class="file-item__pass">Starting&hellip;</span>
      <div class="file-item__bar"><div class="file-item__fill" style="width:0%"></div></div>
    `;
    fileList.appendChild(li);

    const passEl = li.querySelector('.file-item__pass');
    const fillEl = li.querySelector('.file-item__fill');

    try {
      const { result, stats } = await processFileWithProgress(file, (progress, pass) => {
        fillEl.style.width = `${Math.round(progress * 100)}%`;
        passEl.textContent = pass || 'Processing\u2026';
      });

      fillEl.style.width = '100%';
      passEl.textContent = 'Done';

      results.push({ name: file.name, original: file.size, result, stats });
    } catch (err) {
      passEl.textContent = `Error: ${err.message}`;
      fillEl.style.width = '100%';
      fillEl.classList.add('file-item__fill--error');
    }
  }

  // Show results
  showState('results');
  resultsBody.innerHTML = '';
  revokeBlobUrls();

  for (const r of results) {
    const blob = new Blob([r.result], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    blobUrls.push(url);

    const saved = r.original - r.result.byteLength;
    const pct = r.original > 0 ? ((saved / r.original) * 100).toFixed(1) : '0.0';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.name}</td>
      <td>${formatSize(r.original)}</td>
      <td>${formatSize(r.result.byteLength)}</td>
      <td class="${saved > 0 ? 'saved--positive' : 'saved--zero'}">${saved > 0 ? '-' : ''}${pct}%</td>
      <td><a href="${url}" download="${r.name}" class="btn btn--small">Download</a></td>
    `;
    resultsBody.appendChild(tr);
  }

  btnDownloadAll.hidden = results.length <= 1;
  btnDownloadAll.onclick = () => {
    for (const r of results) {
      const blob = new Blob([r.result], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = r.name;
      a.click();
      URL.revokeObjectURL(url);
    }
  };
}

// --- Event listeners ---
dropArea.addEventListener('click', () => fileInput.click());
dropArea.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files.length) handleFiles(e.target.files);
});

dropArea.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropArea.classList.add('drop-area--active');
});

dropArea.addEventListener('dragleave', () => {
  dropArea.classList.remove('drop-area--active');
});

dropArea.addEventListener('drop', (e) => {
  e.preventDefault();
  dropArea.classList.remove('drop-area--active');
  if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
});

btnStartOver.addEventListener('click', () => {
  revokeBlobUrls();
  fileInput.value = '';
  showState('idle');
});

showState('idle');
