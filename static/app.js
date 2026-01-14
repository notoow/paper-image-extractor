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
        sessionId: Math.random().toString(36).substring(7) // Temp ID
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

        // Init Chat
        this.initChat();
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
    },

    // --- Smart Interaction Logic Only ---

    renderGallery(allImages) {
        this.ui.gallery.innerHTML = '';
        this.state.selectedIndices.clear();
        this.state.lastSelectedIndex = null; // Reset shift anchor

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

            card.append(checkbox, wrapper, info);
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
        this.connectWS();
    },

    connectWS() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;
        this.state.ws = new WebSocket(wsUrl);

        this.state.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'chat') {
                this.renderChatMessage(data);
                if (!this.state.chatOpen) {
                    this.state.unread++;
                    this.updateChatBadge();
                }
            } else if (data.type === 'init' || data.type === 'update_score') {
                this.renderLeaderboard(data.leaderboard);
            }
        };

        this.state.ws.onclose = () => { setTimeout(() => this.connectWS(), 3000); };
    },

    toggleChat() {
        this.state.chatOpen = !this.state.chatOpen;
        const container = document.getElementById('chatContainer');
        if (container) container.classList.toggle('open', this.state.chatOpen);
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

    renderChatMessage(data) {
        const msgs = document.getElementById('chatMessages');
        if (!msgs) return;

        const row = document.createElement('div');
        row.className = `msg-row`;
        const flag = this.getFlagEmoji(data.country);

        const safeMsg = data.msg.replace(/[&<>"']/g, function (m) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
        });

        row.innerHTML = `<div class="msg-flag" title="${data.country}">${flag}</div><div class="msg-bubble">${safeMsg}</div>`;
        msgs.appendChild(row);
        msgs.scrollTop = msgs.scrollHeight;
    },

    getFlagEmoji(countryCode) {
        if (!countryCode || countryCode === 'UN' || countryCode === 'UNKNOWN') return '🏳️';
        const codePoints = countryCode
            .toUpperCase()
            .split('')
            .map(char => 127397 + char.charCodeAt());
        return String.fromCodePoint(...codePoints);
    },

    renderLeaderboard(board) {
        const el = document.getElementById('leaderboard');
        if (!el) return;
        if (!board || Object.keys(board).length === 0) {
            el.innerHTML = '<div class="rank-item">Waiting for players...</div>';
            return;
        }
        const sorted = Object.entries(board).sort((a, b) => b[1] - a[1]).slice(0, 5);
        el.innerHTML = sorted.map(([country, score], i) => {
            const flag = this.getFlagEmoji(country);
            const cls = i < 3 ? 'rank-item top' : 'rank-item';
            return `<div class="${cls}">${i + 1}. ${flag} ${score}</div>`;
        }).join('');
    }
};
document.addEventListener('DOMContentLoaded', () => App.init());
