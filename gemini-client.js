// SafePlate AI - Gemini integration layer. Loaded after the main script; overrides the simulated OCR + local analysis.
(function () {
    const API = location.protocol === "file:" ? (window.SAFEPLATE_API || "http://localhost:3000") : "";
    const localAnalysis = window.performAnalysisLogic; // fallback if the server/Gemini is unreachable
    let cache = { key: "", result: null };

    const getAllergies = () => { try { return JSON.parse(localStorage.getItem("safeplate_allergies") || "[]"); } catch { return []; } };
    const setAllergies = (arr) => { try { localStorage.setItem("safeplate_allergies", JSON.stringify(arr)); } catch {} };
    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    async function post(path, body) {
        const r = await fetch(API + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
        return data;
    }

    // Downscale photo so uploads are fast and cheap
   function toJpegBase64(source, maxSide = 1280) {
    const w = source.videoWidth || source.naturalWidth || source.width, h = source.videoHeight || source.naturalHeight || source.height;
    const scale = Math.min(1, maxSide / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    c.getContext("2d").drawImage(source, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.82).split(",")[1];
}

    function expiryInfo(iso) {
        if (!iso) return { tone: "slate", text: "Expiry date not found on this photo" };
        const days = Math.ceil((new Date(iso + "T23:59:59") - new Date()) / 86400000);
        if (days < 0) return { tone: "rose", text: `EXPIRED on ${iso} - do not consume` };
        if (days <= 30) return { tone: "amber", text: `Expires soon: ${iso} (${days} day${days === 1 ? "" : "s"} left)` };
        return { tone: "emerald", text: `Good until ${iso} (${days} days left)` };
    }

    function ensureExtras() {
        let box = document.getElementById("gemini-extras");
        if (box) return box;
        box = document.createElement("div");
        box.id = "gemini-extras";
        box.className = "glass-panel rounded-3xl p-5 sm:p-6 space-y-3 my-4";
        document.getElementById("allergen-card").after(box);
        return box;
    }

    function renderExtras(r) {
        const box = ensureExtras();
        const exp = expiryInfo(r.expiryDate);
        const pill = (label, v) => {
            const tone = v === "yes" ? "emerald" : v === "no" ? "rose" : "amber";
            return `<span class="px-3 py-1 rounded-full text-xs font-bold bg-${tone}-500/20 text-${tone}-200 border border-${tone}-400/40">${label}: ${esc(v)}</span>`;
        };
        box.innerHTML = `
            <div class="flex flex-wrap gap-2">${pill("Halal", r.dietary.halal)}${pill("Vegan", r.dietary.vegan)}${pill("Vegetarian", r.dietary.vegetarian)}</div>
            <div class="px-3 py-2 rounded-2xl text-xs font-bold bg-${exp.tone}-500/20 text-${exp.tone}-100 border border-${exp.tone}-400/40">${esc(exp.text)}</div>
            ${r.combinationWarnings.length ? `<div class="space-y-1">${r.combinationWarnings.map(w => `<div class="text-xs text-amber-200">⚠️ ${esc(w)}</div>`).join("")}</div>` : ""}
            <div class="pt-2 border-t border-white/10">
                <label class="text-[11px] text-slate-300 font-semibold">My allergies (comma separated, e.g. sesame, mustard, shellfish)</label>
                <input id="my-allergies" class="glass-input w-full rounded-xl p-2 text-xs mt-1" value="${esc(getAllergies().join(", "))}" placeholder="Anything - not limited to common allergens">
            </div>`;
        document.getElementById("my-allergies").addEventListener("change", (e) => {
            setAllergies(e.target.value.split(",").map(s => s.trim()).filter(Boolean));
            showToast("Allergies saved. Re-run analysis to apply.");
        });
    }

    function render(r) {
        window.currentProductTitle = r.productName; currentProductTitle = r.productName;
        const tag = [r.dietary.vegan === "yes" ? "Vegan" : r.dietary.vegetarian === "yes" ? "Vegetarian" : "", r.dietary.halal === "yes" ? "Halal" : ""].filter(Boolean).join(" · ");
        currentDietaryTag = tag || "Dietary status unclear";

        const cont = document.getElementById("allergen-badges-container");
        const badge = document.getElementById("allergen-count-badge");
        const card = document.getElementById("allergen-card");
        const t = UI_TRANSLATIONS[currentLang] || UI_TRANSLATIONS.en;
        if (r.allergens.length) {
            badge.textContent = `${r.allergens.length} Allergen${r.allergens.length > 1 ? "s" : ""} Detected`;
            badge.className = "px-3 py-1 rounded-full text-xs font-extrabold bg-rose-500/30 text-rose-100 border border-rose-400/50";
            card.classList.add("border-rose-500/40"); card.classList.remove("border-emerald-500/40");
            cont.innerHTML = r.allergens.map(a => `
                <div class="inline-flex items-center gap-2 px-3.5 py-2 rounded-2xl ${a.userAllergy ? "bg-rose-600/50 border-rose-300" : "bg-rose-500/25 border-rose-400/50"} border text-white shadow-sm">
                    <span class="w-2 h-2 rounded-full bg-rose-400 animate-ping"></span>
                    <span class="text-xs sm:text-sm font-extrabold">${esc(a.label)}${a.mayContain ? " (may contain)" : ""}${a.userAllergy ? " - YOUR ALLERGY" : ""}</span>
                </div>`).join("");
        } else {
            badge.textContent = "0 Allergens";
            badge.className = "px-3 py-1 rounded-full text-xs font-extrabold bg-emerald-500/25 text-emerald-200 border border-emerald-400/40";
            card.classList.remove("border-rose-500/40"); card.classList.add("border-emerald-500/40");
            cont.innerHTML = `<div class="text-emerald-200 text-xs font-semibold">${esc(t.noAllergens)}</div>`;
        }

        const colors = { cyan: "bg-cyan-500/20 text-cyan-200 border-cyan-400/30", amber: "bg-amber-500/20 text-amber-200 border-amber-400/30", emerald: "bg-emerald-500/20 text-emerald-200 border-emerald-400/30", rose: "bg-rose-500/20 text-rose-200 border-rose-400/30" };
        document.getElementById("ingredient-count-pill").textContent = `${r.ingredients.length} Decoded`;
        document.getElementById("ingredients-list").innerHTML = r.ingredients.map(i => `
            <div class="glass-card rounded-2xl p-4 space-y-2">
                <div class="flex items-start justify-between gap-2">
                    <h4 class="font-bold text-sm text-white">${esc(i.name)}${i.code ? ` (${esc(i.code)})` : ""}</h4>
                    <span class="px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase border shrink-0 ${colors[i.badgeColor] || colors.cyan}">${esc(i.category)}</span>
                </div>
                <p class="text-xs text-slate-300 leading-relaxed">${esc(i.explanation)}</p>
            </div>`).join("");

        document.getElementById("product-title-badge").textContent = currentProductTitle;
        document.getElementById("dietary-badge").textContent = currentDietaryTag;
        document.getElementById("simplified-summary-text").textContent = r.summary;
        renderExtras(r);
        lucide.createIcons();
    }

    // Text path: used when the user edits text / picks a sample / changes language
    window.performAnalysisLogic = async function (rawText) {
        const key = `${currentLang}|${getAllergies().join(",")}|${rawText}`;
        try {
            if (cache.key !== key) {
                updateStatusPill("Analysing with Gemini...", "cyan");
                cache = { key, result: await post("/api/analyze-label", { ocrText: rawText, lang: currentLang, userAllergies: getAllergies() }) };
                updateStatusPill("Scan Complete", "emerald");
            }
            render(cache.result);
        } catch (e) {
            showToast(`Gemini unavailable (${e.message}). Showing basic offline analysis.`, "amber");
            updateStatusPill("Offline mode", "amber");
            localAnalysis(rawText);
        }
    };

    // Image path: photo -> Gemini vision -> everything in one call
    async function scanImage(base64, laserId) {
        const laser = document.getElementById(laserId);
        laser && laser.classList.remove("hidden");
        updateStatusPill("Reading packet with Gemini...", "amber");
        try {
            const r = await post("/api/scan-image", { imageBase64: base64, mimeType: "image/jpeg", lang: currentLang, userAllergies: getAllergies() });
            const text = r.ocrText || "";
            document.getElementById("ocr-textarea").value = text;
            document.getElementById("ocr-result-panel").classList.remove("hidden");
            cache = { key: `${currentLang}|${getAllergies().join(",")}|${text}`, result: r };
            if (typeof hideExplanationBox === "function") hideExplanationBox();
            render(r);
            updateStatusPill("Scan Complete", "emerald");
            showToast("Packet analysed. Tap Explain for the simple summary.");
        } catch (e) {
            updateStatusPill("Scan failed", "rose");
            showToast(`Scan failed: ${e.message}`, "rose");
        } finally { laser && laser.classList.add("hidden"); }
    }

    function scanFile(file, laserId) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => scanImage(toJpegBase64(img), laserId);
            img.onerror = () => showToast("Could not read this image. Try a JPG or PNG photo.", "rose");
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    // Upload tab: show preview, then scan the REAL photo
    window.previewUploadedFile = function (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = document.getElementById("uploaded-preview");
            img.onload = () => scanImage(toJpegBase64(img), "upload-laser");
            img.src = e.target.result;
            img.classList.remove("hidden");
            document.getElementById("upload-placeholder").classList.add("hidden");
        };
        reader.readAsDataURL(file);
    };

    // "Scan Uploaded" button used to load a fake sample - now rescans the actual uploaded photo
    window.simulateOCRFromImage = function () {
        const img = document.getElementById("uploaded-preview");
        if (!img || img.classList.contains("hidden") || !img.src) { showToast("Upload a photo of the packet first.", "amber"); return; }
        scanImage(toJpegBase64(img), "upload-laser");
    };

    // Phones: live camera needs HTTPS, so fall back to the phone's own camera app
    let nativeCam;
    function openNativeCamera() {
        if (!nativeCam) {
            nativeCam = document.createElement("input");
            nativeCam.type = "file"; nativeCam.accept = "image/*"; nativeCam.setAttribute("capture", "environment");
            nativeCam.style.display = "none";
            nativeCam.addEventListener("change", () => { const f = nativeCam.files[0]; nativeCam.value = ""; if (f) scanFile(f, null); });
            document.body.appendChild(nativeCam);
        }
        nativeCam.click();
    }

    window.captureCameraFrame = function () {
        const video = document.getElementById("camera-video");
        if (video && video.videoWidth > 0) scanImage(toJpegBase64(video), "camera-laser");
        else openNativeCamera();
    };
})();
