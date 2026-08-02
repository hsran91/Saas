// =========================
// GLOBAL STATE
// =========================
try {
    if (typeof window !== 'undefined') {
        window.__EMAR_SCRIPT_LOADED = (window.__EMAR_SCRIPT_LOADED || 0) + 1;
    }
} catch (e) {
    // ignore
}

const API_BASE = window.location.protocol === "file:" ? "http://localhost:5000" : "";
let residents = [];
let currentResidentId = null;
let currentUser = null;
const medicationDraftStatus = new Map();
const medicationCache = new Map();
let passFinalized = false;
let currentMedTimeslot = null;
let editingMedicationId = null;
let prnFollowupMedicationId = null;
let medPassResidentId = null;
let medPassShift = null;
let pendingFinalizeContext = null;
let medPassDueResidentIds = new Set();
let medPassDueOnly = false;

const SHIFT_WINDOWS = {
    AM: { start: 6 * 60, end: 14 * 60, label: "06:00 - 14:00" },
    PM: { start: 14 * 60, end: 22 * 60, label: "14:00 - 22:00" },
    NOC: { start: 22 * 60, end: 6 * 60, label: "22:00 - 06:00" }
};

function getCurrentTimeslot(now = new Date()) {
    const minutes = now.getHours() * 60 + now.getMinutes();
    if (minutes >= SHIFT_WINDOWS.NOC.start || minutes < SHIFT_WINDOWS.NOC.end) return "NOC";
    if (minutes >= SHIFT_WINDOWS.PM.start && minutes < SHIFT_WINDOWS.PM.end) return "PM";
    if (minutes >= SHIFT_WINDOWS.AM.start && minutes < SHIFT_WINDOWS.AM.end) return "AM";
    return "AM";
}

// Expose commonly used functions to `window` for inline onclick handlers
;(function exposeGlobals() {
    const names = [
        'showPage','openAddResidentModal','closeAddResidentModal','saveNewResident',
        'openDashboardEditModal','closeDashboardEditModal','logout','openAddMedPanel',
        'closeAddMedPanel','addMedTimeRow','removeMedTimeRow','finalizeMedicationPass',
        'openPayInvoicePanel','closePayInvoicePanel','openAddInvoicePanel','closeAddInvoicePanel',
        'openAddAlertPanel','closeAddAlertPanel','openResidentProfile','deleteResident','payInvoice',
        'deleteMedication','startMedicationEdit','openPrnFollowupModal','closePrnFollowupModal',
        'loadMedPassPage','setMedPassShift','onMedPassResidentChange','finalizeMedPassShift','toggleMedPassDueOnly',
        'openMedPassResidentPage'
    ];

    names.forEach(name => {
        try {
            const fn = eval(name);
            if (typeof fn === 'function') window[name] = fn;
        } catch (e) {
            // ignore missing functions
        }
    });
})();

function getToken() {
    return localStorage.getItem("authToken");
}

function saveToken(token) {
    localStorage.setItem("authToken", token);
    setUserFromToken(token);
}

function clearAuth() {
    localStorage.removeItem("authToken");
    currentUser = null;
    window.location.href = "login.html";
}

