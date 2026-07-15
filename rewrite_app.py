import re

with open("c:\\Users\\Raghavendra K C\\Downloads\\EMS_Final_Project\\public\\app.js", "r", encoding="utf-8") as f:
    content = f.read()

# We want to replace everything from `function clearDashboard()` to the end of the file.
new_functions = """
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
        ].join("\\n");
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
"""

# Extract first part
idx = content.find("function clearDashboard()")
if idx == -1:
    print("Could not find clearDashboard function!")
else:
    new_content = content[:idx] + new_functions
    with open("c:\\Users\\Raghavendra K C\\Downloads\\EMS_Final_Project\\public\\app.js", "w", encoding="utf-8") as f:
        f.write(new_content)
    print("Successfully updated app.js")
