/* 
    Zen Pillars Navigation Component
    A premium, scrollable, floating pill-tab system for RMC.
    Handles dynamic section switching and scroll-syncing.
*/

class ZenPillars {
    constructor(options = {}) {
        this.containerId = options.containerId || 'zen-pillars-nav';
        this.sectionsContainerId = options.sectionsContainerId || 'zen-sections';
        this.tabs = options.tabs || []; // [{id, label, icon}]
        this.activeTabId = options.activeTabId || (this.tabs[0] ? this.tabs[0].id : null);
        this.onTabChange = options.onTabChange || null;
        
        this.init();
    }

    init() {
        this.renderNav();
        this.attachEvents();
        this.setActive(this.activeTabId);
    }

    renderNav() {
        const container = document.getElementById(this.containerId);
        if (!container) return;

        container.classList.add('zen-pillars-wrapper');
        
        const navHtml = `
            <div class="zen-pillars-scroll-outer">
                <div class="zen-pillars-list" id="${this.containerId}-list">
                    ${this.tabs.map(tab => `
                        <button type="button" 
                                class="zen-pill ${this.activeTabId === tab.id ? 'active' : ''}" 
                                data-tab-id="${tab.id}"
                                id="pill-${tab.id}">
                            ${tab.icon ? `<span class="pill-icon">${tab.icon}</span>` : ''}
                            <span class="pill-label">${tab.label}</span>
                        </button>
                    `).join('')}
                </div>
            </div>
        `;

        container.innerHTML = navHtml;
    }

    attachEvents() {
        const list = document.getElementById(`${this.containerId}-list`);
        if (!list) return;

        list.addEventListener('click', (e) => {
            const pill = e.target.closest('.zen-pill');
            if (pill) {
                const tabId = pill.dataset.tabId;
                this.setActive(tabId);
            }
        });

        // Horizontal scroll with mouse wheel
        const outer = document.querySelector('.zen-pillars-scroll-outer');
        if (outer) {
            outer.addEventListener('wheel', (e) => {
                if (e.deltaY !== 0) {
                    e.preventDefault();
                    outer.scrollLeft += e.deltaY;
                }
            });
        }
    }

    setActive(tabId) {
        if (!tabId) return;
        
        this.activeTabId = tabId;

        // Update UI
        const pills = document.querySelectorAll(`#${this.containerId}-list .zen-pill`);
        pills.forEach(pill => {
            if (pill.dataset.tabId === tabId) {
                pill.classList.add('active');
                // Scroll into view
                pill.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            } else {
                pill.classList.remove('active');
            }
        });

        // Update sections visibility
        const sections = document.querySelectorAll(`#${this.sectionsContainerId} > .zen-section`);
        sections.forEach(sec => {
            if (sec.id === `section-${tabId}`) {
                sec.classList.remove('hidden');
                sec.classList.add('active-section');
            } else {
                sec.classList.add('hidden');
                sec.classList.remove('active-section');
            }
        });

        // Notify callback
        if (this.onTabChange) this.onTabChange(tabId);

        // Keep the selected section in view without a long smooth-scroll lag.
        const activeSection = document.getElementById(`section-${tabId}`);
        if (activeSection) {
            activeSection.scrollIntoView({ behavior: 'auto', block: 'start' });
            window.scrollBy(0, -120);
        }
    }
}

window.ZenPillars = ZenPillars;
