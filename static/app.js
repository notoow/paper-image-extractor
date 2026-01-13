// --- SSOT: Application State ---
const App = {
    state: {
        images: [], // All images
        selectedIndices: new Set(),
        title: "paper",
        filterSmall: true,
        filterThreshold: 20 // Default: Hide bottom 20%
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
        sliderTooltip: document.getElementById('sliderTooltip')
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
            // Initialize Visual State
            if (this.state.filterSmall) {
                this.ui.filterToggle.classList.add('active');
            }

            this.ui.filterToggle.addEventListener('click', () => {
                this.state.filterSmall = !this.state.filterSmall;
                this.ui.filterToggle.classList.toggle('active', this.state.filterSmall);
                // Re-render
                this.renderGallery(this.state.images);
            });
        }

        // Slider Event
        if (this.ui.sizeSlider) {
            this.ui.sizeSlider.addEventListener('input', (e) => {
                const percent = parseInt(e.target.value);
                this.state.filterThreshold = percent;

                // Update Tooltip
                if (this.ui.sliderTooltip) {
                    this.ui.sliderTooltip.textContent = percent === 0 ? "Show All" : `Hide Bottom ${percent}%`;
                }

                // Re-render
                this.renderGallery(this.state.images);
            });
        }
    },

    setupDragAndDrop() {
        const dropZone = this.ui.searchBox;
        if (!dropZone) return;

        // Prevent default browser behaviors for drag events
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, preventDefaults, false);
            document.body.addEventListener(eventName, preventDefaults, false);
        });

        function preventDefaults(e) {
            e.preventDefault();
            e.stopPropagation();
        }

        // Highlight drop zone
        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => dropZone.classList.add('drag-over'), false);
        });

        // Remove highlight
        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => dropZone.classList.remove('drag-over'), false);
        });

        // Handle Drop
        dropZone.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            const files = dt.files;

            if (files.length > 0) {
                const file = files[0];
                if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
                    // Update the file input manually to keep sync
                    if (this.ui.pdfUploadInput) this.ui.pdfUploadInput.files = files;
                    // Trigger the existing handler
                    this.handleFileUpload({ target: { files: files } });
                } else {
                    this.showStatus('Please drop a valid PDF file.', 'error');
                }
            }
        }, false);
    },

    // --- Core Logic ---

    async processDoi() {
        const doi = this.ui.doiInput.value.trim();
        if (!doi) {
            this.showStatus('Please enter a DOI.', 'error');
            return;
        }

        this.setLoading(true);
        // Note: We don't show text 'Running magic...' anymore based on request, 
        // setLoading handles hiding text. But showStatus might overwrite if not careful.
        // Let's just pass empty string or rely on setLoading.
        // Actually, let's allow showStatus to work but rely on setLoading to hide the text element of the BUTTON.
        // But the status MSG below needs to be cleared or show something? 
        // User requested removing "Uploading and analyzing..." text.
        // Let's keep statusMsg clean.
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
            console.error(error);
        } finally {
            this.setLoading(false);
        }
    },

    async handleFileUpload(e) {
        const file = e.target.files[0];
        if (!file) return;

        if (file.type !== 'application/pdf' && !file.name.endsWith('.pdf')) {
            this.showStatus('Please select a valid PDF file.', 'error');
            return;
        }

        const formData = new FormData();
        formData.append('file', file);

        this.setLoading(true);
        this.showStatus(''); // Clear text
        this.resetGallery();

        try {
            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });
            const data = await response.json();
            this.handleResponse(response, data);
        } catch (error) {
            this.showStatus('Error uploading file.', 'error');
            console.error(error);
        } finally {
            this.setLoading(false);
            this.ui.pdfUploadInput.value = ''; // Reset input
        }
    },

    handleResponse(response, data) {
        if (response.ok && data.status === 'success') {
            this.renderSuccess(data);
        } else if (data && data.status === 'manual_link') {
            this.renderManualLink(data);
        } else {
            // Smart Error: Show message + Rescue Link if DOI is present
            const errorMsg = data.detail || 'Cloudflare blocked or PDF not found.';
            this.showErrorWithRescueLink(errorMsg);
        }
    },

    showErrorWithRescueLink(msg) {
        const doi = this.ui.doiInput.value.trim();

        // Reset class to remove old status styling, we use rescue-box structure now
        this.ui.statusMsg.className = '';

        let html = `<div class="rescue-box">
            <span class="rescue-text"><i class="fa-solid fa-triangle-exclamation"></i> ${msg}</span>`;

        if (doi) {
            html += `
                <a href="https://doi.org/${doi}" target="_blank" class="rescue-link-btn">
                    <i class="fa-solid fa-external-link-alt"></i> Open Publisher Site
                </a>
                <span class="rescue-hint">Download PDF there and drag it here!</span>
            `;
        }
        html += `</div>`;

        this.ui.statusMsg.innerHTML = html;

        // Ensure upload link is visible for fallback
        if (this.ui.uploadArea) this.ui.uploadArea.style.display = 'block';
    },

    renderSuccess(data) {
        this.showStatus(`Successfully extracted ${data.image_count} images!`, 'success');
        this.state.images = data.images;

        // Clean title
        let safeTitle = data.title || "paper";
        safeTitle = safeTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        this.state.title = safeTitle.substring(0, 50);

        this.renderGallery(data.images);

        // UI Updates
        this.ui.resultSection.classList.add('visible');
        document.body.classList.add('has-results');

        // Hide upload buttons when results are shown to clean up UI
        if (this.ui.uploadArea) this.ui.uploadArea.style.display = 'none';
        const actionBtns = document.querySelector('.action-buttons');
        if (actionBtns) actionBtns.style.display = 'none';

        this.updateDownloadBtn();
    },

    renderManualLink(data) {
        // Re-use rescue link logic but with specific message
        this.showErrorWithRescueLink("Protected Paper. Please download manually.");
    },

    // --- UI Helpers ---

    renderGallery(allImages) {
        if (!allImages || allImages.length === 0) {
            this.ui.imgCount.textContent = 0;
            this.ui.gallery.innerHTML = '';
            return;
        }

        let filteredImages = allImages;

        // Semantic Filter Logic: Relative Percentile
        // If Toggle is ON and Slider > 0 (meaning we want to hide some bottom %)
        if (this.state.filterSmall && this.state.filterThreshold > 0) {
            // 1. Calculate Area for all
            const imagesWithArea = allImages.map(img => ({
                ...img,
                area: img.width * img.height
            }));

            // 2. Sort by Area Ascending to find cutoff
            const sorted = [...imagesWithArea].sort((a, b) => a.area - b.area);

            // 3. Find cutoff index based on percentage
            // e.g. 20% -> hide bottom 20% -> index = length * 0.2
            // Math.ceil ensures we hide at least one if percentage is small but non-zero? 
            // Math.floor is safer to avoid index out of bounds.
            const cutoffIndex = Math.floor(sorted.length * (this.state.filterThreshold / 100));

            // Safety check
            if (cutoffIndex < sorted.length) {
                const cutoffArea = sorted[cutoffIndex].area;
                // 4. Filter: Keep images LARGER (or equal? let's say larger to be strict) than the cutoff area
                // If cutoffIndex is 0 (0%), cutoffArea is smallest.
                // We want to hide BOTTOM X%. So if X=20%, we hide items 0 to 0.2*L.
                // We keep items from 0.2*L to L.
                // So we keep items with area >= sorted[cutoffIndex].area

                filteredImages = allImages.filter(img => (img.width * img.height) >= cutoffArea);
            } else {
                // If 100%, hide all? usually yes.
                filteredImages = [];
            }
        }

        this.ui.imgCount.textContent = filteredImages.length;
        this.ui.gallery.innerHTML = '';

        // Clear selection to prevent indices mismatch issue
        this.state.selectedIndices.clear();
        this.updateDownloadBtn();

        filteredImages.forEach((img) => {
            // Find original index to maintain correct file naming/referencing if needed
            const originalIndex = this.state.images.indexOf(img);

            const card = document.createElement('div');
            card.className = 'img-card';

            // Checkbox
            const checkbox = document.createElement('div');
            checkbox.className = 'checkbox-overlay';
            checkbox.innerHTML = '<i class="fa-solid fa-check"></i>';

            // Wrapper
            const wrapper = document.createElement('div');
            wrapper.className = 'img-wrapper';
            const imgEl = document.createElement('img');
            imgEl.src = img.base64;
            wrapper.appendChild(imgEl);

            // Info
            const info = document.createElement('div');
            info.className = 'img-info';
            info.innerHTML = `<span>#${originalIndex + 1}</span> <span>${img.width}x${img.height}</span>`;

            card.append(checkbox, wrapper, info);
            this.ui.gallery.appendChild(card);

            // Selection Logic
            card.addEventListener('click', () => {
                this.toggleSelection(originalIndex, card, checkbox);
            });
        });
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
        const count = this.state.selectedIndices.size;
        this.ui.downloadAllBtn.innerHTML = count > 0
            ? `<i class="fa-solid fa-download"></i> Download Selected (${count})`
            : `<i class="fa-solid fa-file-zipper"></i> Download All`;
    },

    async downloadImages() {
        let targets = [];
        if (this.state.selectedIndices.size > 0) {
            // Download selected specific images
            targets = this.state.images.filter((_, i) => this.state.selectedIndices.has(i));
        } else {
            // Download all *visible* images (Filtered)
            // Re-apply filter logic here to be safe or rely on render?
            // Safer to re-apply filter logic or check against currently rendered DOM?
            // Re-calc logic is safest SSOT.

            if (this.state.filterSmall && this.state.filterThreshold > 0) {
                const imagesWithArea = this.state.images.map(img => ({ ...img, area: img.width * img.height }));
                const sorted = [...imagesWithArea].sort((a, b) => a.area - b.area);
                const cutoffIndex = Math.floor(sorted.length * (this.state.filterThreshold / 100));

                if (cutoffIndex < sorted.length) {
                    const cutoffArea = sorted[cutoffIndex].area;
                    targets = this.state.images.filter(img => (img.width * img.height) >= cutoffArea);
                } else {
                    targets = [];
                }
            } else {
                targets = this.state.images;
            }
        }

        if (targets.length === 0) return;

        // Single Image -> Direct Download
        if (targets.length === 1) {
            const link = document.createElement('a');
            link.href = targets[0].base64;
            // Pad index for filename
            const idx = this.state.images.indexOf(targets[0]) + 1;
            link.download = `${this.state.title}_${String(idx).padStart(3, '0')}.${targets[0].ext}`;
            link.click();
            return;
        }

        // Multiple -> Zip (using JSZip)
        if (!window.JSZip) {
            alert("JSZip library not loaded!");
            return;
        }

        const zip = new JSZip();
        // Create folder inside zip
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

        // Spinner logic
        if (this.ui.btnSpinner) {
            if (isLoading) {
                this.ui.btnSpinner.style.display = 'flex'; // Flex to center the ::after element
            } else {
                this.ui.btnSpinner.style.display = 'none';
            }
        }

        if (isLoading && this.ui.statusMsg) {
            this.ui.statusMsg.innerHTML = ''; // Ensure no text
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

        // Show action buttons again
        const actionBtns = document.querySelector('.action-buttons');
        if (actionBtns) actionBtns.style.display = 'flex';
    }
};

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