function parseJwt(token) {
    try {
        const payload = token.split(".")[1];
        const decoded = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
        return JSON.parse(decodeURIComponent(decoded.split("").map(function(c) {
            return "%" + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join("")));
    } catch (err) {
        return null;
    }
}

function setUserFromToken(token) {
    currentUser = parseJwt(token);
    if (!currentUser || !currentUser.tenantId) {
        clearAuth();
        return;
    }
    updateRoleUI();
}

function getAuthHeaders() {
    const token = getToken();
    if (!token) return {};

    const user = currentUser || parseJwt(token);
    const tenantId = user?.tenantId;
    return {
        Authorization: `Bearer ${token}`,
        ...(tenantId ? { "X-Tenant-Id": tenantId } : {})
    };
}

function authFetch(url, options = {}) {
    const headers = {
        ...(options.headers || {}),
        ...getAuthHeaders(),
    };

    if (!(options.body instanceof FormData) && !headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
    }

    return fetch(url, { ...options, headers }).then(async res => {
        if (res.status === 401) {
            clearAuth();
            throw new Error("Session expired");
        }
        if (!res.ok) {
            const payload = await res.json().catch(() => ({}));
            throw new Error(payload.error || payload.message || "Request failed");
        }
        return res.json();
    });
}

function escapeHtml(text) {
    return String(text || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function updateRoleUI() {
    const badge = document.getElementById("currentUserRoleBadge");
    const logoutButton = document.getElementById("logoutButton");
    const dashboardNav = document.getElementById("nav-dashboard");
    const billNav = document.getElementById("nav-billing");
    const medNav = document.getElementById("nav-meds");
    const medPassNav = document.getElementById("nav-medpass");
    const billingPageDescription = document.getElementById("billingPageDescription");
    const registerNav = document.getElementById("nav-register");
    const addResidentBtn = document.getElementById("addResidentButton");
    const residentBillingTabButton = document.getElementById("residentBillingTabButton");
    const residentPayInvoiceButton = document.getElementById("residentPayInvoiceButton");
    const residentNewInvoiceButton = document.getElementById("residentNewInvoiceButton");
    const editQuickStatsButton = document.getElementById("editQuickStatsButton");
    const editTodaysFocusButton = document.getElementById("editTodaysFocusButton");

    if (!currentUser) {
        if (badge) badge.textContent = "";
        if (logoutButton) logoutButton.style.display = "none";
        if (billNav) billNav.style.display = "none";
        if (medPassNav) medPassNav.style.display = "none";
        if (registerNav) registerNav.style.display = "none";
        if (addResidentBtn) addResidentBtn.style.display = "none";
        if (residentBillingTabButton) residentBillingTabButton.style.display = "none";
        if (residentPayInvoiceButton) residentPayInvoiceButton.style.display = "none";
        if (residentNewInvoiceButton) residentNewInvoiceButton.style.display = "none";
        if (editQuickStatsButton) editQuickStatsButton.style.display = "none";
        if (editTodaysFocusButton) editTodaysFocusButton.style.display = "none";
        return;
    }

    if (badge) badge.textContent = `${currentUser.name || "User"} (${currentUser.role})`;
    if (logoutButton) logoutButton.style.display = "inline-block";

    if (currentUser.role === "admin") {
        if (billNav) billNav.style.display = "block";
        if (medPassNav) medPassNav.style.display = "block";
        if (registerNav) registerNav.style.display = "inline-block";
        if (addResidentBtn) addResidentBtn.style.display = "inline-block";
        if (residentBillingTabButton) residentBillingTabButton.style.display = "inline-block";
        if (residentPayInvoiceButton) residentPayInvoiceButton.style.display = "inline-block";
        if (residentNewInvoiceButton) residentNewInvoiceButton.style.display = "inline-block";
        if (editQuickStatsButton) editQuickStatsButton.style.display = "inline-block";
        if (editTodaysFocusButton) editTodaysFocusButton.style.display = "inline-block";
        if (medPassNav) medPassNav.style.display = "block";
    } else if (currentUser.role === "poa") {
        if (dashboardNav) dashboardNav.style.display = "none";
        if (registerNav) registerNav.style.display = "none";
        if (billNav) billNav.style.display = "block";
        if (medNav) medNav.style.display = "none";
        if (medPassNav) medPassNav.style.display = "none";
        if (addResidentBtn) addResidentBtn.style.display = "none";
        if (residentBillingTabButton) residentBillingTabButton.style.display = "inline-block";
        if (residentPayInvoiceButton) residentPayInvoiceButton.style.display = "inline-block";
        if (residentNewInvoiceButton) residentNewInvoiceButton.style.display = "none";
        if (editQuickStatsButton) editQuickStatsButton.style.display = "none";
        if (editTodaysFocusButton) editTodaysFocusButton.style.display = "none";
        if (billingPageDescription) billingPageDescription.style.display = "none";
        const alertsNav = document.getElementById("nav-alerts");
        const marNav = document.getElementById("nav-mar");
        if (alertsNav) alertsNav.style.display = "none";
        if (marNav) marNav.style.display = "none";
        const medsTabButton = document.getElementById("residentMedsTabButton");
        const marTabButton = document.getElementById("residentMarTabButton");
        if (medsTabButton) medsTabButton.style.display = "none";
        if (marTabButton) marTabButton.style.display = "none";
        const medsTab = document.getElementById("medsTab");
        const marTab = document.getElementById("marTab");
        const billingTab = document.getElementById("billingTab");
        if (medsTab) medsTab.style.display = "none";
        if (marTab) marTab.style.display = "none";
        if (billingTab) billingTab.style.display = "block";
    } else {
        if (registerNav) registerNav.style.display = "none";
        if (billNav) billNav.style.display = "none";
        if (medPassNav) medPassNav.style.display = ["medtech", "rn"].includes(currentUser.role) ? "block" : "none";
        if (addResidentBtn) addResidentBtn.style.display = currentUser.role === "medtech" || currentUser.role === "rn" ? "inline-block" : "none";
        if (residentBillingTabButton) residentBillingTabButton.style.display = currentUser.role === "poa" ? "inline-block" : "none";
        if (residentPayInvoiceButton) residentPayInvoiceButton.style.display = currentUser.role === "poa" ? "inline-block" : "none";
        if (residentNewInvoiceButton) residentNewInvoiceButton.style.display = "none";
        if (editQuickStatsButton) editQuickStatsButton.style.display = "none";
        if (editTodaysFocusButton) editTodaysFocusButton.style.display = "none";
    }
}

function logout() {
    localStorage.removeItem("authToken");
    window.location.href = "login.html";
}

function requireLogin() {
    const token = getToken();
    if (!token) {
        window.location.href = "login.html";
        return false;
    }
    if (!currentUser) {
        setUserFromToken(token);
    }
    return true;
}

function initApp() {
    if (!requireLogin()) return;
    updateRoleUI();
    loadDashboardSettings();
    loadResidentCards();
    if (currentUser && currentUser.role === "poa") {
        showPage("billingPage");
    } else {
        showPage("dashboardPage");
    }
}

// Dashboard settings load/save
async function loadDashboardSettings() {
    try {
        const settings = await authFetch(`${API_BASE}/dashboard`);
        const quickEl = document.getElementById('quickStatsText');
        const focusEl = document.getElementById('todaysFocusText');
        if (quickEl) quickEl.textContent = settings.quickStats || 'Monitor residents, medications, and MAR activity at a glance.';
        if (focusEl) focusEl.textContent = settings.todaysFocus || 'Use the Residents and MAR sections to manage today\'s passes.';
    } catch (err) {
        console.error('Error loading dashboard settings:', err);
    }
}

function saveDashboardSettings() {
    const quick = document.getElementById('dashboardQuickStats')?.value || '';
    const focus = document.getElementById('dashboardTodaysFocus')?.value || '';
    authFetch(`${API_BASE}/dashboard`, { method: 'PATCH', body: JSON.stringify({ quickStats: quick, todaysFocus: focus }) })
        .then(() => {
            const quickEl = document.getElementById('quickStatsText');
            const focusEl = document.getElementById('todaysFocusText');
            if (quickEl) quickEl.textContent = quick;
            if (focusEl) focusEl.textContent = focus;
            closeDashboardEditModal();
        })
        .catch(err => {
            console.error('Error saving dashboard settings:', err);
            alert(err.message || 'Unable to save dashboard settings');
        });
}

window.addEventListener("DOMContentLoaded", () => {
    const logoutButton = document.getElementById("logoutButton");
    if (logoutButton) {
        logoutButton.addEventListener("click", logout);
    }

    const dashboardEditForm = document.getElementById("dashboardEditForm");
    if (dashboardEditForm) {
        dashboardEditForm.addEventListener("submit", function (e) {
            e.preventDefault();
            saveDashboardSettings();
        });
    }

    const adminRegisterForm = document.getElementById("adminRegisterForm");
    const roleSelect = document.getElementById("regRole");
    if (adminRegisterForm) {
        adminRegisterForm.addEventListener("submit", registerNewUser);
    }
    if (roleSelect) {
        const registerResidentIdGroup = document.getElementById("registerResidentIdGroup");
        if (registerResidentIdGroup) {
            roleSelect.addEventListener("change", () => {
                registerResidentIdGroup.style.display = roleSelect.value === "poa" ? "block" : "none";
            });
            registerResidentIdGroup.style.display = roleSelect.value === "poa" ? "block" : "none";
        }
    }

    initApp();
});

function setPassFinalized(value, listId = "med-list", finalizeButtonId = "finalizePassButton") {
    passFinalized = value;
    const medList = document.getElementById(listId);
    const finalizeBtn = document.getElementById(finalizeButtonId);

    if (medList) {
        medList.classList.toggle("pass-finalized", value);
    }
    if (finalizeBtn) {
        finalizeBtn.disabled = value;
    }
}

function openDashboardEditModal() {
    const modal = document.getElementById("dashboardEditModal");
    const quickStatsInput = document.getElementById("dashboardQuickStats");
    const focusInput = document.getElementById("dashboardTodaysFocus");
    if (!modal || !quickStatsInput || !focusInput) return;

    quickStatsInput.value = document.getElementById("quickStatsText")?.textContent || "";
    focusInput.value = document.getElementById("todaysFocusText")?.textContent || "";
    modal.style.display = "flex";
}

function closeDashboardEditModal() {
    const modal = document.getElementById("dashboardEditModal");
    if (modal) modal.style.display = "none";
}

async function loadResidentCards() {
    try {
        const data = await authFetch(`${API_BASE}/residents`);
        residents = data || [];
        const container = document.getElementById("residentList");
        if (!container) return;

        container.innerHTML = "";

        if (!residents.length) {
            container.innerHTML = `<p class="muted">No residents yet. Click "Add Resident" to create one.</p>`;
            return;
        }

        const slot = currentMedTimeslot || getCurrentTimeslot();

        // For admin/medtech, fetch medications to determine due status
        const shouldCheckMeds = currentUser && (currentUser.role === "admin" || currentUser.role === "medtech");

        await Promise.all(residents.map(async resident => {
            const card = document.createElement("div");
            card.classList.add("resident-card");

            const thumbSrc = resident.photoUrl ? `${API_BASE}${resident.photoUrl}` : "images/placeholder.svg";

            let isDue = false;
            if (shouldCheckMeds) {
                try {
                    const meds = await fetch(`${API_BASE}/medications/${resident._id}`, { headers: getAuthHeaders() }).then(r => r.json()).catch(() => []);
                    isDue = Array.isArray(meds) && meds.some(m => medIsScheduledForSlot(m, slot));
                } catch (e) {
                    console.error("Error checking meds for resident", resident._id, e);
                }
            }

            if (isDue) card.classList.add("due");
            else if (shouldCheckMeds) card.classList.add("no-due");

            const codeHtml = (currentUser && currentUser.role === "admin" && resident.residentCode) ? `<p class="resident-code">Code: ${resident.residentCode}</p>` : "";

            card.innerHTML = `
                    <div class="resident-card-row">
                        <img class="resident-thumb" src="${thumbSrc}" alt="${resident.firstName} ${resident.lastName}">
                        <div class="resident-card-body">
                            <div class="resident-card-header">
                                <h3>${resident.firstName} ${resident.lastName}</h3>
                                <button type="button" class="secondary-btn" onclick="event.stopPropagation(); deleteResident('${resident._id}')">Delete</button>
                            </div>
                            <p class="muted">Room ${resident.roomNumber}</p>
                            ${codeHtml}
                        </div>
                    </div>
                `;

            card.onclick = () => openResidentProfile(resident._id);
            container.appendChild(card);
        }));
    } catch (err) {
        console.error("Error loading residents:", err);
    }
}

async function ensureResidentsLoaded(force = false) {
    if (!force && Array.isArray(residents) && residents.length) {
        return residents;
    }
    const data = await authFetch(`${API_BASE}/residents`);
    residents = Array.isArray(data) ? data : [];
    return residents;
}

function renderMedPassShiftButtons() {
    ["AM", "PM", "NOC"].forEach(shift => {
        const btn = document.getElementById(`medpassShift${shift}`);
        if (!btn) return;
        btn.classList.toggle("active-shift", medPassShift === shift);
    });
}

function getShiftWindowLabel(shift) {
    return SHIFT_WINDOWS[shift]?.label || "";
}

function applyMedPassShiftTheme(shift) {
    const shell = document.querySelector("#medPassPage .medpass-shell");
    if (!shell) return;
    shell.classList.remove("shift-am", "shift-pm", "shift-noc");
    if (shift === "AM") shell.classList.add("shift-am");
    if (shift === "PM") shell.classList.add("shift-pm");
    if (shift === "NOC") shell.classList.add("shift-noc");
}

function updateMedPassShiftBanner(shift, dueResidentsCount) {
    const title = document.getElementById("medPassShiftTitle");
    const dueResidents = document.getElementById("medPassShiftDueResidents");
    const windowLabel = getShiftWindowLabel(shift);
    if (title) title.textContent = `Current Shift: ${shift} (${windowLabel})`;
    if (dueResidents) dueResidents.textContent = `Residents with meds due: ${dueResidentsCount}`;
}

async function calculateDueResidentsForShift(shift) {
    if (!shift) return [];

    const checks = await Promise.all(
        residents.map(async (resident) => {
            try {
                const meds = await authFetch(`${API_BASE}/medications/${resident._id}`);
                const isDue = Array.isArray(meds) && meds.some((m) => medIsScheduledForSlot(m, shift));
                return isDue ? resident : null;
            } catch (err) {
                console.error("Error loading resident meds for shift context:", resident._id, err);
                return null;
            }
        })
    );

    return checks.filter(Boolean);
}

function updateMedPassSummary(text) {
    const summary = document.getElementById("medPassSummary");
    if (summary) summary.textContent = text;
}

function updateMedPassCensusUI(census) {
    const dueEl = document.getElementById("medPassCensusDue");
    const completedEl = document.getElementById("medPassCensusCompleted");
    const heldEl = document.getElementById("medPassCensusHeld");
    const refusedEl = document.getElementById("medPassCensusRefused");
    const prnEl = document.getElementById("medPassCensusPrn");

    if (dueEl) dueEl.textContent = String(census.due || 0);
    if (completedEl) completedEl.textContent = String(census.completed || 0);
    if (heldEl) heldEl.textContent = String(census.held || 0);
    if (refusedEl) refusedEl.textContent = String(census.refused || 0);
    if (prnEl) prnEl.textContent = String(census.prn || 0);
}

function resetMedPassCensus() {
    updateMedPassCensusUI({ due: 0, completed: 0, held: 0, refused: 0, prn: 0 });
}

function marScheduledTimeMatchesShift(scheduledTime, shift) {
    if (!scheduledTime || !shift) return false;

    const raw = String(scheduledTime).trim();
    const upper = raw.toUpperCase();
    if (upper === shift) return true;
    if (upper.includes(` ${shift}`) || upper.endsWith(shift)) return true;

    const minutes = parseTimeToMinutes(raw);
    if (minutes == null) return false;
    return isTimeInSlot(minutes, shift);
}

async function loadMedPassCensus(residentId, shift, dueCount = 0) {
    if (!residentId || !shift) {
        resetMedPassCensus();
        return;
    }

    try {
        const entries = await authFetch(`${API_BASE}/mar/${residentId}`);
        const now = new Date();
        const dayStart = new Date(now);
        dayStart.setHours(0, 0, 0, 0);

        const todaysShiftEntries = (Array.isArray(entries) ? entries : []).filter(entry => {
            const actual = new Date(entry.actualTime || entry.createdAt || 0);
            if (Number.isNaN(actual.getTime())) return false;
            if (actual < dayStart) return false;
            if (entry.status === "prn-followup") return false;
            return marScheduledTimeMatchesShift(entry.scheduledTime, shift);
        });

        const uniqueMedIds = new Set();
        let held = 0;
        let refused = 0;
        let prn = 0;
        let completed = 0;

        todaysShiftEntries.forEach(entry => {
            const medId = entry.medicationId?._id || entry.medicationId;
            if (medId) uniqueMedIds.add(String(medId));
            if (entry.status === "given") completed += 1;
            if (entry.status === "held") held += 1;
            if (entry.status === "refused") refused += 1;
            if (entry.status === "prn") prn += 1;
        });

        const chartedCount = uniqueMedIds.size;
        const dueRemaining = Math.max(0, Number(dueCount || 0) - chartedCount);

        updateMedPassCensusUI({
            due: dueRemaining,
            completed,
            held,
            refused,
            prn
        });
    } catch (err) {
        console.error("Error loading Med Pass census:", err);
        resetMedPassCensus();
    }
}

function populateMedPassResidentSelect() {
    const select = document.getElementById("medPassResidentSelect");
    if (!select) return;

    const dueOnlyToggle = document.getElementById("medPassDueOnlyToggle");
    if (dueOnlyToggle) dueOnlyToggle.checked = medPassDueOnly;

    const residentsForSelect = medPassDueOnly
        ? residents.filter(r => medPassDueResidentIds.has(String(r._id)))
        : residents;

    select.innerHTML = `<option value="">Select a resident</option>`;
    residentsForSelect.forEach(resident => {
        const label = `${resident.firstName} ${resident.lastName} (${resident.roomNumber || "-"})`;
        const dueTag = medPassDueResidentIds.has(String(resident._id)) ? " [DUE]" : "";
        select.innerHTML += `<option value="${resident._id}">${escapeHtml(label + dueTag)}</option>`;
    });

    const residentExists = residentsForSelect.some(r => String(r._id) === String(medPassResidentId));
    if (!residentExists) {
        medPassResidentId = null;
    }

    if (!medPassResidentId && residentsForSelect.length) {
        medPassResidentId = residentsForSelect[0]._id;
    }

    select.value = medPassResidentId || "";

    if (!residentsForSelect.length) {
        select.innerHTML = `<option value="">No residents due this shift</option>`;
        select.value = "";
    }

    renderMedPassResidentCards(residentsForSelect);
}

function renderMedPassResidentCards(residentsForCards) {
    const container = document.getElementById("medPassResidentCards");
    if (!container) return;

    container.innerHTML = "";

    if (!Array.isArray(residentsForCards) || !residentsForCards.length) {
        const empty = document.createElement("p");
        empty.className = "muted";
        empty.textContent = medPassDueOnly ? "No residents due in this shift." : "No residents available.";
        container.appendChild(empty);
        return;
    }

    residentsForCards.forEach((resident) => {
        const card = document.createElement("div");
        card.classList.add("resident-card", "medpass-resident-card");

        const isDue = medPassDueResidentIds.has(String(resident._id));
        if (isDue) card.classList.add("due");
        else card.classList.add("no-due");

        if (String(medPassResidentId) === String(resident._id)) {
            card.classList.add("selected");
        }

        const thumbSrc = resident.photoUrl ? `${API_BASE}${resident.photoUrl}` : "images/placeholder.svg";
        const dueLabel = isDue ? "Due this shift" : "No meds due this shift";

        card.innerHTML = `
            <div class="resident-card-row">
                <img class="resident-thumb" src="${thumbSrc}" alt="${escapeHtml(`${resident.firstName} ${resident.lastName}`)}">
                <div class="resident-card-body">
                    <h3>${escapeHtml(`${resident.firstName} ${resident.lastName}`)}</h3>
                    <p class="muted">Room ${escapeHtml(resident.roomNumber || "-")}</p>
                    <p class="medpass-card-status">${dueLabel}</p>
                </div>
            </div>
        `;

        card.onclick = () => {
            medPassResidentId = resident._id;
            const select = document.getElementById("medPassResidentSelect");
            if (select) select.value = resident._id;
            setPassFinalized(false, "medpass-med-list", "medPassFinalizeButton");
            resetMedPassCensus();
            renderMedPassResidentCards(residentsForCards);
            loadMedPassResidentMeds();
            openMedPassResidentPage(resident._id, medPassShift || getCurrentTimeslot());
        };

        container.appendChild(card);
    });
}

function toggleMedPassDueOnly() {
    const checkbox = document.getElementById("medPassDueOnlyToggle");
    medPassDueOnly = Boolean(checkbox?.checked);
    populateMedPassResidentSelect();
    setPassFinalized(false, "medpass-med-list", "medPassFinalizeButton");
    resetMedPassCensus();
    loadMedPassResidentMeds();
}

function openMedPassResidentPage(residentId = medPassResidentId, shift = medPassShift || getCurrentTimeslot()) {
    if (!residentId) return;
    const pageUrl = `medpass-resident.html?residentId=${encodeURIComponent(residentId)}&shift=${encodeURIComponent(shift)}`;
    window.open(pageUrl, "_blank", "noopener,noreferrer");
}

async function refreshMedPassShiftContext() {
    if (!medPassShift) medPassShift = getCurrentTimeslot();

    applyMedPassShiftTheme(medPassShift);
    renderMedPassShiftButtons();

    const dueResidents = await calculateDueResidentsForShift(medPassShift);
    medPassDueResidentIds = new Set(dueResidents.map((r) => String(r._id)));

    const currentIsDue = medPassResidentId && medPassDueResidentIds.has(String(medPassResidentId));
    if (!currentIsDue && dueResidents.length) {
        medPassResidentId = dueResidents[0]._id;
    } else if (!medPassResidentId && !medPassDueOnly && residents.length) {
        medPassResidentId = residents[0]._id;
    }

    populateMedPassResidentSelect();
    updateMedPassShiftBanner(medPassShift, dueResidents.length);
}

function onMedPassResidentChange() {
    const select = document.getElementById("medPassResidentSelect");
    medPassResidentId = select ? select.value : null;
    setPassFinalized(false, "medpass-med-list", "medPassFinalizeButton");
    resetMedPassCensus();
    const residentsForCards = medPassDueOnly
        ? residents.filter(r => medPassDueResidentIds.has(String(r._id)))
        : residents;
    renderMedPassResidentCards(residentsForCards);
    loadMedPassResidentMeds();
    openMedPassResidentPage(medPassResidentId, medPassShift || getCurrentTimeslot());
}

async function setMedPassShift(shift) {
    medPassShift = shift;
    await refreshMedPassShiftContext();
    setPassFinalized(false, "medpass-med-list", "medPassFinalizeButton");
    resetMedPassCensus();
    loadMedPassResidentMeds();
}

async function loadMedPassPage(forceResidentsReload = false) {
    if (!currentUser || !["admin", "medtech", "rn"].includes(currentUser.role)) {
        return;
    }

    try {
        await ensureResidentsLoaded(forceResidentsReload);
        if (!medPassShift) medPassShift = getCurrentTimeslot();
        await refreshMedPassShiftContext();
        setPassFinalized(false, "medpass-med-list", "medPassFinalizeButton");
        resetMedPassCensus();
        loadMedPassResidentMeds();
    } catch (err) {
        console.error("Error loading Med Pass page:", err);
        updateMedPassSummary("Unable to load Med Pass data.");
    }
}

function loadMedPassResidentMeds() {
    const list = document.getElementById("medpass-med-list");
    if (!list) return;

    if (!medPassResidentId) {
        list.innerHTML = "";
        const message = medPassDueOnly
            ? `No residents due for ${medPassShift || getCurrentTimeslot()} shift.`
            : "Select a resident and shift to begin med pass.";
        updateMedPassSummary(message);
        resetMedPassCensus();
        return;
    }

    const resident = residents.find(r => String(r._id) === String(medPassResidentId));
    const residentName = resident ? `${resident.firstName} ${resident.lastName}`.trim() : "Selected resident";

    loadMedications(medPassResidentId, { listId: "medpass-med-list", slot: medPassShift })
        .then((stats) => {
            if (!stats) return;
            updateMedPassSummary(`${residentName} • Shift ${medPassShift} • ${stats.rendered} medication(s) ready.`);
            loadMedPassCensus(medPassResidentId, medPassShift, stats.filtered);
        })
        .catch((err) => {
            console.error("Error loading Med Pass medications:", err);
            updateMedPassSummary("Unable to load medications for this resident and shift.");
            resetMedPassCensus();
        });
}

function finalizeMedPassShift() {
    if (!medPassResidentId) {
        alert("Please select a resident before finalizing the shift pass.");
        return;
    }
    finalizeMedicationPass("medpass-med-list", medPassResidentId, medPassShift || getCurrentTimeslot());
}

function registerNewUser(event) {
    event.preventDefault();
    const name = document.getElementById("regName")?.value.trim();
    const username = document.getElementById("regUsername")?.value.trim();
    const email = document.getElementById("regEmail")?.value.trim();
    const password = document.getElementById("regPassword")?.value.trim();
    const role = document.getElementById("regRole")?.value;
    const residentCode = document.getElementById("regResidentCode")?.value.trim();
    const errorBox = document.getElementById("adminRegisterError");

    if (errorBox) {
        errorBox.style.display = "none";
        errorBox.textContent = "";
    }

    if (!name || !username || !email || !password || !role) {
        if (errorBox) {
            errorBox.textContent = "All fields except Resident Code are required.";
            errorBox.style.display = "block";
        }
        return;
    }

    const rolePrefixes = {
        admin: "adm",
        medtech: "med",
        rn: "med",
        poa: "res"
    };

    if (!username.startsWith(rolePrefixes[role])) {
        if (errorBox) {
            errorBox.textContent = `Username must start with ${rolePrefixes[role]} for role ${role}.`;
            errorBox.style.display = "block";
        }
        return;
    }

    const payload = { name, username, email, password, role };
    if (role === "poa") {
        if (!residentCode) {
            if (errorBox) {
                errorBox.textContent = "Resident code is required for POA users.";
                errorBox.style.display = "block";
            }
            return;
        }
        payload.residentCode = residentCode;
    }

    authFetch(`${API_BASE}/auth/register`, {
        method: "POST",
        body: JSON.stringify(payload),
    })
        .then(() => {
            alert("User registered successfully.");
            const adminRegisterForm = document.getElementById("adminRegisterForm");
            if (adminRegisterForm) adminRegisterForm.reset();
        })
        .catch(err => {
            console.error("Error registering user:", err);
            if (errorBox) {
                errorBox.textContent = err.message || "Unable to register user.";
                errorBox.style.display = "block";
            }
        });
}

// =========================
// PAGE NAVIGATION
// =========================

function showPage(pageId) {
    document.querySelectorAll(".page").forEach(page => {
        page.style.display = "none";
    });

    const target = document.getElementById(pageId);
    if (target) target.style.display = "block";

    // Sidebar active state
    document.querySelectorAll(".nav-item").forEach(btn => btn.classList.remove("active-nav"));
    if (pageId === "dashboardPage") document.getElementById("nav-dashboard").classList.add("active-nav");
    if (pageId === "residentsPage") document.getElementById("nav-residents").classList.add("active-nav");
    if (pageId === "medicationsPage") document.getElementById("nav-meds").classList.add("active-nav");
    if (pageId === "medPassPage") document.getElementById("nav-medpass").classList.add("active-nav");
    if (pageId === "marPage") document.getElementById("nav-mar").classList.add("active-nav");
    if (pageId === "billingPage") document.getElementById("nav-billing").classList.add("active-nav");
    if (pageId === "registerPage") document.getElementById("nav-register").classList.add("active-nav");
    if (pageId === "alertsPage") document.getElementById("nav-alerts").classList.add("active-nav");

    // Hide resident profile when switching main pages
    const profile = document.getElementById("residentProfile");
    if (profile) profile.style.display = "none";

    // When going to Residents page, refresh list
    if (pageId === "residentsPage") {
        loadResidentCards();
    }

    if (pageId === "dashboardPage") {
        if (currentUser && currentUser.role === "poa") {
            showPage("billingPage");
            return;
        }
    }
    if (pageId === "medicationsPage") {
        if (currentUser && currentUser.role === "poa") {
            showPage("billingPage");
            return;
        }
    }
    if (pageId === "medPassPage") {
        if (!currentUser || !["admin", "medtech", "rn"].includes(currentUser.role)) {
            showPage(currentUser && currentUser.role === "poa" ? "billingPage" : "dashboardPage");
            return;
        }
        loadMedPassPage();
    }
    if (pageId === "billingPage") {
        if (!currentUser || !["admin", "poa"].includes(currentUser.role)) {
            showPage("dashboardPage");
            return;
        }
        loadBillingPage();
    }
    // medpass audit page removed
    if (pageId === "registerPage") {
        if (!currentUser || currentUser.role !== "admin") {
            showPage("dashboardPage");
            return;
        }
    }
    if (pageId === "marPage") {
        if (currentUser && currentUser.role === "poa") {
            showPage("billingPage");
            return;
        }
        loadGlobalMarLog();
    }
    if (pageId === "alertsPage") {
        if (currentUser && currentUser.role === "poa") {
            showPage("billingPage");
            return;
        }
        loadGlobalAlerts();
    }
    // medpass audit nav removed
}

// Default page
showPage("dashboardPage");

// =========================
// ADD RESIDENT MODAL
// =========================

function openAddResidentModal() {
    const modal = document.getElementById("addResidentModal");
    if (modal) modal.style.display = "flex";
}

function closeAddResidentModal() {
    const modal = document.getElementById("addResidentModal");
    if (modal) modal.style.display = "none";

    const form = document.getElementById("addResidentForm");
    if (form) form.reset();

    const preview = document.getElementById("residentPhotoPreview");
    if (preview) preview.style.display = "none";
}

// =========================
// PHOTO PREVIEW
// =========================

const photoInput = document.getElementById("newResidentPhotoFile");
if (photoInput) {
    photoInput.addEventListener("change", function () {
        const file = this.files[0];
        const preview = document.getElementById("residentPhotoPreview");

        if (!preview) return;

        if (file) {
            preview.src = URL.createObjectURL(file);
            preview.style.display = "block";
        } else {
            preview.style.display = "none";
        }
    });
}

// =========================
// LOAD RESIDENT CARDS
// =========================
// Resident cards are loaded via `initApp()` after login

// =========================
// SAVE NEW RESIDENT
// =========================

function saveNewResident() {
    console.log("saveNewResident invoked");
    const nameInput = document.getElementById("newResidentName");
    const roomInput = document.getElementById("newResidentRoom");
    const photoInput = document.getElementById("newResidentPhotoFile");

    if (!nameInput || !roomInput) return;

    const name = nameInput.value.trim();
    const room = roomInput.value.trim();
    const photoFile = photoInput ? photoInput.files[0] : null;

    if (!name || !room) {
        alert("Name and room number are required.");
        return;
    }

    const [firstName, ...rest] = name.split(" ");
    const lastName = rest.join(" ") || "";
    const codeInput = document.getElementById("newResidentCode");
    const residentCode = codeInput ? codeInput.value.trim() : "";

    if (!residentCode) {
        alert("Resident code is required.");
        return;
    }

    const formData = new FormData();
    formData.append("firstName", firstName);
    formData.append("lastName", lastName);
    formData.append("roomNumber", room);
    formData.append("residentCode", residentCode);

    if (photoFile) {
        formData.append("photo", photoFile);
    }

    const saveBtn = document.getElementById("saveResidentButton");
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = "Saving...";
    }

    console.debug("Saving resident to:", `${API_BASE}/residents`);
    authFetch(`${API_BASE}/residents`, {
        method: "POST",
        body: formData
    })
        .then(payload => payload)
        .then(savedResident => {
            closeAddResidentModal();

            residents.push(savedResident);
            loadResidentCards();
            showPage("residentsPage");
        })
        .catch(err => {
            console.error("Error saving resident:", err);
            alert(`Error saving resident: ${err.message || err}`);
        })
        .finally(() => {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.textContent = "Save Resident";
            }
        });
}

// =========================
// RESIDENT PROFILE
// =========================

function openResidentProfile(id) {
    currentResidentId = id;

    const resident = residents.find(r => r._id === id);
    if (!resident) return;

    const fullNameEl = document.getElementById("residentFullName");
    const roomEl = document.getElementById("residentRoom");
    const photoEl = document.getElementById("residentPhoto");

    if (fullNameEl) {
        fullNameEl.innerText = `${resident.firstName} ${resident.lastName}`;
    }

    if (roomEl) {
        roomEl.innerText = `Room ${resident.roomNumber}`;
    }

    if (photoEl) {
        if (resident.photoUrl) {
            photoEl.src = `${API_BASE}${resident.photoUrl}`;
        } else {
            photoEl.src = "images/placeholder.svg";
        }
    }

    const residentCodeInfo = document.getElementById("residentCodeInfo");
    if (residentCodeInfo) {
        if (currentUser && currentUser.role === "admin" && resident.residentCode) {
            residentCodeInfo.textContent = `Resident Code: ${resident.residentCode}`;
            residentCodeInfo.style.display = "block";
        } else {
            residentCodeInfo.style.display = "none";
        }
    }

    const profile = document.getElementById("residentProfile");
    if (profile) {
        profile.style.display = "block";
        profile.scrollIntoView({ behavior: "smooth" });
    }

    // Default to current timeslot and show Meds
    currentMedTimeslot = getCurrentTimeslot();
    showResidentTab("medsTab");
    setPassFinalized(false);
    if (!currentUser || currentUser.role !== "poa") {
        loadMedications(id);
        loadMarLog(id);
    }
    if (currentUser && ["admin", "poa"].includes(currentUser.role)) {
        loadBilling(id);
    }

    // control visibility of med pass buttons for admin/medtech only
    const finalizeBtn = document.getElementById("finalizePassButton");
    const addMedBtn = document.querySelector(".section-header-row-actions button[onclick=\"openAddMedPanel()\"]");
    if (finalizeBtn) finalizeBtn.style.display = (currentUser && ["admin", "medtech", "rn"].includes(currentUser.role)) ? "inline-block" : "none";
    if (addMedBtn) addMedBtn.style.display = (currentUser && ["admin", "medtech", "rn"].includes(currentUser.role)) ? "inline-block" : "none";

    // ensure add-med panel is closed when opening a profile
    closeAddMedPanel();
}

// Side panel controls for Add Medication
function openAddMedPanel() {
    const panel = document.getElementById("addMedPanel");
    setMedicationPanelMode("create");
    if (panel) panel.style.display = "block";
}

function closeAddMedPanel() {
    const panel = document.getElementById("addMedPanel");
    if (panel) panel.style.display = "none";
    const form = document.getElementById("addMedForm");
    if (form) form.reset();
    resetMedTimeRows();
    setMedicationPanelMode("create");
}

function setMedicationPanelMode(mode, med = null) {
    const title = document.getElementById("addMedPanelTitle");
    const submitButton = document.getElementById("addMedSubmitButton");

    if (mode === "edit" && med) {
        editingMedicationId = med._id;
        if (title) title.textContent = "Edit Medication";
        if (submitButton) submitButton.textContent = "Update Medication";
        return;
    }

    editingMedicationId = null;
    if (title) title.textContent = "Add Medication";
    if (submitButton) submitButton.textContent = "Save Medication";
}

function setMedicationTimesRows(times = []) {
    const container = document.getElementById("medTimesContainer");
    if (!container) return;

    const list = Array.isArray(times) && times.length ? times : [""];
    container.innerHTML = "";

    list.forEach((entry) => {
        let timeValue = "";
        let periodValue = "AM";

        const m12 = String(entry || "").trim().match(/^(\d{1,2}:\d{2})\s*(AM|PM)$/i);
        if (m12) {
            timeValue = m12[1];
            periodValue = m12[2].toUpperCase();
        }

        const row = document.createElement("div");
        row.className = "time-row";
        row.innerHTML = `
            <input type="text" class="med-time-input" placeholder="08:00" required value="${escapeHtml(timeValue)}">
            <select class="med-time-period" aria-label="AM or PM">
                <option ${periodValue === "AM" ? "selected" : ""}>AM</option>
                <option ${periodValue === "PM" ? "selected" : ""}>PM</option>
            </select>
            <button type="button" class="secondary-btn small-btn" onclick="removeMedTimeRow(this)">Remove</button>
        `;
        container.appendChild(row);
    });

    updateMedTimeButtons();
}

function startMedicationEdit(medicationId) {
    const med = medicationCache.get(medicationId);
    if (!med) {
        alert("Medication details could not be loaded. Please refresh and try again.");
        return;
    }

    setMedicationPanelMode("edit", med);
    const panel = document.getElementById("addMedPanel");
    if (panel) panel.style.display = "block";

    const nameInput = document.getElementById("medName");
    const doseInput = document.getElementById("medDose");
    const routeInput = document.getElementById("medRoute");
    const freqInput = document.getElementById("medFreq");
    const instrInput = document.getElementById("medInstr");

    if (nameInput) nameInput.value = med.name || "";
    if (doseInput) doseInput.value = med.dosage || "";
    if (routeInput) routeInput.value = med.route || "";
    if (freqInput) freqInput.value = med.frequency || "";
    if (instrInput) instrInput.value = med.instructions || "";

    setMedicationTimesRows(med.times || []);
}

function addMedTimeRow() {
    const container = document.getElementById("medTimesContainer");
    if (!container) return;

    const row = document.createElement("div");
    row.className = "time-row";
    row.innerHTML = `
        <input type="text" class="med-time-input" placeholder="08:00" required>
        <select class="med-time-period" aria-label="AM or PM">
            <option>AM</option>
            <option>PM</option>
        </select>
        <button type="button" class="secondary-btn small-btn" onclick="removeMedTimeRow(this)">Remove</button>
    `;

    container.appendChild(row);
    updateMedTimeButtons();
}

function removeMedTimeRow(button) {
    const row = button.closest(".time-row");
    if (!row) return;
    const container = document.getElementById("medTimesContainer");
    if (!container) return;

    if (container.querySelectorAll(".time-row").length === 1) {
        return;
    }

    row.remove();
    updateMedTimeButtons();
}

function resetMedTimeRows() {
    const container = document.getElementById("medTimesContainer");
    if (!container) return;

    container.innerHTML = `
        <div class="time-row">
            <input type="text" class="med-time-input" placeholder="08:00" required>
            <select class="med-time-period" aria-label="AM or PM">
                <option>AM</option>
                <option>PM</option>
            </select>
            <button type="button" class="secondary-btn small-btn" onclick="removeMedTimeRow(this)">Remove</button>
        </div>
    `;

    updateMedTimeButtons();
}

function updateMedTimeButtons() {
    const rows = document.querySelectorAll("#medTimesContainer .time-row");
    rows.forEach(row => {
        const btn = row.querySelector("button");
        if (btn) {
            btn.disabled = rows.length === 1;
        }
    });
}

// =========================
// RESIDENT TAB SWITCHING
// =========================

function showResidentTab(tabId) {
    if (currentUser && currentUser.role === "poa" && tabId !== "billingTab") {
        tabId = "billingTab";
    }

    document.querySelectorAll(".resident-tab").forEach(tab => {
        tab.style.display = "none";
    });

    document.querySelectorAll(".resident-tabs button").forEach(btn => {
        btn.classList.remove("active-tab");
    });

    const target = document.getElementById(tabId);
    if (target) target.style.display = "block";

    const activeBtn = document.querySelector(`.resident-tabs button[onclick="showResidentTab('${tabId}')"]`);
    if (activeBtn) activeBtn.classList.add("active-tab");

    if (tabId === "billingTab" && currentResidentId) {
        loadBilling(currentResidentId);
    }
}

function openAddInvoicePanel() {
    const panel = document.getElementById("addInvoicePanel");
    if (panel) panel.style.display = "block";
}

function closeAddInvoicePanel() {
    const panel = document.getElementById("addInvoicePanel");
    if (panel) panel.style.display = "none";
    const form = document.getElementById("addInvoiceForm");
    if (form) form.reset();
}

function openPayInvoicePanel() {
    populatePayResidentSelect();
    const panel = document.getElementById("payInvoicePanel");
    if (panel) panel.style.display = "block";
}

function closePayInvoicePanel() {
    const panel = document.getElementById("payInvoicePanel");
    if (panel) panel.style.display = "none";
    const form = document.getElementById("payInvoiceForm");
    if (form) form.reset();
}

// =========================
// ALERTS (72h) UI
// =========================

function openAddAlertPanel() {
    console.debug("openAddAlertPanel invoked");
    populateAlertResidentSelect();
    const panel = document.getElementById("addAlertPanel");
    const staffInput = document.getElementById("alertStaffName");
    const notesInput = document.getElementById("alertNotes");
    const submittedAtInput = document.getElementById("alertSubmittedAt");
    if (panel) {
        panel.style.display = "flex";
        panel.style.zIndex = 1100;
    }
    if (staffInput) {
        staffInput.value = currentUser?.name || "";
    }
    if (submittedAtInput) {
        submittedAtInput.value = new Date().toLocaleString();
    }
    if (notesInput) {
        notesInput.focus();
    }
}

function closeAddAlertPanel() {
    const panel = document.getElementById("addAlertPanel");
    if (panel) panel.style.display = "none";
    const form = document.getElementById("addAlertForm");
    if (form) form.reset();
}

function populateAlertResidentSelect() {
    const select = document.getElementById("alertResidentSelect");
    if (!select) return;

    const renderOptions = () => {
        select.innerHTML = `<option value="">Select a resident</option>`;
        residents.forEach(resident => {
            const name = `${resident.firstName} ${resident.lastName}`.trim();
            select.innerHTML += `<option value="${resident._id}">${name} ${resident.roomNumber ? `(${resident.roomNumber})` : ""}</option>`;
        });

        if (currentResidentId) {
            select.value = currentResidentId;
        }
    };

    if (!residents.length) {
        loadResidentCards().then(renderOptions).catch(err => {
            console.error("Error loading residents for alert select:", err);
        });
    } else {
        renderOptions();
    }
}

function loadAlerts(residentId) {
    if (!residentId) return;

    authFetch(`${API_BASE}/alerts/${residentId}?hours=72`)
        .then(alerts => {
            const container = document.getElementById("alertsListContainer");
            if (!container) return;

            container.innerHTML = "";

            if (!alerts.length) {
                container.innerHTML = `<p class=\"muted\">No alerts in the last 72 hours.</p>`;
                return;
            }

            alerts.forEach(a => {
                const div = document.createElement("div");
                div.className = "alert-entry";
                const timeText = new Date(a.createdAt || a.alertTime).toLocaleString();
                const byText = a.userName || a.userId || "Unknown";

                div.innerHTML = `
                    <div class="alert-row">
                        <div>
                            <strong>${a.type}</strong>
                            <p>${a.notes || ""}</p>
                        </div>
                        <div class="alert-meta">
                            <p class="muted">${timeText}</p>
                            <p class="muted">By: ${byText}</p>
                        </div>
                    </div>
                `;

                container.appendChild(div);
            });
        })
        .catch(err => console.error("Error loading alerts:", err));
}

function loadGlobalAlerts() {
    authFetch(`${API_BASE}/alerts/recent/all?hours=72`)
        .then(alerts => {
            const container = document.getElementById("globalAlertsContainer");
            if (!container) return;

            container.innerHTML = "";

            if (!alerts.length) {
                container.innerHTML = `<p class="muted">No alerts in the last 72 hours.</p>`;
                return;
            }

            alerts.forEach(a => {
                const div = document.createElement("div");
                div.className = "alert-entry";
                const timeText = new Date(a.createdAt || a.alertTime).toLocaleString();
                const residentName = a.residentId ? `${a.residentId.firstName} ${a.residentId.lastName} (${a.residentId.roomNumber || "—"})` : "Unknown resident";
                const byText = a.userName || a.userId || "Unknown";

                div.innerHTML = `
                    <div class="alert-row">
                        <div>
                            <strong>${a.type}</strong>
                            <p>${a.notes || ""}</p>
                            <p class="muted">${residentName}</p>
                        </div>
                        <div class="alert-meta">
                            <p class="muted">${timeText}</p>
                            <p class="muted">By: ${byText}</p>
                        </div>
                    </div>
                `;

                div.onclick = () => {
                    if (a.residentId && a.residentId._id) {
                        showPage("residentsPage");
                        openResidentProfile(a.residentId._id);
                    }
                };
                div.style.cursor = "pointer";
                container.appendChild(div);
            });
        })
        .catch(err => console.error("Error loading global alerts:", err));
}

const addAlertForm = document.getElementById("addAlertForm");
if (addAlertForm) {
    addAlertForm.addEventListener("submit", function (e) {
        e.preventDefault();

        const residentId = document.getElementById("alertResidentSelect")?.value || currentResidentId;
        const type = document.getElementById("alertType")?.value || "incident";
        const notes = document.getElementById("alertNotes")?.value || "";
        const staffInput = document.getElementById("alertStaffName");
        const staffName = currentUser?.name || staffInput?.value || "Unknown";
        const staffId = currentUser?.id || currentUser?._id || undefined;

        if (!residentId) {
            alert("Please select a resident for this alert.");
            return;
        }

        authFetch(`${API_BASE}/alerts`, {
            method: "POST",
            body: JSON.stringify({ residentId, type, notes, userName: staffName, userId: staffId })
        })
            .then(created => {
                closeAddAlertPanel();
                currentResidentId = residentId;

                const residentProfileVisible = document.getElementById("residentProfile")?.style.display === "block";
                if (residentProfileVisible) {
                    showResidentTab("alertsTab");
                    loadAlerts(currentResidentId);
                } else {
                    loadGlobalAlerts();
                }

                alert("Alert saved.");
            })
            .catch(err => {
                console.error("Error creating alert:", err);
                alert(err.message || "Unable to save alert.");
            });
    });
}

function populatePayResidentSelect() {
    const select = document.getElementById("payResidentSelect");
    if (!select) return;

    const renderOptions = () => {
        select.innerHTML = `<option value="">Select a resident</option>`;
        const allowedResidents = currentUser && currentUser.role === "poa"
            ? residents.filter(resident => String(resident._id) === String(currentUser.residentId))
            : residents;

        allowedResidents.forEach(resident => {
            const name = `${resident.firstName} ${resident.lastName}`.trim();
            select.innerHTML += `<option value="${resident._id}">${name} ${resident.roomNumber ? `(${resident.roomNumber})` : ""}</option>`;
        });

        if (currentUser && currentUser.role === "poa") {
            select.value = currentUser.residentId || currentResidentId || "";
            select.disabled = true;
        } else if (currentResidentId) {
            select.value = currentResidentId;
        }
    };

    if (!residents.length) {
        loadResidentCards().then(renderOptions).catch(err => {
            console.error("Error loading residents for payment select:", err);
        });
    } else {
        renderOptions();
    }
}

function formatCurrency(amount) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount || 0);
}

