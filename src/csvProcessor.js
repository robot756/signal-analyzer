// -------------------- CSV обработка --------------------
export const processCSVData = (file, options = {}) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const csvText = e.target.result;
        const results = parseCSV(csvText, options);
        resolve(results);
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => reject(new Error("Ошибка чтения файла"));
    reader.readAsText(file);
  });
};

// -------------------- Утилиты для матриц --------------------
const transpose = (M) => M[0].map((_, i) => M.map(row => row[i]));

const multiplyMatrices = (A, B) => {
  const aRows = A.length, aCols = A[0].length, bCols = B[0].length;
  const C = Array.from({ length: aRows }, () => Array(bCols).fill(0));
  for (let i = 0; i < aRows; i++) {
    for (let k = 0; k < aCols; k++) {
      const v = A[i][k];
      for (let j = 0; j < bCols; j++) {
        C[i][j] += v * B[k][j];
      }
    }
  }
  return C;
};

const invertMatrix = (m) => {
  const n = m.length;
  const A = m.map((row, i) => row.concat(Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))));
  for (let i = 0; i < n; i++) {
    let maxRow = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(A[k][i]) > Math.abs(A[maxRow][i])) maxRow = k;
    if (Math.abs(A[maxRow][i]) < 1e-15) throw new Error("Matrix degenerate");
    if (maxRow !== i) [A[i], A[maxRow]] = [A[maxRow], A[i]];
    const diag = A[i][i];
    for (let j = 0; j < 2 * n; j++) A[i][j] /= diag;
    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const factor = A[k][i];
      for (let j = 0; j < 2 * n; j++) A[k][j] -= factor * A[i][j];
    }
  }
  return A.map(row => row.slice(n));
};

// -------------------- Savitzky–Golay фильтр --------------------
const savitzkyGolay = (data, windowSize = 31, polyOrder = 3) => {
  if (!Array.isArray(data) || data.length === 0) return [];
  windowSize = Math.max(3, Math.floor(windowSize));
  if (windowSize % 2 === 0) windowSize += 1;
  polyOrder = Math.max(1, Math.floor(polyOrder));
  if (polyOrder >= windowSize) polyOrder = windowSize - 1;

  const n = data.length;
  const half = Math.floor(windowSize / 2);

  const A = [];
  for (let i = -half; i <= half; i++) {
    const row = [];
    for (let p = 0; p <= polyOrder; p++) row.push(i ** p);
    A.push(row);
  }

  const AT = transpose(A);
  const ATA = multiplyMatrices(AT, A);
  let invATA;
  try { invATA = invertMatrix(ATA); } catch { return data.slice(); }
  const ATAinvAT = multiplyMatrices(invATA, AT);
  const coeffs = ATAinvAT[0];

  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let j = -half; j <= half; j++) {
      let idx = i + j;
      if (idx < 0) idx = 0;
      if (idx >= n) idx = n - 1;
      acc += data[idx] * coeffs[j + half];
    }
    out[i] = acc;
  }
  return out;
};

// -------------------- SG производная --------------------
const calculateDerivativeSG = (t, signal, windowSize = 31, polyOrder = 3) => {
  const n = signal.length;
  if (n < 3) return new Array(n).fill(0);

  const half = Math.floor(windowSize / 2);
  const A = [];
  for (let i = -half; i <= half; i++) {
    const row = [];
    for (let p = 0; p <= polyOrder; p++) row.push(i ** p);
    A.push(row);
  }
  const AT = transpose(A);
  const ATA = multiplyMatrices(AT, A);
  let invATA;
  try { invATA = invertMatrix(ATA); } catch { return new Array(n).fill(0); }
  const ATAinvAT = multiplyMatrices(invATA, AT);
  const coeffsDeriv = ATAinvAT[1];

  const dtConst = t[1] - t[0];  
  const derivative = new Array(n).fill(0);

  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let j = -half; j <= half; j++) {
      let idx = i + j;
      if (idx < 0) idx = 0;
      if (idx >= n) idx = n - 1;
      acc += signal[idx] * coeffsDeriv[j + half];
    }
    derivative[i] = acc / dtConst;
  }
  return derivative;
};

