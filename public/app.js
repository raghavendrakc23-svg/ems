(() => {
  const API = "/api";
  const state = {
    dataset: null,
    metric: "Voltage",
    chart: null,
  };

  const $ = (id) => document.getElementById(id);

  // ---------------- Toast ----------------
  let toastTimer;
  function toast(msg, kind = "") {
    const el = $("toast");
    el.textContent = msg;
    el.className = "toast show" + (kind ? " " + kind : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
  }

  function setConn(ok) {
    const dot = document.querySelector("#connStatus .pulse-dot");
    $("connLabel").textContent = ok ? "Live" : "Offline";
    dot.classList.toggle("error", !ok);
  }

  // ---------------- Fetch helpers ----------------
  async function getJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    return res.json();
  }

  function qs(params) {
    const p = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== null && v !== undefined && v !== "") p.set(k, v);
    });
    return p.toString();
  }

  // ---------------- Init ----------------
  async function init() {
    bindEvents();
    try {
      await loadDatasets();
      await refreshAll();
      setConn(true);
    } catch (e) {
      console.error(e);
      setConn(false);
      toast("Could not reach the API. Check the server is running.", "error");
    }
  }

  function bindEvents() {
    $("applyFilters").addEventListener("click", refreshAll);
    $("datasetSelect").addEventListener("change", async (e) => {
      state.dataset = e.target.value;
      await loadBuses();
      await refreshAll();
    });
    $("trendToggle").addEventListener("click", (e) => {
      const btn = e.target.closest(".toggle-btn");
      if (!btn) return;
      document.querySelectorAll(".toggle-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.metric = btn.dataset.metric;
      renderTrendChart(state.lastRecords || []);
    });
    $("fileInput").addEventListener("change", handleUpload);
  }

  // ---------------- Datasets & buses ----------------
  async function loadDatasets() {
    const data = await getJSON(`${API}/datasets`);
    const sel = $("datasetSelect");
    sel.innerHTML = "";
    if (!data.datasets || data.datasets.length === 0) {
      sel.innerHTML = `<option value="">No dataset loaded</option>`;
      return;
    }
    data.datasets.forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    });
    state.dataset = data.datasets[0];
    await loadBuses();
  }

  async function loadBuses() {
    const sel = $("busSelect");
    sel.innerHTML = `<option value="">All buses</option>`;
    if (!state.dataset) return;
    try {
      const data = await getJSON(`${API}/buses?${qs({ dataset: state.dataset })}`);
      (data.buses || []).forEach((b) => {
        const opt = document.createElement("option");
        opt.value = b;
        opt.textContent = `Bus ${b}`;
        sel.appendChild(opt);
      });
    } catch (e) {
      console.warn("bus load failed", e);
    }
  }

  // ---------------- Main refresh ----------------
  async function refreshAll() {
    if (!state.dataset) {
      renderEmptyState();
      return;
    }
    const params = {
      dataset: state.dataset,
      bus: $("busSelect").value,
      condition: $("conditionSelect").value,
      start_record: $("startRecord").value || 1,
      end_record: $("endRecord").value || 2000,
    };

    const [dataRes, scoreRes] = await Promise.all([
      getJSON(`${API}/data?${qs(params)}`),
      getJSON(`${API}/scorecard?${qs({ dataset: state.dataset })}`),
    ]);

    if (dataRes.error) {
      toast(dataRes.error, "error");
      return;
    }

    state.lastRecords = dataRes.records || [];
    renderKPIs(dataRes.metrics);
    renderPhasor(dataRes.metrics);
    renderTrendChart(state.lastRecords);
    renderScorecard(scoreRes);
    $("recordCount").textContent = `${dataRes.metrics.total.toLocaleString()} records in view`;
    setConn(true);
  }

  function renderEmptyState() {
    $("kpiRail").innerHTML = `<div class="kpi-card"><span class="kpi-label">No data</span><span class="kpi-value" style="font-size:14px;">Upload a CSV to begin</span></div>`;
    $("scorecardBody").innerHTML = `<tr class="empty-row"><td colspan="9">No dataset loaded yet. Use "Upload dataset" above.</td></tr>`;
  }

  // ---------------- KPI rail ----------------
  function fmt(n, digits = 2) {
    if (n === null || n === undefined || Number.isNaN(n)) return "—";
    return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  }

  function renderKPIs(m) {
    const cards = [
      { label: "Total records", value: fmt(m.total, 0), unit: "", accent: "var(--accent-cyan)" },
      { label: "Fault rate", value: fmt(m.fault_pct, 1), unit: "%", accent: "var(--status-critical)", sub: `${fmt(m.fault_count,0)} faults / ${fmt(m.normal_count,0)} normal` },
      { label: "Avg voltage", value: fmt(m.avg_voltage, 1), unit: "V", accent: "var(--accent-cyan)" },
      { label: "Avg current", value: fmt(m.avg_current, 1), unit: "A", accent: "var(--accent-amber)" },
      { label: "Avg frequency", value: fmt(m.avg_freq, 2), unit: "Hz", accent: "var(--accent-cyan)" },
      { label: "Avg power factor", value: fmt(m.avg_PF, 3), unit: "", accent: "var(--accent-amber)", sub: `∠ ${fmt(m.avg_PF_angle,1)}°` },
    ];
    $("kpiRail").innerHTML = cards.map((c) => `
      <div class="kpi-card" style="--kpi-accent:${c.accent}">
        <span class="kpi-label">${c.label}</span>
        <span class="kpi-value">${c.value}<span class="kpi-unit">${c.unit}</span></span>
        ${c.sub ? `<span class="kpi-sub">${c.sub}</span>` : ""}
      </div>
    `).join("");
  }

  // ---------------- Phasor diagram (signature element) ----------------
  function renderPhasor(m) {
    const cx = 130, cy = 130, r = 88;
    const angleDeg = Number(m.avg_PF_angle) || 0;
    const vx = cx + r, vy = cy; // voltage reference along 0°
    const rad = (angleDeg * Math.PI) / 180;
    const ix = cx + r * Math.cos(-rad);
    const iy = cy + r * Math.sin(-rad);

    const vVec = $("voltageVector");
    const iVec = $("currentVector");
    vVec.setAttribute("x2", vx);
    vVec.setAttribute("y2", vy);
    iVec.setAttribute("x2", ix.toFixed(1));
    iVec.setAttribute("y2", iy.toFixed(1));

    // angle arc
    const arcR = 30;
    const largeArc = Math.abs(angleDeg) > 180 ? 1 : 0;
    const sweep = angleDeg >= 0 ? 0 : 1;
    const ax = cx + arcR, ay = cy;
    const bx = cx + arcR * Math.cos(-rad);
    const by = cy + arcR * Math.sin(-rad);
    $("phasorAngleArc").innerHTML = `<path d="M ${ax} ${ay} A ${arcR} ${arcR} 0 ${largeArc} ${sweep} ${bx.toFixed(1)} ${by.toFixed(1)}"/>`;

    $("angleReadout").textContent = `∠ ${angleDeg.toFixed(1)}°`;
  }

  // ---------------- Trend chart ----------------
  function renderTrendChart(records) {
    const ctx = document.getElementById("trendChart");
    const metric = state.metric;
    const labels = records.map((r) => r.Record_Index);
    const values = records.map((r) => r[metric]);

    const colorMap = {
      Voltage: "#33D6E0",
      Current: "#F5A623",
      Frequency: "#33D6E0",
      Power_Factor: "#F5A623",
    };
    const color = colorMap[metric] || "#33D6E0";

    // fault markers
    const faultPoints = records
      .map((r, idx) => (r.Class_Label === 1 ? { x: r.Record_Index, y: r[metric] } : null))
      .filter(Boolean);

    if (state.chart) state.chart.destroy();

    state.chart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: metric.replace("_", " "),
            data: values,
            borderColor: color,
            backgroundColor: color + "22",
            borderWidth: 1.6,
            pointRadius: 0,
            fill: true,
            tension: 0.15,
          },
          {
            label: "Fault",
            data: faultPoints,
            type: "scatter",
            backgroundColor: "#FF5470",
            borderColor: "#FF5470",
            pointRadius: 3,
            showLine: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 400 },
        interaction: { mode: "nearest", intersect: false },
        plugins: {
          legend: {
            labels: { color: "#A6B0C3", font: { family: "JetBrains Mono", size: 11 }, boxWidth: 10 },
          },
          tooltip: {
            backgroundColor: "#151B29",
            borderColor: "#212a3d",
            borderWidth: 1,
            titleColor: "#EDF1F7",
            bodyColor: "#A6B0C3",
            bodyFont: { family: "JetBrains Mono" },
          },
        },
        scales: {
          x: {
            ticks: { color: "#626c81", font: { family: "JetBrains Mono", size: 10 }, maxTicksLimit: 10 },
            grid: { color: "#1a2232" },
          },
          y: {
            ticks: { color: "#626c81", font: { family: "JetBrains Mono", size: 10 } },
            grid: { color: "#1a2232" },
          },
        },
      },
    });
  }

  // ---------------- Scorecard table ----------------
  function healthClass(h) {
    if (h === "Healthy") return "healthy";
    if (h === "Warning") return "warning";
    return "critical";
  }

  function renderScorecard(rows) {
    const body = $("scorecardBody");
    if (!Array.isArray(rows) || rows.length === 0) {
      body.innerHTML = `<tr class="empty-row"><td colspan="9">No bus data available for this dataset.</td></tr>`;
      return;
    }
    body.innerHTML = rows.map((r) => {
      const cls = healthClass(r.Health);
      const rate = Number(r.Fault_Rate_Pct) || 0;
      const barColor = cls === "healthy" ? "var(--status-healthy)" : cls === "warning" ? "var(--status-warning)" : "var(--status-critical)";
      return `
        <tr>
          <td>Bus ${r.Bus_ID}</td>
          <td><span class="health-badge ${cls}">${r.Health}</span></td>
          <td>${fmt(r.Total, 0)}</td>
          <td>${fmt(r.Faults, 0)}</td>
          <td>${rate.toFixed(1)}%
            <span class="fault-rate-bar"><span class="fault-rate-fill" style="width:${Math.min(rate,100)}%;background:${barColor}"></span></span>
          </td>
          <td>${fmt(r.Avg_Voltage, 1)}</td>
          <td>${fmt(r.Avg_Current, 1)}</td>
          <td>${fmt(r.Avg_Frequency, 2)}</td>
          <td>${fmt(r.Avg_PF, 3)}</td>
        </tr>
      `;
    }).join("");
  }

  // ---------------- Upload ----------------
  async function handleUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    toast("Uploading dataset…");
    try {
      const res = await fetch(`${API}/upload`, { method: "POST", body: fd });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      toast(`Loaded ${data.filename} — ${data.records.toLocaleString()} records`, "success");
      await loadDatasets();
      $("datasetSelect").value = data.filename;
      state.dataset = data.filename;
      await loadBuses();
      await refreshAll();
    } catch (err) {
      console.error(err);
      toast("Upload failed: " + err.message, "error");
    } finally {
      e.target.value = "";
    }
  }

  init();
})();
