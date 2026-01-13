// --- SSOT: Application State ---
const App = {
    state: {
        images: [], // All images (Raw Data)
        selectedIndices: new Set(),
        deletedIndices: new Set(),
        lastSelectedIndex: null, // For Shift-Click Range Selection
        title: "paper",
        filterThreshold: 20, // Default: Hide bottom 20%
        sortMode: 'original',
        debounceTimer: null
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

        sizeSlider: document.getElementById('sizeSlider'),
        sliderTooltip: document.getElementById('sliderTooltip'),

        sortBtn: document.getElementById('sortBtn'),
        trashBtn: document.getElementById('trashBtn')
    },

    init() {
        if (this.ui.extractBtn) this.ui.extractBtn.addEventListener('click', () => this.processDoi());
        if (this.ui.doiInput) this.ui.doiInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') this.processDoi(); });
        if (this.ui.uploadLink && this.ui.pdfUploadInput) {
            this.ui.uploadLink.addEventListener('click', () => this.ui.pdfUploadInput.click());
            this.ui.pdfUploadInput.addEventListener('change', (e) => this.handleFileUpload(e));
        }
        this.setupDragAndDrop();

        if (this.ui.downloadAllBtn) this.ui.downloadAllBtn.addEventListener('click', () => this.downloadImages());

        if (this.ui.trashBtn) {
            this.ui.trashBtn.addEventListener('click', () => this.deleteSelectedImages());
        }

        // Slider Logic (Always Active)
        if (this.ui.sizeSlider) {
            // Initial Tooltip
            if (this.ui.sliderTooltip) this.ui.sliderTooltip.textContent = `Hide Bottom ${this.state.filterThreshold}%`;

            this.ui.sizeSlider.addEventListener('input', (e) => {
                const percent = parseInt(e.target.value);
                this.state.filterThreshold = percent;
                if (this.ui.sliderTooltip) this.ui.sliderTooltip.textContent = percent === 0 ? "Show All" : `Hide Bottom ${percent}%`;

                // Debounce Logic
                if (this.state.debounceTimer) clearTimeout(this.state.debounceTimer);
                this.state.debounceTimer = setTimeout(() => this.applyVisibilityFilter(), 20);
            });
        }

        if (this.ui.sortBtn) {
            this.ui.sortBtn.addEventListener('click', () => {
                const modes = ['original', 'asc', 'desc'];
                const icons = { 'original': 'fa-arrow-down-1-9', 'asc': 'fa-arrow-up-short-wide', 'desc': 'fa-arrow-down-wide-short' };
                const currentIdx = modes.indexOf(this.state.sortMode);
                this.state.sortMode = modes[(currentIdx + 1) % modes.length];
                this.ui.sortBtn.innerHTML = `<i class="fa-solid ${icons[this.state.sortMode]}"></i>`;
                this.renderGallery(this.state.images);
            });
        }
    },

    // ... (Network & DragDrop Same)
    setupDragAndDrop() {
        const dropZone = this.ui.searchBox;
        if (!dropZone) return;
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(ev => dropZone.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); }, false));
        ['dragenter', 'dragover'].forEach(ev => dropZone.addEventListener(ev, () => dropZone.classList.add('drag-over'), false));
        ['dragleave', 'drop'].forEach(ev => dropZone.addEventListener(ev, () => dropZone.classList.remove('drag-over'), false));
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
        const doi = this.ui.doiInput.value.trim();
        if (!doi) { this.showStatus('Please enter a DOI.', 'error'); return; }
        this.setLoading(true);
        this.showStatus('');
        this.resetGallery();
        try {
            const response = await fetch('/api/process', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ doi: doi }) });
            const data = await response.json();
            this.handleResponse(response, data);
        } catch (error) { this.showErrorWithRescueLink('Network error or timeout.'); } finally { this.setLoading(false); }
    },

    async handleFileUpload(e) {
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
        } catch (error) { this.showStatus('Error uploading file.', 'error'); } finally { this.setLoading(false); this.ui.pdfUploadInput.value = ''; }
    },

    handleResponse(response, data) {
        if (response.ok && data.status === 'success') { this.renderSuccess(data); }
        else if (data && data.status === 'manual_link') { this.renderManualLink(data); }
        else { this.showErrorWithRescueLink(data.detail || 'Error'); }
    },

    showErrorWithRescueLink(msg) {
        const doi = this.ui.doiInput.value.trim();
        this.ui.statusMsg.className = '';
        let html = `<div class="rescue-box"><span class="rescue-text"><i class="fa-solid fa-triangle-exclamation"></i> ${msg}</span>`;
        if (doi) html += `<a href="https://doi.org/${doi}" target="_blank" class="rescue-link-btn"><i class="fa-solid fa-external-link-alt"></i> Open Publisher Site</a><span class="rescue-hint">Download PDF there and drag it here!</span>`;
        html += `</div>`;
        this.ui.statusMsg.innerHTML = html;
        if (this.ui.uploadArea) this.ui.uploadArea.style.display = 'block';
    },
    renderManualLink(data) { this.showErrorWithRescueLink("Protected Paper. Please download manually."); },

    renderSuccess(data) {
        this.showStatus(`Successfully extracted ${data.image_count} images!`, 'success');
        this.state.images = data.images;
        let safeTitle = data.title || "paper";
        safeTitle = safeTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        this.state.title = safeTitle.substring(0, 50);
        this.renderGallery(data.images);
        this.ui.resultSection.classList.add('visible');
        document.body.classList.add('has-results');
        if (this.ui.uploadArea) this.ui.uploadArea.style.display = 'none';
        const actionBtns = document.querySelector('.action-buttons');
        if (actionBtns) actionBtns.style.display = 'none';
        this.updateDownloadBtn();
    },

    // --- Smart Interaction Logic Only ---

    renderGallery(allImages) {
        this.ui.gallery.innerHTML = '';
        this.state.selectedIndices.clear();
        this.state.lastSelectedIndex = null; // Reset shift anchor

        // Sort Logic
        // For correct range selection, we need to know the CURRENT display order.
        // We will store "displayIndex" alongside originalIndex in DOM if needed, 
        // or just rely on DOM order for range selection. DOM order is best for visual range.

        let displayImages = [...allImages];
        if (this.state.sortMode === 'asc') {
            displayImages.sort((a, b) => (a.width * a.height) - (b.width * b.height));
        } else if (this.state.sortMode === 'desc') {
            displayImages.sort((a, b) => (b.width * b.height) - (a.width * a.height));
        }

        displayImages.forEach((img) => {
            const originalIndex = this.state.images.indexOf(img);
            if (this.state.deletedIndices.has(originalIndex)) return;

            const area = img.width * img.height;
            const card = document.createElement('div');
            card.className = 'img-card';
            card.dataset.area = area;
            card.dataset.id = originalIndex; // Use 'id' for clean separation

            const checkbox = document.createElement('div');
            checkbox.className = 'checkbox-overlay';
            checkbox.innerHTML = '<i class="fa-solid fa-check"></i>';
            // Checkbox -> Always Select, handles Shift too
            checkbox.addEventListener('click', (e) => {
                e.stopPropagation();
                this.handleSelectionClick(originalIndex, card, e.shiftKey);
            });

            const wrapper = document.createElement('div');
            wrapper.className = 'img-wrapper';
            const imgEl = document.createElement('img');
            imgEl.src = img.base64;
            imgEl.draggable = false; // Prevent ghost drag
            wrapper.appendChild(imgEl);

            // Image Click -> Smart Action
            wrapper.addEventListener('click', (e) => {
                e.stopPropagation();
                // Pass shiftKey
                this.handleSmartClick(originalIndex, card, e.shiftKey);
            });

            const info = document.createElement('div');
            info.className = 'img-info';
            info.innerHTML = `<span>#${originalIndex + 1}</span> <span>${img.width}x${img.height}</span>`;

            card.append(checkbox, wrapper, info);
            this.ui.gallery.appendChild(card);

            card.addEventListener('click', (e) => {
                this.handleSelectionClick(originalIndex, card, e.shiftKey);
            });
        });

        this.applyVisibilityFilter(); // Initial Hide
    },

    // Handle Image Click (Wrapper)
    handleSmartClick(index, card, isShift) {
        // If selection mode active OR Shift is pressed -> Selection Logic
        const isSelectMode = this.state.selectedIndices.size > 0;

        if (isSelectMode || isShift) {
            this.handleSelectionClick(index, card, isShift);
        } else {
            // Idle Mode -> Direct Download
            this.downloadSingleImage(index);
        }
    },

    // Handle Selection (Checkbox/Card/SmartClick)
    handleSelectionClick(index, card, isShift) {
        // Range Selection Logic
        if (isShift && this.state.lastSelectedIndex !== null) {
            this.selectRange(this.state.lastSelectedIndex, index);
        } else {
            // Normal Toggle
            this.toggleSelection(index, card);
        }

        // Update anchor
        this.state.lastSelectedIndex = index;
    },

    toggleSelection(index, card) {
        // We need to support toggle state for Range too? 
        // For range, we usually select all. 
        // Here we just toggle single item.

        if (this.state.selectedIndices.has(index)) {
            this.state.selectedIndices.delete(index);
            card.classList.remove('selected');
            card.querySelector('.checkbox-overlay').classList.remove('checked');
        } else {
            this.state.selectedIndices.add(index);
            card.classList.add('selected');
            card.querySelector('.checkbox-overlay').classList.add('checked');
        }
        this.updateDownloadBtn();
    },

    selectRange(fromIds, toIds) {
        // We need to find elements between these two IDs in the DOM order (Visual Order)
        // NOT index order, because of Sorting.

        const cards = Array.from(this.ui.gallery.children);
        // Filter out hidden (deleted or filtered) ones usually ranges respect visibility?
        // Let's iterate all current DOM children (which are "sorted" correctly).

        const visibleCards = cards.filter(c => c.style.display !== 'none');

        let startIndex = visibleCards.findIndex(c => parseInt(c.dataset.id) === fromIds);
        let endIndex = visibleCards.findIndex(c => parseInt(c.dataset.id) === toIds);

        if (startIndex === -1 || endIndex === -1) {
            // Fallback if one is hidden/deleted (shouldn't happen for lastSelectedIndex but possible if filtered)
            // If fallback fails, just select the target
            const targetCard = cards.find(c => parseInt(c.dataset.id) === toIds);
            if (targetCard) this.toggleSelection(toIds, targetCard);
            return;
        }

        const [start, end] = [Math.min(startIndex, endIndex), Math.max(startIndex, endIndex)];

        // Select all in range
        // Standard UX: If Set is mixed, maybe Add to selection? Or Replace?
        // Windows Explorer: Shift Click ADDS to selection range from Anchor.
        // It does NOT toggle off things outside usually, or does it?
        // Let's implement ADDITIVE Range Selection.

        for (let i = start; i <= end; i++) {
            const card = visibleCards[i];
            const idx = parseInt(card.dataset.id);
            if (!this.state.selectedIndices.has(idx)) {
                this.state.selectedIndices.add(idx);
                card.classList.add('selected');
                card.querySelector('.checkbox-overlay').classList.add('checked');
            }
        }
        this.updateDownloadBtn();
    },

    deleteSelectedImages() {
        if (this.state.selectedIndices.size === 0) return;
        const indicesToDelete = Array.from(this.state.selectedIndices);

        const cards = this.ui.gallery.children;
        for (let card of cards) {
            const idx = parseInt(card.dataset.id); // changed to dataset.id
            if (this.state.selectedIndices.has(idx)) {
                card.classList.add('deleting');
                card.classList.remove('selected');
            }
        }

        setTimeout(() => {
            indicesToDelete.forEach(idx => this.state.deletedIndices.add(idx));
            this.state.selectedIndices.clear();
            this.state.lastSelectedIndex = null; // Reset anchor on delete
            this.updateDownloadBtn();
            this.applyVisibilityFilter();
            for (let card of cards) {
                if (card.classList.contains('deleting')) card.classList.remove('deleting');
            }
        }, 400);
    },

    applyVisibilityFilter() {
        if (!this.state.images.length) return;

        let cutoffArea = 0;
        if (this.state.filterThreshold > 0) {
            const areas = this.state.images.map(img => img.width * img.height).sort((a, b) => a - b);
            const cutoffIndex = Math.floor(areas.length * (this.state.filterThreshold / 100));
            cutoffArea = areas[cutoffIndex] || 0;
        }

        const cards = this.ui.gallery.children;
        let visibleCount = 0;

        for (let card of cards) {
            const idx = parseInt(card.dataset.id);
            if (this.state.deletedIndices.has(idx)) {
                card.style.display = 'none';
                continue;
            }
            const area = parseInt(card.dataset.area);
            // No filter toggle, always use threshold
            const isVisible = (area >= cutoffArea);

            if (isVisible) {
                card.style.display = '';
                visibleCount++;
            } else {
                card.style.display = 'none';
            }
        }
        this.ui.imgCount.textContent = visibleCount;
    },

    updateDownloadBtn() {
        const count = this.state.selectedIndices.size;
        this.ui.downloadAllBtn.innerHTML = count > 0
            ? `<i class="fa-solid fa-download"></i> Download Selected (${count})`
            : `<i class="fa-solid fa-file-zipper"></i> Download All`;
        if (this.ui.trashBtn) {
            this.ui.trashBtn.style.opacity = count > 0 ? '1' : '0.5';
            this.ui.trashBtn.style.pointerEvents = count > 0 ? 'auto' : 'none';
        }
    },

    downloadSingleImage(index) {
        const target = this.state.images[index];
        const link = document.createElement('a');
        link.href = target.base64;
        const fnIdx = index + 1;
        link.download = `${this.state.title}_${String(fnIdx).padStart(3, '0')}.${target.ext}`;
        link.click();
    },

    async downloadImages() {
        let targets = [];
        if (this.state.selectedIndices.size > 0) {
            targets = this.state.images.filter((_, i) => this.state.selectedIndices.has(i));
        } else {
            const visibleCards = Array.from(this.ui.gallery.children).filter(c => c.style.display !== 'none');
            const visibleIndices = visibleCards.map(c => parseInt(c.dataset.id));
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
        if (isLoading && this.ui.statusMsg) { this.ui.statusMsg.innerHTML = ''; this.ui.statusMsg.className = 'status-msg'; }
    },
    showStatus(msg, type = 'normal') { if (!this.ui.statusMsg) return; this.ui.statusMsg.textContent = msg; this.ui.statusMsg.className = `status-msg ${type}`; },
    resetGallery() {
        if (this.ui.gallery) this.ui.gallery.innerHTML = '';
        if (this.ui.resultSection) this.ui.resultSection.classList.remove('visible');
        this.state.images = [];
        this.state.selectedIndices.clear();
        this.state.deletedIndices.clear();
        this.updateDownloadBtn();
        const actionBtns = document.querySelector('.action-buttons');
        if (actionBtns) actionBtns.style.display = 'flex';
    }
};
document.addEventListener('DOMContentLoaded', () => App.init());
