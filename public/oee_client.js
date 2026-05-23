// Register datalabels plugin globally
Chart.register(ChartDataLabels);

let stateChart = null;
let paretoChart = null;
let waterfallChart = null;
let currentTimelineData = [];
let currentSort = { column: null, direction: 'asc' };
let lastOeeSuccess = null;

document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const dateParam = urlParams.get('date');
    const machineParam = urlParams.get('machine');

    console.log('OEE Dashboard Init - Params:', { dateParam, machineParam });

    if (dateParam) {
        document.getElementById('dateFilter').value = dateParam;
    } else {
        const now = new Date();
        const d = now.getHours() < 6 ? new Date(now.getTime() - 86400000) : now;
        document.getElementById('dateFilter').value = d.toISOString().split('T')[0];
    }

    if (machineParam) {
        const machineSelect = document.getElementById('machineSelect');
        // Check if the machine exists in the options
        const exists = Array.from(machineSelect.options).some(opt => opt.value === machineParam);
        if (exists) {
            machineSelect.value = machineParam;
        } else {
            console.warn(`Machine ${machineParam} not found in select options.`);
        }
    }

    fetchStoredICT(); // Also calls updateDashboard
    
    // Start status polling
    updateMachineStatus();
    setInterval(updateMachineStatus, 10000);
});

async function updateMachineStatus() {
    const source = document.getElementById('machineSelect').value;
    const el = document.getElementById('lastUpdate');
    if (!source || !el) return;

    try {
        const res = await fetch('/api/status');
        const statuses = await res.json();
        console.log('OEE Machine Statuses:', statuses);
        
        const baseName = source.split('_')[0]; 
        const relevant = statuses.filter(s => s.Source === source || s.Source === baseName);
        
        if (relevant.length === 0) {
            el.innerText = 'No recent data';
            el.style.color = '#888';
            return;
        }

        relevant.sort((a, b) => a.SecondsAgo - b.SecondsAgo);
        const s = relevant[0];

        const now = new Date();
        const lastDate = new Date(now.getTime() - (s.SecondsAgo * 1000));
        const timeStr = lastDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const minsAgo = Math.floor(s.SecondsAgo / 60);
        const agoStr = minsAgo < 1 ? 'just now' : minsAgo + 'm ago';

        el.innerText = 'Last data: ' + timeStr + ' (' + agoStr + ')';
        el.style.color = s.SecondsAgo > 600 ? '#d73a49' : '#888';
    } catch (e) { console.error('Status poll failed', e); }
}

async function fetchStoredICT() {
    const source = document.getElementById('machineSelect').value;
    try {
        const response = await fetch('/api/settings/cycle-times');
        const data = await response.json();
        const entry = data.find(d => d.machine_id === source);
        const ictValue = entry ? entry.ideal_cycle_time : 10.0;
        document.getElementById('ictDisplay').innerText = ictValue;
    } catch (err) {
        console.error('Error fetching ICT:', err);
        document.getElementById('ictDisplay').innerText = '10.0';
    }
    updateDashboard();
}

async function updateDashboard() {
    const date = document.getElementById('dateFilter').value;
    const source = document.getElementById('machineSelect').value;

    if (!date || !source) return;

    // Trigger immediate status refresh
    updateMachineStatus();

    // Update URL without reload to reflect current selection
    const url = new URL(window.location);
    url.searchParams.set('date', date);
    url.searchParams.set('machine', source);
    window.history.pushState({}, '', url);

    // Update navigation links to carry over the machine selection
    const relLink = document.querySelector('a[href^="reliability.html"]');
    if (relLink) {
        relLink.href = `reliability.html?machine=${source}`;
    }

    try {
        let ict = document.getElementById('ictDisplay').innerText;
        if (ict === '--') {
            console.log('ICT not yet loaded, fetching OEE with default/auto ICT');
        }

        const fetchUrl = `/api/oee?date=${date}&source=${source}&idealCycleTime=${ict}`;
        const response = await fetch(fetchUrl);
        if (!response.ok) throw new Error('Server error ' + response.status);
        const data = await response.json();

        if (!data || !data.kpis) {
            showDataStatus('oeeDataStatus', '', 'No data for this period.');
            return;
        }

        lastOeeSuccess = new Date();
        clearDataStatus('oeeDataStatus');

        currentTimelineData = data.timeline.sort((a, b) => b.startTime.localeCompare(a.startTime));
        currentSort = { column: 0, direction: 'desc' };

        const ths = document.querySelectorAll('#timelineTable th');
        ths.forEach((th, i) => {
            th.classList.remove('sort-asc', 'sort-desc');
            if (i === 0) th.classList.add('sort-desc');
        });

        renderKPIs(data.kpis);
        renderStateChart(data.summary);
        renderWaterfallChart(data.kpis, data.topLosses);
        renderParetoChart(data.topLosses);
        renderTimeline(currentTimelineData);

        updateMachineStatus();

    } catch (err) {
        console.error('Error fetching OEE data:', err);
        const lastStr = lastOeeSuccess
            ? 'Last successful: ' + lastOeeSuccess.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : '';
        showDataStatus('oeeDataStatus', 'error',
            'Could not load data.' + (lastStr ? ' ' + lastStr + '.' : '') +
            ' <a href="#" onclick="updateDashboard(); return false;">Retry</a>');
    }
}