// -------------------- Baseline removal --------------------
const removeBaseline = (arr, N = 2000) => {
  const count = Math.min(arr.length, N);
  const avg = arr.slice(0, count).reduce((s, v) => s + v, 0) / count;
  return arr.map(v => v - avg);
};

// -------------------- CSV парсинг --------------------
const parseCSV = (csvText, options = {}) => {

  const sgWindow = options.sgWindow || 31;
  const sgPoly = options.sgPoly || 3;
  const baselineN = options.baselineN || 2000;
  const skipStart = options.skipStart || 6650;
  const skipEnd = options.skipEnd || 27000;
  const derivativeWindowNs = options.derivativeWindowNs || 200; // <<< CHANGES

  const lines = csvText.split("\n");
  const t = [], tenz = [], interf = [];

  let dataStarted = false;
  let lineCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.startsWith("TIME,CH1,")) {
      dataStarted = true;
      continue;
    }
    if (!dataStarted) continue;

    lineCount++;
    if (lineCount < skipStart) continue;
    if (lineCount > skipEnd) break;

    const fields = line.split(",");
    if (fields.length >= 5) {
      const t0 = parseFloat(fields[0]);
      const ch1 = parseFloat(fields[1]);
      const ch3 = parseFloat(fields[3]);
      if (!isNaN(t0) && !isNaN(ch1) && !isNaN(ch3)) {
        t.push(t0);
        tenz.push(ch1 * 0.00132 * 1.25);
        interf.push(ch3 + 0.04);
      }
    }
  }

  const interfSmoothed = savitzkyGolay(interf, sgWindow, sgPoly);
  const interfCorrected = removeBaseline(interfSmoothed, baselineN);

  const { t0, y0 } = findZeroCrossings(t, interfCorrected);
  const { filteredT0, filteredY0 } = filterClosePoints(t0, y0, 100e-9);

  // -------------------- CHANGES: локальная производная --------------------
  const mask = new Array(t.length).fill(false);
  const derivWindowSec = derivativeWindowNs * 1e-9;
  for (let k = 0; k < filteredT0.length; k++) {
    const center = filteredT0[k];
    const tMin = center - derivWindowSec;
    const tMax = center + derivWindowSec;
    for (let i = 0; i < t.length; i++) {
      if (t[i] >= tMin && t[i] <= tMax) mask[i] = true;
    }
  }

  const tForDeriv = [];
  const interfForDeriv = [];
  const idxMap = [];
  for (let i = 0; i < t.length; i++) {
    if (mask[i]) {
      tForDeriv.push(t[i]);
      interfForDeriv.push(interfCorrected[i]);
      idxMap.push(i);
    }
  }

  const dudt_local = tForDeriv.length > 3
    ? calculateDerivativeSG(tForDeriv, interfForDeriv, sgWindow, sgPoly)
    : [];

  const dudt_interf = new Array(t.length).fill(0);
  for (let k = 0; k < idxMap.length; k++) {
    dudt_interf[idxMap[k]] = dudt_local[k];
  }

  // -------------------- пересечения тензо и центрированного интерф --------------------
  const intersectionPoints = findSignalIntersectionsAtZero(t, tenz, interfCorrected);

  return {
    t,
    tenz,
    interf,
    interfSmoothed,
    interfCorrected,
    t0: filteredT0,
    y0: filteredY0,
    dudt_interf,
    intersectionPoints,
  };
};

// -------------------- Нулевые пересечения --------------------
const findZeroCrossings = (t, interf, eps = 1e-6) => {
  const t0 = [];
  const y0 = [];
  for (let i = 1; i < interf.length; i++) {
    const y1 = interf[i - 1], y2 = interf[i];
    if (y1 * y2 < 0) {
      const x1 = t[i - 1], x2 = t[i];
      const tZ = x1 - y1 * (x2 - x1) / (y2 - y1);
      t0.push(tZ);
      y0.push(0);
    }
  }
  return { t0, y0 };
};

// -------------------- Фильтрация близких точек --------------------
const filterClosePoints = (t0, y0, minDistance) => {
  if (!t0 || t0.length <= 1) return { filteredT0: t0 || [], filteredY0: y0 || [] };

  let outT = [...t0];
  let outY = [...y0];

  for (let k = 0; k < 10; k++) {
    const newT = [outT[0]];
    const newY = [outY[0]];
    for (let i = 1; i < outT.length; i++) {
      if (outT[i] - newT[newT.length - 1] >= minDistance) {
        newT.push(outT[i]);
        newY.push(outY[i]);
      }
    }
    if (newT.length === outT.length) break;
    outT = newT;
    outY = newY;
  }
  return { filteredT0: outT, filteredY0: outY };
};

