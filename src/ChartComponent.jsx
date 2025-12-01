import React, { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { Chart, registerables } from "chart.js";
import zoomPlugin from "chartjs-plugin-zoom";

const intersectionMarkerPlugin = {
  id: "intersectionMarker",
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    chart.data.datasets.forEach((dataset, datasetIndex) => {
      if (!dataset?.intersectionMarker) return;

      const meta = chart.getDatasetMeta(datasetIndex);
      if (!chart.isDatasetVisible(datasetIndex)) return;

      meta.data.forEach((element) => {
        // Используем точные координаты элемента после всех трансформаций
        const x = element.x;
        const y = element.y;
        
        // Проверяем, что элемент видим на canvas
        if (x === undefined || y === undefined || isNaN(x) || isNaN(y)) return;
        
        const size = dataset.markerSize ?? 6;

        ctx.save();
        ctx.strokeStyle = dataset.markerColor ?? "#000000";
        ctx.globalAlpha = dataset.markerAlpha ?? 0.8;
        ctx.lineWidth = dataset.markerLineWidth ?? 2;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(x - size, y - size);
        ctx.lineTo(x + size, y + size);
        ctx.moveTo(x - size, y + size);
        ctx.lineTo(x + size, y - size);
        ctx.stroke();
        ctx.restore();
      });
    });
  },
};

Chart.register(...registerables, zoomPlugin, intersectionMarkerPlugin);

const ZOOM_STEP = 1.25;