function renderKPIs(kpis) {
    document.getElementById('kpiOpAvail').innerText = kpis.operationalAvailability + '%';
    document.getElementById('kpiTechAvail').innerText = kpis.technicalAvailability + '%';
    document.getElementById('kpiPerformance').innerText = kpis.performance + '%';
    document.getElementById('kpiQuality').innerText = kpis.quality + '%';
    document.getElementById('kpiOee').innerText = kpis.oee + '%';
    
    // Update sub-text labels
    const formatLoss = (sec) => {
        if (sec >= 3600) return (sec / 3600).toFixed(1) + 'h';
        return Math.floor(sec / 60) + 'm';
    };
    document.getElementById('kpiTotalLoss').innerText = `Total Loss : ${formatLoss(kpis.totalLoss)}`;
    document.getElementById('kpiPerformance').nextElementSibling.innerText = `Total Produced: ${kpis.totalCount} cases`;
    document.getElementById('kpiQuality').nextElementSibling.innerText = `Rejects: ${kpis.badCount} cases`;
    
    // Display MTBF/MTTR in minutes or seconds depending on scale
    const formatTime = (sec) => {
        if (sec > 3600) return (sec / 3600).toFixed(1) + 'h';
        if (sec > 60) return (sec / 60).toFixed(1) + 'm';
        return sec + 's';
    };

    document.getElementById('kpiMtbf').innerText = kpis.mtbf ? formatTime(kpis.mtbf) : 'N/A';
    document.getElementById('kpiMttr').innerText = kpis.totalFailures > 0 ? formatTime(kpis.mttr) : 'No Faults';
}

let waterfallUnit = 'pct';   // 'pct' or 'min'
let waterfallContext = null; // last { kpis, topLosses } for re-render

function setWaterfallUnit(unit) {
    waterfallUnit = unit;
    document.querySelectorAll('#wfUnit .unit-opt').forEach(a => {
        a.classList.toggle('active', a.dataset.unit === unit);
    });
    if (waterfallContext) renderWaterfallChart(waterfallContext.kpis, waterfallContext.topLosses);
}

function fmtMin(sec) {
    const m = sec / 60;
    if (m >= 60) return `${(m / 60).toFixed(1)}h`;
    return `${m.toFixed(0)}m`;
}