// -------------------- Пересечения сигналов --------------------
const findSignalIntersectionsAtZero = (t, tenz, interf, yThreshold = 0.02) => {
  const intersections = [];
  for (let i = 1; i < t.length; i++) {
    const diffPrev = tenz[i - 1] - interf[i - 1];
    const diffCurr = tenz[i] - interf[i];
    if ((diffPrev <= 0 && diffCurr > 0) || (diffPrev >= 0 && diffCurr < 0)) {
      const t1 = t[i - 1], t2 = t[i];
      const ratio = -diffPrev / (diffCurr - diffPrev);
      const time = t1 + ratio * (t2 - t1);
      const value = (tenz[i - 1] + ratio * (tenz[i] - tenz[i - 1])
                     + interf[i - 1] + ratio * (interf[i] - interf[i - 1])) / 2;
      if (Math.abs(value) <= yThreshold) intersections.push({ time, value });
    }
  }
  return intersections;
};

// -------------------- Поиск максимального скачка --------------------
const findJumpByDerivative = (t, signal) => {
  const slopes = [];
  for (let i = 1; i < signal.length; i++) {
    const dt = Math.max(t[i] - t[i - 1], 1e-12);
    slopes.push((signal[i] - signal[i - 1]) / dt);
  }

  if (slopes.length === 0) return null;

  let maxIdx = 0;
  let maxSlope = slopes[0];
  for (let i = 1; i < slopes.length; i++) {
    if (Math.abs(slopes[i]) > Math.abs(maxSlope)) {
      maxSlope = slopes[i];
      maxIdx = i;
    }
  }

  const slopeSign = Math.sign(maxSlope) || 1;
  const startThreshold = Math.abs(maxSlope) * 0.35;
  let startIdx = maxIdx;

  while (startIdx > 0) {
    const prevSlope = slopes[startIdx - 1];
    if (
      Math.sign(prevSlope) !== slopeSign ||
      Math.abs(prevSlope) < startThreshold
    ) {
      break;
    }
    startIdx -= 1;
  }

  return startIdx;
};

const findLargestJumpStart = (t, signal) => {
  if (
    !Array.isArray(t) ||
    !Array.isArray(signal) ||
    t.length < 3 ||
    t.length !== signal.length
  ) {
    return null;
  }

  const smoothSignal = savitzkyGolay(signal, 11, 2);
  const n = smoothSignal.length;

  const headCount = Math.max(20, Math.floor(n * 0.05));
  const baseline =
    smoothSignal.slice(0, headCount).reduce((sum, v) => sum + v, 0) / headCount;
  const minVal = smoothSignal.reduce((min, v) => Math.min(min, v), baseline);
  const amplitude = baseline - minVal;

  let startIdx = null;
  if (amplitude > 0) {
    const threshold = baseline - amplitude * 0.15;
    for (let i = 0; i < n; i++) {
      if (smoothSignal[i] <= threshold) {
        startIdx = i;
        break;
      }
    }
  }

  if (startIdx === null) {
    startIdx = findJumpByDerivative(t, smoothSignal);
  }

  if (startIdx === null) return null;

  const windowSamples = Math.max(20, Math.floor(signal.length * 0.02));
  const leftIdx = Math.max(0, startIdx - windowSamples);
  const rightIdx = Math.min(signal.length - 1, startIdx + windowSamples);
  const window =
    t[rightIdx] - t[leftIdx] > 0 ? t[rightIdx] - t[leftIdx] : 1e-6;

  return {
    time: t[startIdx],
    window,
  };
};