function renderInvoiceListInContainer(container, invoices, showResident = false) {
    if (!container) return;

    container.innerHTML = "";

    if (!invoices.length) {
        container.innerHTML = `<p class="muted">No invoices yet. ${showResident ? "Use New Invoice to create one." : "Refresh to check for invoices."}</p>`;
        return;
    }

    invoices.forEach(invoice => {
        const card = document.createElement("div");
        card.className = "invoice-card";
        const dueDate = invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : "—";
        const statusClass = invoice.status === "paid" ? "paid" : "pending";

        card.innerHTML = `
            <div class="invoice-row">
                <div>
                    <h4>${invoice.description || "Invoice"}</h4>
                    ${showResident && invoice.residentId ? `<p class="muted">Resident: ${invoice.residentId.firstName} ${invoice.residentId.lastName} (${invoice.residentId.roomNumber || "—"})</p>` : ""}
                    <p class="muted"><strong>Description:</strong> ${invoice.description || "No description provided."}</p>
                    <p>${invoice.notes ? `<strong>Notes:</strong> ${invoice.notes}` : "No additional notes."}</p>
                </div>
                <div class="invoice-status ${statusClass}">${invoice.status}</div>
            </div>
            <div class="invoice-row">
                <p>Amount: <strong>${formatCurrency(invoice.amount)}</strong></p>
                <p>Due: <strong>${dueDate}</strong></p>
            </div>
            ${invoice.status === "paid" ? `
                <div class="invoice-meta">
                    <p>Paid by: <strong>${invoice.payerName || "Unknown"}</strong></p>
                    <p>Method: <strong>${invoice.paymentMethod || "—"}</strong></p>
                    ${invoice.paymentReference ? `<p>Ref: <strong>${invoice.paymentReference}</strong></p>` : ""}
                </div>
            ` : ""}
            <div class="invoice-actions">
                ${invoice.status === "pending" ? `<button type="button" class="primary-btn" onclick="payInvoice('${invoice._id}')">${(currentUser && currentUser.role === "poa") ? 'Pay' : 'Mark Paid'}</button>` : ""}
            </div>
        `;

        container.appendChild(card);
    });
}

