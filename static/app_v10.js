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
        debounceTimer: null,
        // Chat State
        ws: null,
        myCountry: 'UN',
        chatOpen: false,
        unread: 0,
        sessionId: Math.random().toString(36).substring(7), // Temp ID
        trendingDirty: false // For Refreshing Trending Tab
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
        trashBtn: document.getElementById('trashBtn'),
        pdfBtn: document.getElementById('pdfBtn'), // Static Ref
        gallery: document.getElementById('gallery'),
        sizeSlider: document.getElementById('sizeSlider'),
        sliderTooltip: document.getElementById('sliderTooltip'),
        onlineCount: document.getElementById('onlineCount')
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

        // Init Chat
        this.initChat();

        // Render History
        this.renderHistory();
    },

    saveHistory(doi) {
        if (!doi || doi === 'uploaded_file') return;
        let history = JSON.parse(localStorage.getItem('paper_history') || '[]');
        history = history.filter(h => h !== doi);
        history.unshift(doi);
        if (history.length > 2) history.pop(); // Limit to 2 as requested
        localStorage.setItem('paper_history', JSON.stringify(history));
        this.renderHistory();
    },

    renderHistory() {
        const container = document.getElementById('searchHistory');
        if (!container) return;

        let history = JSON.parse(localStorage.getItem('paper_history') || '[]');
        // Enforce limit strictly for display
        if (history.length > 2) history = history.slice(0, 2);

        if (history.length === 0) {
            container.style.display = 'none';
            return;
        }

        container.style.display = 'flex';
        container.innerHTML = history.map(doi => {
            // Strip https://doi.org/ prefix for display
            const displayDoi = doi.replace(/^(https?:\/\/)?(dx\.)?doi\.org\//i, '');

            return `
            <div class="history-chip" 
                 title="${doi} (Right-click to copy)" 
                 onclick="document.getElementById('doiInput').value = '${doi}'; App.processDoi();"
                 oncontextmenu="event.preventDefault(); navigator.clipboard.writeText('${doi}'); App.showStatus('DOI Copied to Clipboard! 📋', 'success');">
                <i class="fa-solid fa-clock-rotate-left"></i>
                <span class="history-text">${displayDoi}</span>
                <button class="history-del-btn" onclick="event.stopPropagation(); App.deleteHistory('${doi}')" title="Remove">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            `;
        }).join('');
    },

    deleteHistory(doi) {
        let history = JSON.parse(localStorage.getItem('paper_history') || '[]');
        history = history.filter(h => h !== doi);
        localStorage.setItem('paper_history', JSON.stringify(history));
        this.renderHistory();
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
        // this.showStatus('');
        this.resetGallery();
        try {
            const response = await fetch('/api/process', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ doi: doi }),
                cache: 'no-store' // Force fresh request
            });
            const data = await response.json();
            this.handleResponse(response, data, doi); // Pass doi to handleResponse
        } catch (error) {
            console.error(error);
            alert(`Error: ${error.message}. Please check your connection.`); // Visual feedback
            this.showErrorWithRescueLink('Network error or timeout.');
        } finally { this.setLoading(false); }
    },

    async handleFileUpload(e) {
        const file = e.target.files[0];
        if (!file) return;
        const formData = new FormData();
        formData.append('file', file);
        this.setLoading(true);
        // this.showStatus('');
        this.resetGallery();
        try {
            const response = await fetch('/api/upload', { method: 'POST', body: formData });
            const data = await response.json();
            this.handleResponse(response, data, 'uploaded_file'); // Pass 'uploaded_file' as identifier
        } catch (error) { this.showStatus('Error uploading file.', 'error'); } finally { this.setLoading(false); this.ui.pdfUploadInput.value = ''; }
    },

    handleResponse(response, data, identifier = null) {
        if (response.ok && data.status === 'success') {
            this.renderSuccess(data);
            if (identifier) this.saveHistory(identifier);
        }
        else if (data && data.status === 'manual_link') {
            this.renderManualLink(data);
            if (identifier) this.saveHistory(identifier);
        }
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
        const count = (data.count !== undefined) ? data.count : (data.image_count || 0);
        this.showStatus(`Successfully extracted ${count} images!`, 'success');
        this.state.images = data.images || [];

        let rawTitle = data.title || "paper";
        // SAFE FILENAME LOGIC (Updated to support Korean/Unicode)
        // Replace ONLY filesystem-unsafe characters: < > : " / \ | ? *
        let safeTitle = rawTitle.replace(/[<>:"/\\|?*]+/g, '_');
        this.state.title = safeTitle.substring(0, 100); // Allow longer titles

        this.renderGallery(data.images);
        this.ui.resultSection.classList.add('visible');
        document.body.classList.add('has-results');
        if (this.ui.uploadArea) this.ui.uploadArea.style.display = 'none';
        const actionBtns = document.querySelector('.action-buttons');
        if (actionBtns) actionBtns.style.display = 'none';
        this.updateDownloadBtn();

        // Award Score for Research Activity
        if (count > 0) {
            this.sendScoreEvent();
        }

        // Handle PDF Preview Button
        if (this.ui.pdfBtn) {
            if (data.pdf_base64) {
                try {
                    const byteArr = this.base64ToBytes(data.pdf_base64);
                    const blob = new Blob([byteArr], { type: 'application/pdf' });
                    const url = URL.createObjectURL(blob);

                    this.ui.pdfBtn.style.display = 'inline-flex';
                    this.ui.pdfBtn.onclick = () => window.open(url, '_blank');
                    this.ui.pdfBtn.title = "View Original PDF";
                } catch (e) {
                    console.error("PDF Blob Error:", e);
                    this.ui.pdfBtn.style.display = 'none';
                }
            } else {
                this.ui.pdfBtn.style.display = 'none';
                // Fallback: If user provided DOI, link to DOI? No, stick to PDF button logic
            }
        }
    },

    base64ToBytes(base64) {
        const binString = atob(base64);
        return Uint8Array.from(binString, (m) => m.codePointAt(0));
    },

    sendScoreEvent() {
        if (this.state.ws && this.state.ws.readyState === WebSocket.OPEN) {
            this.state.ws.send(JSON.stringify({
                type: 'score',
                country: this.state.myCountry
            }));
            console.log("Research Point Earned! 🎓");
        }
    },

    // --- Smart Interaction Logic Only ---

    renderGallery(allImages) {
        this.ui.gallery.innerHTML = '';
        this.state.selectedIndices.clear();
        this.state.lastSelectedIndex = null; // Reset shift anchor

        // Handle Empty State
        if (allImages.length === 0) {
            this.ui.gallery.innerHTML = `
                <div class="empty-state">
                    <i class="fa-regular fa-file-image"></i>
                    <h3>No Images Found</h3>
                    <p>This PDF appears to have no extractable raster images.<br>It might contain only vector graphics or text.</p>
                </div>
            `;
            return; // Stop rendering
        }

        // Sort Logic
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

            // Heart Button (New)
            const heartBtn = document.createElement('div');
            heartBtn.className = 'heart-action';
            heartBtn.innerHTML = '<i class="fa-solid fa-heart"></i>';
            heartBtn.title = "Add to Hall of Fame";

            heartBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // No select
                if (heartBtn.classList.contains('active')) return; // Already liked

                heartBtn.classList.add('active');
                this.likeImageFromSearch(img); // Pass the image object directly
            });

            card.append(checkbox, heartBtn, wrapper, info);
            this.ui.gallery.appendChild(card);

            // Card Click -> Smart Action fallback (e.g. padding click)
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
        const cards = Array.from(this.ui.gallery.children);
        // Only visible cards participate in range selection naturally
        const visibleCards = cards.filter(c => c.style.display !== 'none');

        let startIndex = visibleCards.findIndex(c => parseInt(c.dataset.id) === fromIds);
        let endIndex = visibleCards.findIndex(c => parseInt(c.dataset.id) === toIds);

        if (startIndex === -1 || endIndex === -1) {
            // If anchor is invisible, fallback to single select
            const targetCard = visibleCards.find(c => parseInt(c.dataset.id) === toIds);
            if (targetCard) this.toggleSelection(toIds, targetCard);
            return;
        }

        const [start, end] = [Math.min(startIndex, endIndex), Math.max(startIndex, endIndex)];

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
            const idx = parseInt(card.dataset.id);
            if (this.state.selectedIndices.has(idx)) {
                card.classList.add('deleting');
                card.classList.remove('selected');
            }
        }

        setTimeout(() => {
            indicesToDelete.forEach(idx => this.state.deletedIndices.add(idx));
            this.state.selectedIndices.clear();
            this.state.lastSelectedIndex = null; // Reset anchor
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

    // Support Unicode Filenames
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
        // UTF-8 Title folder
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
    showStatus(msg, type = 'normal') {
        if (!msg) return; // Guard: Prevent empty toasts
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        let icon = '<i class="fa-solid fa-circle-info"></i>';
        if (type === 'success') icon = '<i class="fa-solid fa-check"></i>';
        if (type === 'error') icon = '<i class="fa-solid fa-triangle-exclamation" style="color:#ff7675"></i>';

        toast.innerHTML = `${icon} <span>${msg}</span>`;
        container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('toast-out');
            toast.addEventListener('animationend', () => toast.remove());
        }, 3000);
    },
    resetGallery() {
        if (this.ui.gallery) this.ui.gallery.innerHTML = '';
        if (this.ui.resultSection) this.ui.resultSection.classList.remove('visible');
        this.state.images = [];
        this.state.selectedIndices.clear();
        this.state.deletedIndices.clear();
        this.updateDownloadBtn();
        const actionBtns = document.querySelector('.action-buttons');
        if (actionBtns) actionBtns.style.display = 'flex';
    },

    // --- Chat Logic ---
    async initChat() {
        try {
            const res = await fetch('https://ipapi.co/json/');
            const data = await res.json();
            if (data.country_code) this.state.myCountry = data.country_code;
        } catch (e) { console.warn('GeoIP failed'); }

        const toggle = document.getElementById('chatToggle');
        const close = document.getElementById('closeChat');
        const sendBtn = document.getElementById('sendChatBtn');
        const input = document.getElementById('chatInput');

        if (toggle) toggle.addEventListener('click', () => this.toggleChat());
        if (close) close.addEventListener('click', () => this.toggleChat());

        if (sendBtn && input) {
            const send = () => {
                const msg = input.value.trim();
                if (!msg) return;
                this.sendChatMessage(msg);
                input.value = '';
                input.focus();
            };
            sendBtn.addEventListener('click', send);
            input.addEventListener('keypress', (e) => { if (e.key === 'Enter') send(); });
        }

        // Bind Social Tabs
        const tabBtns = document.querySelectorAll('.tab-btn');
        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
        });

        // Bind Trending Filters
        const filterChips = document.querySelectorAll('.filter-chip');
        filterChips.forEach(chip => {
            chip.addEventListener('click', () => {
                // Update UI
                filterChips.forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                // Fetch
                this.fetchTrending(chip.dataset.period);
            });
        });

        // Close Chat when clicking outside
        document.addEventListener('click', (e) => {
            const container = document.getElementById('chatContainer');
            const toggle = document.getElementById('chatToggle');

            if (this.state.chatOpen && container && !container.contains(e.target) && toggle && !toggle.contains(e.target)) {
                this.toggleChat();
            }
        });

        this.connectWS();
    },

    // --- Social & Trending Logic ---

    switchTab(tabName) {
        // Update Buttons
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabName);
        });

        // Update Views
        document.querySelectorAll('.social-view').forEach(view => {
            view.classList.remove('active');
        });
        const targetView = document.getElementById(`view-${tabName}`);
        if (targetView) targetView.classList.add('active');

        // Logic
        if (tabName === 'trending') {
            const grid = document.getElementById('trendingGrid');
            const isEmpty = grid && (!grid.children.length || grid.querySelector('.loading-state'));

            if (isEmpty || this.state.trendingDirty) {
                const activeChip = document.querySelector('.filter-chip.active');
                const period = activeChip ? activeChip.dataset.period : 'all';
                this.fetchTrending(period);
                this.state.trendingDirty = false;
            }
        }
    },

    async fetchTrending(period) {
        const grid = document.getElementById('trendingGrid');
        if (grid && (!grid.children.length || this.state.trendingDirty)) {
            grid.innerHTML = '<div class="loading-state"><div class="spinner" style="display:block; margin: 20px auto;"></div><p>Refining selection...</p></div>';
        }

        try {
            // Cache busting
            const res = await fetch(`/api/trending?period=${period}&_=${Date.now()}`);
            const data = await res.json();
            if (data.status === 'success') {
                this.renderTrending(data.images);
            } else {
                if (grid) grid.innerHTML = `<p style="text-align:center; padding:20px;">Failed to load.</p>`;
            }
        } catch (e) {
            console.error(e);
            if (grid) grid.innerHTML = `<p style="text-align:center; padding:20px;">Network error.</p>`;
        }
    },

    renderTrending(images) {
        const grid = document.getElementById('trendingGrid');
        if (!grid) return;
        grid.innerHTML = '';

        if (images.length === 0) {
            grid.innerHTML = '<div class="loading-state"><p>No trending images yet.<br>Be the first to like one!</p></div>';
            return;
        }

        images.forEach((img, i) => {
            const item = document.createElement('div');
            item.className = 'trending-item';

            // Generate Rank Badge
            let rankClass = '';
            if (i < 3) rankClass = 'top-3';
            const rankHtml = `<div class="trending-rank ${rankClass}">#${i + 1}</div>`;

            // Like Button (Vote)
            // Check cookie or local storage if already liked? (Simplification: just show)
            const likeBtn = document.createElement('button');
            likeBtn.className = 'trending_like-btn';
            likeBtn.innerHTML = `<i class="fa-solid fa-heart"></i>`;

            // Check if user (local) already liked this
            let myLikes = [];
            try { myLikes = JSON.parse(localStorage.getItem('my_liked_ids') || '[]'); } catch (e) { }
            // Use loose comparison (String) to handle DB Integers vs Storage Strings
            if (myLikes.some(savedId => String(savedId) === String(img.id))) {
                likeBtn.classList.add('liked');
            }

            likeBtn.onclick = (e) => {
                e.stopPropagation();
                if (likeBtn.classList.contains('liked')) return;
                this.voteTrendingImage(img.id, likeBtn, countSpan);
            };

            const countSpan = document.createElement('span');
            countSpan.className = 'like-count';
            countSpan.textContent = img.likes;

            // Image
            // Use cached public URL or construct it
            const imgUrl = img.url || img.base64; // Fallback? api/trending should return url

            item.innerHTML = `
                ${rankHtml}
                <img src="${imgUrl}" loading="lazy" alt="Trending">
            `;

            // DOI Pill (Smart Extraction Button) - Restored and Improved
            if (img.doi && img.doi.length > 5) {
                const doiPill = document.createElement('div');
                doiPill.className = 'doi-pill';
                doiPill.innerHTML = `<i class="fa-solid fa-flask-vial"></i> DOI`; // Text changed to DOI
                doiPill.title = `Extract from this paper: ${img.doi}`;
                doiPill.onclick = (e) => {
                    e.stopPropagation();
                    this.ui.doiInput.value = img.doi;
                    this.processDoi();
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                    if (window.innerWidth < 768) this.toggleChat();
                };
                item.appendChild(doiPill);
            }

            item.appendChild(countSpan);
            item.appendChild(likeBtn);

            // Full Preview on Click
            item.onclick = () => window.open(imgUrl, '_blank');

            grid.appendChild(item);
        });
    },

    async voteTrendingImage(id, btn, countSpan) {
        try {
            btn.classList.add('liked');
            // Optimistic update
            let current = parseInt(countSpan.textContent);
            countSpan.textContent = current + 1;

            this.state.trendingDirty = true; // Mark for re-fetch to update ranks

            await fetch('/api/vote', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: id })
            });
            // Persist valid vote locally
            let myLikes = JSON.parse(localStorage.getItem('my_liked_ids') || '[]');
            if (!myLikes.includes(id)) {
                myLikes.push(id);
                localStorage.setItem('my_liked_ids', JSON.stringify(myLikes));
            }
            // Success
        } catch (e) {
            console.error("Vote failed", e);
        }
    },

    async likeImageFromSearch(img) {
        // Find the heart button that was clicked (hacky but effective if we passed it, but here we don't have reference)
        // Check renderGallery -> it calls likeImageFromSearch(img). 
        // We should add loading feedback via toast first since we don't have the button ref here (unless we pass it).
        // Actually renderGallery calls this... let's just use showStatus for loading.

        this.showStatus('Adding to Hall of Fame... ⏳', 'normal');

        // Convert Base64 -> Blob -> File
        try {
            const fetchRes = await fetch(img.base64);
            const blob = await fetchRes.blob();

            // Fix MIME type and filename
            let mimeType = `image/${img.ext}`;
            if (img.ext === 'jpg' || img.ext === 'jpeg') mimeType = 'image/jpeg';

            const file = new File([blob], `image.${img.ext}`, { type: mimeType });

            const formData = new FormData();
            formData.append('file', file);
            formData.append('doi', this.ui.doiInput.value || 'manual_upload');
            formData.append('country', this.state.myCountry);

            const res = await fetch('/api/like', {
                method: 'POST',
                body: formData
            });
            const data = await res.json();
            console.log("Like Result:", data);

            // Show toast/confetti?
            if (data.status === 'success') {
                this.showStatus('Added to Hall of Fame! 🏆', 'success');

                // Save to local storage so it shows as liked
                if (data.id) {
                    let myLikes = JSON.parse(localStorage.getItem('my_liked_ids') || '[]');
                    if (!myLikes.includes(data.id)) {
                        myLikes.push(data.id);
                        localStorage.setItem('my_liked_ids', JSON.stringify(myLikes));
                    }
                }

                this.state.trendingDirty = true; // Mark for refresh

                // IMMEDIATE REFRESH if tab is active
                const trendingView = document.getElementById('view-trending');
                if (trendingView && trendingView.classList.contains('active')) {
                    const activeChip = document.querySelector('.filter-chip.active');
                    this.fetchTrending(activeChip ? activeChip.dataset.period : 'all');
                    this.state.trendingDirty = false;
                }
            }
        } catch (e) {
            this.showStatus('Failed to like image.', 'error');
            console.error("Like failed", e);
        }
    },

    connectWS() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;
        console.log("Connecting to WS:", wsUrl);

        this.state.ws = new WebSocket(wsUrl);

        this.updateConnectionStatus('connecting');

        this.state.ws.onopen = () => {
            console.log("WS Connected");
            this.updateConnectionStatus('connected');
        };

        this.state.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'chat') {
                this.renderChatMessage(data);
                if (!this.state.chatOpen) {
                    this.state.unread++;
                    this.updateChatBadge();
                }
            } else if (data.type === 'init') {
                this.renderLeaderboard(data.leaderboard);
                // Restore History
                if (data.history && Array.isArray(data.history)) {
                    data.history.forEach(msg => this.renderChatMessage(msg));
                }
            } else if (data.type === 'update_score') {
                if (data.leaderboard) this.renderLeaderboard(data.leaderboard);
            } else if (data.type === 'online_count') {
                this.updateOnlineCount(data.count, data.distribution);
            }
        };

        this.state.ws.onclose = () => {
            console.log("WS Closed, retrying...");
            this.updateConnectionStatus('disconnected');
            // Show error in UI
            const board = document.getElementById('leaderboard');
            if (board) board.innerHTML = '<div class="rank-item skeleton" style="color:#e74c3c">Reconnecting... 📡</div>';

            setTimeout(() => this.connectWS(), 3000);
        };

        this.state.ws.onerror = (err) => {
            console.error("WS Error:", err);
            this.state.ws.close();
            const board = document.getElementById('leaderboard');
            if (board) board.innerHTML = '<div class="rank-item skeleton" style="color:#e74c3c">Connection Error! ⚠️</div>';
        };
    },

    updateConnectionStatus(status) {
        const dot = document.getElementById('connectionStatus');
        const input = document.getElementById('chatInput');
        const btn = document.getElementById('sendChatBtn');

        if (dot) {
            dot.className = 'status-dot ' + (status === 'connected' ? 'connected' : 'disconnected');
            dot.title = status;
        }

        // Disable input if disconnected
        if (input) input.disabled = (status !== 'connected');
        if (btn) {
            btn.style.opacity = (status === 'connected') ? '1' : '0.5';
            btn.style.pointerEvents = (status === 'connected') ? 'auto' : 'none';
        }
    },

    toggleChat() {
        this.state.chatOpen = !this.state.chatOpen;
        const container = document.getElementById('chatContainer');
        const toggleBtn = document.getElementById('chatToggle');

        if (container) container.classList.toggle('open', this.state.chatOpen);
        if (toggleBtn) toggleBtn.classList.toggle('hidden', this.state.chatOpen);

        if (this.state.chatOpen) {
            this.state.unread = 0;
            this.updateChatBadge();
            const msgs = document.getElementById('chatMessages');
            if (msgs) msgs.scrollTop = msgs.scrollHeight;
            document.getElementById('chatInput')?.focus();
        }
    },

    updateChatBadge() {
        const badge = document.getElementById('chatBadge');
        if (!badge) return;
        if (this.state.unread > 0) {
            badge.textContent = this.state.unread > 99 ? '99+' : this.state.unread;
            badge.classList.add('visible');
        } else {
            badge.classList.remove('visible');
        }
    },

    sendChatMessage(msg) {
        if (this.state.ws && this.state.ws.readyState === WebSocket.OPEN) {
            this.state.ws.send(JSON.stringify({
                type: 'chat',
                country: this.state.myCountry,
                msg: msg
            }));
        }
    },

    // Helper: Return Flag Image HTML instead of Emoji (Windows fix)
    getFlagEmoji(countryCode) {
        if (!countryCode || countryCode === 'UN' || countryCode === 'UNKNOWN') return '🏳️';
        const code = countryCode.toLowerCase();
        return `<img src="https://flagcdn.com/w40/${code}.png" srcset="https://flagcdn.com/w80/${code}.png 2x" width="20" alt="${countryCode}" style="vertical-align: middle; border-radius: 2px;">`;
    },

    renderChatMessage(data) {
        const msgs = document.getElementById('chatMessages');
        if (!msgs) return;

        const row = document.createElement('div');
        row.className = `msg-row`;
        const flagHtml = this.getFlagEmoji(data.country); // Now returns <img>

        const safeMsg = data.msg.replace(/[&<>"']/g, function (m) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
        });

        row.innerHTML = `<div class="msg-flag" title="${data.country}">${flagHtml}</div><div class="msg-bubble">${safeMsg}</div>`;
        msgs.appendChild(row);
        msgs.scrollTop = msgs.scrollHeight;
    },

    // ... (Skipping getFlagEmoji definition since we replaced it above or defining it here if it was separate) ...
    // Note: In Previous code getFlagEmoji was below renderChatMessage. I will replace both in one block to be safe.

    renderLeaderboard(board) {
        const el = document.getElementById('leaderboard');
        if (!el) return;

        // Handle Array (New) vs Object (Old Fallback)
        let data = [];
        if (Array.isArray(board)) {
            data = board;
        } else if (board && typeof board === 'object') {
            data = Object.entries(board).map(([c, s]) => ({ country: c, score: s, chats: 0 }));
            data.sort((a, b) => b.score - a.score);
        }

        if (data.length === 0) {
            el.innerHTML = '<div class="rank-empty">No records yet.<br>Be the first! 🏆</div>';
            return;
        }

        // Render all (CSS handles scroll)
        el.innerHTML = data.map((item, i) => {
            const country = item.country;
            const score = item.score || 0;
            const chats = item.chats || 0;

            // Use FlagCDN for consistent look
            const flagUrl = `https://flagcdn.com/24x18/${country.toLowerCase()}.png`;
            const flagHtml = `<img src="${flagUrl}" alt="${country}" style="width:20px; border-radius:2px; vertical-align:middle;">`;

            let rankDisplay = `<span class="rank-num">#${i + 1}</span>`;

            // Medals for Top 3
            if (i === 0) rankDisplay = '<span class="medal">🥇</span>';
            if (i === 1) rankDisplay = '<span class="medal">🥈</span>';
            if (i === 2) rankDisplay = '<span class="medal">🥉</span>';

            const isTop = i < 3 ? 'top-rank' : '';

            return `
                <div class="rank-card ${isTop}" style="animation-delay: ${Math.min(i * 0.05, 1)}s">
                    <div class="rank-left">
                        ${rankDisplay}
                        ${flagHtml}
                        <span class="country-code">${country}</span>
                    </div>
                    <div class="rank-stats" style="text-align:right;">
                        <span class="rank-score">${score.toLocaleString()}</span>
                        <span class="rank-chats" style="font-size:0.8em; color:#aaa; margin-left:4px;" title="Chat Count">(💬${chats})</span>
                    </div>
                </div>
            `;
        }).join('');
    },

    updateOnlineCount(count, dist) {
        if (this.ui.onlineCount) {
            this.ui.onlineCount.textContent = `(${count})`;
            if (dist) {
                this.ui.onlineCount.title = `Current Users: ${dist}`;
                this.ui.onlineCount.style.cursor = 'help';
            }
        }
    }
};
window.App = App; // Expose to global scope for inline events
document.addEventListener('DOMContentLoaded', () => App.init());