const ChartComponent = ({ data }) => {
  const originalChartRef = useRef(null);
  const velocityChartRef = useRef(null);
  const displacementChartRef = useRef(null);
  const originalChartInstance = useRef(null);
  const velocityChartInstance = useRef(null);
  const displacementChartInstance = useRef(null);
  const intersections = data?.intersections ?? [];
  const [originalAxisVisibility, setOriginalAxisVisibility] = useState({});
  const [intersectionVisibility, setIntersectionVisibility] = useState(true);
  const [tenzOffset, setTenzOffset] = useState(0); // Сдвиг тензосигнала по Y
  const [interfOffset, setInterfOffset] = useState(0); // Сдвиг интерферосигнала по Y
  const [currentIntersections, setCurrentIntersections] = useState([]); // Текущие пересечения
  const [intersectionXMin, setIntersectionXMin] = useState(null); // Минимальное время для поиска пересечений
  const [velocitySeries, setVelocitySeries] = useState([]);
  const [displacementSeries, setDisplacementSeries] = useState([]);
  const [velocityMarkers, setVelocityMarkers] = useState([]);
  const [displacementMarkers, setDisplacementMarkers] = useState([]);
  // Используем СИ для He-Ne лазера (632.8 нм)
  const useSIUnits = true;
  const wavelength = 632.8e-9; // Длина волны He-Ne лазера в метрах
  const interfCenterPoint = data?.focusPoints?.interfCenter;

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

  const getSeriesValueAtTime = (series, time) => {
    if (!Array.isArray(series) || series.length === 0 || typeof time !== "number") {
      return null;
    }

    if (time <= series[0].time) return series[0].value;
    for (let i = 1; i < series.length; i++) {
      const prev = series[i - 1];
      const curr = series[i];
      if (time <= curr.time) {
        const dt = curr.time - prev.time;
        if (dt === 0) return curr.value;
        const ratio = (time - prev.time) / dt;
        return prev.value + ratio * (curr.value - prev.value);
      }
    }

    return series[series.length - 1].value;
  };

  useEffect(() => {
    if (!data) return;

    const buildOptions = (title, yLabel) => ({
      responsive: true,
      interaction: {
        mode: "index",
        intersect: false,
      },
      scales: {
        x: {
          type: "linear",
          title: {
            display: true,
            text: "Время (секунды)",
          },
        },
        y: {
          type: "linear",
          title: {
            display: true,
            text: yLabel,
          },
        },
      },
      plugins: {
        title: {
          display: true,
          text: title,
        },
        legend: {
          display: true,
        },
        tooltip: {
          enabled: true,
          callbacks: {
            label: function(context) {
              const point = context.raw;
              let xValue, yValue;
              
              if (typeof point.x === 'number') {
                // Форматируем время: если очень маленькое, используем экспоненциальную форму
                if (Math.abs(point.x) < 0.001 || Math.abs(point.x) >= 1000) {
                  xValue = point.x.toExponential(4) + ' с';
                } else {
                  xValue = point.x.toFixed(6) + ' с';
                }
              } else {
                xValue = point.x;
              }
              
              if (typeof point.y === 'number') {
                yValue = point.y.toFixed(6);
              } else {
                yValue = point.y;
              }
              
              return [
                `${context.dataset.label || ''}`,
                `X: ${xValue}`,
                `Y: ${yValue}`
              ];
            },
          },
        },
        zoom: {
          pan: {
            enabled: true,
            mode: "xy",
          },
          zoom: {
            wheel: {
              enabled: true,
              modifierKey: "ctrl",
            },
            pinch: {
              enabled: true,
            },
            drag: {
              enabled: false,
            },
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
          : base;
      setCurrentIntersections(filtered);
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
              label: "Скорость в точках пересечений",
              data: velocitySeries.map((p) => ({ x: p.time, y: p.value })),
              borderColor: "rgb(34,197,94)",
              backgroundColor: "rgba(34,197,94,0.25)",
              showLine: true,
              pointRadius: 0, // Скрываем точки для более плавного вида
              pointHoverRadius: 4,
              tension: 0.4, // Сглаживание кривой (0-1, больше = плавнее)
              cubicInterpolationMode: 'monotone', // Плавная интерполяция
              borderWidth: 2,
            },
            {
              label: "Скорость (точки пересечений)",
              data: velocityMarkers.map((p) => ({ x: p.time, y: p.value })),
              borderColor: "rgb(34,197,94)",
              backgroundColor: "rgba(34,197,94,0.9)",
              showLine: false,
              pointRadius: 4,
              pointHoverRadius: 6,
              pointBackgroundColor: "rgb(34,197,94)",
              pointBorderColor: "#fff",
              borderWidth: 0,
            },
          ],
        },
        options: {
          responsive: true,
          interaction: { mode: "index", intersect: false },
          scales: {
            x: { type: "linear", title: { display: true, text: "Время (секунды)" } },
            y: { type: "linear", title: { display: true, text: yLabel } },
          },
          plugins: {
            zoom: {
              pan: {
                enabled: true,
                mode: "xy",
              },
              zoom: {
                wheel: {
                  enabled: true,
                  modifierKey: "ctrl",
                },
                pinch: {
                  enabled: true,
                },
                drag: {
                  enabled: false,
                },
                mode: "xy",
              },
            },
            tooltip: {
              enabled: true,
              callbacks: {
                label: function (context) {
                  const point = context.raw;
                  const t = typeof point.x === "number"
                    ? `${point.x.toExponential(4)} с`
                    : point.x;
                  const v = typeof point.y === "number"
                    ? `${point.y.toExponential(4)} ${tooltipUnit}`
                    : point.y;
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
              label: "Перемещение в точках пересечений",
              data: displacementSeries.map((p) => ({ x: p.time, y: p.value })),
              borderColor: "rgb(59,130,246)",
              backgroundColor: "rgba(59,130,246,0.25)",
              showLine: true,
              pointRadius: 0, // Скрываем точки для более плавного вида
              pointHoverRadius: 4,
              tension: 0.4, // Сглаживание кривой (0-1, больше = плавнее)
              cubicInterpolationMode: 'monotone', // Плавная интерполяция
              borderWidth: 2,
            },
            {
              label: "Перемещение (точки пересечений)",
              data: displacementMarkers.map((p) => ({ x: p.time, y: p.value })),
              borderColor: "rgb(59,130,246)",
              backgroundColor: "rgba(59,130,246,0.9)",
              showLine: false,
              pointRadius: 4,
              pointHoverRadius: 6,
              pointBackgroundColor: "rgb(59,130,246)",
              pointBorderColor: "#fff",
              borderWidth: 0,
            },
          ],
        },
        options: {
          responsive: true,
          interaction: { mode: "index", intersect: false },
          scales: {
            x: { type: "linear", title: { display: true, text: "Время (секунды)" } },
            y: { type: "linear", title: { display: true, text: yLabel } },
          },
          plugins: {
            zoom: {
              pan: {
                enabled: true,
                mode: "xy",
              },
              zoom: {
                wheel: {
                  enabled: true,
                  modifierKey: "ctrl",
                },
                pinch: {
                  enabled: true,
                },
                drag: {
                  enabled: false,
                },
                mode: "xy",
              },
            },
            tooltip: {
              enabled: true,
              callbacks: {
                label: function (context) {
                  const point = context.raw;
                  const t = typeof point.x === "number"
                    ? `${point.x.toExponential(4)} с`
                    : point.x;
                  const s = typeof point.y === "number"
                    ? `${point.y.toExponential(4)} ${tooltipUnit}`
                    : point.y;
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

  // Обновление графиков при изменении сдвигов сигналов
  useEffect(() => {
    if (!data?.rawData || !originalChartInstance.current) {
      return;
    }

    const { t, tenz, interfCorrected, dudt_interf } = data.rawData;

    const rawT0 = t.length > 0 ? t[0] : null;
    const minTime = intersectionXMin ?? rawT0;

    // Обновляем сигналы с учетом сдвигов
    const shiftedTenz = tenz.map((val) => val + tenzOffset);
    const shiftedInterf = interfCorrected.map((val) => val + interfOffset);
    
    // Обновляем график исходных данных
    const originalChart = originalChartInstance.current;
    const tenzDatasetIndex = originalChart.data.datasets.findIndex(
      (ds) => ds.label === "Тензометрический сигнал (CH1)"
    );

    if (tenzDatasetIndex !== -1) {
      originalChart.data.datasets[tenzDatasetIndex].data = t.map((time, idx) => ({
        x: time,
        y: shiftedTenz[idx],
      }));
    }

    const interfDatasetIndex = originalChart.data.datasets.findIndex(
      (ds) => ds.label === "Интерф центрированный"
    );
    if (interfDatasetIndex !== -1) {
      originalChart.data.datasets[interfDatasetIndex].data = t.map((time, idx) => ({
        x: time,
        y: shiftedInterf[idx],
      }));
    }

    // Пересчитываем пересечения
    const newIntersections = [];
    const yThreshold = 0.02;
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

        if (Math.abs(value) <= yThreshold) {
          newIntersections.push({ time, value });
        }
      }
    }

    // Фильтруем пересечения по минимальному времени (на всякий случай)
    const intersectionsForPlot =
      typeof minTime === "number"
        ? newIntersections.filter((p) => p.time >= minTime)
        : newIntersections;

    // Обновляем пересечения на графике исходных данных
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
      (ds) => ds.label === "Пересечения тензо и интерф"
    );
    if (originalIntersectionDatasetIndex !== -1) {
      originalChart.data.datasets[originalIntersectionDatasetIndex].data = intersectionsForPlot.map(
        ({ time, value }) => ({ x: time, y: value })
      );
    }

    // Обновляем состояние для таблицы пересечений
    setCurrentIntersections(intersectionsForPlot);

    // Пересчёт скорости и перемещения с использованием всех точек данных для плавных графиков
    // Пересчет в СИ для He-Ne лазера (632.8 нм)
    // Для интерферометра: один период интерференции = λ/2 перемещения
    // Коэффициент преобразования: λ/2 (предполагаем, что амплитуда периода ≈ 1 В)
    const conversionFactor = wavelength / 2; // λ/2 для He-Ne = 316.4 нм
    const velocityPoints = [];
    const displacementPoints = [];

    if (
      Array.isArray(intersectionsForPlot) &&
      intersectionsForPlot.length > 0 &&
      Array.isArray(dudt_interf) &&
      dudt_interf.length === t.length
    ) {
      // Определяем диапазон времени для расчета
      const firstIntersectionTime = intersectionsForPlot[0].time;
      const lastIntersectionTime = intersectionsForPlot[intersectionsForPlot.length - 1].time;
      const effectiveMinTime = typeof minTime === "number" ? Math.max(minTime, firstIntersectionTime) : firstIntersectionTime;

      // Используем все точки данных в диапазоне между пересечениями
      let disp = 0;
      let lastVel = 0;
      let lastTime = null;

      for (let i = 0; i < t.length; i++) {
        if (t[i] < effectiveMinTime || t[i] > lastIntersectionTime) {
          continue;
        }

        const currentTime = t[i];
        const v = dudt_interf[i] ?? 0;
        
        // Пересчет скорости в м/с: В/с * (λ/2)
        const vSI = v * conversionFactor;
        velocityPoints.push({ time: currentTime, value: vSI });

        // Интегрируем для перемещения (метод трапеций)
        if (lastTime !== null) {
          const dt = currentTime - lastTime;
          disp += 0.5 * (v + lastVel) * dt;
        }
        
        // Пересчет перемещения в м: усл. ед. * (λ/2)
        const dispSI = disp * conversionFactor;
        displacementPoints.push({ time: currentTime, value: dispSI });

        lastTime = currentTime;
        lastVel = v;
      }
    }

    const markerVelocities = intersectionsForPlot.map((point) => ({
      time: point.time,
      value: getSeriesValueAtTime(velocityPoints, point.time),
    }));

    const markerDisplacements = intersectionsForPlot.map((point) => ({
      time: point.time,
      value: getSeriesValueAtTime(displacementPoints, point.time),
    }));

    setVelocitySeries(velocityPoints);
    setDisplacementSeries(displacementPoints);
    setVelocityMarkers(markerVelocities);
    setDisplacementMarkers(markerDisplacements);

    originalChart.update("none");
  }, [tenzOffset, interfOffset, intersectionXMin, data?.rawData]);

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
    const range = Math.max(...values) - Math.min(...values);
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
    const range = Math.max(...values) - Math.min(...values);
    const safeRange = range || 1;
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
      {data?.rawData && (
        <div className="tenz-offset-control">
          <label htmlFor="tenz-offset-input" className="tenz-offset-label">
            Сдвиг тензометрического сигнала (CH1) по оси Y:
          </label>
          <div className="tenz-offset-input-group">
            <input
              id="tenz-offset-input"
              type="range"
              min={offsetRange.min}
              max={offsetRange.max}
              step={offsetRange.step}
              value={tenzOffset}
              onChange={(e) => setTenzOffset(parseFloat(e.target.value))}
              className="tenz-offset-slider"
            />
            <input
              type="number"
              min={offsetRange.min}
              max={offsetRange.max}
              step={offsetRange.step}
              value={tenzOffset}
              onChange={(e) =>
                setTenzOffset(parseFloat(e.target.value) || 0)
              }
              className="tenz-offset-number"
            />
            <button
              type="button"
              className="tenz-offset-reset-btn"
              onClick={() => setTenzOffset(0)}
              aria-label="Сбросить сдвиг"
            >
              Сбросить
            </button>
          </div>
        </div>
      )}
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
          </div>
        )}
        <canvas ref={originalChartRef} width="800" height="400"></canvas>
      </section>

      {velocitySeries.length > 0 && (
        <section className="chart-section">
          <h3>Скорость от времени</h3>
          <canvas ref={velocityChartRef} width="800" height="280"></canvas>
        </section>
      )}

      {displacementSeries.length > 0 && (
        <section className="chart-section">
          <h3>Перемещение от времени</h3>
          <canvas ref={displacementChartRef} width="800" height="280"></canvas>
        </section>
      )}

      {currentIntersections.length > 0 && (
        <aside className="intersection-panel">
          <div className="intersection-panel__header">
            <span className="chart-chip chart-chip--highlight">
              Пересечения Y={averageY.toFixed(4)}
            </span>
            <p>Общие точки tензо и интерферосигнала</p>
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
                {currentIntersections.map((point, idx) => {
                  const speedValue = getSeriesValueAtTime(velocitySeries, point.time);
                  const displacementValue = getSeriesValueAtTime(displacementSeries, point.time);
                  return (
                    <tr key={`${point.time}-${idx}`}>
                      <td>{idx + 1}</td>
                      <td>{formatTime(point.time)}</td>
                      <td>{formatSpeed(speedValue)}</td>
                      <td>{formatDisplacement(displacementValue)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </aside>
      )}
    </div>
  );
};

export default ChartComponent;