function renderInvoiceList(invoices) {
    renderInvoiceListInContainer(document.getElementById("invoiceList"), invoices, false);
}

function renderBillingPageInvoices(invoices) {
    renderInvoiceListInContainer(document.getElementById("billingInvoiceList"), invoices, true);
}

function setResidentInvoiceCount(count) {
    const badge = document.getElementById("residentInvoiceCount");
    if (!badge) return;
    badge.textContent = count > 0 ? `${count} pending` : "No pending";
    badge.classList.toggle("visible", count > 0 || count === 0);
}

function medIsScheduledForSlot(med, slot) {
    if (!med) return false;
    const times = Array.isArray(med.times) ? med.times : [];
    if (times.some(t => String(t).toUpperCase() === slot)) return true;

    for (const tRaw of times) {
        const t = parseTimeToMinutes(tRaw);
        if (t == null) continue;
        if (isTimeInSlot(t, slot)) return true;
    }

    // med.time might be "08:00" or similar
    if (med.time) {
        const t = parseTimeToMinutes(med.time);
        if (t == null) return false;
        return isTimeInSlot(t, slot);
    }

    if (med.frequency) {
        return med.frequency.toUpperCase().includes(slot);
    }

    return false;
}

function isTimeInSlot(minutes, slot) {
    if (slot === "AM") return minutes >= SHIFT_WINDOWS.AM.start && minutes < SHIFT_WINDOWS.AM.end;
    if (slot === "PM") return minutes >= SHIFT_WINDOWS.PM.start && minutes < SHIFT_WINDOWS.PM.end;
    if (slot === "NOC") return minutes >= SHIFT_WINDOWS.NOC.start || minutes < SHIFT_WINDOWS.NOC.end;
    return false;
}

