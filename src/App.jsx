import React, { useState, useRef } from "react";
import { processCSVData, generateChartData } from "./csvProcessor";
import ChartComponent from "./ChartComponent";
import "./App.css";

function App() {
  const [chartData, setChartData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sgWindow, setSgWindow] = useState(31);
  const [sgPoly, setSgPoly] = useState(3);
  const [applyingSmoothing, setApplyingSmoothing] = useState(false);
  const fileInputRef = useRef(null);
  const lastFileRef = useRef(null);

  const handleFileUpload = async (event) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    lastFileRef.current = files[0];

    setLoading(true);
    setError("");

    try {
      const results = await processCSVData(files[0], {
        sgWindow,
        sgPoly,
      });
      const chartData = generateChartData(results);
      setChartData(chartData);
    } catch (err) {
      setError(`Ошибка обработки файла: ${err.message}`);
      console.error("Processing error:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleDrop = (event) => {
    event.preventDefault();
    const files = event.dataTransfer.files;
    if (files.length > 0) {
      handleFileUpload({ target: { files } });
    }
  };

  const handleDragOver = (event) => {
    event.preventDefault();
  };

  const resetFiles = () => {
    setChartData(null);
    setError("");
    lastFileRef.current = null;
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>Анализатор сигналов</h1>
        <p>Загрузите CSV-файл для построения графиков</p>
      </header>

      <main className="App-main">
        {!loading && (
          <section className="sg-settings">
            <h2>Параметры сглаживания (Savitzky–Golay)</h2>
            <div className="sg-settings-row">
              <label className="sg-label">
                Размер окна (windowSize):
                <input
                  type="number"
                  min={3}
                  step={2}
                  value={sgWindow}
                  onChange={(e) => {
                    const val = Math.floor(Number(e.target.value) || 3);
                    const odd = val % 2 === 0 ? val + 1 : val;
                    const next = Math.max(3, odd);
                    setSgWindow(next);
                  }}
                  className="sg-input"
                />
                <span className="sg-help">
                  Количество точек в окне фильтра. Должно быть нечётным: больше окно —
                  сильнее сглаживание и меньше шум, но хуже видны резкие фронты.
                </span>
              </label>
            </div>
            <div className="sg-settings-row">
              <label className="sg-label">
                Порядок полинома (polyOrder):
                <input
                  type="number"
                  min={1}
                  max={sgWindow - 1}
                  value={sgPoly}
                  onChange={(e) => {
                    const raw = Math.floor(Number(e.target.value) || 1);
                    const clamped = Math.min(Math.max(1, raw), sgWindow - 1);
                    setSgPoly(clamped);
                  }}
                  className="sg-input"
                />
                <span className="sg-help">
                  Степень полинома аппроксимации внутри окна. Больше порядок — точнее
                  повторяет форму сигнала, но чувствительнее к шуму.
                </span>
              </label>
            </div>
            <div className="sg-settings-row">
              <button
                type="button"
                className="sg-apply-btn"
                disabled={!lastFileRef.current || loading || applyingSmoothing}
                onClick={async () => {
                  if (!lastFileRef.current) return;
                  setApplyingSmoothing(true);
                  setError("");
                  try {
                    const results = await processCSVData(lastFileRef.current, {
                      sgWindow,
                      sgPoly,
                    });
                    const nextChartData = generateChartData(results);
                    setChartData(nextChartData);
                  } catch (err) {
                    setError(`Ошибка обработки файла: ${err.message}`);
                    console.error("Processing error:", err);
                  } finally {
                    setApplyingSmoothing(false);
                  }
                }}
              >
                {applyingSmoothing ? "Применение..." : "Применить сглаживание"}
              </button>
            </div>
          </section>
        )}

        {!chartData && !loading && (
          <div
            className="drop-zone"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.CSV"
              onChange={handleFileUpload}
              style={{ display: "none" }}
              id="file-input"
            />
            <label htmlFor="file-input" className="file-label">
              <div className="upload-icon">📁</div>
              <p>Нажмите для выбора файла или перетащите его сюда</p>
              <p className="file-hint">Поддерживаемый формат: CSV</p>
            </label>
          </div>
        )}

        {loading && (
          <div className="loading">
            <div className="spinner"></div>
            <p>Обработка данных...</p>
          </div>
        )}

        {error && (
          <div className="error">
            <p>{error}</p>
            <button onClick={resetFiles} className="reset-btn">
              Попробовать снова
            </button>
          </div>
        )}

        {chartData && (
          <div className="chart-container">
            <div className="chart-controls">
              <button onClick={resetFiles} className="reset-btn">
                Загрузить другой файл
              </button>
            </div>
            <ChartComponent data={chartData} />
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
