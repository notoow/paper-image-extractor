// --- SSOT: Application State ---
const App = {
    state: {
        images: [], // All images (Raw Data)
        selectedIndices: new Set(),
        title: "paper",
        filterSmall: true,
        filterThreshold: 20, // Default: Hide bottom 20%
        sortMode: 'original' // 'original', 'asc', 'desc'
    },

    ui: {
        doiInput: document.getElementById('doiInput'),
        extractBtn: document.getElementById('extractBtn'),
        btnText: document.getElementById('btnText'),
        btnSpinner: document.getElementById('btnSpinner'),
        statusMsg: document.getElementById('statusMsg'),

        uploadLink: document.getElementById('uploadLink'),
        pdfUploadInput: document.getElementById('pdfUploadInput'),
        uploadArea: document.querySelector('.upload-area'),
        searchBox: document.querySelector('.search-box'),

        resultSection: document.getElementById('resultSection'),
        imgCount: document.getElementById('imgCount'),
        downloadAllBtn: document.getElementById('downloadAllBtn'),
        gallery: document.getElementById('gallery'),

        filterToggle: document.getElementById('filterToggle'),
        sizeSlider: document.getElementById('sizeSlider'),
        sliderTooltip: document.getElementById('sliderTooltip'),

        sortBtn: document.getElementById('sortBtn')
    },

    init() {
        // Event Listeners
        if (this.ui.extractBtn) {
            this.ui.extractBtn.addEventListener('click', () => this.processDoi());
        }
        if (this.ui.doiInput) {
            this.ui.doiInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.processDoi();
            });
        }

        // Upload Events
        if (this.ui.uploadLink && this.ui.pdfUploadInput) {
            this.ui.uploadLink.addEventListener('click', () => this.ui.pdfUploadInput.click());
            this.ui.pdfUploadInput.addEventListener('change', (e) => this.handleFileUpload(e));
        }

        // Drag & Drop
        this.setupDragAndDrop();

        // Download Event
        if (this.ui.downloadAllBtn) {
            this.ui.downloadAllBtn.addEventListener('click', () => this.downloadImages());
        }

        // Filter Toggle Event
        if (this.ui.filterToggle) {
            if (this.state.filterSmall) {
                this.ui.filterToggle.classList.add('active');
            }

            this.ui.filterToggle.addEventListener('click', () => {
                this.state.filterSmall = !this.state.filterSmall;
                this.ui.filterToggle.classList.toggle('active', this.state.filterSmall);

                // Toggle -> Just re-apply visibility logic, no re-render
                this.applyVisibilityFilter();
            });
        }

        // Slider Event (Real-time, High Performance)
        if (this.ui.sizeSlider) {
            this.ui.sizeSlider.addEventListener('input', (e) => {
                const percent = parseInt(e.target.value);
                this.state.filterThreshold = percent;

                // 1. Tooltip Update
                if (this.ui.sliderTooltip) {
                    this.ui.sliderTooltip.textContent = percent === 0 ? "Show All" : `Hide Bottom ${percent}%`;
                }

                // 2. Direct DOM Visibility Update (No re-render!)
                if (this.state.filterSmall) {
                    this.applyVisibilityFilter();
                }
            });
        }

        // Sort Button
        if (this.ui.sortBtn) {
            this.ui.sortBtn.addEventListener('click', () => {
                const modes = ['original', 'asc', 'desc'];
                const icons = {
                    'original': 'fa-arrow-down-1-9',
                    'asc': 'fa-arrow-up-short-wide',
                    'desc': 'fa-arrow-down-wide-short'
                };

                // Cycle Mode
                const currentIdx = modes.indexOf(this.state.sortMode);
                this.state.sortMode = modes[(currentIdx + 1) % modes.length];

                // Update Icon
                this.ui.sortBtn.innerHTML = `<i class="fa-solid ${icons[this.state.sortMode]}"></i>`;

                // Sort requires re-ordering DOM, so we re-render
                this.renderGallery(this.state.images);
            });
        }
    },

    // ... (Drag & Drop, network logic same as before) ...
    setupDragAndDrop() {
        const dropZone = this.ui.searchBox;
        if (!dropZone) return;
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => { e.preventDefault(); e.stopPropagation(); }, false);
        });
        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => dropZone.classList.add('drag-over'), false);
        });
        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => dropZone.classList.remove('drag-over'), false);
        });
        dropZone.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            const files = dt.files;
            if (files.length > 0) {
                const file = files[0];
                if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
                    if (this.ui.pdfUploadInput) this.ui.pdfUploadInput.files = files;
                    this.handleFileUpload({ target: { files: files } });
                } else {
                    this.showStatus('Please drop a valid PDF file.', 'error');
                }
            }
        }, false);
    },

    async processDoi() {
        // ... (Same network logic)
        const doi = this.ui.doiInput.value.trim();
        if (!doi) { this.showStatus('Please enter a DOI.', 'error'); return; }
        this.setLoading(true);
        this.showStatus('');
        this.resetGallery();
        try {
            const response = await fetch('/api/process', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ doi: doi })
            });
            const data = await response.json();
            this.handleResponse(response, data);
        } catch (error) {
            this.showErrorWithRescueLink('Network error or timeout.');
        } finally {
            this.setLoading(false);
        }
    },

    async handleFileUpload(e) {
        // ... (Same upload logic)
        const file = e.target.files[0];
        if (!file) return;
        const formData = new FormData();
        formData.append('file', file);
        this.setLoading(true);
        this.showStatus('');
        this.resetGallery();
        try {
            const response = await fetch('/api/upload', { method: 'POST', body: formData });
            const data = await response.json();
            this.handleResponse(response, data);
        } catch (error) {
            this.showStatus('Error uploading file.', 'error');
        } finally {
            this.setLoading(false);
            this.ui.pdfUploadInput.value = '';
        }
    },

    handleResponse(response, data) {
        if (response.ok && data.status === 'success') {
            this.renderSuccess(data);
        } else if (data && data.status === 'manual_link') {
            this.renderManualLink(data);
        } else {
            const errorMsg = data.detail || 'Cloudflare blocked or PDF not found.';
            this.showErrorWithRescueLink(errorMsg);
        }
    },

    showErrorWithRescueLink(msg) {
        // ... (Previous implementation)
        const doi = this.ui.doiInput.value.trim();
        this.ui.statusMsg.className = '';
        let html = `<div class="rescue-box"><span class="rescue-text"><i class="fa-solid fa-triangle-exclamation"></i> ${msg}</span>`;
        if (doi) {
            html += `<a href="https://doi.org/${doi}" target="_blank" class="rescue-link-btn"><i class="fa-solid fa-external-link-alt"></i> Open Publisher Site</a><span class="rescue-hint">Download PDF there and drag it here!</span>`;
        }
        html += `</div>`;
        this.ui.statusMsg.innerHTML = html;
        if (this.ui.uploadArea) this.ui.uploadArea.style.display = 'block';
    },

    renderManualLink(data) { this.showErrorWithRescueLink("Protected Paper. Please download manually."); },

    renderSuccess(data) {
        this.showStatus(`Successfully extracted ${data.image_count} images!`, 'success');
        this.state.images = data.images; // Store Raw Data

        let safeTitle = data.title || "paper";
        safeTitle = safeTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        this.state.title = safeTitle.substring(0, 50);

        // Initial Render
        this.renderGallery(data.images);

        this.ui.resultSection.classList.add('visible');
        document.body.classList.add('has-results');
        if (this.ui.uploadArea) this.ui.uploadArea.style.display = 'none';
        const actionBtns = document.querySelector('.action-buttons');
        if (actionBtns) actionBtns.style.display = 'none';

        this.updateDownloadBtn();
    },

    // --- High Performance Rendering & Filtering ---

    // 1. Render All Cards (Sorted) - Only called on Init or Sort Change
    renderGallery(allImages) {
        this.ui.gallery.innerHTML = '';
        this.state.selectedIndices.clear();

        // Prepare sorted list for display order
        let displayImages = [...allImages];
        if (this.state.sortMode === 'asc') {
            displayImages.sort((a, b) => (a.width * a.height) - (b.width * b.height));
        } else if (this.state.sortMode === 'desc') {
            displayImages.sort((a, b) => (b.width * b.height) - (a.width * a.height));
        }
        // 'original' uses original order

        displayImages.forEach((img) => {
            const originalIndex = this.state.images.indexOf(img);
            const area = img.width * img.height;

            const card = document.createElement('div');
            card.className = 'img-card';
            // Store area for fast filtering
            card.dataset.area = area;
            card.dataset.index = originalIndex; // Store ID

            const checkbox = document.createElement('div');
            checkbox.className = 'checkbox-overlay';
            checkbox.innerHTML = '<i class="fa-solid fa-check"></i>';

            const wrapper = document.createElement('div');
            wrapper.className = 'img-wrapper';
            const imgEl = document.createElement('img');
            imgEl.src = img.base64;
            // Lazy load can be added here if needed, but base64 is already in memory
            wrapper.appendChild(imgEl);

            const info = document.createElement('div');
            info.className = 'img-info';
            info.innerHTML = `<span>#${originalIndex + 1}</span> <span>${img.width}x${img.height}</span>`;

            card.append(checkbox, wrapper, info);
            this.ui.gallery.appendChild(card);

            card.addEventListener('click', () => {
                this.toggleSelection(originalIndex, card, checkbox);
            });
        });

        // Apply initial filter visibility
        this.applyVisibilityFilter();
    },

    // 2. Fast Visibility Toggle (No Re-render)
    applyVisibilityFilter() {
        if (!this.state.images.length) return;

        let cutoffArea = 0;

        // Calculate Cutoff (Semantic Percentile)
        if (this.state.filterSmall && this.state.filterThreshold > 0) {
            // Need sorted areas to find percentile
            // Sort only areas array (fast numeric sort)
            const areas = this.state.images.map(img => img.width * img.height).sort((a, b) => a - b);
            const cutoffIndex = Math.floor(areas.length * (this.state.filterThreshold / 100));
            cutoffArea = areas[cutoffIndex] || 0;
        }

        // Apply to DOM
        const cards = this.ui.gallery.children;
        let visibleCount = 0;

        for (let card of cards) {
            const area = parseInt(card.dataset.area);
            // Show if area >= cutoff
            // If toggle is OFF, show everything (cutoff 0 handles this mostly, but safety check)
            const isVisible = (!this.state.filterSmall) || (area >= cutoffArea);

            if (isVisible) {
                card.style.display = ''; // Reset to default (flex/block)
                visibleCount++;
            } else {
                card.style.display = 'none';
            }
        }

        this.ui.imgCount.textContent = visibleCount;
        this.updateDownloadBtn();
    },

    toggleSelection(index, card, checkbox) {
        if (this.state.selectedIndices.has(index)) {
            this.state.selectedIndices.delete(index);
            card.classList.remove('selected');
            checkbox.classList.remove('checked');
        } else {
            this.state.selectedIndices.add(index);
            card.classList.add('selected');
            checkbox.classList.add('checked');
        }
        this.updateDownloadBtn();
    },

    updateDownloadBtn() {
        // ... (Same)
        const count = this.state.selectedIndices.size;
        this.ui.downloadAllBtn.innerHTML = count > 0
            ? `<i class="fa-solid fa-download"></i> Download Selected (${count})`
            : `<i class="fa-solid fa-file-zipper"></i> Download All`;
    },

    async downloadImages() {
        // Logic needs to adapt to visibility state if no selection
        let targets = [];

        if (this.state.selectedIndices.size > 0) {
            targets = this.state.images.filter((_, i) => this.state.selectedIndices.has(i));
        } else {
            // Download Visible Cards
            // We can re-calculate visible headers or query DOM
            // Querying DOM respects current Sort AND Filter
            const visibleCards = Array.from(this.ui.gallery.children).filter(c => c.style.display !== 'none');
            const visibleIndices = visibleCards.map(c => parseInt(c.dataset.index));
            // Map indices back to images (to preserve data integrity)
            targets = visibleIndices.map(idx => this.state.images[idx]);
        }

        if (targets.length === 0) return;

        if (targets.length === 1) {
            const target = targets[0];
            const link = document.createElement('a');
            link.href = target.base64;
            const idx = this.state.images.indexOf(target) + 1;
            link.download = `${this.state.title}_${String(idx).padStart(3, '0')}.${target.ext}`;
            link.click();
            return;
        }

        if (!window.JSZip) { alert("JSZip library not loaded!"); return; }

        const zip = new JSZip();
        const folder = zip.folder(this.state.title);

        targets.forEach((img) => {
            const idx = this.state.images.indexOf(img) + 1;
            const filename = `${this.state.title}_${String(idx).padStart(3, '0')}.${img.ext}`;
            const base64Data = img.base64.split(',')[1];
            folder.file(filename, base64Data, { base64: true });
        });

        const content = await zip.generateAsync({ type: "blob" });
        saveAs(content, `${this.state.title}_images.zip`);
    },

    setLoading(isLoading) {
        if (this.ui.extractBtn) this.ui.extractBtn.disabled = isLoading;
        if (this.ui.doiInput) this.ui.doiInput.disabled = isLoading;
        if (this.ui.btnText) this.ui.btnText.style.display = isLoading ? 'none' : 'block';
        if (this.ui.btnSpinner) this.ui.btnSpinner.style.display = isLoading ? 'flex' : 'none';
        if (isLoading && this.ui.statusMsg) {
            this.ui.statusMsg.innerHTML = '';
            this.ui.statusMsg.className = 'status-msg';
        }
    },

    showStatus(msg, type = 'normal') {
        if (!this.ui.statusMsg) return;
        this.ui.statusMsg.textContent = msg;
        this.ui.statusMsg.className = `status-msg ${type}`;
    },

    resetGallery() {
        if (this.ui.gallery) this.ui.gallery.innerHTML = '';
        if (this.ui.resultSection) this.ui.resultSection.classList.remove('visible');
        this.state.images = [];
        this.state.selectedIndices.clear();
        this.updateDownloadBtn();
        const actionBtns = document.querySelector('.action-buttons');
        if (actionBtns) actionBtns.style.display = 'flex';
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