function getScheduledTimeForSlot(med, slot) {
    const medTimes = Array.isArray(med?.times) ? med.times : [];
    const matching = medTimes.find(t => {
        const asSlot = String(t).toUpperCase();
        if (asSlot === slot) return true;
        const parsed = parseTimeToMinutes(t);
        return parsed != null && isTimeInSlot(parsed, slot);
    });

    if (matching) return matching;

    if (med?.time) return med.time;
    if (med?.frequency) return med.frequency;
    return slot;
}

function normalizeMedStatus(status) {
    const allowed = ["given", "held", "refused", "prn"];
    return allowed.includes(status) ? status : "held";
}

function parseTimeToMinutes(timeStr) {
    if (!timeStr) return null;
    // accept HH:MM or H:MM AM/PM formats
    const m24 = timeStr.match(/^(\d{1,2}):(\d{2})$/);
    if (m24) return Number(m24[1]) * 60 + Number(m24[2]);
    const m12 = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (m12) {
        let h = Number(m12[1]);
        const mm = Number(m12[2]);
        const ampm = m12[3].toUpperCase();
        if (ampm === "PM" && h !== 12) h += 12;
        if (ampm === "AM" && h === 12) h = 0;
        return h * 60 + mm;
    }
    return null;
}

function setBillingPendingCount(count) {
    const badge = document.getElementById("billingPendingCount");
    if (!badge) return;
    badge.textContent = count > 0 ? `${count} pending` : "No pending";
    badge.classList.toggle("visible", count > 0 || count === 0);
}

