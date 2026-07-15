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

    function clearDashboard() {
        headerStatus.textContent = 'Please add a data file to start analysis.';
        headerStatus.style.color = '#fbbf24'; // Yellow-ish warning color

        const kpis = ['kpi-voltage', 'kpi-current', 'kpi-freq', 'kpi-fault-rate', 'kpi-normal', 'kpi-fault', 'kpi-total'];
        kpis.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                const valEl = el.querySelector('.kpi-value');
                if (valEl) valEl.textContent = '--';
                const deltaEl = el.querySelector('.kpi-delta');
                if (deltaEl) deltaEl.textContent = '--';
            }
        });

        Plotly.purge('trend-chart');
        Plotly.purge('pie-chart');
        Plotly.purge('scatter-chart');
        Plotly.purge('scorecard-chart');
    }

    function updateKPIs(metrics) {
        document.getElementById('kpi-voltage').querySelector('.kpi-value').textContent = metrics.avg_voltage.toFixed(4) + ' pu';
        document.getElementById('kpi-voltage').querySelector('.kpi-delta').textContent = (metrics.avg_voltage - 1.0 > 0 ? '+' : '') + (metrics.avg_voltage - 1.0).toFixed(4) + ' from nominal';

        document.getElementById('kpi-current').querySelector('.kpi-value').textContent = metrics.avg_current.toFixed(4) + ' pu';
        document.getElementById('kpi-current').querySelector('.kpi-delta').textContent = (metrics.avg_current - 1.0 > 0 ? '+' : '') + (metrics.avg_current - 1.0).toFixed(4) + ' from nominal';

        document.getElementById('kpi-freq').querySelector('.kpi-value').textContent = metrics.avg_freq.toFixed(3) + ' Hz';
        document.getElementById('kpi-freq').querySelector('.kpi-delta').textContent = (metrics.avg_freq - 50.0 > 0 ? '+' : '') + (metrics.avg_freq - 50.0).toFixed(3) + ' from 50 Hz';

        document.getElementById('kpi-fault-rate').querySelector('.kpi-value').textContent = metrics.fault_pct.toFixed(1) + '%';
        const deltaFault = metrics.fault_pct - 40.0;
        const faultDeltaEl = document.getElementById('kpi-fault-rate').querySelector('.kpi-delta');
        faultDeltaEl.textContent = (deltaFault > 0 ? '+' : '') + deltaFault.toFixed(1) + '% vs 40% threshold';
        if (deltaFault > 0) faultDeltaEl.className = 'kpi-delta negative';
        else faultDeltaEl.className = 'kpi-delta';

        document.getElementById('kpi-normal').querySelector('.kpi-value').textContent = metrics.normal_count.toLocaleString();
        document.getElementById('kpi-normal').querySelector('.kpi-delta').textContent = metrics.total > 0 ? ((metrics.normal_count / metrics.total) * 100).toFixed(1) + '% of selection' : '--';

        document.getElementById('kpi-fault').querySelector('.kpi-value').textContent = metrics.fault_count.toLocaleString();
        document.getElementById('kpi-fault').querySelector('.kpi-delta').textContent = metrics.total > 0 ? ((metrics.fault_count / metrics.total) * 100).toFixed(1) + '% of selection' : '--';
    }

    function updateCharts(records, trendParamName) {
        if (!records || records.length === 0) {
            Plotly.purge('trend-chart');
            Plotly.purge('pie-chart');
            Plotly.purge('scatter-chart');
            return;
        }

        const xVals = records.map(r => r.Record_Index);
        const yVals = records.map(r => r[trendParamName]);
        const labels = records.map(r => r.Class_Label);

        // 1. Trend Chart
        const trendTrace = {
            x: xVals,
            y: yVals,
            type: 'scatter',
            mode: 'lines',
            name: trendParamName,
            line: { color: '#3b82f6', width: 1.5 }
        };

        const faultXVals = [];
        const faultYVals = [];
        records.forEach(r => {
            if (r.Class_Label === 1) {
                faultXVals.push(r.Record_Index);
                faultYVals.push(r[trendParamName]);
            }
        });

        const faultTrace = {
            x: faultXVals,
            y: faultYVals,
            type: 'scatter',
            mode: 'markers',
            name: 'Fault',
            marker: { color: 'rgba(239, 68, 68, 0.5)', size: 4 }
        };

        Plotly.newPlot('trend-chart', [trendTrace, faultTrace], {
            ...darkLayout,
            hovermode: 'x unified',
            legend: { orientation: 'h', y: 1.1 },
            xaxis: { ...darkLayout.xaxis, title: 'Record Index' },
            yaxis: { ...darkLayout.yaxis, title: trendParamName }
        });

        // 2. Pie Chart
        const normalCount = labels.filter(l => l === 0).length;
        const faultCount = labels.filter(l => l === 1).length;

        const pieTrace = {
            values: [normalCount, faultCount],
            labels: ['Normal (0)', 'Fault (1)'],
            type: 'pie',
            hole: 0.6,
            marker: { colors: ['#22c55e', '#ef4444'] },
            textinfo: 'label+percent'
        };

        Plotly.newPlot('pie-chart', [pieTrace], {
            ...darkLayout,
            showlegend: false,
            margin: { t: 10, b: 10, l: 10, r: 10 }
        });

        // 3. Scatter Chart (Voltage vs Current)
        // Sample down to max 2000 for scatter to keep UI responsive
        const sampleSize = Math.min(2000, records.length);
        const sampled = [];
        for (let i = 0; i < sampleSize; i++) {
            sampled.push(records[Math.floor(Math.random() * records.length)]);
        }

        const scatterNormal = {
            x: sampled.filter(r => r.Class_Label === 0).map(r => r.Voltage),
            y: sampled.filter(r => r.Class_Label === 0).map(r => r.Current),
            mode: 'markers',
            type: 'scatter',
            name: 'Normal',
            marker: { color: '#22c55e', size: 4, opacity: 0.6 }
        };

        const scatterFault = {
            x: sampled.filter(r => r.Class_Label === 1).map(r => r.Voltage),
            y: sampled.filter(r => r.Class_Label === 1).map(r => r.Current),
            mode: 'markers',
            type: 'scatter',
            name: 'Fault',
            marker: { color: '#ef4444', size: 4, opacity: 0.6 }
        };

        Plotly.newPlot('scatter-chart', [scatterNormal, scatterFault], {
            ...darkLayout,
            xaxis: { ...darkLayout.xaxis, title: 'Voltage (pu)' },
            yaxis: { ...darkLayout.yaxis, title: 'Current (pu)' },
            legend: { orientation: 'h', y: 1.1 }
        });
    }

    function updateScorecard(scorecard) {
        if (!scorecard || scorecard.error) return;

        const buses = scorecard.map(s => s.Bus_ID.toString());
        const faultRates = scorecard.map(s => s.Fault_Rate_Pct);
        const colors = faultRates.map(r => {
            if (r < 45) return '#22c55e';
            if (r <= 50) return '#f59e0b';
            return '#ef4444';
        });

        const trace = {
            x: buses,
            y: faultRates,
            type: 'bar',
            marker: { color: colors },
            text: scorecard.map(s => s.Health),
            textposition: 'outside',
            textfont: { color: '#94a3b8' }
        };

        const layout = {
            ...darkLayout,
            xaxis: { ...darkLayout.xaxis, title: 'Bus ID', type: 'category' },
            yaxis: { ...darkLayout.yaxis, title: 'Fault Rate (%)' },
            shapes: [
                { type: 'line', x0: -0.5, x1: buses.length - 0.5, y0: 45, y1: 45, line: { color: '#f59e0b', dash: 'dash' } },
                { type: 'line', x0: -0.5, x1: buses.length - 0.5, y0: 50, y1: 50, line: { color: '#ef4444', dash: 'dash' } }
            ]
        };

        Plotly.newPlot('scorecard-chart', [trace], layout);
    }
});
