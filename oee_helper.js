/**
 * OEE Helper Module
 * Centralizes state mappings, reason codes, and calculation logic for Machine Availability.
 */

const stateMap = {
    1: 'Running',
    2: 'Starved',
    3: 'Blocked',
    4: 'Idle/Wait Operator',
    5: 'Faulted',
    6: 'Planned Stop'
};

const reasonMap = {
    0: 'No Specific Reason',
    200: 'No infeed product',
    300: 'No Case',
    301: 'Infeed Roller Faulted',
    302: 'Sorter Roller Faulted',
    303: 'Flip A Roller Faulted',
    304: 'Flip B Roller Faulted',
    305: 'No Pallet',
    306: 'No Demand',
    401: 'Machine Stopped',
    402: 'Machine Idle',
    403: 'Machine Held',
    410: 'Seal Tape Problem',
    411: 'Case Stack1 Empty',
    412: 'Case Stack2 Empty',
    413: 'Case Stack3 Empty',
    501: 'Stack Plate Error',
    502: 'Pusher Error',
    503: 'Head Slide Error',
    504: 'Clamper Error',
    505: 'Lift Error',
    506: 'Sweeper Error',
    507: 'Sweeper Drive Alarm',
    510: 'Flipper Push In Guide Error',
    511: 'Flipper Guide L Error',
    512: 'Flipper Guide R Error',
    513: 'Flipper Arm L Error',
    514: 'Flipper Arm R Error',
    515: 'Flipper 90deg Error',
    516: 'Flipper Vacuum Error',
    520: 'Safety Open',
    530: 'Robot Error',
    551: 'Gripper Vacuum Error',
    552: 'Gripper Error',
    553: 'Top Sheet Empty',
    600: 'Module Disabled'
};

/**
 * Resolves a StateCode into a human-readable label.
 */
function getStateLabel(code) {
    return stateMap[code] || `Unknown (${code})`;
}

/**
 * Resolves a ReasonCode into a human-readable label.
 */
function getReasonLabel(code) {
    return reasonMap[code] || `Unknown Reason (${code})`;
}

/**
 * Calculates durations between state changes.
 * Filters out State 0 (Heartbeat/No Change) and can optionally merge Running/Starved.
 * 
 * @param {Array} rows - Database records from ReceivedOEE
 * @param {Boolean} mergeRunningStarved - If true, treats 1 and 2 as the same state
 */