// -------------------- Подготовка данных для графиков --------------------
export const generateChartData = (results, options = {}) => {
  const {
    t,
    tenz,
    interfCorrected,
    interfSmoothed,
    dudt_interf,
    intersectionPoints
  } = results;

  const maxPoints = options.maxPoints || 2000;
  const step = Math.max(1, Math.floor(t.length / maxPoints));

  const lt = [], lten = [], lint = [], lsm = [], lder = [];
  for (let i = 0; i < t.length; i += step) {
    lt.push(t[i]);
    lten.push(tenz[i]);
    lint.push(interfCorrected[i]);
    lsm.push(interfSmoothed[i]);
    lder.push(dudt_interf[i]);
  }

  const chartData = {
    original: [
      { 
        label: "Тензометрический сигнал (CH1)", 
        data: lt.map((x,i)=>({x,y:lten[i]})), 
        borderColor: "rgb(255,99,132)", 
        backgroundColor: "rgba(255,99,132,0.3)",
        borderWidth: 1.5, 
        pointRadius: 2,
        pointHoverRadius: 4,
        pointBorderWidth: 1.5,
        pointBorderColor: "rgb(255,99,132)",
        pointBackgroundColor: "rgba(255,99,132,0.6)",
        showLine: true 
      },
      { label: "Интерф CH3 (SG)", data: lt.map((x,i)=>({x,y:lsm[i]})), borderColor:"rgb(0,0,0)", borderWidth:1 },
      { label: "Интерф центрированный", data: lt.map((x,i)=>({x,y:lint[i]})), borderColor:"rgb(54,162,235)", borderWidth:1 },
      { 
        label: "Пересечения тензо и интерф", 
        data: intersectionPoints.map(p=>({x:p.time,y:p.value})), 
        pointStyle: "circle",
        pointRadius: 4,
        pointHoverRadius: 6,
        showLine: false, 
        borderColor: "rgb(255, 140, 0)",
        backgroundColor: "rgba(255, 215, 0, 0.8)",
        borderWidth: 2,
        pointBorderColor: "rgb(255, 140, 0)",
        pointBackgroundColor: "rgba(255, 215, 0, 0.9)"
      }
    ],
    processed: [
      { 
        label: "Производная (локальная)", 
        data: lt.map((x,i)=>({x,y:lder[i]})), 
        borderColor: "rgb(77, 182, 172)",
        backgroundColor: "rgba(77, 182, 172, 0.1)",
        borderWidth: 2.5,
        pointRadius: 0,
        showLine: true,
        fill: false,
        tension: 0.1,
        borderCapStyle: 'round',
        borderJoinStyle: 'round'
      },
      { 
        label: "Пересечения тензо и интерф", 
        data: intersectionPoints.map(p=>({x:p.time,y:p.value})), 
        pointStyle: "circle",
        pointRadius: 4,
        pointHoverRadius: 6,
        showLine: false, 
        borderColor: "rgb(220, 20, 60)",
        backgroundColor: "rgba(255, 69, 0, 0.85)",
        borderWidth: 2,
        pointBorderColor: "rgb(220, 20, 60)",
        pointBackgroundColor: "rgba(255, 69, 0, 0.95)"
      }
    ],
    rawData: {
      t,
      tenz,
      interf: results.interf,
      interfCorrected,
      dudt_interf
    }
  };

  chartData.intersections = intersectionPoints || [];
  
  // Скорость (по производной интерферосигнала) в точках пересечения
  const velocitySeries = [];
  const displacementSeries = [];
  if (Array.isArray(intersectionPoints) && intersectionPoints.length > 0) {
    let idx = 0;
    let lastTime = intersectionPoints[0].time;
    let lastVel = 0;
    let disp = 0;

    for (let k = 0; k < intersectionPoints.length; k++) {
      const ptTime = intersectionPoints[k].time;
      while (idx < t.length - 1 && t[idx] < ptTime) {
        idx++;
      }
      const v = dudt_interf[idx] ?? 0;
      velocitySeries.push({ time: ptTime, value: v });

      if (k > 0) {
        const dt = ptTime - lastTime;
        disp += 0.5 * (v + lastVel) * dt;
      }
      displacementSeries.push({ time: ptTime, value: disp });

      lastTime = ptTime;
      lastVel = v;
    }
  }

  chartData.velocitySeries = velocitySeries;
  chartData.displacementSeries = displacementSeries;
  const interfJumpCenter = findLargestJumpStart(t, interfCorrected);
  if (interfJumpCenter) {
    chartData.focusPoints = {
      interfCenter: interfJumpCenter,
    };
  }

  return chartData;
};
