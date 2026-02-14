---
title: "Paper Prism - Paper Image Extractor"
emoji: 📑
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
license: mit
---

# Paper Prism | Paper Image Extractor 🧪✨

A premium, glassmorphism-inspired web tool designed for researchers to instantly extract high-quality figures and diagrams from academic papers using only a DOI or direct PDF upload.

## 🚀 Live Demo
**[Launch Paper Prism on Hugging Face Spaces](https://notoow-paper-image-extractor.hf.space)**

## ✨ Core Features

- **DOI Smart Fetch**: Paste a DOI, and we'll handle the rest via Sci-Hub mirrors/Unpaywall.
- **Precision Extraction**: Powered by `PyMuPDF` to grab raw image bytes without quality loss.
- **Smart Filtering**: Automatically hides tiny icons/logos and focuses on actual scientific figures.
- **Social & Collaborative**:
  - **Hall of Fame**: Discover what researchers are trending globally.
  - **Live Multi-Country Hub**: Real-time chat and leaderboard.
- **Modern UX**: Beautiful Neumorphic design with mobile-first responsiveness.
- **SEO Optimized**: Built to be discoverable by research communities worldwide.

## 🛠️ Tech Stack

- **Backend**: Python, FastAPI, APScheduler
- **Extraction**: PyMuPDF (fitz)
- **Database/Real-time**: Supabase (PostgreSQL & Realtime)
- **Frontend**: Vanilla JS (ES6+), CSS Grid/Flexbox, Neumorphism system
- **Deployment**: Docker on Hugging Face Spaces

## 🛡️ Self-Maintenance

The app includes a built-in **Janitor Service** that automatically:
- Truncates old chat logs to maintain performance.
- Rotates the Hall of Fame images based on popularity and age.
- Employs a keep-alive self-ping task to stay active.

## ⚠️ Disclaimer

This tool is created for educational and research purposes. Please ensure you comply with international copyright laws and journal access policies.

---
Created with ❤️ for the global research community.