function calculateStateDurations(rows, mergeRunningStarved = false, idealCycleTime = 0, totalCount = 0, badCount = 0) {
    if (!rows || rows.length < 2) return { timeline: [], summary: [], kpis: {}, topLosses: [] };

    // Filter out state 0 (Heartbeat)
    const filtered = rows.filter(r => r.StateCode !== 0);
    if (filtered.length < 2) return { timeline: [], summary: [], kpis: {}, topLosses: [] };

    const processedRows = [];
    if (mergeRunningStarved) {
        let lastEffectiveState = (filtered[0].StateCode === 1 || filtered[0].StateCode === 2) ? 'UP' : filtered[0].StateCode;
        processedRows.push(filtered[0]);
        for (let i = 1; i < filtered.length; i++) {
            const currentState = (filtered[i].StateCode === 1 || filtered[i].StateCode === 2) ? 'UP' : filtered[i].StateCode;
            if (currentState !== lastEffectiveState) {
                processedRows.push(filtered[i]);
                lastEffectiveState = currentState;
            }
        }
    } else {
        processedRows.push(...filtered);
    }

    const timeline = [];
    const totalsByState = {};
    const totalsByReason = {};
    let faultCount = 0;
    let totalTime = 0;

    for (let i = 0; i < processedRows.length - 1; i++) {
        const current = processedRows[i];
        const next = processedRows[i + 1];

        const start = new Date(current.LocalTimestamp);
        const end = new Date(next.LocalTimestamp);
        const durationSec = Math.floor((end - start) / 1000);

        if (durationSec >= 0) {
            let label = getStateLabel(current.StateCode);
            if (mergeRunningStarved && (current.StateCode === 1 || current.StateCode === 2)) {
                label = 'Running/Starved';
            }

            timeline.push({
                startTime: current.LocalTimestamp,
                stateLabel: label,
                reasonLabel: getReasonLabel(current.ReasonCode),
                duration: durationSec
            });

            // Aggregates
            totalTime += durationSec;
            totalsByState[label] = (totalsByState[label] || 0) + durationSec;

            // Pareto logic (only for loss states: Faulted, Idle, Blocked, Starved)
            if (current.StateCode >= 2 && current.StateCode <= 5) {
                const reasonKey = `${label}: ${getReasonLabel(current.ReasonCode)}`;
                totalsByReason[reasonKey] = (totalsByReason[reasonKey] || 0) + durationSec;
            }

            if (current.StateCode === 5) faultCount++;
        }
    }

    // KPI Calculations
    const runTime = totalsByState['Running'] || totalsByState['Running/Starved'] || 0;
    const starvedTime = totalsByState['Starved'] || 0;
    const blockedTime = totalsByState['Blocked'] || 0;
    const idleTime = totalsByState['Idle/Wait Operator'] || 0;
    const faultTime = totalsByState['Faulted'] || 0;
    const plannedStop = totalsByState['Planned Stop'] || 0;

    // ISO 22400: Uptime = machine-ready states (line-constrained minor stops included)
    const uptime = runTime + starvedTime + blockedTime;
    const availableTime = totalTime - plannedStop;
    // TA numerator: only Faulted reduces it; Idle/Wait Operator is human-response loss
    const techUptime = uptime + idleTime;

    // A = Operational Availability: downtime = Faulted + Idle/Wait Operator
    const availability = availableTime > 0 ? (uptime / availableTime) : 0;

    // P = (IdealCycleTimeSec x TotalCount) / Uptime (Starved + Blocked are minor stops)
    let performance = 0;
    if (uptime > 0 && idealCycleTime > 0) {
        performance = (idealCycleTime * totalCount) / uptime;
        if (performance > 1) performance = 1;
    }

    // Q = (TotalCount - BadCount) / TotalCount
    let quality = 0;
    if (totalCount > 0) {
        quality = (totalCount - badCount) / totalCount;
        if (quality < 0) quality = 0;
    }

    // OEE = A x P x Q
    const oeeValue = availability * performance * quality;

    const kpis = {
        operationalAvailability: (availability * 100).toFixed(1),
        technicalAvailability: availableTime > 0 ? ((techUptime / availableTime) * 100).toFixed(1) : 0,
        performance: (performance * 100).toFixed(1),
        quality: (quality * 100).toFixed(1),
        oee: (oeeValue * 100).toFixed(1),
        mtbf: faultCount > 0 ? Math.floor(uptime / faultCount) : null,
        mttr: faultCount > 0 ? Math.floor(faultTime / faultCount) : 0,
        totalFailures: faultCount,
        totalCount: totalCount,
        badCount: badCount,
        runTime: runTime,
        availableTime: availableTime,
        totalLoss: availableTime - uptime
    };

    const summary = Object.keys(totalsByState).map(label => ({
        stateLabel: label,
        duration: totalsByState[label],
        percentage: totalTime > 0 ? ((totalsByState[label] / totalTime) * 100).toFixed(1) : 0
    })).sort((a, b) => b.duration - a.duration);

    const topLosses = Object.keys(totalsByReason).map(reason => ({
        reason: reason,
        duration: totalsByReason[reason]
    })).sort((a, b) => b.duration - a.duration).slice(0, 5);

    return { timeline, summary, kpis, topLosses, totalDuration: totalTime };
}

module.exports = {
    stateMap,
    reasonMap,
    getStateLabel,
    getReasonLabel,
    calculateStateDurations
};
