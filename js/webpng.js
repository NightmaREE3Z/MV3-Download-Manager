(function() {
    'use strict';

    // MV3 Download Manager v9.6 - Anti-WebP/AVIF fallback helper
    // Goal:
    // - Keep the normal browser "Save image as..." workflow intact.
    // - Make pages prefer PNG/JPG/GIF fallbacks when they exist.
    // - On standalone WebP/AVIF image pages, replace the displayed image with a PNG Blob.
    // - Do not add UI, toggles, context menus, or download replacement behavior.

    if (window.__bravefoxAntiWebpInstalled) return;
    window.__bravefoxAntiWebpInstalled = true;

    const BAD_FORMAT_RE = /(?:^|[.\/=&?_%:-])(?:webp|avif)(?:$|[\s,\/&#?;:.)_-])/i;
    const BAD_TYPE_RE = /^\s*image\/(?:webp|avif)\s*(?:;|$)/i;
    const GOOD_IMAGE_RE = /(?:^|[.\/=&?_%:-])(?:png|jpe?g|gif|apng|bmp|svg)(?:$|[\s,\/&#?;:.)_-])/i;

    const SOURCESET_ATTRS = [
        'srcset',
        'data-srcset',
        'data-lazy-srcset',
        'data-original-srcset',
        'data-srcset-webp',
        'data-webp-srcset'
    ];

    const SRC_ATTRS = [
        'src',
        'data-src',
        'data-lazy-src',
        'data-original',
        'data-original-src',
        'data-webp',
        'data-webp-src'
    ];

    const WATCHED_ATTRS = [
        'type',
        'media',
        ...SOURCESET_ATTRS,
        ...SRC_ATTRS
    ];


    // === DIRECT IMAGE PAGE PNG TRANSFORMER ===
    // Handles the especially cursed case where a URL says .jpg/.png, but the server
    // still returns WebP/AVIF bytes. We cannot change Chrome's native save menu,
    // but on standalone image pages we can replace the displayed image with a PNG
    // Blob so normal right-click saving has a real PNG source to work with.
    const DIRECT_IMAGE_URL_RE = /\.(?:png|jpe?g|gif|webp|avif|bmp)(?:$|[?#])/i;
    const DIRECT_IMAGE_SKIP_RE = /\.(?:gif|svg)(?:$|[?#])/i;

    function isProbablyDirectImageDocument() {
        try {
            if (window.top !== window) return false;
        } catch (e) {
            return false;
        }

        const contentType = String(document.contentType || '').toLowerCase();
        if (/^image\//i.test(contentType)) return true;

        return DIRECT_IMAGE_URL_RE.test(String(window.location.href || ''));
    }

    function shouldSkipDirectImageTransform() {
        const href = String(window.location.href || '');
        const contentType = String(document.contentType || '').toLowerCase();

        // Preserve animated GIFs as GIFs, and do not mess with SVG documents.
        if (/^image\/(?:gif|svg\+xml)/i.test(contentType)) return true;
        if (DIRECT_IMAGE_SKIP_RE.test(href)) return true;

        return false;
    }

    function directImageNeedsPngTransform(img) {
        if (!img) return false;

        const contentType = String(document.contentType || '').toLowerCase();
        const href = String(window.location.href || '');
        const src = String(img.currentSrc || img.src || img.getAttribute('src') || '');

        // The main target: fake .jpg/.png URLs served as WebP/AVIF.
        if (/^image\/(?:webp|avif)/i.test(contentType)) return true;
        if (mentionsBadFormat(src)) return true;

        // If our cache-buster is present and Chrome still exposes the document as a
        // generic image document, treat it as suspicious only when the URL itself is
        // an image file. This avoids touching normal webpages.
        if (/[?&]bravefox_no_webp=1\b/i.test(href) && DIRECT_IMAGE_URL_RE.test(href)) {
            return !/^image\/(?:png|jpe?g|bmp)/i.test(contentType);
        }

        return false;
    }

    function makeDirectImagePngFilename() {
        try {
            const url = new URL(window.location.href);
            let name = decodeURIComponent((url.pathname.split('/').pop() || 'image').trim());
            name = name.replace(/[\\/:*?"<>|\x00-\x1F]/g, '_');
            name = name.replace(/\.(?:webp|avif|png|jpe?g|bmp)$/i, '');
            if (!name) name = 'image';
            return name + '.png';
        } catch (e) {
            return 'image.png';
        }
    }

    function getDirectImageElement() {
        try {
            const imgs = Array.from(document.images || []);
            if (!imgs.length) return null;

            // Prefer the largest image, because Chrome's standalone image viewer can
            // sometimes have tiny UI/helper images in unusual cases.
            imgs.sort((a, b) => {
                const aw = a.naturalWidth || a.width || 0;
                const ah = a.naturalHeight || a.height || 0;
                const bw = b.naturalWidth || b.width || 0;
                const bh = b.naturalHeight || b.height || 0;
                return (bw * bh) - (aw * ah);
            });
            return imgs[0] || null;
        } catch (e) {
            return null;
        }
    }

    function blobFromCanvas(canvas) {
        return new Promise(resolve => {
            try {
                canvas.toBlob(resolve, 'image/png');
            } catch (e) {
                resolve(null);
            }
        });
    }

    async function convertDirectImageToPng(img) {
        if (!img || img.dataset.bravefoxDirectImagePng === '1') return false;
        if (!directImageNeedsPngTransform(img)) return false;

        const width = img.naturalWidth || img.width || 0;
        const height = img.naturalHeight || img.height || 0;
        if (!width || !height) return false;

        try {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext('2d', { alpha: true });
            if (!ctx) return false;

            ctx.drawImage(img, 0, 0, width, height);
            const blob = await blobFromCanvas(canvas);
            if (!blob) return false;

            const pngUrl = URL.createObjectURL(blob);
            const pngName = makeDirectImagePngFilename();

            img.dataset.bravefoxDirectImagePng = '1';
            img.dataset.bravefoxOriginalSrc = img.currentSrc || img.src || img.getAttribute('src') || '';
            img.dataset.bravefoxPngFilename = pngName;
            img.removeAttribute('srcset');
            img.setAttribute('alt', pngName);
            img.setAttribute('title', pngName);
            img.srcset = '';
            img.src = pngUrl;

            try { document.title = pngName; } catch (e) {}
            try { document.documentElement.dataset.bravefoxDirectImagePng = '1'; } catch (e) {}

            window.addEventListener('pagehide', () => {
                try { URL.revokeObjectURL(pngUrl); } catch (e) {}
            }, { once: true });

            return true;
        } catch (e) {
            // Canvas may fail if the browser marks the image as cross-origin tainted.
            // In that case we leave the page alone instead of breaking the image.
            devLog('Direct image PNG transform failed:', e && (e.message || e));
            return false;
        }
    }

    function installDirectImageTransformer() {
        if (!isProbablyDirectImageDocument() || shouldSkipDirectImageTransform()) return false;
        if (window.__bravefoxDirectImageTransformerInstalled) return true;
        window.__bravefoxDirectImageTransformerInstalled = true;

        let attempts = 0;
        const maxAttempts = 80;

        const tryConvert = () => {
            attempts++;
            const img = getDirectImageElement();
            if (!img) {
                if (attempts < maxAttempts) setTimeout(tryConvert, 50);
                return;
            }

            const run = () => {
                convertDirectImageToPng(img).then(done => {
                    if (!done && attempts < maxAttempts) setTimeout(tryConvert, 100);
                });
            };

            if (img.complete && (img.naturalWidth || img.width)) {
                run();
            } else {
                img.addEventListener('load', run, { once: true });
                if (attempts < maxAttempts) setTimeout(tryConvert, 100);
            }
        };

        tryConvert();
        return true;
    }

    const isBadType = (value) => BAD_TYPE_RE.test(String(value || ''));
    const mentionsBadFormat = (value) => BAD_FORMAT_RE.test(String(value || ''));
    const mentionsGoodImage = (value) => GOOD_IMAGE_RE.test(String(value || ''));

    function splitSrcset(srcset) {
        // Good enough for real-world srcset fallback filtering.
        // Handles normal comma-separated candidates; leaves unusual quoted/data URLs alone.
        return String(srcset || '')
            .split(',')
            .map(part => part.trim())
            .filter(Boolean);
    }

    function stripBadSrcsetCandidates(value) {
        const original = String(value || '').trim();
        if (!original || !mentionsBadFormat(original)) return null;

        const candidates = splitSrcset(original);
        if (!candidates.length) return null;

        const goodCandidates = candidates.filter(candidate => !mentionsBadFormat(candidate));
        if (!goodCandidates.length) return '';

        const stripped = goodCandidates.join(', ');
        return stripped !== original ? stripped : null;
    }

    function saveOriginalAttr(el, attr) {
        const key = `bravefoxOriginal${attr.replace(/(^|-)([a-z])/g, (_, __, c) => c.toUpperCase())}`;
        if (!el.dataset[key] && el.hasAttribute(attr)) {
            el.dataset[key] = el.getAttribute(attr) || '';
        }
    }

    function disablePictureSource(source) {
        if (!source || source.dataset.bravefoxAntiWebpDisabled === '1') return;
        if (source.parentElement && source.parentElement.tagName !== 'PICTURE') return;

        source.dataset.bravefoxAntiWebpDisabled = '1';

        for (const attr of ['type', 'media', ...SOURCESET_ATTRS]) {
            saveOriginalAttr(source, attr);
        }

        // Make this source impossible to select while preserving the node for page scripts.
        source.setAttribute('media', 'not all');
        source.setAttribute('type', 'application/x-bravefox-disabled-image-source');

        for (const attr of SOURCESET_ATTRS) {
            if (source.hasAttribute(attr)) {
                source.removeAttribute(attr);
            }
        }
    }

    function sourceLooksBad(source) {
        if (!source || source.dataset.bravefoxAntiWebpDisabled === '1') return false;
        if (source.parentElement && source.parentElement.tagName !== 'PICTURE') return false;

        const type = source.getAttribute('type') || '';
        if (isBadType(type)) return true;

        for (const attr of SOURCESET_ATTRS) {
            if (mentionsBadFormat(source.getAttribute(attr))) return true;
        }

        return false;
    }

    function cleanImgSrcset(img) {
        if (!img) return false;
        let changed = false;

        for (const attr of SOURCESET_ATTRS) {
            if (!img.hasAttribute(attr)) continue;

            const value = img.getAttribute(attr) || '';
            const stripped = stripBadSrcsetCandidates(value);
            if (stripped === null) continue;

            saveOriginalAttr(img, attr);
            if (stripped) {
                img.setAttribute(attr, stripped);
            } else {
                img.removeAttribute(attr);
            }
            changed = true;
        }

        return changed;
    }

    function findBestNonWebpFallback(img) {
        if (!img) return '';

        for (const attr of SRC_ATTRS) {
            const value = img.getAttribute(attr);
            if (value && !mentionsBadFormat(value) && mentionsGoodImage(value)) {
                return value;
            }
        }

        return '';
    }

    function forceImgFallback(img) {
        if (!img) return;

        const attrSrc = img.getAttribute('src') || '';
        const current = img.currentSrc || img.src || attrSrc;
        const needsFallback = mentionsBadFormat(current) || mentionsBadFormat(attrSrc);
        if (!needsFallback) return;

        const fallback = findBestNonWebpFallback(img);
        if (!fallback) return;

        saveOriginalAttr(img, 'src');
        saveOriginalAttr(img, 'srcset');
        img.removeAttribute('srcset');
        img.srcset = '';
        img.setAttribute('src', fallback);
        img.src = fallback;
    }

    function processImg(img) {
        if (!img || img.nodeType !== 1 || img.tagName !== 'IMG') return;

        const srcsetChanged = cleanImgSrcset(img);
        forceImgFallback(img);

        // Encourage browser source re-selection after srcset cleanup.
        if (srcsetChanged && img.parentElement && img.parentElement.tagName === 'PICTURE') {
            const src = img.getAttribute('src');
            if (src && !mentionsBadFormat(src)) {
                img.src = src;
            }
        }
    }

    function processPicture(picture) {
        if (!picture || picture.nodeType !== 1 || picture.tagName !== 'PICTURE') return;

        let disabledAnySource = false;
        for (const source of picture.querySelectorAll('source')) {
            if (sourceLooksBad(source)) {
                disablePictureSource(source);
                disabledAnySource = true;
            }
        }

        for (const img of picture.querySelectorAll('img')) {
            processImg(img);
            if (disabledAnySource) {
                forceImgFallback(img);
            }
        }
    }

    function processSource(source) {
        if (!source || source.nodeType !== 1 || source.tagName !== 'SOURCE') return;
        if (sourceLooksBad(source)) {
            const picture = source.closest('picture');
            if (picture) {
                processPicture(picture);
            } else {
                disablePictureSource(source);
            }
        }
    }

    function processImagePreload(link) {
        if (!link || link.nodeType !== 1 || link.tagName !== 'LINK') return;

        const rel = (link.getAttribute('rel') || '').toLowerCase();
        const as = (link.getAttribute('as') || '').toLowerCase();
        if (!rel.includes('preload') || as !== 'image') return;

        const type = link.getAttribute('type') || '';
        const href = link.getAttribute('href') || '';
        const imagesrcset = link.getAttribute('imagesrcset') || '';

        if (!isBadType(type) && !mentionsBadFormat(href) && !mentionsBadFormat(imagesrcset)) return;
        if (link.dataset.bravefoxAntiWebpDisabled === '1') return;

        link.dataset.bravefoxAntiWebpDisabled = '1';
        saveOriginalAttr(link, 'rel');
        saveOriginalAttr(link, 'href');
        saveOriginalAttr(link, 'imagesrcset');
        link.setAttribute('rel', 'x-bravefox-disabled-preload');
        link.removeAttribute('imagesrcset');
    }

    function processNode(node) {
        if (!node || node.nodeType !== 1) return;

        const tag = node.tagName;
        if (tag === 'PICTURE') processPicture(node);
        else if (tag === 'SOURCE') processSource(node);
        else if (tag === 'IMG') processImg(node);
        else if (tag === 'LINK') processImagePreload(node);

        if (node.querySelectorAll) {
            const targets = node.querySelectorAll('picture, picture source, img, link[as="image"]');
            for (const target of targets) {
                const targetTag = target.tagName;
                if (targetTag === 'PICTURE') processPicture(target);
                else if (targetTag === 'SOURCE') processSource(target);
                else if (targetTag === 'IMG') processImg(target);
                else if (targetTag === 'LINK') processImagePreload(target);
            }
        }
    }

    let scanQueued = false;
    function queueScan() {
        if (scanQueued) return;
        scanQueued = true;
        const runner = () => {
            scanQueued = false;
            processNode(document.documentElement || document.body);
        };

        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(runner, { timeout: 750 });
        } else {
            setTimeout(runner, 50);
        }
    }

    function installObserver() {
        const root = document.documentElement || document.body;
        if (!root) {
            setTimeout(installObserver, 25);
            return;
        }

        processNode(root);

        const observer = new MutationObserver((mutations) => {
            let shouldScan = false;

            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    for (const node of mutation.addedNodes) {
                        processNode(node);
                    }
                } else if (mutation.type === 'attributes') {
                    processNode(mutation.target);
                    shouldScan = true;
                }
            }

            if (shouldScan) queueScan();
        });

        observer.observe(root, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: WATCHED_ATTRS
        });

        window.addEventListener('DOMContentLoaded', queueScan, { once: true, passive: true });
        window.addEventListener('load', queueScan, { once: true, passive: true });
    }

    if (installDirectImageTransformer()) return;
    installObserver();
})();
