// Shared across all dashboard pages

function toggleMenu() {
    document.getElementById('navMenu').classList.toggle('active');
    document.querySelector('.menu-toggle').classList.toggle('is-open');
}

function setActiveNav() {
    const page = window.location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.nav-link').forEach(link => {
        if (link.getAttribute('href').split('?')[0] === page) {
            link.classList.add('active');
        }
    });
}

document.addEventListener('DOMContentLoaded', setActiveNav);

function showDataStatus(id, type, html) {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = type === 'error' ? 'status-line is-error' : 'status-line';
    el.innerHTML = html;
}

function clearDataStatus(id) {
    const el = document.getElementById(id);
    if (el) { el.className = 'status-line'; el.innerHTML = ''; }
}
