import React, { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { Chart, registerables } from "chart.js";
import zoomPlugin from "chartjs-plugin-zoom";
import { filterCloseIntersections } from "./csvProcessor";

const intersectionMarkerPlugin = {
  id: "intersectionMarker",
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    chart.data.datasets.forEach((dataset, datasetIndex) => {
      if (!dataset?.intersectionMarker) return;

      const meta = chart.getDatasetMeta(datasetIndex);
      if (!chart.isDatasetVisible(datasetIndex)) return;

      const elements = meta.data;
      if (elements.length === 0) return;

      const size = dataset.markerSize ?? 6;

      ctx.save();
      ctx.strokeStyle = dataset.markerColor ?? "#000000";
      ctx.globalAlpha = dataset.markerAlpha ?? 0.8;
      ctx.lineWidth = dataset.markerLineWidth ?? 2;
      ctx.lineCap = "round";
      ctx.beginPath();

      for (let i = 0; i < elements.length; i++) {
        const x = elements[i].x;
        const y = elements[i].y;
        if (x === undefined || y === undefined || isNaN(x) || isNaN(y)) continue;
        ctx.moveTo(x - size, y - size);
        ctx.lineTo(x + size, y + size);
        ctx.moveTo(x - size, y + size);
        ctx.lineTo(x + size, y - size);
      }

      ctx.stroke();
      ctx.restore();
    });
  },
};

Chart.register(...registerables, zoomPlugin, intersectionMarkerPlugin);

// Отключаем анимации глобально для производительности
Chart.defaults.animation = false;
Chart.defaults.transitions.active.animation.duration = 0;

const ZOOM_STEP = 1.25;

const formatTime = (value) => {
  if (typeof value !== "number") return "-";
  return value.toExponential(3);
};

const formatSignal = (value) => {
  if (typeof value !== "number") return "-";
  return value.toFixed(5);
};

const formatSpeed = (value) => {
  if (typeof value !== "number") return "-";
  return value.toExponential(3);
};

const formatDisplacement = (value) => {
  if (typeof value !== "number") return "-";
  return value.toExponential(3);
};

// Кэшированные стили для таблицы экстремумов
const STYLE_EXTREMUM_HEADER = { backgroundColor: "rgba(220, 38, 38, 0.15)", color: "rgb(220, 38, 38)", border: "1px solid rgb(220, 38, 38)" };
const STYLE_EXTREMUM_MAX = { color: "rgb(220, 38, 38)", fontWeight: 600 };
const STYLE_EXTREMUM_MIN = { color: "rgb(37, 99, 235)", fontWeight: 600 };

