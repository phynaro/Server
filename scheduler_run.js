const scheduler = require('./scheduler_helper');

// Run every 30 minutes
setInterval(async () => {
    try {
        await scheduler.runDailyUpdate();
    } catch (err) {
        console.error('[Standalone Scheduler] Error:', err);
    }
}, 30 * 60 * 1000);

// Initial run
console.log('[Standalone Scheduler] Starting initial update...');
scheduler.runDailyUpdate();