function renderWaterfallChart(kpis, topLosses) {
    waterfallContext = { kpis, topLosses };
    const ctx = document.getElementById('waterfallChart').getContext('2d');
    if (waterfallChart) waterfallChart.destroy();

    const a = parseFloat(kpis.operationalAvailability) || 0;
    const p = parseFloat(kpis.performance) || 0;
    const q = parseFloat(kpis.quality) || 0;
    const oee = parseFloat(kpis.oee) || 0;

    const availReasons = (topLosses || []).slice(0, 5);
    const availTimeSec = kpis.availableTime || 0;
    const uptimeSec = availTimeSec * a / 100; // Run + Starved + Blocked (ISO 22400 uptime)
    const totalCount = kpis.totalCount || 0;
    const badCount = kpis.badCount || 0;

    // Values in either unit
    let productive, losses, axisMax, lossNames, axisFmt, makeLabel;
    if (waterfallUnit === 'min') {
        // Time values in seconds, then formatted in tooltip; X axis values are in seconds for stacking math
        const plantOpSec = availTimeSec;
        const plannedSec = availTimeSec;
        const netRunSec = uptimeSec * p / 100;
        const fullProdSec = uptimeSec * p * q / 10000;

        const schedLossSec = 0;
        const availLossSec = Math.max(0, plannedSec - uptimeSec);
        const perfLossSec = Math.max(0, uptimeSec - netRunSec);
        const qualLossSec = Math.max(0, netRunSec - fullProdSec);

        productive = [plantOpSec, plannedSec, uptimeSec, netRunSec, fullProdSec];
        losses = [0, schedLossSec, availLossSec, perfLossSec, qualLossSec];
        axisMax = plantOpSec || 1;
        axisFmt = (v) => fmtMin(v);
        makeLabel = (sec) => fmtMin(sec);
    } else {
        const runVal = a;
        const netRunVal = (a * p) / 100;
        const fullyProdVal = oee;
        const availLoss = Math.max(0, 100 - runVal);
        const perfLoss = Math.max(0, runVal - netRunVal);
        const qualLoss = Math.max(0, netRunVal - fullyProdVal);

        productive = [100, 100, runVal, netRunVal, fullyProdVal];
        losses = [0, 0, availLoss, perfLoss, qualLoss];
        axisMax = 100;
        axisFmt = (v) => v + '%';
        makeLabel = (v) => `${v.toFixed(1)}%`;
    }

    const lossCategoryNames = ['—', 'Schedule Loss', 'Availability Loss', 'Performance Loss', 'Quality Loss'];
    const lossColors = ['rgba(0,0,0,0)', '#9e9e9e', '#a4262c', '#ffb900', '#d97706'];

    waterfallChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: [
                'Plant Operating Time',
                'Planned Production Time',
                'Machine Uptime',
                'Net Run Time',
                `Fully Productive Time (OEE ${oee.toFixed(1)}%)`
            ],
            datasets: [
                {
                    label: 'Productive',
                    data: productive,
                    backgroundColor: ['#0056b3', '#107c10', '#107c10', '#107c10', '#107c10'],
                    stack: 'oee'
                },
                {
                    label: 'Loss',
                    data: losses,
                    backgroundColor: lossColors,
                    stack: 'oee'
                }
            ]
        },
        options: {
            indexAxis: 'y',
            responsive: true, maintainAspectRatio: false,
            scales: {
                x: { stacked: true, beginAtZero: true, max: axisMax, ticks: { callback: axisFmt } },
                y: { stacked: true, grid: { display: false }, ticks: { font: { size: 12, weight: '600' } } }
            },
            plugins: {
                legend: { display: false },
                datalabels: { display: false },
                tooltip: {
                    callbacks: {
                        title: (items) => items[0].label.split('(')[0].trim(),
                        label: (item) => {
                            const i = item.dataIndex;
                            const isLoss = item.dataset.label === 'Loss';
                            const v = item.parsed.x;
                            if (!isLoss) return `Remaining: ${makeLabel(v)}`;
                            if (i === 0 || v === 0) return null;
                            return `${lossCategoryNames[i]}: −${makeLabel(v)}`;
                        },
                        afterBody: (items) => {
                            const item = items.find(it => it.dataset.label === 'Loss') || items[0];
                            const i = item.dataIndex;
                            if (i === 2) {
                                if (!availReasons.length) return ['(no downtime reasons logged)'];
                                const total = availReasons.reduce((s, r) => s + r.duration, 0);
                                return ['', 'Top downtime reasons:'].concat(
                                    availReasons.map(r => {
                                        const pct = total > 0 ? (r.duration / total * 100).toFixed(0) : 0;
                                        const mins = (r.duration / 60).toFixed(0);
                                        return `  • ${r.reason}: ${mins}m (${pct}%)`;
                                    })
                                );
                            }
                            if (i === 3) {
                                const gap = uptimeSec * (1 - p / 100);
                                return ['', 'Speed / minor stops:', `  ≈ ${(gap / 60).toFixed(0)} min lost to speed & line constraints`];
                            }
                            if (i === 4) {
                                const rate = totalCount > 0 ? (badCount / totalCount * 100).toFixed(2) : '0';
                                return ['', `Rejects: ${badCount.toLocaleString()} / ${totalCount.toLocaleString()} cases (${rate}%)`];
                            }
                            return [];
                        }
                    }
                }
            }
        }
    });
}