const ChartComponent = React.memo(({ data }) => {
  const originalChartRef = useRef(null);
  const velocityChartRef = useRef(null);
  const displacementChartRef = useRef(null);
  const originalChartInstance = useRef(null);
  const velocityChartInstance = useRef(null);
  const displacementChartInstance = useRef(null);
  const intersections = data?.intersections ?? [];
  const [originalAxisVisibility, setOriginalAxisVisibility] = useState({});
  const [intersectionVisibility, setIntersectionVisibility] = useState(true);
  const [tenzOffset, setTenzOffset] = useState(0);
  const [interfOffset, setInterfOffset] = useState(0);
  const [currentIntersections, setCurrentIntersections] = useState([]);
  const [intersectionXMin, setIntersectionXMin] = useState(null);
  const [velocitySeries, setVelocitySeries] = useState([]);
  const [displacementSeries, setDisplacementSeries] = useState([]);
  const [velocityMarkers, setVelocityMarkers] = useState([]);
  const [displacementMarkers, setDisplacementMarkers] = useState([]);
  const [extremumPoints, setExtremumPoints] = useState([]);
  const [showExtremumMax, setShowExtremumMax] = useState(true);
  const [showExtremumMin, setShowExtremumMin] = useState(true);
  const interfCenterPoint = data?.focusPoints?.interfCenter;

  useEffect(() => {
    if (!data) return;

    const buildOptions = (title, yLabel) => ({
      responsive: true,
      maintainAspectRatio: false,
      normalized: true,
      interaction: {
        mode: "nearest",
        intersect: true,
        axis: "x",
      },
      elements: {
        point: { radius: 0, hoverRadius: 4 },
        line: { tension: 0, borderWidth: 1.5 },
      },
      scales: {
        x: {
          type: "linear",
          title: { display: true, text: "Время (секунды)" },
        },
        y: {
          type: "linear",
          title: { display: true, text: yLabel },
        },
      },
      plugins: {
        title: { display: true, text: title },
        legend: { display: false },
        tooltip: {
          enabled: true,
          animation: false,
          position: 'nearest',
          callbacks: {
            label: function(context) {
              const point = context.raw;
              const xValue = typeof point.x === 'number'
                ? point.x.toExponential(3) + ' с'
                : String(point.x);
              const yValue = typeof point.y === 'number'
                ? point.y.toFixed(6)
                : String(point.y);
              return [`${context.dataset.label || ''}`, `X: ${xValue}`, `Y: ${yValue}`];
            },
          },
        },
        zoom: {
          pan: { enabled: true, mode: "xy", threshold: 5 },
          zoom: {
            wheel: { enabled: true, modifierKey: "ctrl", speed: 0.1 },
            pinch: { enabled: true },
            drag: { enabled: false },
            mode: "xy",
          },
        },
      },
    });

    if (originalChartInstance.current) {
      originalChartInstance.current.destroy();
      originalChartInstance.current = null;
    }
    if (velocityChartInstance.current) {
      velocityChartInstance.current.destroy();
      velocityChartInstance.current = null;
    }
    if (displacementChartInstance.current) {
      displacementChartInstance.current.destroy();
      displacementChartInstance.current = null;
    }

    // График исходных данных
    if (originalChartRef.current) {
      const ctx = originalChartRef.current.getContext("2d");
      originalChartInstance.current = new Chart(ctx, {
        type: "line",
        data: {
          datasets: data.original,
        },
        options: buildOptions("Исходные сигналы", "Сигнал (В)"),
      });
    }

    return () => {
      if (originalChartInstance.current) {
        originalChartInstance.current.destroy();
        originalChartInstance.current = null;
      }
      if (velocityChartInstance.current) {
        velocityChartInstance.current.destroy();
        velocityChartInstance.current = null;
      }
      if (displacementChartInstance.current) {
        displacementChartInstance.current.destroy();
        displacementChartInstance.current = null;
      }
    };
  }, [data]);

  const centerOriginalChartOnTime = useCallback((centerTime, windowHint) => {
    const chart = originalChartInstance.current;
    if (!chart || typeof centerTime !== "number") return;

    const xScale = chart.scales?.x;
    if (!xScale) return;

    const currentRange = xScale.max - xScale.min;
    const spanCandidate =
      currentRange > 0 && isFinite(currentRange)
        ? currentRange / 2
        : windowHint ?? 1e-6;
    const span = isFinite(spanCandidate) && spanCandidate > 0 ? spanCandidate : 1e-6;

    chart.options.scales.x.min = centerTime - span;
    chart.options.scales.x.max = centerTime + span;
    chart.update("none");
  }, []);

  useEffect(() => {
    if (interfCenterPoint?.time) {
      centerOriginalChartOnTime(interfCenterPoint.time, interfCenterPoint.window);
    }
  }, [interfCenterPoint, centerOriginalChartOnTime]);

  useEffect(() => {
    if (data?.original) {
      setOriginalAxisVisibility((prev) => {
        const next = { ...prev };
        data.original.forEach((dataset) => {
          if (dataset.intersectionMarker) return;
          if (!(dataset.label in next)) {
            next[dataset.label] = true;
          }
        });
        return next;
      });
    }

    // Инициализируем текущие пересечения
    if (data?.intersections) {
      const rawT0 =
        data?.rawData?.t && data.rawData.t.length > 0 ? data.rawData.t[0] : null;
      const minTime = intersectionXMin ?? rawT0;
      const base = data.intersections;
      const filtered =
        typeof minTime === "number"
          ? base.filter((p) => p.time >= minTime)
          : [...base];

      setCurrentIntersections(filterCloseIntersections(filtered));
    }
  }, [data, intersectionXMin]);

  // Синхронизация видимости датасетов Chart.js с состоянием originalAxisVisibility
  useEffect(() => {
    const chart = originalChartInstance.current;
    if (!chart) return;

    chart.data.datasets.forEach((dataset, index) => {
      if (dataset.intersectionMarker) return;
      const visible = originalAxisVisibility[dataset.label];
      if (typeof visible === "boolean") {
        chart.setDatasetVisibility(index, visible);
      }
    });

    chart.update("none");
  }, [originalAxisVisibility, data]);


  // График скорости
  useEffect(() => {
    if (!velocityChartRef.current) return;

    if (!velocityChartInstance.current) {
      if (velocitySeries.length === 0) return;
      const yLabel = "Скорость (м/с)";
      const tooltipUnit = "м/с";
      const ctxV = velocityChartRef.current.getContext("2d");
      velocityChartInstance.current = new Chart(ctxV, {
        type: "line",
        data: {
          datasets: [
            {
              label: "Скорость (линия)",
              data: velocitySeries.map((p) => ({ x: p.time, y: p.value })),
              borderColor: "rgb(34,197,94)",
              backgroundColor: "rgba(34,197,94,0.08)",
              fill: true,
              showLine: true,
              pointRadius: 3,
              pointHoverRadius: 5,
              pointBackgroundColor: "rgb(34,197,94)",
              pointBorderWidth: 0,
              tension: 0.3,
              cubicInterpolationMode: 'monotone',
              borderWidth: 2,
            },
            {
              label: "Скорость (точки)",
              data: velocityMarkers.map((p) => ({ x: p.time, y: p.value })),
              backgroundColor: "rgb(34,197,94)",
              showLine: false,
              pointRadius: 4,
              pointHoverRadius: 6,
              pointBackgroundColor: "rgb(34,197,94)",
              pointBorderWidth: 0,
              borderWidth: 0,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          normalized: true,
          interaction: {
            mode: "nearest",
            intersect: true,
          },
          scales: {
            x: {
              type: "linear",
              title: { display: true, text: "Время (секунды)", font: { size: 13, weight: 'bold' } },
              ticks: {
                callback: function(value) {
                  return value.toExponential(4).replace('.', ',').replace('e+', 'E+').replace('e-', 'E-');
                },
                font: { size: 11 },
                maxRotation: 0,
              },
              grid: { color: 'rgba(0,0,0,0.08)' },
            },
            y: {
              type: "linear",
              title: { display: true, text: yLabel, font: { size: 13, weight: 'bold' } },
              ticks: {
                callback: function(value) {
                  return value.toFixed(2).replace('.', ',');
                },
                font: { size: 11 },
              },
              grid: { color: 'rgba(0,0,0,0.08)' },
            },
          },
          plugins: {
            title: {
              display: true,
              text: 'Скорость от времени',
              font: { size: 18, weight: 'bold' },
              padding: { top: 10, bottom: 15 },
              color: '#1a1a1a',
            },
            legend: { display: false },
            zoom: {
              pan: { enabled: true, mode: "xy", threshold: 5 },
              zoom: {
                wheel: { enabled: true, modifierKey: "ctrl", speed: 0.1 },
                pinch: { enabled: true },
                drag: { enabled: false },
                mode: "xy",
              },
            },
            tooltip: {
              enabled: true,
              animation: false,
              position: 'nearest',
              filter: function (tooltipItem, currentIndex, tooltipItems) {
                return !tooltipItems.some((item, idx) =>
                  idx < currentIndex && item.raw.x === tooltipItem.raw.x && item.raw.y === tooltipItem.raw.y
                );
              },
              callbacks: {
                label: function (context) {
                  const point = context.raw;
                  const t = typeof point.x === "number"
                    ? point.x.toExponential(4).replace('.', ',') + " с"
                    : String(point.x);
                  const v = typeof point.y === "number"
                    ? point.y.toExponential(4).replace('.', ',') + " " + tooltipUnit
                    : String(point.y);
                  return [`${context.dataset.label || ""}`, `t: ${t}`, `v: ${v}`];
                },
              },
            },
          },
        },
      });
      return;
    }

    const chart = velocityChartInstance.current;
    chart.data.datasets[0].data = velocitySeries.map((p) => ({
      x: p.time,
      y: p.value,
    }));
    if (chart.data.datasets[1]) {
      chart.data.datasets[1].data = velocityMarkers.map((p) => ({
        x: p.time,
        y: p.value,
      }));
    }
    chart.update("none");
  }, [velocitySeries, velocityMarkers]);

  // График перемещения
  useEffect(() => {
    if (!displacementChartRef.current) return;

    if (!displacementChartInstance.current) {
      if (displacementSeries.length === 0) return;
      const yLabel = "Перемещение (м)";
      const tooltipUnit = "м";
      const ctxS = displacementChartRef.current.getContext("2d");
      displacementChartInstance.current = new Chart(ctxS, {
        type: "line",
        data: {
          datasets: [
            {
              label: "Перемещение (линия)",
              data: displacementSeries.map((p) => ({ x: p.time, y: p.value })),
              borderColor: "rgb(59,130,246)",
              backgroundColor: "rgba(59,130,246,0.08)",
              fill: true,
              showLine: true,
              pointRadius: 3,
              pointHoverRadius: 5,
              pointBackgroundColor: "rgb(59,130,246)",
              pointBorderWidth: 0,
              tension: 0.3,
              cubicInterpolationMode: 'monotone',
              borderWidth: 2,
            },
            {
              label: "Перемещение (точки)",
              data: displacementMarkers.map((p) => ({ x: p.time, y: p.value })),
              backgroundColor: "rgb(59,130,246)",
              showLine: false,
              pointRadius: 4,
              pointHoverRadius: 6,
              pointBackgroundColor: "rgb(59,130,246)",
              pointBorderWidth: 0,
              borderWidth: 0,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          normalized: true,
          interaction: {
            mode: "nearest",
            intersect: true,
          },
          scales: {
            x: {
              type: "linear",
              title: { display: true, text: "Время (секунды)", font: { size: 13, weight: 'bold' } },
              ticks: {
                callback: function(value) {
                  return value.toExponential(4).replace('.', ',').replace('e+', 'E+').replace('e-', 'E-');
                },
                font: { size: 11 },
                maxRotation: 0,
              },
              grid: { color: 'rgba(0,0,0,0.08)' },
            },
            y: {
              type: "linear",
              title: { display: true, text: yLabel, font: { size: 13, weight: 'bold' } },
              ticks: {
                callback: function(value) {
                  return value.toExponential(7).replace('.', ',').replace('e+', 'E+').replace('e-', 'E-');
                },
                font: { size: 11 },
              },
              grid: { color: 'rgba(0,0,0,0.08)' },
            },
          },
          plugins: {
            title: {
              display: true,
              text: 'Перемещение от времени',
              font: { size: 18, weight: 'bold' },
              padding: { top: 10, bottom: 15 },
              color: '#1a1a1a',
            },
            legend: { display: false },
            zoom: {
              pan: { enabled: true, mode: "xy", threshold: 5 },
              zoom: {
                wheel: { enabled: true, modifierKey: "ctrl", speed: 0.1 },
                pinch: { enabled: true },
                drag: { enabled: false },
                mode: "xy",
              },
            },
            tooltip: {
              enabled: true,
              animation: false,
              position: 'nearest',
              filter: function (tooltipItem, currentIndex, tooltipItems) {
                return !tooltipItems.some((item, idx) =>
                  idx < currentIndex && item.raw.x === tooltipItem.raw.x && item.raw.y === tooltipItem.raw.y
                );
              },
              callbacks: {
                label: function (context) {
                  const point = context.raw;
                  const t = typeof point.x === "number"
                    ? point.x.toExponential(4).replace('.', ',') + " с"
                    : String(point.x);
                  const s = typeof point.y === "number"
                    ? point.y.toExponential(4).replace('.', ',') + " " + tooltipUnit
                    : String(point.y);
                  return [`${context.dataset.label || ""}`, `t: ${t}`, `s: ${s}`];
                },
              },
            },
          },
        },
      });
      return;
    }

    const chart = displacementChartInstance.current;
    chart.data.datasets[0].data = displacementSeries.map((p) => ({
      x: p.time,
      y: p.value,
    }));
    if (chart.data.datasets[1]) {
      chart.data.datasets[1].data = displacementMarkers.map((p) => ({
        x: p.time,
        y: p.value,
      }));
    }
    chart.update("none");
  }, [displacementSeries, displacementMarkers]);

  // Расчет пересечений, скорости и перемещения при изменении сдвигов или предела по X
  useEffect(() => {
    if (!data?.rawData) {
      setCurrentIntersections([]);
      setVelocitySeries([]);
      setDisplacementSeries([]);
      setVelocityMarkers([]);
      setDisplacementMarkers([]);
      setExtremumPoints([]);
      return;
    }

    const { t, tenz, interfCorrected } = data.rawData;

    const rawT0 = t.length > 0 ? t[0] : null;
    const minTime = intersectionXMin ?? rawT0;

    // Обновляем сигналы с учетом сдвигов
    const shiftedTenz = tenz.map((val) => val + tenzOffset);
    const shiftedInterf = interfCorrected.map((val) => val + interfOffset);

    // Пересчитываем пересечения
    const newIntersections = [];
    for (let i = 1; i < interfCorrected.length; i++) {
      const diffPrev = shiftedTenz[i - 1] - shiftedInterf[i - 1];
      const diffCurr = shiftedTenz[i] - shiftedInterf[i];

      if ((diffPrev <= 0 && diffCurr > 0) || (diffPrev >= 0 && diffCurr < 0)) {
        const t1 = t[i - 1];
        const t2 = t[i];
        const diffDelta = diffCurr - diffPrev;

        if (diffDelta === 0) continue;

        const ratio = -diffPrev / diffDelta;
        const time = t1 + ratio * (t2 - t1);

        if (typeof minTime === "number" && time < minTime) {
          continue;
        }
        const tenzValue =
          shiftedTenz[i - 1] + ratio * (shiftedTenz[i] - shiftedTenz[i - 1]);
        const interfValue =
          shiftedInterf[i - 1] + ratio * (shiftedInterf[i] - shiftedInterf[i - 1]);
        const value = (tenzValue + interfValue) / 2;

        newIntersections.push({ time, value });
      }
    }

    // Фильтруем пересечения по минимальному времени
    let intersectionsForPlot =
      typeof minTime === "number"
        ? newIntersections.filter((p) => p.time >= minTime)
        : [...newIntersections];

    intersectionsForPlot = filterCloseIntersections(intersectionsForPlot);

    // Обновляем состояние для таблицы пересечений
    setCurrentIntersections(intersectionsForPlot);

    // ---------------- Расчет скорости и перемещения от точек пересечения ----------------
    // Алгоритм как в Octave-скрипте, но используем точки пересечения вместо нулей интерфера
    const velocityPoints = [];
    const displacementPoints = [];

    if (intersectionsForPlot.length > 0) {
      // Параметры как в Octave-скрипте
      const lambda = 0.63e-6;              // 0.63 мкм
      const du = lambda / 4;               // аналог 0.63/4*10^(-6)

      const sortedIntersections = intersectionsForPlot;

      let u = 0;

      // Сначала рассчитываем все скорости для определения медианы и порога выбросов
      const rawVelocities = [];
      for (let i = 1; i < sortedIntersections.length; i++) {
        const dtVal = sortedIntersections[i].time - sortedIntersections[i - 1].time;
        if (!isFinite(dtVal) || dtVal <= 0) {
          rawVelocities.push(null);
        } else {
          rawVelocities.push(du / dtVal);
        }
      }

      // Определяем порог для выбросов: медиана * 5
      const validVelocities = rawVelocities.filter(v => v !== null && isFinite(v));
      let velocityThreshold = Infinity;
      if (validVelocities.length > 2) {
        const sorted = [...validVelocities].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        velocityThreshold = Math.max(median * 5, 1); // минимум 1 м/с порог
      }

      for (let i = 0; i < sortedIntersections.length; i++) {
        const intersectionTime = sortedIntersections[i].time;

        if (i === 0) {
          // Первая точка: начинаем от нуля
          u = 0;
          displacementPoints.push({ time: intersectionTime, value: u });
          velocityPoints.push({ time: intersectionTime, value: 0 });
        } else {
          const v = rawVelocities[i - 1];
          if (v === null || !isFinite(v)) continue;

          // Пропускаем выбросы скорости
          if (Math.abs(v) > velocityThreshold) continue;

          // Увеличиваем перемещение на фиксированный шаг и считаем скорость
          u = u + du;
          const v_val = v;

          displacementPoints.push({ time: intersectionTime, value: u });
          velocityPoints.push({ time: intersectionTime, value: v_val });
        }
      }
    }

    // Маркеры для точек пересечения - оптимизированная версия
    // Используем прямое сопоставление вместо поиска, так как точки пересечения
    // соответствуют точкам в velocityPoints/displacementPoints
    const markerVelocities = [];
    const markerDisplacements = [];
    
    // Создаем Map для быстрого поиска (O(1) вместо O(log n))
    const velocityMap = new Map(velocityPoints.map(p => [p.time, p.value]));
    const displacementMap = new Map(displacementPoints.map(p => [p.time, p.value]));
    
    for (const point of intersectionsForPlot) {
      // Маркер скорости — только если точка реально есть в данных скорости
      if (velocityMap.has(point.time)) {
        markerVelocities.push({ time: point.time, value: velocityMap.get(point.time) });
      }
      // Маркер перемещения — только если точка реально есть в данных перемещения
      if (displacementMap.has(point.time)) {
        markerDisplacements.push({ time: point.time, value: displacementMap.get(point.time) });
      }
    }

    // ---------------- Поиск экстремумов интерферограммы ----------------
    // Подход: между каждыми двумя соседними нулевыми пересечениями
    // интерферограммы есть ровно один экстремум (пик или впадина).
    const shiftedInterfFull = interfCorrected.map((val) => val + interfOffset);

    // 1. Находим нулевые пересечения сдвинутого интерферосигнала
    const zeroCrossings = []; // индексы, где сигнал меняет знак
    for (let i = 1; i < shiftedInterfFull.length; i++) {
      if (shiftedInterfFull[i - 1] * shiftedInterfFull[i] < 0) {
        zeroCrossings.push(i);
      }
    }

    // 2. Между каждой парой нулевых пересечений ищем max или min
    const finalExtremums = [];
    for (let z = 0; z < zeroCrossings.length - 1; z++) {
      const startIdx = zeroCrossings[z];
      const endIdx = zeroCrossings[z + 1];

      // Находим индекс с максимальным абсолютным значением в этом сегменте
      let bestIdx = startIdx;
      let bestAbsVal = Math.abs(shiftedInterfFull[startIdx]);
      for (let j = startIdx + 1; j < endIdx; j++) {
        const absVal = Math.abs(shiftedInterfFull[j]);
        if (absVal > bestAbsVal) {
          bestAbsVal = absVal;
          bestIdx = j;
        }
      }

      // Определяем тип: max (положительный) или min (отрицательный)
      const type = shiftedInterfFull[bestIdx] > 0 ? "max" : "min";

      // Используем точные значения сэмплов (без интерполяции),
      // чтобы точки точно совпадали с отображаемой линией графика
      const peakTime = t[bestIdx];
      const peakValue = shiftedInterfFull[bestIdx];

      // Фильтр по времени
      if (typeof minTime === "number" && peakTime < minTime) continue;

      finalExtremums.push({ time: peakTime, value: peakValue, type });
    }

    setExtremumPoints(finalExtremums);

    setVelocitySeries(velocityPoints);
    setDisplacementSeries(displacementPoints);
    setVelocityMarkers(markerVelocities);
    setDisplacementMarkers(markerDisplacements);
  }, [tenzOffset, interfOffset, intersectionXMin, data?.rawData]);

  // Мемоизация прореженных данных для оптимизации
  const downsampledData = useMemo(() => {
    if (!data?.rawData) return null;

    const { t, tenz, interfCorrected } = data.rawData;
    const maxPoints = 5000; // Увеличено для сохранения деталей пиков
    const step = Math.max(1, Math.floor(t.length / maxPoints));

    const downsampledT = [];
    const downsampledIndices = [];

    for (let i = 0; i < t.length; i += step) {
      downsampledT.push(t[i]);
      downsampledIndices.push(i);
    }

    return {
      t: downsampledT,
      indices: downsampledIndices,
      originalLength: t.length
    };
  }, [data?.rawData]);

  // Обновление графиков при изменении сдвигов сигналов
  useEffect(() => {
    if (!data?.rawData || !originalChartInstance.current || !downsampledData) {
      return;
    }

    const { t, tenz, interfCorrected } = data.rawData;
    const { t: downsampledT, indices } = downsampledData;

    // Обновляем сигналы с учетом сдвигов только для прореженных точек
    const tenzData = new Array(downsampledT.length);
    const interfDataBase = new Array(downsampledT.length);

    for (let i = 0; i < downsampledT.length; i++) {
      const idx = indices[i];
      tenzData[i] = { x: downsampledT[i], y: tenz[idx] + tenzOffset };
      interfDataBase[i] = { x: downsampledT[i], y: interfCorrected[idx] + interfOffset };
    }

    // Вставляем точки экстремумов в данные линии интерферограммы,
    // чтобы линия гарантированно проходила через пики и впадины
    let interfData = interfDataBase;
    if (extremumPoints.length > 0) {
      // Собираем Set времён прореженных точек для избежания дубликатов
      const existingTimes = new Set(downsampledT);
      const extraPoints = [];
      for (const ext of extremumPoints) {
        if (!existingTimes.has(ext.time)) {
          extraPoints.push({ x: ext.time, y: ext.value });
        }
      }
      if (extraPoints.length > 0) {
        interfData = [...interfDataBase, ...extraPoints].sort((a, b) => a.x - b.x);
      }
    }

    // Обновляем график исходных данных
    const originalChart = originalChartInstance.current;
    const tenzDatasetIndex = originalChart.data.datasets.findIndex(
      (ds) => ds.label === "Тензометрический сигнал (CH1)"
    );

    if (tenzDatasetIndex !== -1) {
      originalChart.data.datasets[tenzDatasetIndex].data = tenzData;
    }

    const interfDatasetIndex = originalChart.data.datasets.findIndex(
      (ds) => ds.label === "Интерферограмма (центр.)"
    );
    if (interfDatasetIndex !== -1) {
      originalChart.data.datasets[interfDatasetIndex].data = interfData;
    }

    // Обновляем пересечения на графике исходных данных
    const intersectionsForPlot = currentIntersections;
    
    // Обновляем датасет с intersectionMarker (если есть)
    const intersectionMarkerIndex = originalChart.data.datasets.findIndex(
      (ds) => ds.intersectionMarker
    );
    if (intersectionMarkerIndex !== -1) {
      originalChart.data.datasets[intersectionMarkerIndex].data = intersectionsForPlot.map(
        ({ time, value }) => ({ x: time, y: value })
      );
      
      // Обновляем метку с актуальным значением Y
      const avgY = intersectionsForPlot.length > 0
        ? intersectionsForPlot.reduce((acc, p) => acc + p.value, 0) / intersectionsForPlot.length
        : 0;
      originalChart.data.datasets[intersectionMarkerIndex].label = 
        `Пересечения при Y=${avgY.toFixed(4)}`;
    }
    
    // Обновляем обычный датасет пересечений на original графике
    const originalIntersectionDatasetIndex = originalChart.data.datasets.findIndex(
      (ds) => ds.label === "Пересечения тензо- и интерферосигнала"
    );
    if (originalIntersectionDatasetIndex !== -1) {
      originalChart.data.datasets[originalIntersectionDatasetIndex].data = intersectionsForPlot.map(
        ({ time, value }) => ({ x: time, y: value })
      );
    }

    // Обновляем/создаем датасеты экстремумов на original графике
    const maxPoints = extremumPoints.filter(p => p.type === "max");
    const minPoints = extremumPoints.filter(p => p.type === "min");

    const LABEL_MAX = "Максимумы интерферограммы";
    const LABEL_MIN = "Минимумы интерферограммы";

    let maxIdx = originalChart.data.datasets.findIndex(ds => ds.label === LABEL_MAX);
    let minIdx = originalChart.data.datasets.findIndex(ds => ds.label === LABEL_MIN);

    const maxData = showExtremumMax ? maxPoints.map(p => ({ x: p.time, y: p.value })) : [];
    const minData = showExtremumMin ? minPoints.map(p => ({ x: p.time, y: p.value })) : [];

    const maxDatasetDef = {
      label: LABEL_MAX,
      data: maxData,
      showLine: false,
      pointRadius: 3,
      pointHoverRadius: 5,
      borderWidth: 0,
      pointBorderWidth: 0,
      backgroundColor: "rgb(220, 38, 38)",
      pointBackgroundColor: "rgb(220, 38, 38)",
    };

    const minDatasetDef = {
      label: LABEL_MIN,
      data: minData,
      showLine: false,
      pointRadius: 3,
      pointHoverRadius: 5,
      borderWidth: 0,
      pointBorderWidth: 0,
      backgroundColor: "rgb(37, 99, 235)",
      pointBackgroundColor: "rgb(37, 99, 235)",
    };

    if (maxIdx !== -1) {
      originalChart.data.datasets[maxIdx].data = maxData;
    } else {
      originalChart.data.datasets.push(maxDatasetDef);
    }

    if (minIdx !== -1) {
      originalChart.data.datasets[minIdx].data = minData;
    } else {
      originalChart.data.datasets.push(minDatasetDef);
    }

    originalChart.update("none");
  }, [tenzOffset, interfOffset, currentIntersections, extremumPoints, showExtremumMax, showExtremumMin, data?.rawData, downsampledData]);

  const handleResetOriginal = useCallback(() => {
    const chart = originalChartInstance.current;
    if (!chart) return;

    if (chart.options?.scales?.x) {
      chart.options.scales.x.min = undefined;
      chart.options.scales.x.max = undefined;
    }

    chart.resetZoom();
    chart.update("none");
  }, []);

  const zoomChart = useCallback((chartRef, factor) => {
    chartRef.current?.zoom({ x: factor, y: factor });
  }, []);

  const handleZoomOriginalIn = useCallback(() => {
    zoomChart(originalChartInstance, ZOOM_STEP);
  }, [zoomChart]);

  const handleZoomOriginalOut = useCallback(() => {
    zoomChart(originalChartInstance, 1 / ZOOM_STEP);
  }, [zoomChart]);

  const handleAxisToggle = useCallback(
    (chartInstanceRef, label, visibilityState, setVisibilityState) => {
      const current = visibilityState[label] ?? true;
      const next = !current;

      setVisibilityState((prev) => ({
        ...prev,
        [label]: next,
      }));

      const chart = chartInstanceRef.current;
      if (!chart) return;

      const datasetIndex = chart.data.datasets.findIndex(
        (dataset) => dataset.label === label
      );

      if (datasetIndex === -1) return;

      chart.setDatasetVisibility(datasetIndex, next);
      chart.update("none");
    },
    []
  );

  const originalAxisOptions = useMemo(() => {
    return (data?.original ?? [])
      .filter((dataset) => !dataset.intersectionMarker)
      .map((dataset) => ({
        label: dataset.label,
        color: dataset.borderColor,
      }));
  }, [data]);

  // Pre-built Maps для O(1) поиска в таблице (вместо binary search на каждую строку)
  const velocityMap = useMemo(
    () => new Map(velocitySeries.map(p => [p.time, p.value])),
    [velocitySeries]
  );
  const displacementMap = useMemo(
    () => new Map(displacementSeries.map(p => [p.time, p.value])),
    [displacementSeries]
  );

  // Вычисляем среднее значение Y для пересечений
  const averageY = useMemo(() => {
    if (currentIntersections.length === 0) return 0;
    const sum = currentIntersections.reduce((acc, point) => acc + point.value, 0);
    return sum / currentIntersections.length;
  }, [currentIntersections]);

  const intersectionDataset = useMemo(() => {
    const dataset = (data?.original ?? []).find(
      (dataset) => dataset.intersectionMarker
    );
    if (dataset) {
      return {
        ...dataset,
        label: `Пересечения при Y=${averageY.toFixed(4)}`,
      };
    }
    return dataset;
  }, [data, averageY]);

  const handleIntersectionToggle = useCallback(() => {
    const next = !intersectionVisibility;
    setIntersectionVisibility(next);

    const chart = originalChartInstance.current;
    if (!chart || !intersectionDataset) return;

    const datasetIndex = chart.data.datasets.findIndex(
      (dataset) => dataset.intersectionMarker
    );

    if (datasetIndex === -1) return;

    chart.setDatasetVisibility(datasetIndex, next);
    chart.update("none");
  }, [intersectionVisibility, intersectionDataset]);

  // Определяем диапазон для сдвига
  const offsetRange = useMemo(() => {
    if (!data?.rawData?.tenz) {
      return { min: -1, max: 1, step: 0.001 };
    }
    const values = data.rawData.tenz;
    let lo = values[0], hi = values[0];
    for (let i = 1; i < values.length; i++) {
      if (values[i] < lo) lo = values[i];
      if (values[i] > hi) hi = values[i];
    }
    const range = hi - lo;
    return {
      min: -range,
      max: range,
      step: range / 1000,
    };
  }, [data?.rawData]);

  const interfOffsetRange = useMemo(() => {
    if (!data?.rawData?.interfCorrected) {
      return { min: -1, max: 1, step: 0.001 };
    }
    const values = data.rawData.interfCorrected;
    let lo = values[0], hi = values[0];
    for (let i = 1; i < values.length; i++) {
      if (values[i] < lo) lo = values[i];
      if (values[i] > hi) hi = values[i];
    }
    const safeRange = (hi - lo) || 1;
    return {
      min: -safeRange,
      max: safeRange,
      step: safeRange / 1000,
    };
  }, [data?.rawData]);

  const intersectionXRange = useMemo(() => {
    if (!data?.rawData?.t || data.rawData.t.length === 0) {
      return { min: 0, max: 1, step: 0.001 };
    }
    const tArr = data.rawData.t;
    const min = tArr[0];
    const max = tArr[tArr.length - 1];
    const span = max - min || 1;
    return {
      min,
      max,
      step: span / 1000,
    };
  }, [data?.rawData]);

  return (
    <div className="charts-wrapper">
      {/* Сдвиг тензосигнала убран по запросу */}
      {data?.rawData && (
        <div className="tenz-offset-control">
          <label htmlFor="intersection-xmin-input" className="tenz-offset-label">
            Минимальное время для поиска пересечений (ось X):
          </label>
          <div className="tenz-offset-input-group">
            <input
              id="intersection-xmin-input"
              type="range"
              min={intersectionXRange.min}
              max={intersectionXRange.max}
              step={intersectionXRange.step}
              value={intersectionXMin ?? intersectionXRange.min}
              onChange={(e) =>
                setIntersectionXMin(parseFloat(e.target.value))
              }
              className="tenz-offset-slider"
            />
            <input
              type="number"
              min={intersectionXRange.min}
              max={intersectionXRange.max}
              step={intersectionXRange.step}
              value={intersectionXMin ?? intersectionXRange.min}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                if (Number.isNaN(val)) {
                  setIntersectionXMin(null);
                } else {
                  setIntersectionXMin(val);
                }
              }}
              className="tenz-offset-number"
            />
            <button
              type="button"
              className="tenz-offset-reset-btn"
              onClick={() => setIntersectionXMin(null)}
              aria-label="Сбросить минимальное время пересечений"
            >
              Сбросить
            </button>
          </div>
        </div>
      )}
      {data?.rawData && (
        <div className="tenz-offset-control">
          <label htmlFor="interf-offset-input" className="tenz-offset-label">
            Сдвиг интерферосигнала по оси Y:
          </label>
          <div className="tenz-offset-input-group">
            <input
              id="interf-offset-input"
              type="range"
              min={interfOffsetRange.min}
              max={interfOffsetRange.max}
              step={interfOffsetRange.step}
              value={interfOffset}
              onChange={(e) => setInterfOffset(parseFloat(e.target.value))}
              className="tenz-offset-slider"
            />
            <input
              type="number"
              min={interfOffsetRange.min}
              max={interfOffsetRange.max}
              step={interfOffsetRange.step}
              value={interfOffset}
              onChange={(e) =>
                setInterfOffset(parseFloat(e.target.value) || 0)
              }
              className="tenz-offset-number"
            />
            <button
              type="button"
              className="tenz-offset-reset-btn"
              onClick={() => setInterfOffset(0)}
              aria-label="Сбросить сдвиг интерферосигнала"
            >
              Сбросить
            </button>
          </div>
        </div>
      )}
      <section className="chart-section">
        <div className="chart-controls-group">
          <div className="zoom-controls" role="group" aria-label="Управление масштабом">
            <button
              type="button"
              className="zoom-control-btn"
              onClick={handleZoomOriginalOut}
              aria-label="Уменьшить масштаб"
            >
              -
            </button>
            <button
              type="button"
              className="zoom-control-btn"
              onClick={handleZoomOriginalIn}
              aria-label="Увеличить масштаб"
            >
              +
            </button>
            <button
              type="button"
              className="zoom-reset-btn"
              onClick={handleResetOriginal}
              aria-label="Сбросить масштаб"
            >
              ↺ Сбросить
            </button>
          </div>
        </div>
        {originalAxisOptions.length > 0 && (
          <div
            className="axis-toggle-group"
            role="group"
            aria-label="Отображение осей исходных сигналов"
          >
            {originalAxisOptions.map(({ label, color }) => {
              const isActive = originalAxisVisibility[label] ?? true;
              return (
                <button
                  key={label}
                  type="button"
                  className={`axis-toggle-btn ${
                    isActive ? "axis-toggle-btn--active" : ""
                  }`}
                  onClick={() =>
                    handleAxisToggle(
                      originalChartInstance,
                      label,
                      originalAxisVisibility,
                      setOriginalAxisVisibility
                    )
                  }
                  aria-pressed={isActive}
                >
                  <span
                    className="axis-toggle-btn__indicator"
                    style={{
                      borderColor: color,
                      backgroundColor: isActive ? color : "transparent",
                    }}
                    aria-hidden="true"
                  />
                  <span className="axis-toggle-btn__label">{label}</span>
                </button>
              );
            })}
            {intersectionDataset && (
              <button
                type="button"
                className={`axis-toggle-btn ${
                  intersectionVisibility ? "axis-toggle-btn--active" : ""
                }`}
                onClick={handleIntersectionToggle}
                aria-pressed={intersectionVisibility}
              >
                <span
                  className="axis-toggle-btn__indicator"
                  style={{
                    borderColor: "#000000",
                    backgroundColor: intersectionVisibility
                      ? "#000000"
                      : "transparent",
                  }}
                  aria-hidden="true"
                />
                <span className="axis-toggle-btn__label">
                  {intersectionDataset.label}
                </span>
              </button>
            )}
            {extremumPoints.length > 0 && (
              <button
                type="button"
                className={`axis-toggle-btn ${showExtremumMax ? "axis-toggle-btn--active" : ""}`}
                onClick={() => setShowExtremumMax(v => !v)}
                aria-pressed={showExtremumMax}
              >
                <span
                  className="axis-toggle-btn__indicator"
                  style={{
                    borderColor: "rgb(220, 38, 38)",
                    backgroundColor: showExtremumMax ? "rgb(220, 38, 38)" : "transparent",
                  }}
                  aria-hidden="true"
                />
                <span className="axis-toggle-btn__label">Максимумы</span>
              </button>
            )}
            {extremumPoints.length > 0 && (
              <button
                type="button"
                className={`axis-toggle-btn ${showExtremumMin ? "axis-toggle-btn--active" : ""}`}
                onClick={() => setShowExtremumMin(v => !v)}
                aria-pressed={showExtremumMin}
              >
                <span
                  className="axis-toggle-btn__indicator"
                  style={{
                    borderColor: "rgb(37, 99, 235)",
                    backgroundColor: showExtremumMin ? "rgb(37, 99, 235)" : "transparent",
                  }}
                  aria-hidden="true"
                />
                <span className="axis-toggle-btn__label">Минимумы</span>
              </button>
            )}
          </div>
        )}
        <div className="chart-canvas-wrapper chart-canvas-wrapper--main">
          <canvas ref={originalChartRef}></canvas>
        </div>
      </section>

      {velocitySeries.length > 0 && (
        <section className="chart-section">
          <div className="chart-canvas-wrapper chart-canvas-wrapper--secondary">
            <canvas ref={velocityChartRef}></canvas>
          </div>
        </section>
      )}

      {displacementSeries.length > 0 && (
        <section className="chart-section">
          <div className="chart-canvas-wrapper chart-canvas-wrapper--secondary">
            <canvas ref={displacementChartRef}></canvas>
          </div>
        </section>
      )}

      {currentIntersections.length > 0 && (
        <aside className="intersection-panel">
          <div className="intersection-panel__header">
            <span className="chart-chip chart-chip--highlight">
              Пересечения при Y = {averageY.toFixed(4)}
            </span>
            <p>Общие точки тензо- и интерферосигнала</p>
          </div>
          <div className="intersection-table-wrapper">
            <table className="intersection-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Время (с)</th>
                  <th>Скорость (м/с)</th>
                  <th>Перемещение (м)</th>
                </tr>
              </thead>
              <tbody>
                {currentIntersections.map((point, idx) => (
                    <tr key={`${point.time}-${idx}`}>
                      <td>{idx + 1}</td>
                      <td>{formatTime(point.time)}</td>
                      <td>{formatSpeed(velocityMap.get(point.time) ?? null)}</td>
                      <td>{formatDisplacement(displacementMap.get(point.time) ?? null)}</td>
                    </tr>
                ))}
              </tbody>
            </table>
          </div>
        </aside>
      )}
      {extremumPoints.length > 0 && (
        <aside className="intersection-panel">
          <div className="intersection-panel__header">
            <span className="chart-chip" style={STYLE_EXTREMUM_HEADER}>
              Экстремумы интерферограммы ({extremumPoints.length})
            </span>
            <p>Точки максимумов и минимумов интерферосигнала</p>
          </div>
          <div className="intersection-table-wrapper">
            <table className="intersection-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Тип</th>
                  <th>Время (с)</th>
                  <th>Значение (В)</th>
                </tr>
              </thead>
              <tbody>
                {extremumPoints.map((point, idx) => (
                  <tr key={`ext-${point.time}-${idx}`}>
                    <td>{idx + 1}</td>
                    <td style={point.type === "max" ? STYLE_EXTREMUM_MAX : STYLE_EXTREMUM_MIN}>
                      {point.type === "max" ? "MAX" : "MIN"}
                    </td>
                    <td>{formatTime(point.time)}</td>
                    <td>{formatSignal(point.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </aside>
      )}
    </div>
  );
});

export default ChartComponent;
