// Register datalabels plugin globally
Chart.register(ChartDataLabels);

let stateChart = null;
let paretoChart = null;
let currentTimelineData = [];
let currentSort = { column: null, direction: 'asc' };

document.addEventListener('DOMContentLoaded', () => {
    // Set default date to today
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('dateFilter').value = today;
    fetchStoredICT(); // Also calls updateDashboard
});

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

    try {
        // Backend now handles ICT lookup if not passed, but we can pass it if we want to be explicit
        const ict = document.getElementById('ictDisplay').innerText;
        const response = await fetch(`/api/oee?date=${date}&source=${source}&idealCycleTime=${ict}`);
        const data = await response.json();

        if (!data || !data.kpis) {
            alert('No data found for this selection.');
            return;
        }

        // Default sort: Newer top (Time Descending)
        currentTimelineData = data.timeline.sort((a, b) => b.startTime.localeCompare(a.startTime));
        currentSort = { column: 0, direction: 'desc' };
        
        // Update UI Indicators for default sort
        const ths = document.querySelectorAll('#timelineTable th');
        ths.forEach((th, i) => {
            th.classList.remove('sort-asc', 'sort-desc');
            if (i === 0) th.classList.add('sort-desc');
        });

        renderKPIs(data.kpis);
        renderStateChart(data.summary);
        renderParetoChart(data.topLosses);
        renderTimeline(currentTimelineData);

    } catch (err) {
        console.error('Error fetching OEE data:', err);
    }
}

function renderKPIs(kpis) {
    document.getElementById('kpiOpAvail').innerText = kpis.operationalAvailability + '%';
    document.getElementById('kpiTechAvail').innerText = kpis.technicalAvailability + '%';
    document.getElementById('kpiPerformance').innerText = kpis.performance + '%';
    document.getElementById('kpiQuality').innerText = kpis.quality + '%';
    document.getElementById('kpiOee').innerText = kpis.oee + '%';
    
    // Update sub-text with raw counts
    document.getElementById('kpiPerformance').nextElementSibling.innerText = `Total Produced: ${kpis.totalCount} cases`;
    document.getElementById('kpiQuality').nextElementSibling.innerText = `Rejects: ${kpis.badCount} cases`;
    
    // Display MTBF/MTTR in minutes or seconds depending on scale
    const formatTime = (sec) => {
        if (sec > 3600) return (sec / 3600).toFixed(1) + 'h';
        if (sec > 60) return (sec / 60).toFixed(1) + 'm';
        return sec + 's';
    };

    document.getElementById('kpiMtbf').innerText = formatTime(kpis.mtbf);
    document.getElementById('kpiMttr').innerText = formatTime(kpis.mttr);
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

function renderParetoChart(losses) {
    const ctx = document.getElementById('paretoChart').getContext('2d');
    if (paretoChart) paretoChart.destroy();

    paretoChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: losses.map(l => l.reason), // Show full text
            datasets: [{
                label: 'Loss Duration (min)',
                data: losses.map(l => (l.duration / 60).toFixed(1)),
                backgroundColor: '#a4262c',
                borderRadius: 4
            }]
        },
        options: {
            indexAxis: 'y',
            maintainAspectRatio: false,
            layout: {
                padding: {
                    left: 20 // Extra space for labels
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    enabled: true,
                    bodyFont: { size: 12 },
                    callbacks: {
                        label: (ctx) => `Duration: ${ctx.raw} min`
                    }
                },
                datalabels: { display: false } // Hide labels on Pareto chart
            },
            scales: {
                x: { beginAtZero: true, title: { display: true, text: 'Minutes' } },
                y: {
                    ticks: {
                        autoSkip: false,
                        font: { size: 11 }
                    }
                }
            }
        }
    });
}

function renderTimeline(timeline) {
    const tbody = document.getElementById('timelineBody');
    tbody.innerHTML = '';

    // If no explicit sort, show original (usually chronological)
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