function loadBilling(residentId) {
    if (!residentId) return;
    if (!currentUser || !["admin", "poa"].includes(currentUser.role)) return;

    authFetch(`${API_BASE}/invoices/${residentId}`)
        .then(invoices => {
            const all = Array.isArray(invoices) ? invoices : [];
            const listToShow = (currentUser && currentUser.role === "poa")
                ? all.filter(i => i.status === "pending")
                : all;
            renderInvoiceList(listToShow);
            setResidentInvoiceCount(all.filter(i => i.status === "pending").length);
        })
        .catch(err => {
            console.error("Error loading invoices:", err);
        });
}

function loadBillingPage() {
    if (!currentUser) return;

    const endpoint = currentUser.role === "poa"
        ? `${API_BASE}/invoices/${currentUser.residentId}`
        : `${API_BASE}/invoices`;

    authFetch(endpoint)
        .then(invoices => {
            const invoiceArray = Array.isArray(invoices) ? invoices : [];
            renderBillingPageInvoices(invoiceArray);
            setBillingPendingCount(invoiceArray.filter(i => i.status === "pending").length);
        })
        .catch(err => {
            console.error("Error loading all invoices:", err);
            const container = document.getElementById("billingInvoiceList");
            if (container) container.innerHTML = `<p class="muted">Unable to load invoices.</p>`;
        });
}

function formatTimestamp(value) {
    if (!value) return "";
    const date = new Date(value);
    return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function getResidentNameById(residentId) {
    const resident = (residents || []).find(r => String(r._id) === String(residentId));
    return resident ? `${resident.firstName} ${resident.lastName}` : null;
}

async function payInvoice(invoiceId) {
    if (!invoiceId) return;

    try {
        const response = await fetch(`${API_BASE}/invoices/${invoiceId}/pay`, { method: "PATCH", headers: getAuthHeaders() });
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || "Unable to update invoice status");
        }
        if (document.getElementById("billingPage")?.style.display === "block") {
            loadBillingPage();
        }
        if (currentResidentId) {
            loadBilling(currentResidentId);
        }
        alert("Invoice marked as paid.");
    } catch (err) {
        console.error(err);
        alert(err.message || "Failed to mark invoice paid.");
    }
}

function deleteResident(id) {
    if (!confirm("Delete this resident?")) return;

    fetch(`${API_BASE}/residents/${id}`, {
        method: "DELETE",
        headers: getAuthHeaders()
    })
        .then(res => res.json())
        .then(() => {
            residents = residents.filter(r => r._id !== id);
            loadResidentCards();
            const profile = document.getElementById("residentProfile");
            if (profile) profile.style.display = "none";
        })
        .catch(err => {
            console.error("Error deleting resident:", err);
            alert("Could not delete resident. Check the console for details.");
        });
}

