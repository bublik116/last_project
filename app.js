/*
  Сумматор аудио-сигналов (без бэкенда)
  - Диапазон: ~20 Гц .. 20 кГц (ограничение интерфейсом)
  - До 10 источников разных типов
  - Поддержка: синус, квадрат (меандр), треугольник, пила ↑/↓, импульсы (unipolar), DC, белый шум, затухающая синусоида, chirp (f0→f1)
  - Воспроизведение через WebAudio, визуализация на Canvas, экспорт WAV/CSV

  Замечания по математике/определениям:
  - Амплитуда A трактуется как пиковая (макс. по модулю) величина конкретного источника.
  - Квадрат (square) — биполярный: значения ±A в зависимости от скважности duty.
  - Импульсный поезд (pulse) — униполярный: A в течение duty%, иначе 0 (плюс смещение offset).
  - Смещение offset складывается после формирования формы (итоговое значение источника = форма + offset).
  - Фаза задаётся в градусах и применяется для периодических сигналов.
  - Нормализация (опция): при превышении |y|max>1, весь итоговый сигнал делится на |y|max, чтобы избежать клиппинга.
  - Если нормализация выключена, значения на выходе аудио усекаются в [-1, 1] и вы увидите предупреждение о клиппинге.
*/

(() => {
  const MAX_SOURCES = 10;

  /** @type {HTMLSelectElement} */
  const sampleRateEl = document.getElementById('sampleRate');
  /** @type {HTMLInputElement} */
  const durationSecEl = document.getElementById('durationSec');
  /** @type {HTMLInputElement} */
  const normalizeEl = document.getElementById('normalize');
  /** @type {HTMLButtonElement} */
  const renderBtn = document.getElementById('renderBtn');
  /** @type {HTMLButtonElement} */
  const playBtn = document.getElementById('playBtn');
  /** @type {HTMLButtonElement} */
  const stopBtn = document.getElementById('stopBtn');
  /** @type {HTMLButtonElement} */
  const exportWavBtn = document.getElementById('exportWavBtn');
  /** @type {HTMLButtonElement} */
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  /** @type {HTMLDivElement} */
  const sourcesContainer = document.getElementById('sourcesContainer');
  /** @type {HTMLButtonElement} */
  const addSourceBtn = document.getElementById('addSourceBtn');
  /** @type {HTMLButtonElement} */
  const clearSourcesBtn = document.getElementById('clearSourcesBtn');
  /** @type {HTMLCanvasElement} */
  const canvas = document.getElementById('waveCanvas');
  const ctx = canvas.getContext('2d');
  /** @type {HTMLDivElement} */
  const warningsEl = document.getElementById('warnings');

  // Контролы масштабирования окна просмотра
  /** @type {HTMLInputElement} */
  const viewLenMsRange = document.getElementById('viewLenMsRange');
  /** @type {HTMLInputElement} */
  const viewLenMsNumber = document.getElementById('viewLenMsNumber');
  /** @type {HTMLInputElement} */
  const viewOffsetMsRange = document.getElementById('viewOffsetMsRange');
  /** @type {HTMLInputElement} */
  const viewOffsetMsNumber = document.getElementById('viewOffsetMsNumber');
  /** @type {HTMLButtonElement} */
  const fitAllBtn = document.getElementById('fitAllBtn');

  // Вкладки и элементы спектра (FFT)
  /** @type {HTMLButtonElement} */
  const tabTime = document.getElementById('tabTime');
  /** @type {HTMLButtonElement} */
  const tabFFT = document.getElementById('tabFFT');
  /** @type {HTMLElement} */
  const vizSection = document.querySelector('section.viz');
  /** @type {HTMLElement} */
  const spectrumSection = document.querySelector('section.spectrum');
  /** @type {HTMLSelectElement} */
  const fftSizeEl = document.getElementById('fftSize');
  /** @type {HTMLSelectElement} */
  const windowTypeEl = document.getElementById('windowType');
  /** @type {HTMLInputElement} */
  const fftLogEl = document.getElementById('fftLog');
  /** @type {HTMLInputElement} */
  const peakCountEl = document.getElementById('peakCount');
  /** @type {HTMLButtonElement} */
  const recalcFFTBtn = document.getElementById('recalcFFTBtn');
  /** @type {HTMLCanvasElement} */
  const fftCanvas = document.getElementById('fftCanvas');
  const fftCtx = fftCanvas ? fftCanvas.getContext('2d') : null;
  /** @type {HTMLDivElement} */
  const fftInfo = document.getElementById('fftInfo');
  /** @type {HTMLButtonElement} */
  const fftResetZoomBtn = document.getElementById('fftResetZoomBtn');

  // Элементы раздела «Речь (форманты)»
  /** @type {HTMLButtonElement} */
  const tabSpeech = document.getElementById('tabSpeech');
  /** @type {HTMLElement} */
  const speechSection = document.querySelector('section.speech');
  /** @type {HTMLSelectElement} */
  const vowelPresetEl = document.getElementById('vowelPreset');
  /** @type {HTMLSelectElement} */
  const genderEl = document.getElementById('gender');
  /** @type {HTMLInputElement} */
  const f0RangeEl = document.getElementById('f0Range');
  /** @type {HTMLInputElement} */
  const f0NumberEl = document.getElementById('f0Number');
  /** @type {HTMLInputElement} */
  const durSpeechEl = document.getElementById('durSpeech');
  /** @type {HTMLInputElement} */
  const voicedLevelEl = document.getElementById('voicedLevel');
  /** @type {HTMLInputElement} */
  const noiseLevelEl = document.getElementById('noiseLevel');
  /** @type {HTMLInputElement} */
  const F1El = document.getElementById('F1');
  /** @type {HTMLInputElement} */
  const B1El = document.getElementById('B1');
  /** @type {HTMLInputElement} */
  const F2El = document.getElementById('F2');
  /** @type {HTMLInputElement} */
  const B2El = document.getElementById('B2');
  /** @type {HTMLInputElement} */
  const F3El = document.getElementById('F3');
  /** @type {HTMLInputElement} */
  const B3El = document.getElementById('B3');
  /** @type {HTMLButtonElement} */
  const synthSpeechBtn = document.getElementById('synthSpeechBtn');
  /** @type {HTMLButtonElement} */
  const playSpeechBtn = document.getElementById('playSpeechBtn');
  /** @type {HTMLButtonElement} */
  const exportSpeechBtn = document.getElementById('exportSpeechBtn');
  /** @type {HTMLCanvasElement} */
  const speechCanvas = document.getElementById('speechCanvas');
  const speechCtx = speechCanvas ? speechCanvas.getContext('2d') : null;
  /** @type {HTMLDivElement} */
  const speechInfo = document.getElementById('speechInfo');
  /** @type {HTMLInputElement} */
  const ttsTextEl = document.getElementById('ttsText');
  /** @type {HTMLButtonElement} */
  const ttsSpeakBtn = document.getElementById('ttsSpeakBtn');
  // Новые элементы: глоттальный источник, преэмфаза, морфинг гласных
  /** @type {HTMLSelectElement} */
  const glottalModelEl = document.getElementById('glottalModel');
  /** @type {HTMLInputElement} */
  const OqEl = document.getElementById('Oq');
  /** @type {HTMLInputElement} */
  const RqEl = document.getElementById('Rq');
  /** @type {HTMLInputElement} */
  const preEmphEl = document.getElementById('preEmph');
  /** @type {HTMLInputElement} */
  const preEmphAEl = document.getElementById('preEmphA');
  /** @type {HTMLSelectElement} */
  const vowelPresetFromEl = document.getElementById('vowelPresetFrom');
  /** @type {HTMLSelectElement} */
  const vowelPresetToEl = document.getElementById('vowelPresetTo');
  /** @type {HTMLInputElement} */
  const morphAlphaEl = document.getElementById('morphAlpha');
  /** @type {HTMLSelectElement} */
  const tractModelEl = document.getElementById('tractModel');
  /** @type {HTMLButtonElement} */
  const demoVowelsBtn = document.getElementById('demoVowelsBtn');

  // Текущее собранное аудио (последний рассчитанный буфер)
  let lastBuffer = null; // Float32Array
  let lastComputed = null; // объект с метаданными расчёта

  // WebAudio
  /** @type {AudioContext|null} */
  let audioCtx = null;
  /** @type {AudioBufferSourceNode|null} */
  let currentSourceNode = null;
  // Буфер речи
  let speechBuffer = null; // Float32Array
  let speechMeta = null;   // { Fs, N, T }

  // Состояние спектра для зума/панорамы
  let lastFFT = null; // { mags, freqs, Nfft, Fs }
  let lastPeaks = [];
  let fftFmin = 0;
  let fftFmax = 0; // при 0 — инициализация до Fs/2
  let fftCursorFreq = null;
  let isFftPanning = false;
  let fftPanStartX = 0;

  // Типы сигналов и их «особый» параметр (duty/τ/f1)
  const TYPES = [
    { id: 'sine', name: 'Синус' },
    { id: 'square', name: 'Квадрат (меандр)', extraLabel: 'Скважность, %', extraMin: 1, extraMax: 99, extraStep: 1, extraDefault: 50 },
    { id: 'triangle', name: 'Треугольник' },
    { id: 'sawup', name: 'Пила вверх' },
    { id: 'sawdown', name: 'Пила вниз' },
    { id: 'pulse', name: 'Импульсы (uni)', extraLabel: 'Скважность, %', extraMin: 1, extraMax: 99, extraStep: 1, extraDefault: 20 },
    { id: 'dc', name: 'DC (постоян.)' },
    { id: 'noise', name: 'Белый шум' },
    { id: 'decaysine', name: 'Затухающая синус.', extraLabel: 'τ (с)', extraMin: 0.01, extraMax: 10, extraStep: 0.01, extraDefault: 0.5 },
    { id: 'chirp', name: 'Chirp (f0→f1)', extraLabel: 'f1 (Гц)', extraMin: 20, extraMax: 20000, extraStep: 1, extraDefault: 880 },
  ];

  // Состояние источников
  /** @type {Array<{
   * id: string,
   * on: boolean,
   * type: string,
   * amp: number,
   * freq: number,
   * phaseDeg: number,
   * dutyOrExtra: number,
   * offset: number,
   * color?: string
   * }>} */
  const sources = [];

  // Утилиты
  const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);
  const deg2rad = (d) => (d * Math.PI) / 180;
  const frac = (x) => x - Math.floor(x);

  function getFs() {
    return parseInt(sampleRateEl.value, 10) || 44100;
  }

  // Универсальная отрисовка массива на указанный канвас
  function drawOnCanvas(targetCanvas, targetCtx, arr) {
    if (!targetCanvas || !targetCtx || !arr) return;
    const W = targetCanvas.width;
    const H = targetCanvas.height;
    targetCtx.clearRect(0, 0, W, H);
    targetCtx.fillStyle = '#0b0f14';
    targetCtx.fillRect(0, 0, W, H);
    const midY = H / 2;
    targetCtx.strokeStyle = '#30363d';
    targetCtx.lineWidth = 1;
    targetCtx.beginPath();
    targetCtx.moveTo(0, midY);
    targetCtx.lineTo(W, midY);
    targetCtx.stroke();
    targetCtx.strokeStyle = '#58a6ff';
    targetCtx.lineWidth = 1.5;
    targetCtx.beginPath();
    const N = arr.length;
    const xStep = W / (N - 1);
    for (let i = 0; i < N; i++) {
      const x = i * xStep;
      const y = midY - (arr[i] * (H * 0.45));
      if (i === 0) targetCtx.moveTo(x, y); else targetCtx.lineTo(x, y);
    }
    targetCtx.stroke();
  }
  function getDuration() {
    return Math.max(0.1, parseFloat(durationSecEl.value) || 1.0);
  }
  function isNormalize() {
    return !!normalizeEl.checked;
  }

  // Создание карточки источника UI
  function renderSources() {
    sourcesContainer.innerHTML = '';
    sources.forEach((src, idx) => {
      sourcesContainer.appendChild(createSourceCard(src, idx));
    });
  }

  function findTypeDef(typeId) {
    return TYPES.find((t) => t.id === typeId);
  }

  function createSourceCard(src, index) {
    const card = document.createElement('div');
    card.className = 'source-card';

    const row = document.createElement('div');
    row.className = 'source-row';

    // Вкл/Выкл
    const onWrap = document.createElement('div');
    const onLabel = document.createElement('label');
    onLabel.textContent = 'Вкл';
    const onInput = document.createElement('input');
    onInput.type = 'checkbox';
    onInput.checked = src.on;
    onInput.addEventListener('change', () => { src.on = onInput.checked; recalcAndDraw(); });
    onWrap.append(onLabel, onInput);

    // Тип
    const typeWrap = document.createElement('div');
    const typeLabel = document.createElement('label');
    typeLabel.textContent = 'Тип';
    const typeSelect = document.createElement('select');
    TYPES.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id; opt.textContent = t.name; if (t.id === src.type) opt.selected = true; typeSelect.appendChild(opt);
    });
    typeSelect.addEventListener('change', () => {
      src.type = typeSelect.value;
      // Подстроить extra под тип
      const def = findTypeDef(src.type);
      if (def && def.extraDefault !== undefined) src.dutyOrExtra = def.extraDefault;
      // Отключить/включить поля, зависящие от типа
      adjustInputsByType();
      recalcAndDraw();
    });
    typeWrap.append(typeLabel, typeSelect);

    // Амплитуда
    const ampWrap = document.createElement('div');
    const ampLabel = document.createElement('label'); ampLabel.textContent = 'A (пик)';
    const ampInput = document.createElement('input');
    ampInput.type = 'number'; ampInput.step = '0.01'; ampInput.min = '0'; ampInput.max = '2';
    ampInput.value = String(src.amp);
    ampInput.addEventListener('input', () => { src.amp = clamp(parseFloat(ampInput.value) || 0, 0, 2); recalcAndDraw(); });
    ampWrap.append(ampLabel, ampInput);

    // Частота
    const fWrap = document.createElement('div');
    const fLabel = document.createElement('label'); fLabel.textContent = 'f (Гц)';
    const fInput = document.createElement('input');
    fInput.type = 'number'; fInput.step = '1'; fInput.min = '0'; fInput.max = '20000';
    fInput.value = String(src.freq);
    // Бегунок частоты (линейный), 20..20000 Гц
    const fSlider = document.createElement('input');
    fSlider.type = 'range'; fSlider.min = '20'; fSlider.max = '20000'; fSlider.step = '1';
    fSlider.value = String(clamp(src.freq || 0, 20, 20000));

    // Привязки: ввод числа → слайдер, слайдер → ввод числа
    fInput.addEventListener('input', () => {
      src.freq = clamp(parseFloat(fInput.value) || 0, 0, 20000);
      if (src.freq >= 20) fSlider.value = String(src.freq);
      recalcAndDraw();
    });
    fSlider.addEventListener('input', () => {
      const v = clamp(parseFloat(fSlider.value) || 20, 20, 20000);
      src.freq = v;
      fInput.value = String(v);
      recalcAndDraw();
    });
    fWrap.append(fLabel, fInput);
    // Второй ряд — только слайдер частоты
    const fSliderWrap = document.createElement('div');
    fSliderWrap.style.gridColumn = 'span 2';
    fSliderWrap.appendChild(fSlider);

    // Фаза
    const phWrap = document.createElement('div');
    const phLabel = document.createElement('label'); phLabel.textContent = 'φ (°)';
    const phInput = document.createElement('input');
    phInput.type = 'number'; phInput.step = '1'; phInput.min = '0'; phInput.max = '360';
    phInput.value = String(src.phaseDeg);
    phInput.addEventListener('input', () => { src.phaseDeg = clamp(parseFloat(phInput.value) || 0, 0, 360); recalcAndDraw(); });
    phWrap.append(phLabel, phInput);

    // Доп. параметр (duty/τ/f1) — динамический ярлык
    const exWrap = document.createElement('div');
    const exLabel = document.createElement('label'); exLabel.textContent = extraLabelFor(src.type);
    const exInput = document.createElement('input');
    exInput.type = 'number';
    setExtraAttrs(exInput, src.type);
    exInput.value = String(src.dutyOrExtra);
    exInput.addEventListener('input', () => { src.dutyOrExtra = parseFloat(exInput.value) || 0; recalcAndDraw(); });
    exWrap.append(exLabel, exInput);

    // Смещение
    const offWrap = document.createElement('div');
    const offLabel = document.createElement('label'); offLabel.textContent = 'Смещение';
    const offInput = document.createElement('input');
    offInput.type = 'number'; offInput.step = '0.01'; offInput.min = '-2'; offInput.max = '2';
    offInput.value = String(src.offset);
    offInput.addEventListener('input', () => { src.offset = clamp(parseFloat(offInput.value) || 0, -2, 2); recalcAndDraw(); });
    offWrap.append(offLabel, offInput);

    // Действия
    const actions = document.createElement('div');
    actions.className = 'source-actions';
    const delBtn = document.createElement('button'); delBtn.textContent = 'Удалить';
    delBtn.addEventListener('click', () => { removeSource(index); });
    const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = `#${index+1}`;
    actions.append(delBtn, badge);

    row.append(onWrap, typeWrap, ampWrap, fWrap, phWrap, exWrap, offWrap, actions);
    // Добавим дополнительную строку сетки для слайдера частоты
    const row2 = document.createElement('div');
    row2.className = 'source-row';
    row2.append(document.createElement('div'), document.createElement('div'), fSliderWrap);
    // добьем пустышками до 8 колонок
    for (let k = 0; k < 5; k++) row2.appendChild(document.createElement('div'));
    card.appendChild(row);
    card.appendChild(row2);

    function extraLabelFor(typeId) {
      const def = findTypeDef(typeId);
      if (def && def.extraLabel) return def.extraLabel;
      return '—';
    }
    function setExtraAttrs(input, typeId) {
      const def = findTypeDef(typeId);
      if (def && def.extraLabel) {
        input.min = String(def.extraMin ?? 0);
        input.max = String(def.extraMax ?? 100);
        input.step = String(def.extraStep ?? 1);
        input.disabled = false;
      } else {
        input.min = '0'; input.max = '0'; input.step = '1'; input.disabled = true;
      }
    }
    function adjustInputsByType() {
      // Включить/выключить поля f, φ, extra в зависимости от типа
      const t = src.type;
      const isDC = t === 'dc';
      const isNoise = t === 'noise';
      // Частота и фаза неактуальны для DC; фаза неактуальна для шума
      fInput.disabled = isDC || isNoise;
      fSlider.disabled = isDC || isNoise;
      phInput.disabled = isDC || isNoise;
      // Доп. параметр доступен только у некоторых
      exLabel.textContent = extraLabelFor(t);
      setExtraAttrs(exInput, t);
    }

    adjustInputsByType();
    return card;
  }

  function removeSource(index) {
    sources.splice(index, 1);
    renderSources();
    recalcAndDraw();
  }

  function addDefaultSource(type = 'sine') {
    const def = findTypeDef(type);
    const src = {
      id: Math.random().toString(36).slice(2),
      on: true,
      type,
      amp: 0.3,
      freq: type === 'dc' ? 0 : 440,
      phaseDeg: 0,
      dutyOrExtra: def && def.extraDefault !== undefined ? def.extraDefault : 0,
      offset: 0.0,
    };
    sources.push(src);
  }

  // Генерация и сумма
  function computeSum() {
    const Fs = getFs();
    const T = getDuration();
    const N = Math.max(1, Math.floor(Fs * T));
    const y = new Float32Array(N);

    let maxFreqCandidate = 0;
    let hasNoise = false;

    // Предподсчёт параметров для эффективности
    const active = sources.filter(s => s.on);

    for (const s of active) {
      // Оценка частоты для Найквиста
      if (s.type === 'chirp') {
        maxFreqCandidate = Math.max(maxFreqCandidate, s.freq, Math.abs(s.dutyOrExtra || 0));
      } else if (s.type === 'noise') {
        hasNoise = true;
      } else if (s.type !== 'dc') {
        maxFreqCandidate = Math.max(maxFreqCandidate, Math.abs(s.freq));
      }
    }

    // Основной цикл по отсчётам
    const twoPi = 2 * Math.PI;
    for (let i = 0; i < N; i++) {
      const t = i / Fs;
      let acc = 0;
      for (const s of active) {
        const A = s.amp;
        const off = s.offset;
        switch (s.type) {
          case 'sine': {
            const w = twoPi * s.freq;
            const ph = deg2rad(s.phaseDeg);
            acc += A * Math.sin(w * t + ph) + off;
            break;
          }
          case 'square': {
            const D = clamp(s.dutyOrExtra || 50, 1, 99) / 100;
            const phCyc = (s.phaseDeg || 0) / 360;
            const cyc = frac(s.freq * t + phCyc);
            const v = (cyc < D) ? A : -A; // биполярный
            acc += v + off;
            break;
          }
          case 'triangle': {
            const phCyc = (s.phaseDeg || 0) / 360;
            const cyc = frac(s.freq * t + phCyc);
            const v = 4 * Math.abs(cyc - 0.5) - 1; // в диапазоне [-1, 1]
            acc += A * (-v) + off; // инвертируем, чтобы начиналось с -1→1 линейно
            break;
          }
          case 'sawup': {
            const phCyc = (s.phaseDeg || 0) / 360;
            const cyc = frac(s.freq * t + phCyc);
            const v = 2 * cyc - 1; // [-1,1]
            acc += A * v + off;
            break;
          }
          case 'sawdown': {
            const phCyc = (s.phaseDeg || 0) / 360;
            const cyc = frac(s.freq * t + phCyc);
            const v = 1 - 2 * cyc; // [-1,1]
            acc += A * v + off;
            break;
          }
          case 'pulse': {
            const D = clamp(s.dutyOrExtra || 20, 1, 99) / 100;
            const phCyc = (s.phaseDeg || 0) / 360;
            const cyc = frac(s.freq * t + phCyc);
            const v = (cyc < D) ? A : 0; // униполярный: [0, A]
            acc += v + off;
            break;
          }
          case 'dc': {
            acc += s.amp + off; // для DC интерпретируем A как уровень
            break;
          }
          case 'noise': {
            const v = (Math.random() * 2 - 1) * A; // белый шум ~ U[-A, A]
            acc += v + off;
            break;
          }
          case 'decaysine': {
            const tau = Math.max(0.001, s.dutyOrExtra || 0.5);
            const w = twoPi * s.freq;
            const ph = deg2rad(s.phaseDeg);
            acc += (A * Math.exp(-t / tau) * Math.sin(w * t + ph)) + off;
            break;
          }
          case 'chirp': {
            const f0 = Math.max(0, s.freq);
            const f1 = clamp(s.dutyOrExtra || f0, 0, 20000);
            const ph0 = deg2rad(s.phaseDeg);
            // f(t) = f0 + k*t, k = (f1 - f0)/T;  φ(t) = 2π (f0 t + 0.5 k t^2)
            const k = (f1 - f0) / T;
            const phase = twoPi * (f0 * t + 0.5 * k * t * t) + ph0;
            acc += A * Math.sin(phase) + off;
            break;
          }
        }
      }
      y[i] = acc;
    }

    // Нормализация/клиппинг
    let maxAbs = 0;
    for (let i = 0; i < N; i++) maxAbs = Math.max(maxAbs, Math.abs(y[i]));
    let wasNormalized = false;
    let normFactor = 1;
    let clippedCount = 0;

    if (isNormalize() && maxAbs > 1) {
      normFactor = maxAbs;
      for (let i = 0; i < N; i++) y[i] /= normFactor;
      wasNormalized = true;
      maxAbs = 1;
    } else if (!isNormalize()) {
      for (let i = 0; i < N; i++) {
        if (y[i] > 1) { y[i] = 1; clippedCount++; }
        else if (y[i] < -1) { y[i] = -1; clippedCount++; }
      }
    }

    // Предупреждения
    const warns = [];
    const FsNyq = Fs / 2;
    if (maxFreqCandidate > FsNyq + 1e-6) {
      warns.push(`Нарушение Найквиста: f_max ≈ ${Math.round(maxFreqCandidate)} Гц > Fs/2 = ${Math.round(FsNyq)} Гц → возможен алиасинг.`);
    }
    if (hasNoise) {
      warns.push('Белый шум: широкополосный спектр — визуально может «выглядеть» за пределами Fs/2, но аудио движок ограничит полосу.');
    }
    if (wasNormalized) {
      warns.push(`Была выполнена нормализация (деление на ${normFactor.toFixed(3)}), чтобы избежать клиппинга.`);
    } else if (!isNormalize() && clippedCount > 0) {
      warns.push(`Обнаружен клиппинг: ${clippedCount} отсчётов были ограничены в [-1, 1]. Включите нормализацию или уменьшите амплитуды.`);
    }

    return { Fs, T, N, samples: y, maxAbs, wasNormalized, normFactor, clippedCount, warnings: warns };
  }

  // Текущее окно просмотра (мс)
  let viewLenMs = parseFloat(viewLenMsRange?.value || '200');
  let viewOffsetMs = 0;

  function clampViewToSignal() {
    if (!lastComputed) return;
    const totalMs = lastComputed.T * 1000;
    viewLenMs = clamp(viewLenMs, 5, totalMs);
    const maxOffset = Math.max(0, totalMs - viewLenMs);
    viewOffsetMs = clamp(viewOffsetMs, 0, maxOffset);
    // Обновить контролы
    if (viewLenMsRange) {
      viewLenMsRange.max = String(Math.max(5, Math.round(totalMs)));
      viewLenMsRange.value = String(Math.round(viewLenMs));
    }
    if (viewLenMsNumber) {
      viewLenMsNumber.max = String(Math.max(5, Math.round(totalMs)));
      viewLenMsNumber.value = String(Math.round(viewLenMs));
    }
    if (viewOffsetMsRange) {
      viewOffsetMsRange.max = String(Math.max(0, Math.round(totalMs - viewLenMs)));
      viewOffsetMsRange.value = String(Math.round(viewOffsetMs));
    }
    if (viewOffsetMsNumber) {
      viewOffsetMsNumber.max = String(Math.max(0, Math.round(totalMs - viewLenMs)));
      viewOffsetMsNumber.value = String(Math.round(viewOffsetMs));
    }
  }

  function applyVowelMorph() {
    if (!vowelPresetFromEl || !vowelPresetToEl || !genderEl || !morphAlphaEl) return;
    const a = clamp(parseFloat(morphAlphaEl.value) || 0, 0, 1);
    const from = VOWEL_PRESETS[vowelPresetFromEl.value] || VOWEL_PRESETS.a;
    const to = VOWEL_PRESETS[vowelPresetToEl.value] || VOWEL_PRESETS.i;
    const scale = (genderEl.value === 'female') ? 1.2 : 1.0;
    const lerp = (u, v) => (1 - a) * u + a * v;
    const F1 = lerp(from.F1, to.F1) * scale;
    const B1 = lerp(from.B1, to.B1);
    const F2 = lerp(from.F2, to.F2) * scale;
    const B2 = lerp(from.B2, to.B2);
    const F3 = lerp(from.F3, to.F3) * scale;
    const B3 = lerp(from.B3, to.B3);
    F1El.value = String(Math.round(F1));
    B1El.value = String(Math.round(B1));
    F2El.value = String(Math.round(F2));
    B2El.value = String(Math.round(B2));
    F3El.value = String(Math.round(F3));
    B3El.value = String(Math.round(B3));
  }

  // Отрисовка сигнала на Canvas с учётом окна просмотра
  function drawWave(arr) {
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // фон
    ctx.fillStyle = '#0b0f14';
    ctx.fillRect(0, 0, W, H);

    // ось 0
    const midY = H / 2;
    ctx.strokeStyle = '#30363d';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(W, midY);
    ctx.stroke();

    // сигнал
    ctx.strokeStyle = '#58a6ff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    const Fs = lastComputed?.Fs || getFs();
    const startIdx = Math.floor((viewOffsetMs / 1000) * Fs);
    const lenIdx = Math.max(2, Math.floor((viewLenMs / 1000) * Fs));
    const endIdx = Math.min(arr.length, startIdx + lenIdx);
    const xStep = W / (endIdx - startIdx - 1);

    for (let i = startIdx; i < endIdx; i++) {
      const x = (i - startIdx) * xStep;
      const y = midY - (arr[i] * (H * 0.45)); // масштаб по амплитуде
      if (i === startIdx) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    ctx.stroke();
  }

  // Управление предупреждениями
  function showWarnings(list) {
    warningsEl.innerHTML = '';
    if (!list || list.length === 0) return;
    const ul = document.createElement('ul');
    for (const w of list) {
      const li = document.createElement('li'); li.textContent = w; ul.appendChild(li);
    }
    warningsEl.appendChild(ul);
  }

  // Перерасчёт и отрисовка
  function recalcAndDraw() {
    lastComputed = computeSum();
    lastBuffer = lastComputed.samples;
    clampViewToSignal();
    drawWave(lastBuffer);
    showWarnings(lastComputed.warnings);
    // Если открыта вкладка спектра — пересчитаем и его
    if (isFFTActive()) {
      recalcFFTAndDraw();
    }
  }

  // Воспроизведение
  function ensureAudioCtx() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioCtx;
  }

  function stopPlayback() {
    if (currentSourceNode) {
      try { currentSourceNode.stop(); } catch {}
      currentSourceNode.disconnect();
      currentSourceNode = null;
    }
    stopBtn.disabled = true;
  }

  function playCurrent() {
    if (!lastBuffer) recalcAndDraw();
    const ctx = ensureAudioCtx();
    if (ctx.state === 'suspended') try { ctx.resume(); } catch {}

    // Создаём буфер и заливаем данные
    const ch = 1;
    const N = lastBuffer.length;
    const Fs = lastComputed.Fs;
    const audioBuf = ctx.createBuffer(ch, N, Fs);
    audioBuf.copyToChannel(lastBuffer, 0);

    stopPlayback();

    const node = ctx.createBufferSource();
    node.buffer = audioBuf;
    node.connect(ctx.destination);
    node.start();
    currentSourceNode = node;
    stopBtn.disabled = false;

    node.onended = () => { stopPlayback(); };
  }

  // Экспорт WAV (PCM 16-bit LE)
  function exportWav() {
    if (!lastBuffer) recalcAndDraw();
    const Fs = lastComputed.Fs;
    const ch = 1;
    const N = lastBuffer.length;
    const bytesPerSample = 2;
    const blockAlign = ch * bytesPerSample;
    const byteRate = Fs * blockAlign;
    const dataSize = N * blockAlign;
    const headerSize = 44;
    const buf = new ArrayBuffer(headerSize + dataSize);
    const view = new DataView(buf);

    // RIFF header
    writeStr(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeStr(view, 8, 'WAVE');
    // fmt chunk
    writeStr(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // PCM chunk size
    view.setUint16(20, 1, true);  // PCM format
    view.setUint16(22, ch, true);
    view.setUint32(24, Fs, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true); // bitsPerSample
    // data chunk
    writeStr(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    // PCM samples
    let offset = 44;
    for (let i = 0; i < N; i++) {
      let s = clamp(lastBuffer[i], -1, 1);
      s = s < 0 ? s * 0x8000 : s * 0x7FFF; // 16-bit
      view.setInt16(offset, s, true);
      offset += 2;
    }

    const blob = new Blob([view], { type: 'audio/wav' });
    downloadBlob(blob, 'signal_sum.wav');

    function writeStr(dv, pos, str) {
      for (let i = 0; i < str.length; i++) dv.setUint8(pos + i, str.charCodeAt(i));
    }
  }

  // Экспорт CSV (t,y)
  function exportCsv() {
    if (!lastBuffer) recalcAndDraw();
    const Fs = lastComputed.Fs;
    const N = lastBuffer.length;
    const lines = ['t,y'];
    for (let i = 0; i < N; i++) {
      const t = i / Fs;
      lines.push(`${t.toFixed(8)},${lastBuffer[i].toFixed(8)}`);
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, 'signal_sum.csv');
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // События UI (глобальные)
  addSourceBtn.addEventListener('click', () => {
    if (sources.length >= MAX_SOURCES) return alert(`Максимум ${MAX_SOURCES} источников`);
    addDefaultSource('sine');
    renderSources();
    recalcAndDraw();
  });

  clearSourcesBtn.addEventListener('click', () => {
    sources.splice(0, sources.length);
    renderSources();
    recalcAndDraw();
  });

  renderBtn.addEventListener('click', recalcAndDraw);
  sampleRateEl.addEventListener('change', recalcAndDraw);
  durationSecEl.addEventListener('input', recalcAndDraw);
  normalizeEl.addEventListener('change', recalcAndDraw);

  playBtn.addEventListener('click', () => {
    playCurrent();
  });
  stopBtn.addEventListener('click', () => {
    stopPlayback();
  });

  exportWavBtn.addEventListener('click', exportWav);
  exportCsvBtn.addEventListener('click', exportCsv);

  // ===== Спектр (FFT) =====
  function isFFTActive() {
    return tabFFT && tabFFT.classList.contains('active');
  }

  function getFFTSize() {
    return parseInt(fftSizeEl?.value || '4096', 10) || 4096;
  }
  function getWindowType() {
    return windowTypeEl?.value || 'rect';
  }
  function isFFTLog() {
    return !!fftLogEl?.checked;
  }
  function getPeakCount() {
    return clamp(parseInt(peakCountEl?.value || '5', 10) || 5, 0, 20);
  }

  // Построение окон
  function makeWindow(N, type) {
    const w = new Float32Array(N);
    switch (type) {
      case 'hann':
        for (let n = 0; n < N; n++) w[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (N - 1));
        break;
      case 'hamming':
        for (let n = 0; n < N; n++) w[n] = 0.54 - 0.46 * Math.cos((2 * Math.PI * n) / (N - 1));
        break;
      case 'rect':
      default:
        for (let n = 0; n < N; n++) w[n] = 1;
        break;
    }
    return w;
  }

  // Быстрое преобразование Фурье (radix-2, in-place)
  function fftRadix2(re, im) {
    const N = re.length;
    // бит-реверс перестановка
    let j = 0;
    for (let i = 0; i < N; i++) {
      if (i < j) {
        let tr = re[i]; re[i] = re[j]; re[j] = tr;
        let ti = im[i]; im[i] = im[j]; im[j] = ti;
      }
      let m = N >> 1;
      while (m >= 1 && j >= m) { j -= m; m >>= 1; }
      j += m;
    }
    // бабочки
    for (let size = 2; size <= N; size <<= 1) {
      const half = size >> 1;
      const theta = -2 * Math.PI / size;
      const wpr = Math.cos(theta);
      const wpi = Math.sin(theta);
      for (let k = 0; k < N; k += size) {
        let wr = 1, wi = 0;
        for (let n = 0; n < half; n++) {
          const i0 = k + n;
          const i1 = i0 + half;
          const tr = wr * re[i1] - wi * im[i1];
          const ti = wr * im[i1] + wi * re[i1];
          re[i1] = re[i0] - tr;
          im[i1] = im[i0] - ti;
          re[i0] += tr;
          im[i0] += ti;
          const tmp = wr;
          wr = tmp * wpr - wi * wpi;
          wi = tmp * wpi + wi * wpr;
        }
      }
    }
  }

  function computeFFT() {
    if (!lastBuffer || !lastComputed) recalcAndDraw();
    const Fs = lastComputed.Fs;
    const Nfft = getFFTSize();
    // Начальная позиция окна: берем по текущему смещению просмотра
    const startIdx = Math.floor((viewOffsetMs / 1000) * Fs) || 0;
    const re = new Float32Array(Nfft);
    const im = new Float32Array(Nfft);
    const w = makeWindow(Nfft, getWindowType());
    // Копирование и оконное взвешивание с нулевым дополнением
    for (let n = 0; n < Nfft; n++) {
      const i = startIdx + n;
      const v = (i < lastBuffer.length) ? lastBuffer[i] : 0;
      re[n] = v * w[n];
      im[n] = 0;
    }
    fftRadix2(re, im);
    // Амплитудный спектр, односторонний (0..Fs/2)
    const bins = (Nfft >> 1) + 1;
    const mags = new Float32Array(bins);
    const freqs = new Float32Array(bins);
    const scaleDC = 1 / Nfft; // для DC и Nyquist
    const scale = 2 / Nfft;   // для остальных (односторонний)
    for (let k = 0; k < bins; k++) {
      const m = Math.hypot(re[k], im[k]);
      const s = (k === 0 || (Nfft % 2 === 0 && k === Nfft / 2)) ? scaleDC : scale;
      mags[k] = m * s;
      freqs[k] = (k * Fs) / Nfft;
    }
    return { Fs, Nfft, mags, freqs };
  }

  function findPeaks(mags, freqs, count) {
    // Простая локальная экстремальность + порог от максимума
    const peaks = [];
    let maxVal = 0;
    for (let i = 1; i < mags.length - 1; i++) maxVal = Math.max(maxVal, mags[i]);
    const thr = maxVal * 0.02; // 2% от максимума, чтобы отфильтровать шум
    for (let i = 1; i < mags.length - 1; i++) {
      if (mags[i] > mags[i - 1] && mags[i] > mags[i + 1] && mags[i] >= thr) {
        peaks.push({ idx: i, mag: mags[i], freq: freqs[i] });
      }
    }
    peaks.sort((a, b) => b.mag - a.mag);
    return peaks.slice(0, count);
  }

  function drawSpectrum(mags, freqs, peaks) {
    if (!fftCtx || !fftCanvas) return;
    const W = fftCanvas.width;
    const H = fftCanvas.height;
    fftCtx.clearRect(0, 0, W, H);
    // фон
    fftCtx.fillStyle = '#0b0f14';
    fftCtx.fillRect(0, 0, W, H);
    // оси
    fftCtx.strokeStyle = '#30363d';
    fftCtx.lineWidth = 1;
    fftCtx.beginPath();
    fftCtx.moveTo(0, H - 20);
    fftCtx.lineTo(W, H - 20);
    fftCtx.stroke();

    const Fs = lastFFT?.Fs ?? (lastComputed?.Fs || getFs());
    const fullFmax = Fs / 2;
    // Текущее окно просмотра по частоте
    const fMin = clamp(fftFmin, 0, fullFmax);
    const fMax = clamp(fftFmax || fullFmax, fMin + 1e-6, fullFmax);
    const span = fMax - fMin;
    const xOfF = (f) => ((f - fMin) / span) * W;

    // Вычисляем амплитуды: линейные или дБ
    const useDb = isFFTLog();
    let values = new Float32Array(mags.length);
    if (useDb) {
      const eps = 1e-12;
      let maxDb = -Infinity, minDb = Infinity;
      for (let i = 0; i < mags.length; i++) {
        const db = 20 * Math.log10(mags[i] + eps);
        values[i] = db;
        if (db > maxDb) maxDb = db;
        if (db < minDb) minDb = db;
      }
      // ограничим диапазон дБ для отрисовки
      const top = Math.max(-10, maxDb);
      const bottom = Math.min(-120, minDb);
      const yOfDb = (db) => {
        const t = (db - bottom) / (top - bottom + 1e-9);
        return (1 - t) * (H - 30) + 10;
      };
      // кривая
      fftCtx.strokeStyle = '#58a6ff';
      fftCtx.lineWidth = 1.5;
      fftCtx.beginPath();
      let started = false;
      for (let i = 0; i < mags.length; i++) {
        const f = freqs[i];
        if (f < fMin || f > fMax) continue;
        const x = xOfF(f);
        const y = yOfDb(values[i]);
        if (!started) { fftCtx.moveTo(x, y); started = true; }
        else fftCtx.lineTo(x, y);
      }
      if (started) fftCtx.stroke();

      // Пики
      fftCtx.fillStyle = '#ffa657';
      fftCtx.strokeStyle = '#ffa657';
      for (const p of peaks) {
        if (p.freq < fMin || p.freq > fMax) continue;
        const x = xOfF(p.freq);
        const y = yOfDb(20 * Math.log10(p.mag + 1e-12));
        fftCtx.beginPath();
        fftCtx.moveTo(x, H - 20);
        fftCtx.lineTo(x, y);
        fftCtx.stroke();
        fftCtx.fillText(`${Math.round(p.freq)} Гц`, x + 4, y - 4);
      }
    } else {
      // линейный масштаб по амплитуде
      let vmax = 0;
      for (let i = 0; i < mags.length; i++) if (mags[i] > vmax) vmax = mags[i];
      const yOf = (v) => {
        const t = v / (vmax + 1e-9);
        return (1 - t) * (H - 30) + 10;
      };
      fftCtx.strokeStyle = '#58a6ff';
      fftCtx.lineWidth = 1.5;
      fftCtx.beginPath();
      let started = false;
      for (let i = 0; i < mags.length; i++) {
        const f = freqs[i];
        if (f < fMin || f > fMax) continue;
        const x = xOfF(f);
        const y = yOf(mags[i]);
        if (!started) { fftCtx.moveTo(x, y); started = true; }
        else fftCtx.lineTo(x, y);
      }
      if (started) fftCtx.stroke();

      // Пики
      fftCtx.fillStyle = '#ffa657';
      fftCtx.strokeStyle = '#ffa657';
      for (const p of peaks) {
        if (p.freq < fMin || p.freq > fMax) continue;
        const x = xOfF(p.freq);
        const y = yOf(p.mag);
        fftCtx.beginPath();
        fftCtx.moveTo(x, H - 20);
        fftCtx.lineTo(x, y);
        fftCtx.stroke();
        fftCtx.fillText(`${Math.round(p.freq)} Гц`, x + 4, y - 4);
      }
    }
    // Вертикальная линия курсора
    if (fftCursorFreq != null && fftCursorFreq >= fMin && fftCursorFreq <= fMax) {
      const x = xOfF(fftCursorFreq);
      fftCtx.strokeStyle = '#6e7681';
      fftCtx.setLineDash([4, 4]);
      fftCtx.beginPath();
      fftCtx.moveTo(x, 0);
      fftCtx.lineTo(x, H - 20);
      fftCtx.stroke();
      fftCtx.setLineDash([]);
    }
  }

  function updateFFTInfo() {
    if (!fftInfo || !lastFFT) return;
    const { Nfft, Fs } = lastFFT;
    const df = Fs / Nfft;
    let cursorText = '';
    if (fftCursorFreq != null) {
      const i = nearestBinIndex(fftCursorFreq);
      if (i >= 0) {
        const useDb = isFFTLog();
        const mag = lastFFT.mags[i];
        const val = useDb ? (20 * Math.log10(mag + 1e-12)) : mag;
        cursorText = ` | курсор: f≈${fftCursorFreq.toFixed(1)} Гц, ${useDb ? 'дБ' : 'A'}≈${useDb ? val.toFixed(1) : val.toFixed(3)}`;
      }
    }
    fftInfo.textContent = `N=${Nfft}, Δf≈${df.toFixed(2)} Гц, окно: [${Math.round(fftFmin)}..${Math.round(fftFmax)}] Гц` + cursorText;
  }

  function nearestBinIndex(freq) {
    if (!lastFFT) return -1;
    const { freqs } = lastFFT;
    // бинарный поиск ближайшей частоты
    let lo = 0, hi = freqs.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (freqs[mid] < freq) lo = mid + 1; else hi = mid - 1;
    }
    const i1 = clamp(lo, 0, freqs.length - 1);
    const i0 = Math.max(0, i1 - 1);
    return (Math.abs(freqs[i0] - freq) <= Math.abs(freqs[i1] - freq)) ? i0 : i1;
  }

  function recalcFFTAndDraw() {
    if (!fftCanvas) return;
    const { mags, freqs, Nfft, Fs } = computeFFT();
    lastFFT = { mags, freqs, Nfft, Fs };
    lastPeaks = findPeaks(mags, freqs, getPeakCount());
    // Инициализация/проверка окна просмотра
    const fMaxFull = Fs / 2;
    if (fftFmax <= 0 || fftFmax > fMaxFull || fftFmin < 0 || (fftFmax - fftFmin) < (Fs / Nfft)) {
      fftFmin = 0;
      fftFmax = fMaxFull;
    } else {
      // поджать к границам, если поменялся Fs
      fftFmin = clamp(fftFmin, 0, fMaxFull);
      fftFmax = clamp(fftFmax, fftFmin + (Fs / Nfft), fMaxFull);
    }
    drawSpectrum(mags, freqs, lastPeaks);
    updateFFTInfo();
  }

  // Переключение вкладок
  function showTimeTab() {
    if (!vizSection || !spectrumSection) return;
    tabTime?.classList.add('active');
    tabFFT?.classList.remove('active');
    tabSpeech?.classList.remove('active');
    vizSection.classList.remove('hidden');
    spectrumSection.classList.add('hidden');
    speechSection?.classList.add('hidden');
  }
  function showFFTTab() {
    if (!vizSection || !spectrumSection) return;
    tabFFT?.classList.add('active');
    tabTime?.classList.remove('active');
    tabSpeech?.classList.remove('active');
    vizSection.classList.add('hidden');
    spectrumSection.classList.remove('hidden');
    recalcFFTAndDraw();
  }
  tabTime?.addEventListener('click', showTimeTab);
  tabFFT?.addEventListener('click', showFFTTab);
  function showSpeechTab() {
    if (!speechSection || !vizSection || !spectrumSection) return;
    tabSpeech?.classList.add('active');
    tabTime?.classList.remove('active');
    tabFFT?.classList.remove('active');
    vizSection.classList.add('hidden');
    spectrumSection.classList.add('hidden');
    speechSection.classList.remove('hidden');
    // при первом входе обновим пресеты и отрисуем
    applyVowelPreset();
    synthSpeech();
    drawSpeech();
  }
  tabSpeech?.addEventListener('click', showSpeechTab);
  recalcFFTBtn?.addEventListener('click', recalcFFTAndDraw);
  fftSizeEl?.addEventListener('change', recalcFFTAndDraw);
  windowTypeEl?.addEventListener('change', recalcFFTAndDraw);
  fftLogEl?.addEventListener('change', recalcFFTAndDraw);
  peakCountEl?.addEventListener('input', recalcFFTAndDraw);
  fftResetZoomBtn?.addEventListener('click', () => {
    if (!lastFFT) return;
    fftFmin = 0;
    fftFmax = lastFFT.Fs / 2;
    drawSpectrum(lastFFT.mags, lastFFT.freqs, lastPeaks);
    updateFFTInfo();
  });

  // ===== Формантный синтез речи =====
  const VOWEL_PRESETS = {
    // Набор базовых значений (мужской голос). Для женского применим масштаб 1.2 по частоте формант.
    a: { F1: 730, B1: 80,  F2: 1090, B2: 90,  F3: 2440, B3: 120 },
    e: { F1: 530, B1: 70,  F2: 1840, B2: 100, F3: 2480, B3: 120 },
    i: { F1: 270, B1: 60,  F2: 2290, B2: 100, F3: 3010, B3: 120 },
    o: { F1: 570, B1: 80,  F2: 840,  B2: 90,  F3: 2410, B3: 120 },
    u: { F1: 300, B1: 70,  F2: 870,  B2: 100, F3: 2240, B3: 120 },
  };

  function applyVowelPreset() {
    if (!vowelPresetEl || !genderEl) return;
    const p = VOWEL_PRESETS[vowelPresetEl.value] || VOWEL_PRESETS.a;
    const scale = (genderEl.value === 'female') ? 1.2 : 1.0;
    F1El.value = String(Math.round(p.F1 * scale));
    B1El.value = String(p.B1);
    F2El.value = String(Math.round(p.F2 * scale));
    B2El.value = String(p.B2);
    F3El.value = String(Math.round(p.F3 * scale));
    B3El.value = String(p.B3);
    // Предложим F0 типичный
    if (f0RangeEl && f0NumberEl) {
      const f0 = (genderEl.value === 'female') ? 200 : 120;
      f0RangeEl.value = String(f0);
      f0NumberEl.value = String(f0);
    }
  }

  vowelPresetEl?.addEventListener('change', applyVowelPreset);
  genderEl?.addEventListener('change', applyVowelPreset);
  // Синхронизация F0 ползунок↔число
  f0RangeEl?.addEventListener('input', () => { if (f0NumberEl) f0NumberEl.value = f0RangeEl.value; });
  f0NumberEl?.addEventListener('input', () => { if (f0RangeEl) f0RangeEl.value = f0NumberEl.value; });
  // Морфинг и прочие параметры — пересчёт при изменении
  morphAlphaEl?.addEventListener('input', () => { applyVowelMorph(); synthSpeech(); drawSpeech(); });
  vowelPresetFromEl?.addEventListener('change', () => { applyVowelMorph(); synthSpeech(); drawSpeech(); });
  vowelPresetToEl?.addEventListener('change', () => { applyVowelMorph(); synthSpeech(); drawSpeech(); });
  glottalModelEl?.addEventListener('change', () => { synthSpeech(); drawSpeech(); });
  OqEl?.addEventListener('input', () => { synthSpeech(); drawSpeech(); });
  RqEl?.addEventListener('input', () => { synthSpeech(); drawSpeech(); });
  preEmphEl?.addEventListener('change', () => { synthSpeech(); drawSpeech(); });
  preEmphAEl?.addEventListener('input', () => { synthSpeech(); drawSpeech(); });
  tractModelEl?.addEventListener('change', () => { synthSpeech(); drawSpeech(); });
  demoVowelsBtn?.addEventListener('click', () => { playDemoVowels(); });

  // Преобразование частоты и добротности в коэффициенты би-квадратного полосового фильтра (RBJ)
  function biquadBandpassCoeffs(Fs, Fc, B) {
    const Q = Math.max(0.1, Fc / Math.max(1e-6, B));
    const w0 = 2 * Math.PI * (Fc / Fs);
    const cw = Math.cos(w0);
    const sw = Math.sin(w0);
    const alpha = sw / (2 * Q);
    const b0 = alpha;
    const b1 = 0;
    const b2 = -alpha;
    const a0 = 1 + alpha;
    const a1 = -2 * cw;
    const a2 = 1 - alpha;
    return { b0, b1, b2, a0, a1, a2 };
  }

  function processBiquad(x, coeffs) {
    // Нормализация коэффициентов и реализация RBJ biquad в виде
    // транспонированной прямой формы II (устойчиво и корректно по амплитуде)
    const y = new Float32Array(x.length);
    const { b0, b1, b2, a0, a1, a2 } = coeffs;
    const invA0 = 1 / a0;
    const b0a = b0 * invA0;
    const b1a = b1 * invA0;
    const b2a = b2 * invA0;
    const a1a = a1 * invA0;
    const a2a = a2 * invA0;
    let z1 = 0, z2 = 0;
    for (let n = 0; n < x.length; n++) {
      const xn = x[n];
      const out = b0a * xn + z1;
      z1 = b1a * xn - a1a * out + z2;
      z2 = b2a * xn - a2a * out;
      y[n] = out;
    }
    return y;
  }

  function synthSpeech() {
    const Fs = getFs();
    const T = Math.max(0.2, parseFloat(durSpeechEl?.value || '1.0'));
    const N = Math.floor(Fs * T);
    const f0 = clamp(parseFloat(f0NumberEl?.value || f0RangeEl?.value || '120'), 40, 400);
    const voicedLvl = clamp(parseFloat(voicedLevelEl?.value || '1'), 0, 1);
    const noiseLvl = clamp(parseFloat(noiseLevelEl?.value || '0'), 0, 1);
    const F1 = clamp(parseFloat(F1El?.value || '730'), 50, 6000);
    const B1 = clamp(parseFloat(B1El?.value || '80'), 10, 1000);
    const F2 = clamp(parseFloat(F2El?.value || '1090'), 50, 6000);
    const B2 = clamp(parseFloat(B2El?.value || '90'), 10, 1000);
    const F3 = clamp(parseFloat(F3El?.value || '2440'), 50, 8000);
    const B3 = clamp(parseFloat(B3El?.value || '120'), 10, 1200);
    const tractModel = tractModelEl?.value || 'parallel';

    // Источник: выбранная глоттальная модель + шум
    const x = new Float32Array(N);
    const model = glottalModelEl?.value || 'impulse';
    let phase = 0; // фаза в циклах (0..1)
    // Небольшой вибрато+джиттер для живости
    const vibDepth = 0.01; // ±1%
    const vibRate = 5;     // 5 Гц
    let jitterVal = 0;     // ±0.3%
    const jitterDepth = 0.003;
    const Oq = clamp(parseFloat(OqEl?.value || '0.6'), 0.3, 0.9);
    const Rq = clamp(parseFloat(RqEl?.value || '0.1'), 0.05, 0.4);
    let prevUg = 0;
    for (let n = 0; n < N; n++) {
      const t = n / Fs;
      const f0inst = f0 * (1 + vibDepth * Math.sin(2 * Math.PI * vibRate * t) + jitterVal);
      const dphi = f0inst / Fs;
      phase += dphi;
      if (phase >= 1.0) phase -= 1.0;
      let voiced = 0;
      if (model === 'impulse') {
        // узкий импульс в начале периода
        voiced = (phase < dphi) ? 1.0 : 0.0;
      } else {
        // Rosenberg: формируем поток Ug(phase), берём дискретную производную как возбуждение
        const Tc = Oq; // конец открытой фазы
        const Ta = Math.max(1e-4, Oq * (1 - Rq));
        let Ug = 0;
        if (phase < Ta) {
          Ug = 0.5 * (1 - Math.cos(Math.PI * (phase / Ta)));
        } else if (phase < Tc) {
          const denom = 2 * (Tc - Ta) + 1e-9;
          Ug = Math.cos((Math.PI * (phase - Ta)) / denom) ** 2;
        } else {
          Ug = 0;
        }
        const deriv = Ug - prevUg;
        prevUg = Ug;
        voiced = deriv;
      }
      // При прохождении через ноль фазы — обновим джиттер
      if (phase < dphi) {
        jitterVal = (Math.random() * 2 - 1) * jitterDepth;
      }
      const noise = (Math.random() * 2 - 1) * 0.3;
      x[n] = voicedLvl * voiced + noiseLvl * noise;
    }

    // Преэмфаза (y[n] = x[n] - a*x[n-1])
    if (preEmphEl?.checked) {
      const a = clamp(parseFloat(preEmphAEl?.value || '0.97'), 0, 0.99);
      let prev = 0;
      for (let n = 0; n < N; n++) {
        const xn = x[n];
        x[n] = xn - a * prev;
        prev = xn;
      }
    }

    // Фильтры формант
    const c1 = biquadBandpassCoeffs(Fs, F1, B1);
    const c2 = biquadBandpassCoeffs(Fs, F2, B2);
    const c3 = biquadBandpassCoeffs(Fs, F3, B3);
    const y = new Float32Array(N);
    if (tractModel === 'cascade') {
      // Каскадный тракт: последовательные резонаторы
      const s1 = processBiquad(x, c1);
      const s2 = processBiquad(s1, c2);
      const s3 = processBiquad(s2, c3);
      for (let n = 0; n < N; n++) y[n] = s3[n];
    } else {
      // Параллельный тракт: сумма трёх резонаторов
      const y1 = processBiquad(x, c1);
      const y2 = processBiquad(x, c2);
      const y3 = processBiquad(x, c3);
      for (let n = 0; n < N; n++) y[n] = y1[n] + y2[n] + y3[n];
    }

    // Амплитудная огибающая (атака/спад), чтобы убрать щелчки и добавить естественности
    const att = Math.max(1, Math.floor(0.01 * Fs));
    const rel = Math.max(1, Math.floor(0.05 * Fs));
    for (let n = 0; n < N; n++) {
      let env = 1;
      if (n < att) env = n / att;
      else if (n > N - rel) env = (N - n) / rel;
      y[n] *= env;
    }

    // Нормализация: масштабируем к целевому пику ~0.95, если есть ненулевая энергия
    let maxAbs = 0; for (let n = 0; n < N; n++) maxAbs = Math.max(maxAbs, Math.abs(y[n]));
    if (maxAbs > 1e-9) { const k = 0.95 / maxAbs; for (let n = 0; n < N; n++) y[n] *= k; }

    speechBuffer = y;
    speechMeta = { Fs, N, T, f0, F1, F2, F3, model };
  }

  function drawSpeech() {
    if (!speechBuffer) return;
    drawOnCanvas(speechCanvas, speechCtx, speechBuffer);
    if (speechInfo && speechMeta) speechInfo.textContent = `Fs=${speechMeta.Fs} Гц, T=${speechMeta.T.toFixed(2)} с, F0≈${Math.round(speechMeta.f0)} Гц`;
  }

  function playSpeech() {
    if (!speechBuffer) synthSpeech();
    if (!speechBuffer || !speechMeta) return;
    const ctx = ensureAudioCtx();
    if (ctx.state === 'suspended') try { ctx.resume(); } catch {}
    const audioBuf = ctx.createBuffer(1, speechBuffer.length, speechMeta.Fs);
    audioBuf.copyToChannel(speechBuffer, 0);
    stopPlayback();
    const node = ctx.createBufferSource();
    node.buffer = audioBuf;
    node.connect(ctx.destination);
    node.start();
    currentSourceNode = node;
    stopBtn.disabled = false;
    node.onended = () => { stopPlayback(); };
  }

  function exportSpeechWav() {
    if (!speechBuffer) synthSpeech();
    if (!speechBuffer || !speechMeta) return;
    exportWavGeneric(speechBuffer, 'speech_formant.wav', speechMeta.Fs);
  }

  // Общая функция экспорта WAV для произвольного буфера
  function exportWavGeneric(buffer, filename, Fs) {
    const ch = 1;
    const N = buffer.length;
    const bytesPerSample = 2;
    const blockAlign = ch * bytesPerSample;
    const byteRate = Fs * blockAlign;
    const dataSize = N * blockAlign;
    const headerSize = 44;
    const buf = new ArrayBuffer(headerSize + dataSize);
    const view = new DataView(buf);
    writeStr(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeStr(view, 8, 'WAVE');
    writeStr(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, ch, true);
    view.setUint32(24, Fs, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeStr(view, 36, 'data');
    view.setUint32(40, dataSize, true);
    let offset = 44;
    for (let i = 0; i < N; i++) {
      let s = clamp(buffer[i], -1, 1);
      s = s < 0 ? s * 0x8000 : s * 0x7FFF;
      view.setInt16(offset, s, true);
      offset += 2;
    }
    const blob = new Blob([view], { type: 'audio/wav' });
    downloadBlob(blob, filename);
    function writeStr(dv, pos, str) { for (let i = 0; i < str.length; i++) dv.setUint8(pos + i, str.charCodeAt(i)); }
  }

  synthSpeechBtn?.addEventListener('click', () => { synthSpeech(); drawSpeech(); });
  playSpeechBtn?.addEventListener('click', () => { playSpeech(); });
  exportSpeechBtn?.addEventListener('click', () => { exportSpeechWav(); });

  // ===== Обработчики мыши для зума/панорамы спектра =====
  if (fftCanvas) {
    fftCanvas.addEventListener('wheel', (e) => {
      if (!lastFFT) return;
      e.preventDefault();
      const rect = fftCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const W = rect.width;
      const fMin = fftFmin;
      const fMax = fftFmax;
      const span = fMax - fMin;
      const fUnder = fMin + (x / W) * span;
      const delta = Math.sign(e.deltaY);
      const factor = delta > 0 ? 1.1 : 0.9; // 10% шаг
      const Fs = lastFFT.Fs;
      const minSpan = Math.max(Fs / lastFFT.Nfft, 5); // не меньше df и 5 Гц
      const maxSpan = Fs / 2;
      let newSpan = clamp(span * factor, minSpan, maxSpan);
      // сохраняем точку под курсором
      let newMin = fUnder - (x / W) * newSpan;
      let newMax = newMin + newSpan;
      const fullMin = 0, fullMax = Fs / 2;
      // поджать к границам
      if (newMin < fullMin) { newMin = fullMin; newMax = newMin + newSpan; }
      if (newMax > fullMax) { newMax = fullMax; newMin = newMax - newSpan; }
      fftFmin = newMin;
      fftFmax = newMax;
      fftCursorFreq = fUnder;
      drawSpectrum(lastFFT.mags, lastFFT.freqs, lastPeaks);
      updateFFTInfo();
    }, { passive: false });

    fftCanvas.addEventListener('mousedown', (e) => {
      isFftPanning = true;
      fftPanStartX = e.clientX;
    });
    window.addEventListener('mouseup', () => { isFftPanning = false; });
    window.addEventListener('mousemove', (e) => {
      if (!lastFFT) return;
      const rect = fftCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const W = rect.width;
      const span = (fftFmax - fftFmin) || (lastFFT.Fs / 2);
      const fUnder = fftFmin + (clamp(x, 0, W) / W) * span;
      fftCursorFreq = clamp(fUnder, 0, lastFFT.Fs / 2);
      if (isFftPanning) {
        const dx = e.clientX - fftPanStartX;
        fftPanStartX = e.clientX;
        const hzPerPx = span / W;
        let newMin = fftFmin - dx * hzPerPx;
        let newMax = fftFmax - dx * hzPerPx;
        const fullMin = 0, fullMax = lastFFT.Fs / 2;
        const minSpan = Math.max(lastFFT.Fs / lastFFT.Nfft, 5);
        const curSpan = newMax - newMin;
        // защита от выхода за границы
        if (newMin < fullMin) { newMin = fullMin; newMax = newMin + curSpan; }
        if (newMax > fullMax) { newMax = fullMax; newMin = newMax - curSpan; }
        // защита от слишком узкого окна
        if (curSpan < minSpan) { newMax = newMin + minSpan; }
        fftFmin = newMin;
        fftFmax = newMax;
      }
      drawSpectrum(lastFFT.mags, lastFFT.freqs, lastPeaks);
      updateFFTInfo();
    });
  }
  ttsSpeakBtn?.addEventListener('click', () => {
    const text = (ttsTextEl?.value || '').trim();
    if (!text) return;
    speakText(text);
  });

  // ===== Простейший TTS поверх формантного движка =====
  const RU_VOWEL_MAP = {
    'а': 'a', 'я': 'a',
    'э': 'e', 'е': 'e',
    'и': 'i', 'ы': 'i', // приближение
    'о': 'o', 'ё': 'o',
    'у': 'u', 'ю': 'u',
  };

  function presetByKey(key) { return VOWEL_PRESETS[key] || VOWEL_PRESETS.a; }

  function genExcitation(Fs, N, f0, model, Oq, Rq, voicedLvl, noiseLvl) {
    const x = new Float32Array(N);
    let phase = 0;
    let prevUg = 0;
    for (let n = 0; n < N; n++) {
      phase += f0 / Fs;
      if (phase >= 1) phase -= 1;
      let voiced = 0;
      if (model === 'impulse') {
        voiced = (phase < (f0 / Fs)) ? 1 : 0;
      } else {
        const Tc = Oq; const Ta = Math.max(1e-4, Oq * (1 - Rq));
        let Ug = 0;
        if (phase < Ta) Ug = 0.5 * (1 - Math.cos(Math.PI * (phase / Ta)));
        else if (phase < Tc) { const denom = 2 * (Tc - Ta) + 1e-9; Ug = Math.cos((Math.PI * (phase - Ta)) / denom) ** 2; }
        else Ug = 0;
        const deriv = Ug - prevUg; prevUg = Ug; voiced = deriv;
      }
      const noise = (Math.random() * 2 - 1) * 0.3;
      x[n] = voicedLvl * voiced + noiseLvl * noise;
    }
    return x;
  }

  function preEmphasisInplace(x, a) {
    let prev = 0; for (let n = 0; n < x.length; n++) { const xn = x[n]; x[n] = xn - a * prev; prev = xn; }
  }

  function filterFormants(x, Fs, tractModel, F1,B1,F2,B2,F3,B3) {
    const c1 = biquadBandpassCoeffs(Fs, F1, B1);
    const c2 = biquadBandpassCoeffs(Fs, F2, B2);
    const c3 = biquadBandpassCoeffs(Fs, F3, B3);
    if (tractModel === 'cascade') {
      return processBiquad(processBiquad(processBiquad(x, c1), c2), c3);
    } else {
      const y1 = processBiquad(x, c1);
      const y2 = processBiquad(x, c2);
      const y3 = processBiquad(x, c3);
      const y = new Float32Array(x.length);
      for (let i = 0; i < x.length; i++) y[i] = y1[i] + y2[i] + y3[i];
      return y;
    }
  }

  function applyEnvelopeInplace(y, Fs) {
    const N = y.length;
    const att = Math.max(1, Math.floor(0.01 * Fs));
    const rel = Math.max(1, Math.floor(0.05 * Fs));
    for (let n = 0; n < N; n++) {
      let env = 1;
      if (n < att) env = n / att;
      else if (n > N - rel) env = (N - n) / rel;
      y[n] *= env;
    }
  }

  function synthFormantSegment(Fs, durationSec, f0, model, Oq, Rq, tractModel, preEmph, preA, voicedLvl, noiseLvl, formants) {
    const N = Math.max(1, Math.floor(Fs * durationSec));
    const x = genExcitation(Fs, N, f0, model, Oq, Rq, voicedLvl, noiseLvl);
    if (preEmph) preEmphasisInplace(x, preA);
    const y = filterFormants(x, Fs, tractModel, formants.F1, formants.B1, formants.F2, formants.B2, formants.F3, formants.B3);
    applyEnvelopeInplace(y, Fs);
    // нормализация секции к пику ~0.9
    let m = 0; for (let i = 0; i < y.length; i++) m = Math.max(m, Math.abs(y[i]));
    if (m > 1e-9) { const k = 0.9 / m; for (let i = 0; i < y.length; i++) y[i] *= k; }
    return y;
  }

  function speakText(text) {
    const Fs = getFs();
    const model = glottalModelEl?.value || 'rosenberg';
    const tractModel = tractModelEl?.value || 'cascade';
    const Oq = clamp(parseFloat(OqEl?.value || '0.6'), 0.3, 0.9);
    const Rq = clamp(parseFloat(RqEl?.value || '0.1'), 0.05, 0.4);
    const preEmph = !!preEmphEl?.checked;
    const preA = clamp(parseFloat(preEmphAEl?.value || '0.97'), 0, 0.99);
    const baseF0 = clamp(parseFloat(f0NumberEl?.value || f0RangeEl?.value || '140'), 40, 400);

    const units = [];
    const lower = text.toLowerCase();
    for (const ch of lower) {
      if (ch === ' ') { units.push({ type: 'pause', dur: 0.08 }); continue; }
      const vkey = RU_VOWEL_MAP[ch];
      if (vkey) {
        const p = presetByKey(vkey);
        units.push({ type: 'vowel', dur: 0.18, p });
        continue;
      }
      // Простейшие согласные: шумовые вставки
      if ('сзшжщчфхц'.includes(ch)) { units.push({ type: 'sibilant', dur: 0.12 }); continue; }
      if ('ммннглрйвпбтдкг'.includes(ch)) { units.push({ type: 'voiced', dur: 0.10 }); continue; }
      // неизвестные символы — короткая пауза
      units.push({ type: 'pause', dur: 0.06 });
    }

    // Сборка звука
    const segments = [];
    let lastFormants = null;
    for (const u of units) {
      if (u.type === 'pause') {
        segments.push(new Float32Array(Math.floor(Fs * u.dur)));
      } else if (u.type === 'vowel') {
        const formants = { F1: u.p.F1, B1: u.p.B1, F2: u.p.F2, B2: u.p.B2, F3: u.p.F3, B3: u.p.B3 };
        // Небольшая подстройка огласовки: чуть больше шума на мягких
        const voicedLvl = 1.0;
        const noiseLvl = 0.04;
        const seg = synthFormantSegment(Fs, u.dur, baseF0, model, Oq, Rq, tractModel, preEmph, preA, voicedLvl, noiseLvl, formants);
        // Добавим мини-переход: если предыдущие форманты есть — краткий морф 40 мс
        if (lastFormants) {
          const a = 0.04; // 40мс
          const mid = synthFormantSegment(Fs, a, baseF0, model, Oq, Rq, tractModel, preEmph, preA, voicedLvl, noiseLvl, {
            F1: (lastFormants.F1 * 0.3 + formants.F1 * 0.7), B1: (lastFormants.B1 * 0.5 + formants.B1 * 0.5),
            F2: (lastFormants.F2 * 0.3 + formants.F2 * 0.7), B2: (lastFormants.B2 * 0.5 + formants.B2 * 0.5),
            F3: (lastFormants.F3 * 0.3 + formants.F3 * 0.7), B3: (lastFormants.B3 * 0.5 + formants.B3 * 0.5),
          });
          segments.push(mid);
        }
        segments.push(seg);
        lastFormants = formants;
      } else if (u.type === 'sibilant') {
        // «С»/«Ш» приближённо: шум + высокочастотные форманты
        const formants = { F1: 1500, B1: 600, F2: 3500, B2: 800, F3: 5500, B3: 1200 };
        const seg = synthFormantSegment(Fs, u.dur, baseF0, model, Oq, Rq, tractModel, preEmph, preA, 0.0, 0.6, formants);
        segments.push(seg);
      } else if (u.type === 'voiced') {
        const formants = lastFormants || presetByKey('a');
        const f = { F1: formants.F1 || 700, B1: 100, F2: formants.F2 || 1100, B2: 120, F3: formants.F3 || 2400, B3: 140 };
        const seg = synthFormantSegment(Fs, u.dur, baseF0, model, Oq, Rq, tractModel, preEmph, preA, 0.7, 0.1, f);
        segments.push(seg);
      }
    }

    // Конкатенация
    let totalN = 0; for (const s of segments) totalN += s.length;
    const y = new Float32Array(totalN);
    let pos = 0; for (const s of segments) { y.set(s, pos); pos += s.length; }

    // Воспроизвести
    speechBuffer = y;
    speechMeta = { Fs, N: y.length, T: y.length / Fs, f0: baseF0 };
    drawSpeech();
    playSpeech();
  }

  // Демо: последовательное проигрывание гласных а-э-и-о-у
  function playDemoVowels() {
    const seq = ['a', 'e', 'i', 'o', 'u'];
    let idx = 0;
    const playNext = () => {
      if (idx >= seq.length) return;
      if (vowelPresetEl) {
        vowelPresetEl.value = seq[idx];
        applyVowelPreset();
      }
      synthSpeech();
      const ctx = ensureAudioCtx();
      const audioBuf = ctx.createBuffer(1, speechBuffer.length, speechMeta.Fs);
      audioBuf.copyToChannel(speechBuffer, 0);
      stopPlayback();
      const node = ctx.createBufferSource();
      node.buffer = audioBuf;
      node.connect(ctx.destination);
      node.start();
      currentSourceNode = node;
      stopBtn.disabled = false;
      node.onended = () => { idx++; playNext(); };
    };
    playNext();
  }

  // События масштабирования окна
  function syncViewLen(valMs) {
    viewLenMs = valMs;
    clampViewToSignal();
    if (lastBuffer) drawWave(lastBuffer);
  }
  function syncViewOffset(valMs) {
    viewOffsetMs = valMs;
    clampViewToSignal();
    if (lastBuffer) drawWave(lastBuffer);
  }
  if (viewLenMsRange) viewLenMsRange.addEventListener('input', () => syncViewLen(parseFloat(viewLenMsRange.value) || 200));
  if (viewLenMsNumber) viewLenMsNumber.addEventListener('input', () => syncViewLen(parseFloat(viewLenMsNumber.value) || 200));
  if (viewOffsetMsRange) viewOffsetMsRange.addEventListener('input', () => syncViewOffset(parseFloat(viewOffsetMsRange.value) || 0));
  if (viewOffsetMsNumber) viewOffsetMsNumber.addEventListener('input', () => syncViewOffset(parseFloat(viewOffsetMsNumber.value) || 0));
  if (fitAllBtn) fitAllBtn.addEventListener('click', () => { viewOffsetMs = 0; viewLenMs = (lastComputed?.T || getDuration()) * 1000; clampViewToSignal(); if (lastBuffer) drawWave(lastBuffer); });

  // Мышиные взаимодействия: колесо — зум, перетаскивание — панорама
  let isPanning = false;
  let panStartX = 0;
  canvas.addEventListener('wheel', (e) => {
    if (!lastComputed) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const fracX = clamp(x / rect.width, 0, 1);
    const delta = Math.sign(e.deltaY); // 1 — отдаление, -1 — приближение
    const factor = delta > 0 ? 1.1 : 0.9;
    const oldLen = viewLenMs;
    let newLen = clamp(oldLen * factor, 5, lastComputed.T * 1000);
    // Сохраняем точку под курсором
    const centerMs = viewOffsetMs + fracX * oldLen;
    viewOffsetMs = clamp(centerMs - fracX * newLen, 0, Math.max(0, lastComputed.T * 1000 - newLen));
    viewLenMs = newLen;
    clampViewToSignal();
    drawWave(lastBuffer);
  }, { passive: false });

  canvas.addEventListener('mousedown', (e) => {
    isPanning = true;
    panStartX = e.clientX;
  });
  window.addEventListener('mouseup', () => { isPanning = false; });
  window.addEventListener('mousemove', (e) => {
    if (!isPanning || !lastComputed) return;
    const rect = canvas.getBoundingClientRect();
    const dx = e.clientX - panStartX;
    panStartX = e.clientX;
    const msPerPixel = viewLenMs / rect.width;
    viewOffsetMs = clamp(viewOffsetMs - dx * msPerPixel, 0, Math.max(0, lastComputed.T * 1000 - viewLenMs));
    clampViewToSignal();
    drawWave(lastBuffer);
  });

  // Инициализация
  addDefaultSource('sine'); // базовый 440 Гц
  renderSources();
  recalcAndDraw();
  // Инициализируем пресет речи по умолчанию
  applyVowelPreset();
})();
