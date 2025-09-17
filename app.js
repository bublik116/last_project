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

    const maxFreq = (lastComputed?.Fs || getFs()) / 2;
    const xOfF = (f) => (f / maxFreq) * W;

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
      for (let i = 0; i < values.length; i++) {
        const x = xOfF(freqs[i]);
        const y = yOfDb(values[i]);
        if (i === 0) fftCtx.moveTo(x, y); else fftCtx.lineTo(x, y);
      }
      fftCtx.stroke();

      // Пики
      fftCtx.fillStyle = '#ffa657';
      fftCtx.strokeStyle = '#ffa657';
      for (const p of peaks) {
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
        const t = v / (vmax + 1e-12);
        return (1 - t) * (H - 30) + 10;
      };
      fftCtx.strokeStyle = '#58a6ff';
      fftCtx.lineWidth = 1.5;
      fftCtx.beginPath();
      for (let i = 0; i < mags.length; i++) {
        const x = xOfF(freqs[i]);
        const y = yOf(mags[i]);
        if (i === 0) fftCtx.moveTo(x, y); else fftCtx.lineTo(x, y);
      }
      fftCtx.stroke();

      // Пики
      fftCtx.fillStyle = '#ffa657';
      fftCtx.strokeStyle = '#ffa657';
      for (const p of peaks) {
        const x = xOfF(p.freq);
        const y = yOf(p.mag);
        fftCtx.beginPath();
        fftCtx.moveTo(x, H - 20);
        fftCtx.lineTo(x, y);
        fftCtx.stroke();
        fftCtx.fillText(`${Math.round(p.freq)} Гц`, x + 4, y - 4);
      }
    }
  }

  function recalcFFTAndDraw() {
    if (!fftCanvas) return;
    const { mags, freqs, Nfft, Fs } = computeFFT();
    const peaks = findPeaks(mags, freqs, getPeakCount());
    drawSpectrum(mags, freqs, peaks);
    if (fftInfo) {
      const df = Fs / Nfft;
      fftInfo.textContent = `N=${Nfft}, Δf≈${df.toFixed(2)} Гц, пики: ${peaks.map(p => `${Math.round(p.freq)} Гц`).join(', ')}`;
    }
  }

  // Переключение вкладок
  function showTimeTab() {
    if (!vizSection || !spectrumSection) return;
    tabTime?.classList.add('active');
    tabFFT?.classList.remove('active');
    vizSection.classList.remove('hidden');
    spectrumSection.classList.add('hidden');
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
    const y = new Float32Array(x.length);
    let z1 = 0, z2 = 0; // Direct Form I implementation (transposed would be better but fine)
    const { b0, b1, b2, a0, a1, a2 } = coeffs;
    for (let n = 0; n < x.length; n++) {
      const xn = x[n];
      const yn = (b0 * xn + z1) / a0;
      z1 = b1 * xn + z2 - a1 * yn;
      z2 = b2 * xn - a2 * yn;
      y[n] = yn;
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

    // Источник: импульсный поезд на F0 + белый шум
    const x = new Float32Array(N);
    let phase = 0;
    const dphi = f0 / Fs;
    for (let n = 0; n < N; n++) {
      phase += dphi;
      let voiced = 0;
      if (phase >= 1.0) { phase -= 1.0; voiced = 1.0; } // узкий импульс
      const noise = (Math.random() * 2 - 1);
      x[n] = voicedLvl * voiced + noiseLvl * noise * 0.3; // шум приглушим
    }

    // Фильтры формант
    const c1 = biquadBandpassCoeffs(Fs, F1, B1);
    const c2 = biquadBandpassCoeffs(Fs, F2, B2);
    const c3 = biquadBandpassCoeffs(Fs, F3, B3);
    const y1 = processBiquad(x, c1);
    const y2 = processBiquad(x, c2);
    const y3 = processBiquad(x, c3);
    const y = new Float32Array(N);
    for (let n = 0; n < N; n++) y[n] = y1[n] + y2[n] + y3[n];

    // Нормализация, чтобы избежать клиппинга
    let maxAbs = 0; for (let n = 0; n < N; n++) maxAbs = Math.max(maxAbs, Math.abs(y[n]));
    if (maxAbs > 0.99) { const k = 0.99 / maxAbs; for (let n = 0; n < N; n++) y[n] *= k; }

    speechBuffer = y;
    speechMeta = { Fs, N, T, f0, F1, F2, F3 };
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
