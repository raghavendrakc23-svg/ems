document.addEventListener('DOMContentLoaded', () => {
    // Automatically use Render backend when hosted on Netlify, but use local backend when testing on computer!
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:';
    const API_BASE = isLocalhost ? 'http://127.0.0.1:8000' : '';

    // Elements
    const busSelect = document.getElementById('bus-select');
    const conditionRadios = document.querySelectorAll('input[name="condition"]');
    const recordStart = document.getElementById('record-start');
    const recordEnd = document.getElementById('record-end');
    const trendParam = document.getElementById('trend-param');
    const applyBtn = document.getElementById('apply-btn');
    const headerStatus = document.getElementById('header-status');
    const csvUpload = document.getElementById('csv-upload');
    const uploadStatus = document.getElementById('upload-status');
    const datasetSelect = document.getElementById('dataset-select');
    const clearDatasetsBtn = document.getElementById('clear-datasets');

    // Default Plotly Layout Config
    const darkLayout = {
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        font: { color: '#94a3b8', family: 'Outfit, sans-serif' },
        margin: { t: 30, b: 40, l: 50, r: 20 },
        xaxis: { gridcolor: 'rgba(255,255,255,0.05)' },
        yaxis: { gridcolor: 'rgba(255,255,255,0.05)' }
    };

    // Initialize
    init();

    async function init() {
        await loadDatasets();
        await loadBuses();
        await updateDashboard();

        applyBtn.addEventListener('click', updateDashboard);
        csvUpload.addEventListener('change', handleFileUpload);
        clearDatasetsBtn.addEventListener('click', async () => {
            if (confirm("Are you sure you want to clear all datasets?")) {
                try {
                    await fetch(API_BASE + '/api/datasets', { method: 'DELETE' });
                    datasetSelect.innerHTML = '';
                    busSelect.innerHTML = '<option value="All Buses">All Buses</option>';
                    await loadBuses();
                    await updateDashboard();
                } catch (err) {
                    console.error('Failed to clear datasets', err);
                }
            }
        });
        datasetSelect.addEventListener('change', async () => {
            await loadBuses();
            await updateDashboard();
        });
    }

    async function loadDatasets() {
        try {
            const res = await fetch(API_BASE + '/api/datasets');
            const data = await res.json();
            datasetSelect.innerHTML = '';
            if (data.datasets) {
                data.datasets.forEach(ds => {
                    const opt = document.createElement('option');
                    opt.value = ds;
                    opt.textContent = ds;
                    datasetSelect.appendChild(opt);
                });
            }
        } catch (err) {
            console.error('Failed to load datasets', err);
        }
    }

    async function handleFileUpload(e) {
        const file = e.target.files[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('file', file);

        uploadStatus.textContent = 'Uploading...';
        uploadStatus.style.color = '#94a3b8';

        try {
            const res = await fetch(API_BASE + '/api/upload', {
                method: 'POST',
                body: formData
            });
            const data = await res.json();

            if (data.error) {
                uploadStatus.textContent = 'Upload failed: ' + data.error;
                uploadStatus.style.color = '#ef4444';
            } else {
                uploadStatus.textContent = 'Upload successful!';
                uploadStatus.style.color = '#22c55e';
                // Refresh datasets and dashboard
                await loadDatasets();
                datasetSelect.value = data.filename;
                busSelect.innerHTML = '<option value="All Buses">All Buses</option>';
                await loadBuses();
                await updateDashboard();

                setTimeout(() => { uploadStatus.textContent = ''; }, 3000);
            }
        } catch (err) {
            uploadStatus.textContent = 'Upload error.';
            uploadStatus.style.color = '#ef4444';
        }

        // Clear input
        csvUpload.value = '';
    }

    async function loadBuses() {
        const dataset = datasetSelect.value;
        const query = dataset ? `?dataset=${encodeURIComponent(dataset)}` : '';
        try {
            const res = await fetch(API_BASE + `/api/buses${query}`);
            const data = await res.json();
            if (data.buses) {
                data.buses.forEach(bus => {
                    const opt = document.createElement('option');
                    opt.value = bus;
                    opt.textContent = `Bus ${bus}`;
                    busSelect.appendChild(opt);
                });
            }
        } catch (err) {
            console.error('Failed to load buses', err);
        }
    }

    function getFilters() {
        let condition = 'All Records';
        conditionRadios.forEach(r => { if (r.checked) condition = r.value; });

        const busVal = busSelect.value;
        const bus = busVal === 'All Buses' ? null : parseInt(busVal);
        const dataset = datasetSelect.value;

        return {
            dataset: dataset,
            bus: bus,
            condition: condition,
            start_record: parseInt(recordStart.value) || 1,
            end_record: parseInt(recordEnd.value) || 2000,
            trend_param: trendParam.value
        };
    }

    async function updateDashboard() {
        applyBtn.textContent = 'Loading...';
        applyBtn.disabled = true;

        const filters = getFilters();
        let query = `?condition=${encodeURIComponent(filters.condition)}&start_record=${filters.start_record}&end_record=${filters.end_record}`;
        if (filters.bus !== null) query += `&bus=${filters.bus}`;
        if (filters.dataset) query += `&dataset=${encodeURIComponent(filters.dataset)}`;

        try {
            const [dataRes, scorecardRes] = await Promise.all([
                fetch(API_BASE + `/api/data${query}`).then(r => r.json()),
                fetch(API_BASE + `/api/scorecard${filters.dataset ? '?dataset=' + encodeURIComponent(filters.dataset) : ''}`).then(r => r.json())
            ]);

            if (dataRes.error) {
                clearDashboard();
                return;
            }

            updateKPIs(dataRes.metrics);
            updateCharts(dataRes.records, filters.trend_param);
            updateScorecard(scorecardRes);

            headerStatus.textContent = `Showing ${dataRes.records.length} records · Bus: ${busSelect.value} · Condition: ${filters.condition}`;
            headerStatus.style.color = '#94a3b8'; // Default subtitle color

        } catch (err) {
            console.error('Dashboard update failed', err);
            headerStatus.textContent = 'Error loading data';
        } finally {
            applyBtn.textContent = 'Apply Filters';
            applyBtn.disabled = false;
        }
    }

    
    let currentRecords = [];
    
    function clearDashboard() {
        headerStatus.textContent = 'Please add a data file to start analysis.';
        headerStatus.style.color = '#fbbf24'; 
        // Purge charts
        const charts = ['pie-chart', 'bus-bar-chart', 'vi-scatter-chart', 'freq-hist-chart', 
                        'v-angle-hist', 'i-angle-hist', 's-scatter-chart', 'pf-angle-hist', 
                        'pq-scatter-chart', 'pf-hist', 'scorecard-chart'];
        charts.forEach(c => {
            if(document.getElementById(c)) Plotly.purge(c);
        });
    }

    function calcStat(arr) {
        if (!arr.length) return {mean:0, std:0, min:0, max:0, q25:0, q75:0};
        arr.sort((a, b) => a - b);
        const sum = arr.reduce((a, b) => a + b, 0);
        const mean = sum / arr.length;
        const std = Math.sqrt(arr.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / arr.length);
        return {
            mean, std, min: arr[0], max: arr[arr.length - 1],
            q25: arr[Math.floor(arr.length * 0.25)],
            q75: arr[Math.floor(arr.length * 0.75)]
        };
    }

    function updateKPIs(metrics) {
        // We removed old KPIs. Let's update Power KPIs instead.
        if(document.getElementById('kpi-S')) document.getElementById('kpi-S').textContent = (metrics.avg_S || 0).toFixed(4) + ' pu';
        if(document.getElementById('kpi-P')) document.getElementById('kpi-P').textContent = (metrics.avg_P || 0).toFixed(4) + ' pu';
        if(document.getElementById('kpi-Q')) document.getElementById('kpi-Q').textContent = (metrics.avg_Q || 0).toFixed(4) + ' pu';
        if(document.getElementById('kpi-PF')) document.getElementById('kpi-PF').textContent = (metrics.avg_PF || 0).toFixed(4);
        if(document.getElementById('kpi-PF-Angle')) document.getElementById('kpi-PF-Angle').textContent = (metrics.avg_PF_angle || 0).toFixed(2) + '°';
    }

    function updateCharts(records, trendParamName) {
        currentRecords = records;
        if (!records || records.length === 0) {
            clearDashboard();
            return;
        }

        const faults = records.filter(r => r.Class_Label === 1);
        const normals = records.filter(r => r.Class_Label === 0);

        // --- Row 1: Pie Chart & Stat Table ---
        const pieTrace = {
            values: [normals.length, faults.length],
            labels: ['Normal (0)', 'Fault (1)'],
            type: 'pie', hole: 0.5,
            marker: { colors: ['#22c55e', '#ef4444'] },
            textinfo: 'label+percent'
        };
        Plotly.newPlot('pie-chart', [pieTrace], { ...darkLayout, showlegend: true, legend: {orientation: 'h', y: -0.2}, margin: { t: 30, b: 30, l: 30, r: 30 } });

        const params = ['Voltage', 'Current', 'Frequency', 'Voltage_Angle', 'Current_Angle'];
        let statHTML = '';
        params.forEach(p => {
            const vals = records.map(r => r[p]).filter(v => v !== null && v !== undefined);
            const st = calcStat(vals);
            statHTML += `<tr><td>${p}</td><td>${st.mean.toFixed(4)}</td><td>${st.std.toFixed(4)}</td><td>${st.min.toFixed(4)}</td><td>${st.max.toFixed(4)}</td><td>${st.q25.toFixed(4)}</td><td>${st.q75.toFixed(4)}</td></tr>`;
        });
        document.querySelector('#stat-table tbody').innerHTML = statHTML;

        // --- Row 3: VI Scatter & Freq Hist ---
        const sampleSize = Math.min(2000, records.length);
        const sampled = [];
        for (let i = 0; i < sampleSize; i++) sampled.push(records[Math.floor(Math.random() * records.length)]);
        
        Plotly.newPlot('vi-scatter-chart', [{
            x: sampled.map(r => r.Voltage), y: sampled.map(r => r.Current),
            mode: 'markers', type: 'scatter',
            marker: { color: sampled.map(r => r.Class_Label), colorscale: [[0, '#3b82f6'], [1, '#facc15']], size: 4, opacity: 0.7, showscale: true, colorbar: {title: 'Condition'} }
        }], { ...darkLayout, xaxis: { ...darkLayout.xaxis, title: 'Voltage (pu)' }, yaxis: { ...darkLayout.yaxis, title: 'Current (pu)' }, margin: {l: 50, r: 20, t: 30, b: 40} });

        Plotly.newPlot('freq-hist-chart', [
            { x: normals.map(r => r.Frequency), type: 'histogram', name: 'Normal', marker: {color: '#22c55e'} },
            { x: faults.map(r => r.Frequency), type: 'histogram', name: 'Fault', marker: {color: '#ef4444'} }
        ], { ...darkLayout, barmode: 'overlay', xaxis: { ...darkLayout.xaxis, title: 'Frequency (Hz)' }, yaxis: { ...darkLayout.yaxis, title: 'Count' }, margin: {l: 50, r: 20, t: 30, b: 40}, legend: {orientation: 'h', y: 1.1} });

        // --- Row 4: Angles ---
        Plotly.newPlot('v-angle-hist', [
            { x: normals.map(r => r.Voltage_Angle), type: 'histogram', name: 'Normal', marker: {color: '#22c55e'} },
            { x: faults.map(r => r.Voltage_Angle), type: 'histogram', name: 'Fault', marker: {color: '#ef4444'} }
        ], { ...darkLayout, barmode: 'overlay', xaxis: { ...darkLayout.xaxis, title: 'Voltage_Angle (°)' }, yaxis: { ...darkLayout.yaxis, title: 'Count' }, margin: {l: 50, r: 20, t: 30, b: 40}, legend: {orientation: 'h', y: 1.1} });

        Plotly.newPlot('i-angle-hist', [
            { x: normals.map(r => r.Current_Angle), type: 'histogram', name: 'Normal', marker: {color: '#22c55e'} },
            { x: faults.map(r => r.Current_Angle), type: 'histogram', name: 'Fault', marker: {color: '#ef4444'} }
        ], { ...darkLayout, barmode: 'overlay', xaxis: { ...darkLayout.xaxis, title: 'Current_Angle (°)' }, yaxis: { ...darkLayout.yaxis, title: 'Count' }, margin: {l: 50, r: 20, t: 30, b: 40}, legend: {orientation: 'h', y: 1.1} });

        // --- Row 6: S scatter & PF Angle Hist ---
        Plotly.newPlot('s-scatter-chart', [
            { x: normals.map(r => r.Record_Index), y: normals.map(r => r.Apparent_Power), mode: 'markers', type: 'scatter', name: 'Normal', marker: {color: '#22c55e', size: 3, opacity: 0.5} },
            { x: faults.map(r => r.Record_Index), y: faults.map(r => r.Apparent_Power), mode: 'markers', type: 'scatter', name: 'Fault', marker: {color: '#ef4444', size: 3, opacity: 0.5} }
        ], { ...darkLayout, xaxis: { ...darkLayout.xaxis, title: 'Record Index' }, yaxis: { ...darkLayout.yaxis, title: 'Apparent Power (pu)' }, margin: {l: 50, r: 20, t: 30, b: 40}, legend: {orientation: 'h', y: 1.1} });

        Plotly.newPlot('pf-angle-hist', [
            { x: normals.map(r => r.PF_Angle), type: 'histogram', name: 'Normal', marker: {color: '#22c55e'} },
            { x: faults.map(r => r.PF_Angle), type: 'histogram', name: 'Fault', marker: {color: '#ef4444'} }
        ], { ...darkLayout, barmode: 'overlay', xaxis: { ...darkLayout.xaxis, title: 'PF Angle (°)' }, yaxis: { ...darkLayout.yaxis, title: 'Count' }, margin: {l: 50, r: 20, t: 30, b: 40}, legend: {orientation: 'h', y: 1.1} });

        // --- Row 7: P vs Q scatter & PF Hist ---
        Plotly.newPlot('pq-scatter-chart', [{
            x: sampled.map(r => r.Active_Power), y: sampled.map(r => r.Reactive_Power),
            mode: 'markers', type: 'scatter',
            marker: { color: sampled.map(r => r.Class_Label), colorscale: [[0, '#4f46e5'], [1, '#facc15']], size: 4, opacity: 0.7, showscale: true, colorbar: {title: 'Condition'} }
        }], { ...darkLayout, xaxis: { ...darkLayout.xaxis, title: 'Active Power P (pu)' }, yaxis: { ...darkLayout.yaxis, title: 'Reactive Power Q (pu)' }, margin: {l: 50, r: 20, t: 30, b: 40} });

        Plotly.newPlot('pf-hist', [
            { x: normals.map(r => r.Power_Factor), type: 'histogram', name: 'Normal', marker: {color: '#22c55e'} },
            { x: faults.map(r => r.Power_Factor), type: 'histogram', name: 'Fault', marker: {color: '#ef4444'} }
        ], { ...darkLayout, barmode: 'overlay', xaxis: { ...darkLayout.xaxis, title: 'Power Factor' }, yaxis: { ...darkLayout.yaxis, title: 'Count' }, margin: {l: 50, r: 20, t: 30, b: 40}, legend: {orientation: 'h', y: 1.1} });
    }

    function updateScorecard(scorecard) {
        if (!scorecard || scorecard.error) return;

        scorecard.sort((a, b) => b.Fault_Rate_Pct - a.Fault_Rate_Pct); // Sort by fault rate descending

        const buses = scorecard.map(s => s.Bus_ID.toString());
        const faultRates = scorecard.map(s => s.Fault_Rate_Pct);
        const colors = faultRates.map(r => {
            if (r < 45) return '#10b981';
            if (r <= 50) return '#facc15';
            return '#ef4444';
        });

        // Bus Bar Chart (Row 2) - Stacked Normal vs Fault
        Plotly.newPlot('bus-bar-chart', [
            { x: buses, y: scorecard.map(s => s.Normal), type: 'bar', name: 'Normal', marker: {color: '#22c55e'} },
            { x: buses, y: scorecard.map(s => s.Faults), type: 'bar', name: 'Fault', marker: {color: '#ef4444'} }
        ], { ...darkLayout, barmode: 'stack', xaxis: { ...darkLayout.xaxis, title: 'Bus ID', type: 'category' }, yaxis: { ...darkLayout.yaxis, title: 'Record Count' }, margin: {l: 50, r: 20, t: 30, b: 40}, legend: {orientation: 'h', y: 1.1} });

        // Top 10 Buses Table (Row 2)
        let top10HTML = '';
        scorecard.slice(0, 10).forEach(s => {
            top10HTML += `<tr><td>${s.Bus_ID}</td><td>${s.Total}</td><td>${s.Faults}</td><td>${s.Fault_Rate_Pct.toFixed(2)}</td></tr>`;
        });
        document.querySelector('#top-buses-table tbody').innerHTML = top10HTML;

        // Health KPIs (Row 8)
        const healthyCount = faultRates.filter(r => r < 45).length;
        const warningCount = faultRates.filter(r => r >= 45 && r <= 50).length;
        const criticalCount = faultRates.filter(r => r > 50).length;
        document.getElementById('health-healthy').textContent = healthyCount;
        document.getElementById('health-warning').textContent = warningCount;
        document.getElementById('health-critical').textContent = criticalCount;

        // Scorecard Chart (Row 9)
        Plotly.newPlot('scorecard-chart', [{
            x: buses, y: faultRates, type: 'bar', marker: { color: colors, colorbar: {title: 'Fault %', tickvals: [40, 45, 50, 55], tickcolor: 'white'} },
            text: faultRates.map(r => (r < 45 ? 'Healthy' : (r <= 50 ? 'Warning' : 'Critical'))), textposition: 'outside', textfont: { color: '#94a3b8' }
        }], {
            ...darkLayout, xaxis: { ...darkLayout.xaxis, title: 'Bus ID', type: 'category' }, yaxis: { ...darkLayout.yaxis, title: 'Fault Rate (%)' }, margin: {l: 50, r: 20, t: 30, b: 40},
            shapes: [
                { type: 'line', x0: -0.5, x1: buses.length - 0.5, y0: 45, y1: 45, line: { color: '#facc15', dash: 'dash' } },
                { type: 'line', x0: -0.5, x1: buses.length - 0.5, y0: 50, y1: 50, line: { color: '#ef4444', dash: 'dash' } }
            ],
            annotations: [
                { x: 0, y: 45, text: 'Warning threshold (45%)', showarrow: false, yanchor: 'bottom', xanchor: 'left', font: {color: '#facc15'} },
                { x: 0, y: 50, text: 'Critical threshold (50%)', showarrow: false, yanchor: 'bottom', xanchor: 'left', font: {color: '#ef4444'} }
            ]
        });

        // Full Scorecard Table (Row 10)
        let fullHTML = '';
        scorecard.forEach(s => {
            const statusColor = s.Fault_Rate_Pct > 50 ? 'rgba(239, 68, 68, 0.2)' : (s.Fault_Rate_Pct >= 45 ? 'rgba(250, 204, 21, 0.2)' : 'transparent');
            const statusText = s.Fault_Rate_Pct > 50 ? '🔴 Critical' : (s.Fault_Rate_Pct >= 45 ? '🟡 Warning' : '🟢 Healthy');
            fullHTML += `<tr>
                <td>${s.Bus_ID}</td><td style="background: ${statusColor}">${statusText}</td><td style="color: ${s.Fault_Rate_Pct>50?'#ef4444':(s.Fault_Rate_Pct>=45?'#facc15':'#22c55e')}">${s.Fault_Rate_Pct.toFixed(2)}%</td>
                <td>${s.Total}</td><td>${s.Faults}</td><td>${s.Normal}</td>
                <td>${(s.Avg_Voltage||0).toFixed(4)}</td><td>${(s.Avg_Current||0).toFixed(4)}</td><td>${(s.Avg_Frequency||0).toFixed(4)}</td><td>${(s.Avg_S||0).toFixed(4)}</td><td>${(s.Avg_PF||0).toFixed(4)}</td>
            </tr>`;
        });
        document.querySelector('#full-scorecard-table tbody').innerHTML = fullHTML;
    }

    // Exports
    function downloadCSV(records, filename) {
        if (!records || records.length === 0) return alert("No data to export.");
        const keys = Object.keys(records[0]);
        const csvContent = [
            keys.join(","),
            ...records.map(r => keys.map(k => r[k]).join(","))
        ].join("\n");
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
    }

    document.getElementById('export-all-btn').addEventListener('click', () => {
        downloadCSV(currentRecords, 'filtered_records.csv');
    });

    document.getElementById('export-faults-btn').addEventListener('click', () => {
        downloadCSV(currentRecords.filter(r => r.Class_Label === 1), 'fault_records.csv');
    });

});