// =========================
// LOAD MEDICATIONS
// =========================

function loadMedications(residentId, options = {}) {
    if (currentUser && currentUser.role === "poa") {
        return Promise.resolve({ rendered: 0, total: 0, filtered: 0 });
    }

    const listId = options.listId || "med-list";
    const slot = options.slot || currentMedTimeslot || getCurrentTimeslot();

    return authFetch(`${API_BASE}/medications/${residentId}`)
        .then(meds => {
            const medList = document.getElementById(listId);
            if (!medList) return { rendered: 0, total: 0, filtered: 0 };

            medList.innerHTML = "";

            if (!meds.length) {
                medList.innerHTML = `<li class="muted">No medications on file.</li>`;
                if (listId === "med-list") medicationCache.clear();
                return { rendered: 0, total: 0, filtered: 0 };
            }

            if (listId === "med-list" || listId === "medpass-med-list") {
                medicationCache.clear();
                meds.forEach(m => medicationCache.set(m._id, m));
            }

            const filtered = meds.filter(m => medIsScheduledForSlot(m, slot));

            // if none match the slot, show all but grayed out state is handled on cards
            const toRender = filtered.length ? filtered : meds;
            const canManageMeds = currentUser && ["admin", "medtech", "rn"].includes(currentUser.role);

            toRender.forEach(med => {
                const li = document.createElement("li");
                const scheduledTimes = Array.isArray(med.times) && med.times.length ? med.times.join(", ") : "";
                const timeText = scheduledTimes || med.time || med.frequency || "ASAP";
                const draftStatus = normalizeMedStatus(medicationDraftStatus.get(med._id));

                if (!medicationDraftStatus.has(med._id)) {
                    medicationDraftStatus.set(med._id, draftStatus);
                }

                li.innerHTML = `
                    <div class="med-card ${filtered.length ? '' : 'muted-med'}">
                        <div class="med-left">
                            <strong>${med.name}</strong>
                            <p>${med.dosage} — ${med.route}</p>
                            <small>${timeText}</small><br>
                            <small>${med.instructions || ""}</small>
                        </div>
                        <div class="med-actions">
                            <select class="med-status-select" aria-label="Set status for ${med.name}">
                                <option value="given" ${draftStatus === "given" ? "selected" : ""}>Given</option>
                                <option value="held" ${draftStatus === "held" ? "selected" : ""}>Held</option>
                                <option value="refused" ${draftStatus === "refused" ? "selected" : ""}>Refused</option>
                                <option value="prn" ${draftStatus === "prn" ? "selected" : ""}>PRN</option>
                            </select>
                            ${canManageMeds ? `<button type="button" class="secondary-btn small-btn med-action-btn" onclick="event.stopPropagation(); startMedicationEdit('${med._id}')">Edit</button>` : ""}
                            ${canManageMeds ? `<button type="button" class="secondary-btn small-btn med-action-btn" onclick="event.stopPropagation(); openPrnFollowupModal('${med._id}')">PRN Follow-up</button>` : ""}
                            ${canManageMeds ? `<button type="button" class="secondary-btn small-btn med-action-btn" onclick="event.stopPropagation(); deleteMedication('${med._id}')">Delete</button>` : ""}
                        </div>
                    </div>
                `;

                const statusSelect = li.querySelector(".med-status-select");
                const card = li.querySelector(".med-card");
                li.dataset.med = JSON.stringify(med);
                li.dataset.medId = med._id;

                if (card) {
                    card.classList.add(`status-${draftStatus}`);
                }

                if (statusSelect) {
                    statusSelect.addEventListener("change", () => {
                        const nextStatus = normalizeMedStatus(statusSelect.value);
                        medicationDraftStatus.set(med._id, nextStatus);
                        if (card) {
                            card.classList.remove("status-given", "status-held", "status-refused", "status-prn");
                            card.classList.add(`status-${nextStatus}`);
                        }
                    });
                }

                medList.appendChild(li);
            });

            return { rendered: toRender.length, total: meds.length, filtered: filtered.length };
        })
        .catch(err => {
            console.error("Error loading medications:", err);
            throw err;
        });
}

let statusReasonQueue = [];
let currentStatusReasonIndex = 0;

function finalizeMedicationPass(listId = "med-list", residentIdOverride = null, slotOverride = null) {
    const targetResidentId = residentIdOverride || currentResidentId;
    const targetSlot = slotOverride || currentMedTimeslot || getCurrentTimeslot();

    if (!targetResidentId) {
        alert("Please select a resident before finalizing the medication pass.");
        return;
    }

    const medList = document.getElementById(listId);
    if (!medList) return;

    pendingFinalizeContext = {
        listId,
        residentId: targetResidentId,
        slot: targetSlot,
        finalizeButtonId: listId === "medpass-med-list" ? "medPassFinalizeButton" : "finalizePassButton"
    };

    const reasonRequiredItems = [];

    medList.querySelectorAll("li").forEach(item => {
        const medId = item.dataset.medId;
        const med = item.dataset.med ? JSON.parse(item.dataset.med) : null;
        if (!med || !medId) return;

        const selectedStatus = normalizeMedStatus(medicationDraftStatus.get(medId));
        if (selectedStatus === "held" || selectedStatus === "prn") {
            reasonRequiredItems.push({ med, medId, status: selectedStatus });
        }
    });

    statusReasonQueue = reasonRequiredItems;
    currentStatusReasonIndex = 0;

    if (statusReasonQueue.length) {
        openHeldReasonModal();
    } else {
        saveMedicationPass();
    }
}

function openHeldReasonModal() {
    const modal = document.getElementById("heldReasonModal");
    const heldText = document.getElementById("heldReasonText");
    const reasonInput = document.getElementById("heldReasonInput");

    if (!modal || !heldText || !reasonInput) return;

    const currentMed = statusReasonQueue[currentStatusReasonIndex];
    const actionWord = currentMed.status === "prn" ? "given PRN" : "held";
    heldText.textContent = `Please provide the reason ${currentMed.med.name} was ${actionWord}.`;
    reasonInput.value = "";
    modal.style.display = "flex";
    reasonInput.focus();
}

function cancelHeldReasonPrompt() {
    const modal = document.getElementById("heldReasonModal");
    if (modal) modal.style.display = "none";
}

const heldReasonForm = document.getElementById("heldReasonForm");
if (heldReasonForm) {
    heldReasonForm.addEventListener("submit", function (e) {
        e.preventDefault();
        const reasonInput = document.getElementById("heldReasonInput");
        if (!reasonInput) return;

        const reason = reasonInput.value.trim();
        if (!reason) {
            alert("Please enter a reason before continuing.");
            return;
        }

        const item = statusReasonQueue[currentStatusReasonIndex];
        item.reason = reason;
        currentStatusReasonIndex += 1;

        if (currentStatusReasonIndex < statusReasonQueue.length) {
            openHeldReasonModal();
        } else {
            cancelHeldReasonPrompt();
            saveMedicationPass();
        }
    });
}

// medpass confirmation handlers removed

function saveMedicationPass() {
    const context = pendingFinalizeContext || {
        listId: "med-list",
        residentId: currentResidentId,
        slot: currentMedTimeslot || getCurrentTimeslot(),
        finalizeButtonId: "finalizePassButton"
    };

    const medList = document.getElementById(context.listId);
    if (!medList) return;

    const promises = [];
    const slot = context.slot || getCurrentTimeslot();

    medList.querySelectorAll("li").forEach(item => {
        const medId = item.dataset.medId;
        const med = item.dataset.med ? JSON.parse(item.dataset.med) : null;
        if (!med || !medId) return;

        const selectedStatus = normalizeMedStatus(medicationDraftStatus.get(medId));
        const scheduledTime = getScheduledTimeForSlot(med, slot);
        const queuedItem = statusReasonQueue.find(entry => entry.medId === medId);
        const reason = queuedItem ? queuedItem.reason : undefined;

        promises.push(
            authFetch(`${API_BASE}/mar`, {
                method: "POST",
                body: JSON.stringify({
                    residentId: context.residentId,
                    medicationId: medId,
                    scheduledTime,
                    status: selectedStatus,
                    reason
                })
            })
        );
    });

    if (!promises.length) {
        alert("No medications to finalize.");
        return;
    }

    Promise.all(promises)
        .then(() => {
            alert("Medication pass finalized.");
            medicationDraftStatus.clear();
            statusReasonQueue = [];
            currentStatusReasonIndex = 0;
            if (context.listId === "medpass-med-list") {
                loadMedications(context.residentId, { listId: "medpass-med-list", slot: slot })
                    .then((stats) => loadMedPassCensus(context.residentId, slot, stats?.filtered || 0))
                    .catch(() => resetMedPassCensus());
            } else {
                loadMedications(context.residentId);
                loadMarLog(context.residentId);
            }
            setPassFinalized(true, context.listId, context.finalizeButtonId);
            pendingFinalizeContext = null;
        })
        .catch(err => {
            console.error("Error finalizing medication pass:", err);
            alert(err.message || "Unable to finalize medication pass. Try again.");
            pendingFinalizeContext = null;
        });
}

// =========================
// ADD MEDICATION
// =========================