function renderStateChart(summary) {
    const ctx = document.getElementById('stateChart').getContext('2d');
    if (stateChart) stateChart.destroy();

    const colors = {
        'Running': '#4caf50',
        'Starved': '#2196f3',
        'Blocked': '#ff9800',
        'Faulted': '#f44336',
        'Planned Stop': '#9e9e9e',
        'Idle/Wait Operator': '#ffeb3b',
        'Running/Starved': '#4caf50'
    };

    stateChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: summary.map(s => s.stateLabel),
            datasets: [{
                data: summary.map(s => s.percentage),
                durations: summary.map(s => (s.duration / 60).toFixed(1)), // Add duration data
                backgroundColor: summary.map(s => colors[s.stateLabel] || '#ccc')
            }]
        },
        options: {
            maintainAspectRatio: false,
            plugins: {
                legend: { 
                    position: 'right',
                    labels: { boxWidth: 12, font: { size: 11 } }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const pct = context.raw || 0;
                            const mins = context.dataset.durations[context.dataIndex] || 0;
                            return `${label}: ${mins} min (${pct}%)`;
                        }
                    },
                    bodyFont: { size: 12 }
                },
                datalabels: {
                    color: '#fff',
                    font: { weight: 'bold', size: 11 },
                    formatter: (value, ctx) => {
                        const mins = ctx.dataset.durations[ctx.dataIndex];
                        return mins > 0 ? `${mins}m\n(${value}%)` : '';
                    },
                    textAlign: 'center',
                    display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 4 // Only show if > 4% to avoid crowding
                }
            }
        }
    });
}

const paretoLineOnTopPlugin = {
    id: 'paretoLineOnTop',
    afterDatasetsDraw(chart) {
        const ctx = chart.ctx;
        const yScale = chart.scales.y;
        const xScale = chart.scales.cumPct;
        if (!yScale || !xScale) return;

        chart.data.datasets.forEach((ds) => {
            if (ds.type !== 'line' || !ds._paretoOverlay) return;
            const color = ds.borderColor || '#000';
            const width = ds.borderWidth || 2;
            const radius = ds.pointRadius || 0;
            const dash = ds.borderDash || [];

            ctx.save();
            ctx.strokeStyle = color;
            ctx.lineWidth = width;
            ctx.setLineDash(dash);
            ctx.beginPath();
            ds.data.forEach((val, i) => {
                const x = xScale.getPixelForValue(val);
                const y = yScale.getPixelForValue(i);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });
            ctx.stroke();
            ctx.setLineDash([]);

            if (radius > 0) {
                ctx.fillStyle = ds.pointBackgroundColor || color;
                ds.data.forEach((val, i) => {
                    const x = xScale.getPixelForValue(val);
                    const y = yScale.getPixelForValue(i);
                    ctx.beginPath();
                    ctx.arc(x, y, radius, 0, Math.PI * 2);
                    ctx.fill();
                });
            }
            ctx.restore();
        });
    }
};

