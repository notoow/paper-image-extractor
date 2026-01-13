// --- SSOT: Application State ---
const App = {
    state: {
        images: [],
        selectedIndices: new Set(),
        title: "paper"
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
        gallery: document.getElementById('gallery')
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
        this.showStatus('Running magic... (This may take 10-20s)');
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
            this.showStatus('Network error occurred.', 'error');
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
        this.showStatus('Uploading and analyzing PDF...');
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
        if (response.ok || data.status === 'manual_link') {
            if (data.status === 'success') {
                this.renderSuccess(data);
            } else if (data.status === 'manual_link') {
                this.renderManualLink(data);
            }
        } else {
            this.showStatus(data.detail || 'Failed to process.', 'error');
        }
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

        // Hide upload link when results are shown (Requirement: Clean UI)
        if (this.ui.uploadArea) this.ui.uploadArea.style.display = 'none';

        this.updateDownloadBtn();
    },

    renderManualLink(data) {
        this.ui.statusMsg.innerHTML = `
            <span style="color: #ffa502">
                <i class="fa-solid fa-triangle-exclamation"></i> Protected Paper.<br>
                <a href="${data.pdf_url}" target="_blank" style="color: #5352ed; font-weight: bold; text-decoration: underline; margin-left: 5px;">
                    Download PDF manually <i class="fa-solid fa-external-link-alt"></i>
                </a>
                <br><span style="font-size: 0.8em; color: gray;">Then upload it above to extract images.</span>
            </span>`;
        // Ensure upload link is visible for manual upload
        if (this.ui.uploadArea) this.ui.uploadArea.style.display = 'block';
    },

    // --- UI Helpers ---

    renderGallery(images) {
        this.ui.imgCount.textContent = images.length;
        this.ui.gallery.innerHTML = '';

        images.forEach((img, index) => {
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
            info.innerHTML = `<span>#${index + 1}</span> <span>${img.width}x${img.height}</span>`;

            card.append(checkbox, wrapper, info);
            this.ui.gallery.appendChild(card);

            // Selection Logic
            card.addEventListener('click', () => {
                this.toggleSelection(index, card, checkbox);
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
        const targets = this.state.selectedIndices.size > 0
            ? this.state.images.filter((_, i) => this.state.selectedIndices.has(i))
            : this.state.images;

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

        targets.forEach((img, i) => {
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
        if (this.ui.btnSpinner) this.ui.btnSpinner.style.display = isLoading ? 'block' : 'none';

        if (isLoading && this.ui.statusMsg) this.ui.statusMsg.textContent = '';
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

        // Show upload link again
        if (this.ui.uploadArea) this.ui.uploadArea.style.display = 'block';
    }
};

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