const addMedForm = document.getElementById("addMedForm");
if (addMedForm) {
    addMedForm.addEventListener("submit", function (e) {
        e.preventDefault();

        if (!currentResidentId) {
            alert("No resident selected.");
            return;
        }

        const timeRows = document.querySelectorAll("#medTimesContainer .time-row");
        const medTimes = Array.from(timeRows).map(row => {
            const timeInput = row.querySelector(".med-time-input");
            const periodSelect = row.querySelector(".med-time-period");
            const timeValue = timeInput?.value.trim();
            const periodValue = periodSelect?.value.trim();
            return timeValue ? `${timeValue} ${periodValue}`.trim() : "";
        }).filter(Boolean);

        const invalidTime = medTimes.find(t => parseTimeToMinutes(t) == null);
        if (invalidTime) {
            alert(`Invalid medication time: ${invalidTime}. Use HH:MM format.`);
            return;
        }

        const medData = {
            name: document.getElementById("medName")?.value || "",
            dosage: document.getElementById("medDose")?.value || "",
            route: document.getElementById("medRoute")?.value || "",
            frequency: document.getElementById("medFreq")?.value || "",
            times: medTimes,
            instructions: document.getElementById("medInstr")?.value || "",
            residentId: currentResidentId
        };

        if (!medData.name.trim()) {
            alert("Medication name is required.");
            return;
        }

        const isEdit = Boolean(editingMedicationId);
        const endpoint = isEdit ? `${API_BASE}/medications/${editingMedicationId}` : `${API_BASE}/medications`;
        const method = isEdit ? "PUT" : "POST";

        authFetch(endpoint, {
            method,
            body: JSON.stringify(medData)
        })
            .then(() => {
                loadMedications(currentResidentId);
                addMedForm.reset();
                closeAddMedPanel();
                loadResidentCards();
            })
            .catch(err => {
                console.error("Error adding medication:", err);
                alert(err.message || "Unable to save medication.");
            });
    });
}

function openPrnFollowupModal(medicationId) {
    if (!currentResidentId) {
        alert("Please select a resident first.");
        return;
    }
    const med = medicationCache.get(medicationId);
    if (!med) {
        alert("Medication details could not be loaded. Please refresh and try again.");
        return;
    }

    prnFollowupMedicationId = medicationId;
    const prompt = document.getElementById("prnFollowupPrompt");
    const notes = document.getElementById("prnFollowupNotes");
    const modal = document.getElementById("prnFollowupModal");

    if (prompt) prompt.textContent = `Document follow-up for ${med.name}. Notes are required.`;
    if (notes) notes.value = "";
    if (modal) modal.style.display = "flex";
    if (notes) notes.focus();
}

function closePrnFollowupModal() {
    const modal = document.getElementById("prnFollowupModal");
    const notes = document.getElementById("prnFollowupNotes");
    prnFollowupMedicationId = null;
    if (modal) modal.style.display = "none";
    if (notes) notes.value = "";
}

const prnFollowupForm = document.getElementById("prnFollowupForm");
if (prnFollowupForm) {
    prnFollowupForm.addEventListener("submit", function (e) {
        e.preventDefault();

        if (!currentResidentId || !prnFollowupMedicationId) {
            alert("Missing resident or medication for PRN follow-up.");
            return;
        }

        const notes = document.getElementById("prnFollowupNotes")?.value.trim() || "";
        if (!notes) {
            alert("Follow-up notes are required.");
            return;
        }

        const med = medicationCache.get(prnFollowupMedicationId);
        if (!med) {
            alert("Medication details could not be loaded. Please refresh and try again.");
            return;
        }

        const slot = currentMedTimeslot || getCurrentTimeslot();
        const scheduledTime = getScheduledTimeForSlot(med, slot) || "PRN";

        authFetch(`${API_BASE}/mar`, {
            method: "POST",
            body: JSON.stringify({
                residentId: currentResidentId,
                medicationId: prnFollowupMedicationId,
                scheduledTime,
                status: "prn-followup",
                notes
            })
        })
            .then(() => {
                closePrnFollowupModal();
                loadMarLog(currentResidentId);
                loadGlobalMarLog();
                alert("PRN follow-up saved.");
            })
            .catch(err => {
                console.error("Error saving PRN follow-up:", err);
                alert(err.message || "Unable to save PRN follow-up.");
            });
    });
}

function deleteMedication(medicationId) {
    if (!medicationId) return;
    if (!currentUser || !["admin", "medtech", "rn"].includes(currentUser.role)) {
        alert("You do not have permission to delete medications.");
        return;
    }

    if (!confirm("Delete this medication?")) return;

    authFetch(`${API_BASE}/medications/${medicationId}`, { method: "DELETE" })
        .then(() => {
            medicationDraftStatus.delete(medicationId);
            medicationCache.delete(medicationId);
            if (currentResidentId) {
                loadMedications(currentResidentId);
                loadResidentCards();
            }
        })
        .catch(err => {
            console.error("Error deleting medication:", err);
            alert(err.message || "Unable to delete medication.");
        });
}

const addInvoiceForm = document.getElementById("addInvoiceForm");
if (addInvoiceForm) {
    addInvoiceForm.addEventListener("submit", function (e) {
        e.preventDefault();

        if (!currentResidentId) {
            alert("No resident selected.");
            return;
        }

        const invoiceData = {
            residentId: currentResidentId,
            description: document.getElementById("invoiceDescription")?.value || "",
            amount: Number(document.getElementById("invoiceAmount")?.value || 0),
            dueDate: document.getElementById("invoiceDueDate")?.value || null,
            notes: document.getElementById("invoiceNotes")?.value || ""
        };

        authFetch(`${API_BASE}/invoices`, {
            method: "POST",
            body: JSON.stringify(invoiceData)
        })
            .then(() => {
                closeAddInvoicePanel();
                if (currentResidentId) {
                    showResidentTab("billingTab");
                    loadBilling(currentResidentId);
                }
            })
            .catch(err => {
                console.error("Error creating invoice:", err);
                alert(err.message || "Unable to create invoice.");
            });
    });
}

const payInvoiceForm = document.getElementById("payInvoiceForm");
if (payInvoiceForm) {
    payInvoiceForm.addEventListener("submit", function (e) {
        e.preventDefault();

        const residentId = document.getElementById("payResidentSelect")?.value;
        const description = document.getElementById("payDescription")?.value.trim();
        const amount = Number(document.getElementById("payAmount")?.value || 0);
        const dueDate = document.getElementById("payDueDate")?.value || null;
        const notes = document.getElementById("payNotes")?.value || "";
        const paymentMethod = document.getElementById("paymentMethod")?.value;
        const payerName = document.getElementById("payerName")?.value.trim();
        const paymentInfo = document.getElementById("paymentInfo")?.value.trim();

        if (!residentId || !description || !amount || !paymentMethod || !payerName || !paymentInfo) {
            alert("Please complete all payment and invoice details.");
            return;
        }

        const invoiceData = {
            residentId,
            description,
            amount,
            dueDate,
            notes,
            paymentMethod,
            payerName,
            paymentInfo,
        };

        authFetch(`${API_BASE}/invoices`, {
            method: "POST",
            body: JSON.stringify(invoiceData)
        })
            .then(() => {
                closePayInvoicePanel();
                if (residentId === currentResidentId) {
                    showResidentTab("billingTab");
                    loadBilling(currentResidentId);
                } else {
                    loadBillingPage();
                    showPage("billingPage");
                }
                alert("Payment processed and invoice created.");
            })
            .catch(err => {
                console.error("Error processing payment:", err);
                alert(err.message || "Unable to process payment.");
            });
    });
}

// =========================
// LOAD MAR LOG
// =========================

function loadMarLog(residentId) {
    authFetch(`${API_BASE}/mar/${residentId}`)
        .then(entries => {
            const container = document.getElementById("marLogContainer");
            if (!container) return;

            container.innerHTML = "";

            if (!entries.length) {
                container.innerHTML = `<p class="muted">No MAR entries yet.</p>`;
                return;
            }

            entries.forEach(entry => {
                const div = document.createElement("div");
                div.classList.add("mar-entry");

                const medName = entry.medicationId?.name || entry.medicationName || "Medication";
                const formattedTime = new Date(entry.actualTime).toLocaleString();

                div.innerHTML = `
                    <strong>${medName}</strong>
                    <p>Status: ${entry.status}</p>
                    <p>Scheduled: ${entry.scheduledTime || "N/A"}</p>
                    ${entry.reason ? `<p>Reason: ${entry.reason}</p>` : ""}
                    ${entry.staffName ? `<p>By: ${entry.staffName}</p>` : ""}
                    <p class="muted">${formattedTime}</p>
                `;

                container.appendChild(div);
            });
        })
        .catch(err => console.error("Error loading MAR log:", err));
}

// Load recent MAR entries across all residents
function loadGlobalMarLog() {
    authFetch(`${API_BASE}/mar`)
        .then(entries => {
            const container = document.getElementById("globalMarContainer");
            if (!container) return;

            container.innerHTML = "";

            if (!entries.length) {
                container.innerHTML = `<p class=\"muted\">No MAR entries yet.</p>`;
                return;
            }

            entries.forEach(entry => {
                const div = document.createElement("div");
                div.classList.add("mar-entry");

                const medName = entry.medicationId?.name || entry.medicationName || "Medication";
                const residentName = entry.residentId ? `${entry.residentId.firstName} ${entry.residentId.lastName}` : "Unknown resident";
                const formattedTime = new Date(entry.actualTime || entry.createdAt || Date.now()).toLocaleString();

                div.innerHTML = `
                    <strong>${medName} — <small>${residentName} (${entry.residentId?.roomNumber || '—'})</small></strong>
                    <p>Status: ${entry.status}</p>
                    <p>Scheduled: ${entry.scheduledTime || "N/A"}</p>
                    ${entry.reason ? `<p>Reason: ${entry.reason}</p>` : ""}
                    ${entry.staffName ? `<p>By: ${entry.staffName}</p>` : ""}
                    <p class="muted">${formattedTime}</p>
                `;

                div.onclick = () => {
                    if (entry.residentId && entry.residentId._id) openResidentProfile(entry.residentId._id);
                };

                container.appendChild(div);
            });
        })
        .catch(err => console.error("Error loading global MAR log:", err));
}
