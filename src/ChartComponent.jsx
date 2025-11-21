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
  const processedChartRef = useRef(null);
  const originalChartInstance = useRef(null);
  const processedChartInstance = useRef(null);
  const intersections = data?.intersections ?? [];
  const [originalAxisVisibility, setOriginalAxisVisibility] = useState({});
  const [processedAxisVisibility, setProcessedAxisVisibility] = useState({});
  const [intersectionVisibility, setIntersectionVisibility] = useState(true);
  const [tenzOffset, setTenzOffset] = useState(0); // Сдвиг тензосигнала по Y
  const [interfOffset, setInterfOffset] = useState(0); // Сдвиг интерферосигнала по Y
  const [currentIntersections, setCurrentIntersections] = useState([]); // Текущие пересечения
  const interfCenterPoint = data?.focusPoints?.interfCenter;

  const formatTime = (value) => {
    if (typeof value !== "number") return "-";
    return value.toExponential(3);
  };

  const formatSignal = (value) => {
    if (typeof value !== "number") return "-";
    return value.toFixed(5);
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

    if (processedChartInstance.current) {
      processedChartInstance.current.destroy();
      processedChartInstance.current = null;
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

    // График обработанных данных
    if (processedChartRef.current) {
      const ctx = processedChartRef.current.getContext("2d");
      processedChartInstance.current = new Chart(ctx, {
        type: "line",
        data: {
          datasets: data.processed,
        },
        options: buildOptions("Обработанные сигналы", "Сигнал"),
      });
    }

    return () => {
      if (originalChartInstance.current) {
        originalChartInstance.current.destroy();
        originalChartInstance.current = null;
      }
      if (processedChartInstance.current) {
        processedChartInstance.current.destroy();
        processedChartInstance.current = null;
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
      const visibilityMap = {};
      data.original.forEach((dataset) => {
        if (dataset.intersectionMarker) return;
        visibilityMap[dataset.label] = true;
      });
      setOriginalAxisVisibility(visibilityMap);
    }

    if (data?.processed) {
      const visibilityMap = {};
      data.processed.forEach((dataset) => {
        if (dataset?.intersectionMarker) return;
        visibilityMap[dataset.label] = true;
      });
      setProcessedAxisVisibility(visibilityMap);
    }

    // Инициализируем текущие пересечения
    if (data?.intersections) {
      setCurrentIntersections(data.intersections);
    }
  }, [data]);

  // Обновление графиков при изменении сдвигов сигналов
  useEffect(() => {
    if (
      !data?.rawData ||
      !originalChartInstance.current ||
      !processedChartInstance.current
    ) {
      return;
    }

    const { t, tenz, interfCorrected } = data.rawData;

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

    // Обновляем пересечения на графике исходных данных
    // Обновляем датасет с intersectionMarker (если есть)
    const intersectionMarkerIndex = originalChart.data.datasets.findIndex(
      (ds) => ds.intersectionMarker
    );
    if (intersectionMarkerIndex !== -1) {
      originalChart.data.datasets[intersectionMarkerIndex].data = newIntersections.map(
        ({ time, value }) => ({ x: time, y: value })
      );
      
      // Обновляем метку с актуальным значением Y
      const avgY = newIntersections.length > 0
        ? newIntersections.reduce((acc, p) => acc + p.value, 0) / newIntersections.length
        : 0;
      originalChart.data.datasets[intersectionMarkerIndex].label = 
        `Пересечения при Y=${avgY.toFixed(4)}`;
    }
    
    // Обновляем обычный датасет пересечений на original графике
    const originalIntersectionDatasetIndex = originalChart.data.datasets.findIndex(
      (ds) => ds.label === "Пересечения тензо и интерф"
    );
    if (originalIntersectionDatasetIndex !== -1) {
      originalChart.data.datasets[originalIntersectionDatasetIndex].data = newIntersections.map(
        ({ time, value }) => ({ x: time, y: value })
      );
    }

    // Обновляем состояние для таблицы пересечений
    setCurrentIntersections(newIntersections);

    // Обновляем обработанный график
    const processedChart = processedChartInstance.current;
    
    // Обновляем график пересечений на processed графике
    const processedIntersectionDatasetIndex = processedChart.data.datasets.findIndex(
      (ds) => ds.label === "Пересечения тензо и интерф"
    );
    if (processedIntersectionDatasetIndex !== -1) {
      processedChart.data.datasets[processedIntersectionDatasetIndex].data = newIntersections.map(
        ({ time, value }) => ({ x: time, y: value })
      );
    }
    
    // Обновляем обработанный сигнал (скорректированный тензосигнал), если он есть
    const correctedDatasetIndex = processedChart.data.datasets.findIndex(
      (ds) => ds.label === "Скорректированный тензосигнал"
    );
    
    if (correctedDatasetIndex !== -1) {
      processedChart.data.datasets[correctedDatasetIndex].data = t.map((time, idx) => ({
        x: time + 50e-6, // коррекция времени
        y: -shiftedTenz[idx] * 5000 + 0.38, // преобразование с учетом сдвига
      }));
    }

    originalChart.update("none");
    processedChart.update("none");
  }, [tenzOffset, interfOffset, data?.rawData]);

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

  const handleResetProcessed = useCallback(() => {
    processedChartInstance.current?.resetZoom();
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

  const handleZoomProcessedIn = useCallback(() => {
    zoomChart(processedChartInstance, ZOOM_STEP);
  }, [zoomChart]);

  const handleZoomProcessedOut = useCallback(() => {
    zoomChart(processedChartInstance, 1 / ZOOM_STEP);
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

  const processedAxisOptions = useMemo(() => {
    return (data?.processed ?? []).map((dataset) => ({
      label: dataset.label,
      color: dataset.borderColor,
    }));
  }, [data]);

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
            {interfCenterPoint?.time && (
              <button
                type="button"
                className="zoom-center-btn"
                onClick={() =>
                  centerOriginalChartOnTime(
                    interfCenterPoint.time,
                    interfCenterPoint.window
                  )
                }
                aria-label="Центрировать по скачку интерф"
              >
                Центр. Интерф
              </button>
            )}
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

      <section className="chart-section">
        <div className="chart-controls-group">
          <div className="zoom-controls" role="group" aria-label="Управление масштабом">
            <button
              type="button"
              className="zoom-control-btn"
              onClick={handleZoomProcessedOut}
              aria-label="Уменьшить масштаб"
            >
              -
            </button>
            <button
              type="button"
              className="zoom-control-btn"
              onClick={handleZoomProcessedIn}
              aria-label="Увеличить масштаб"
            >
              +
            </button>
            <button
              type="button"
              className="zoom-reset-btn"
              onClick={handleResetProcessed}
              aria-label="Сбросить масштаб"
            >
              ↺ Сбросить
            </button>
          </div>
        </div>
        {processedAxisOptions.length > 0 && (
          <div
            className="axis-toggle-group"
            role="group"
            aria-label="Отображение осей обработанных сигналов"
          >
            {processedAxisOptions.map(({ label, color }) => {
              const isActive = processedAxisVisibility[label] ?? true;
              return (
                <button
                  key={label}
                  type="button"
                  className={`axis-toggle-btn ${
                    isActive ? "axis-toggle-btn--active" : ""
                  }`}
                  onClick={() =>
                    handleAxisToggle(
                      processedChartInstance,
                      label,
                      processedAxisVisibility,
                      setProcessedAxisVisibility
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
          </div>
        )}
        <canvas ref={processedChartRef} width="800" height="400"></canvas>
      </section>
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
                  <th>Амплитуда (В)</th>
                </tr>
              </thead>
              <tbody>
                {currentIntersections.map((point, idx) => (
                  <tr key={`${point.time}-${idx}`}>
                    <td>{idx + 1}</td>
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
};

export default ChartComponent;
