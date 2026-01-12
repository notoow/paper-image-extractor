const doiInput = document.getElementById('doiInput');
const extractBtn = document.getElementById('extractBtn');
const btnText = document.getElementById('btnText');
const btnSpinner = document.getElementById('btnSpinner');
const statusMsg = document.getElementById('statusMsg');
const resultSection = document.getElementById('resultSection');
const imgCount = document.getElementById('imgCount');
const gallery = document.getElementById('gallery');
const downloadAllBtn = document.getElementById('downloadAllBtn');

let currentImages = []; // Store images for download logic
let selectedIndices = new Set(); // Store indices of selected images
let paperTitle = "paper"; // default

extractBtn.addEventListener('click', async () => {
    const doi = doiInput.value.trim();
    if (!doi) {
        showStatus('Please enter a valid DOI.', 'error');
        return;
    }

    setLoading(true);
    showStatus('Connecting to Sci-Hub mirrors (this may take 10-20s)...');

    // Clear previous results
    gallery.innerHTML = '';
    resultSection.classList.remove('visible');
    currentImages = [];
    selectedIndices.clear();
    updateDownloadBtnState();

    try {
        const response = await fetch('/api/process', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ doi })
        });

        const data = await response.json();

        if (response.ok) {
            showStatus(`Successfully extracted ${data.image_count} images!`, 'success');
            currentImages = data.images;

            // Store and clean title
            paperTitle = data.title || "paper";
            // Simple sanitization
            paperTitle = paperTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            if (paperTitle.length > 50) paperTitle = paperTitle.substring(0, 50);

            renderImages(data.images);
            document.body.classList.add('has-results');
        } else {
            showStatus(data.detail || 'Failed to process DOI.', 'error');
        }

    } catch (error) {
        showStatus('Network error or server unavailable.', 'error');
        console.error(error);
    } finally {
        setLoading(false);
    }
});

downloadAllBtn.addEventListener('click', async () => {
    // Determine which images to download
    const imagesToDownload = selectedIndices.size > 0
        ? currentImages.filter((_, idx) => selectedIndices.has(idx))
        : currentImages;

    if (imagesToDownload.length === 0) return;

    const zip = new JSZip();
    const folder = zip.folder(paperTitle); // Folder name is proper title

    // Change button text temporarily
    const originalHTML = downloadAllBtn.innerHTML;
    downloadAllBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Zipping...';
    downloadAllBtn.disabled = true;

    imagesToDownload.forEach(img => {
        // Remove data:image/xxx;base64, prefix
        const base64Data = img.base64.split(',')[1];
        // Filename: title_page_X_img_Y
        const filename = `${paperTitle}_p${img.page}_${img.index + 1}.${img.ext}`;
        folder.file(filename, base64Data, { base64: true });
    });

    try {
        const content = await zip.generateAsync({ type: "blob" });
        const zipName = selectedIndices.size > 0 ? `${paperTitle}_selected.zip` : `${paperTitle}_images.zip`;
        saveAs(content, zipName);
    } catch (e) {
        console.error("Zip failed", e);
        showStatus('Failed to generate ZIP file.', 'error');
    } finally {
        downloadAllBtn.innerHTML = originalHTML;
        downloadAllBtn.disabled = false;
    }
});

function updateDownloadBtnState() {
    if (selectedIndices.size > 0) {
        downloadAllBtn.innerHTML = `<i class="fa-solid fa-check"></i> Download Selected (${selectedIndices.size})`;
    } else {
        downloadAllBtn.innerHTML = `<i class="fa-solid fa-file-zipper"></i> Download All`;
    }
}

function setLoading(isLoading) {
    extractBtn.disabled = isLoading;
    if (isLoading) {
        btnText.style.display = 'none';
        btnSpinner.style.display = 'block';
    } else {
        btnText.style.display = 'block';
        btnSpinner.style.display = 'none';
    }
}

function showStatus(msg, type = 'normal') {
    statusMsg.textContent = msg;
    statusMsg.className = 'status-msg ' + type;
}

function renderImages(images) {
    imgCount.textContent = images.length;
    resultSection.classList.remove('hidden');

    setTimeout(() => {
        resultSection.classList.add('visible');
    }, 10);

    images.forEach((img, idx) => { // Use idx for selection tracking
        const card = document.createElement('div');
        card.className = 'img-card';

        // Checkbox Overlay
        const checkbox = document.createElement('div');
        checkbox.className = 'checkbox-overlay';
        checkbox.innerHTML = '<i class="fa-solid fa-check"></i>';

        checkbox.onclick = (e) => {
            e.stopPropagation(); // Prevent card click
            if (selectedIndices.has(idx)) {
                selectedIndices.delete(idx);
                checkbox.classList.remove('checked');
                card.classList.remove('selected');
            } else {
                selectedIndices.add(idx);
                checkbox.classList.add('checked');
                card.classList.add('selected');
            }
            updateDownloadBtnState();
        };

        // Allow card click to trigger selection
        card.onclick = () => {
            checkbox.click();
        };

        const wrapper = document.createElement('div');
        wrapper.className = 'img-wrapper';

        const imageEl = document.createElement('img');
        imageEl.src = img.base64;
        imageEl.alt = `Extracted from Page ${img.page}`;

        wrapper.appendChild(imageEl);

        const info = document.createElement('div');
        info.className = 'img-info';

        // Single Download Link
        const dlSpan = document.createElement('span');
        const dlLink = document.createElement('a');
        dlLink.href = img.base64;
        dlLink.download = `${paperTitle}_p${img.page}_${img.index + 1}.${img.ext}`;
        dlLink.className = 'download-link';
        dlLink.textContent = 'Save';
        dlLink.onclick = (e) => e.stopPropagation();

        dlSpan.appendChild(dlLink);

        info.innerHTML = `<span>Page ${img.page}</span>`;
        info.appendChild(dlSpan);

        card.appendChild(checkbox);
        card.appendChild(wrapper);
        card.appendChild(info);
        gallery.appendChild(card);
    });
}