function renderParetoChart(losses) {
    const ctx = document.getElementById('paretoChart').getContext('2d');
    if (paretoChart) paretoChart.destroy();

    const totalDuration = losses.reduce((sum, l) => sum + l.duration, 0);
    let cumSum = 0;
    const cumulative = losses.map(l => {
        cumSum += l.duration;
        return parseFloat(((cumSum / totalDuration) * 100).toFixed(1));
    });

    paretoChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: losses.map(l => l.reason),
            datasets: [
                {
                    label: 'Loss Duration (min)',
                    data: losses.map(l => (l.duration / 60).toFixed(1)),
                    backgroundColor: '#a4262c',
                    borderRadius: 4,
                    xAxisID: 'x'
                },
                {
                    type: 'line',
                    label: 'Cumulative %',
                    data: cumulative,
                    borderColor: '#0056b3',
                    borderWidth: 2,
                    pointRadius: 4,
                    pointBackgroundColor: '#0056b3',
                    fill: false,
                    tension: 0,
                    xAxisID: 'cumPct',
                    showLine: false,
                    pointStyle: false,
                    _paretoOverlay: true
                },
                {
                    type: 'line',
                    label: '80% target',
                    data: losses.map(() => 80),
                    borderColor: '#888',
                    borderWidth: 1,
                    borderDash: [5, 5],
                    pointRadius: 0,
                    fill: false,
                    xAxisID: 'cumPct',
                    showLine: false,
                    _paretoOverlay: true
                }
            ]
        },
        plugins: [paretoLineOnTopPlugin],
        options: {
            indexAxis: 'y',
            maintainAspectRatio: false,
            layout: { padding: { left: 20 } },
            plugins: {
                legend: {
                    display: true,
                    labels: {
                        filter: item => item.text !== '80% target',
                        boxWidth: 12,
                        font: { size: 11 }
                    }
                },
                tooltip: {
                    enabled: true,
                    bodyFont: { size: 12 },
                    callbacks: {
                        label: (ctx) => {
                            if (ctx.dataset.label === 'Loss Duration (min)') return `Duration: ${ctx.raw} min`;
                            if (ctx.dataset.label === 'Cumulative %') return `Cumulative: ${ctx.raw}%`;
                            return null;
                        }
                    }
                },
                datalabels: { display: false }
            },
            scales: {
                x: { beginAtZero: true, position: 'bottom', title: { display: true, text: 'Minutes' } },
                cumPct: {
                    type: 'linear',
                    position: 'top',
                    min: 0,
                    max: 100,
                    title: { display: true, text: 'Cumulative %' },
                    ticks: { callback: v => v + '%' },
                    grid: { drawOnChartArea: false }
                },
                y: { ticks: { autoSkip: false, font: { size: 11 } } }
            }
        }
    });
}

function renderTimeline(timeline) {
    const tbody = document.getElementById('timelineBody');
    tbody.innerHTML = '';

    if (timeline.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="status-line">No data for this period.</td></tr>';
        return;
    }

    timeline.forEach(row => {
        const tr = document.createElement('tr');
        
        let stateClass = '';
        if (row.stateLabel === 'Running') stateClass = 'style="color: #107c10; font-weight: bold;"';
        if (row.stateLabel === 'Faulted') stateClass = 'style="color: #a4262c; font-weight: bold;"';

        tr.innerHTML = `
            <td>${row.startTime}</td>
            <td ${stateClass}>${row.stateLabel}</td>
            <td>${row.reasonLabel}</td>
            <td>${row.duration}</td>
            <td>${(row.duration / 60).toFixed(1)}</td>
        `;
        tbody.appendChild(tr);
    });
}

function sortTimeline(columnIndex) {
    const columns = ['startTime', 'stateLabel', 'reasonLabel', 'duration', 'duration'];
    const key = columns[columnIndex];
    
    if (currentSort.column === columnIndex) {
        currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
        currentSort.column = columnIndex;
        currentSort.direction = 'asc';
    }

    // Update UI Indicators
    const ths = document.querySelectorAll('#timelineTable th');
    ths.forEach((th, i) => {
        th.classList.remove('sort-asc', 'sort-desc');
        if (i === columnIndex) {
            th.classList.add(currentSort.direction === 'asc' ? 'sort-asc' : 'sort-desc');
        }
    });

    currentTimelineData.sort((a, b) => {
        let valA = a[key];
        let valB = b[key];

        if (typeof valA === 'string') {
            return currentSort.direction === 'asc' 
                ? valA.localeCompare(valB) 
                : valB.localeCompare(valA);
        } else {
            return currentSort.direction === 'asc' ? valA - valB : valB - valA;
        }
    });

    renderTimeline(currentTimelineData);
}

function exportToExcel() {
    if (!currentTimelineData || currentTimelineData.length === 0) {
        alert("No data to export");
        return;
    }

    const headers = ["Start Time", "State", "Reason", "Duration (s)", "Duration (min)"];
    const csvRows = [headers.join(",")];
    
    currentTimelineData.forEach(row => {
        const values = [
            `"${row.startTime}"`,
            `"${row.stateLabel}"`,
            `"${row.reasonLabel}"`,
            row.duration,
            (row.duration / 60).toFixed(1)
        ];
        csvRows.push(values.join(","));
    });

    const csvString = csvRows.join("\n");
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement("a");
    const date = document.getElementById('dateFilter').value;
    const machine = document.getElementById('machineSelect').value;
    
    link.setAttribute("href", url);
    link.setAttribute("download", `Timeline_${machine}_${date}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
