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
let residentCardsRenderVersion = 0;
let currentResidentId = null;
let residentAppointments = [];
let appointmentCalendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let appointmentCalendarMonthManuallyChanged = false;
let editingAppointmentId = null;
let selectedMedicationResidentId = null;
let medicationResidentRequestVersion = 0;
let currentUser = null;
const resident911ChartStorageKey = "resident911Charts";
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
        'loadMedPassPage','setMedPassShift','finalizeMedPassShift','toggleMedPassDueOnly',
        'openMedPassResidentPage','printResidentMedicationList','openAppointmentModal',
        'closeAppointmentModal','changeAppointmentCalendarMonth','deleteResidentAppointment','openPoaEvents'
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
    localStorage.removeItem("employeeSessionId");
    localStorage.removeItem("employeeLastActivityAt");
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

function bindLegacyInlineHandlers() {
    if (typeof document === "undefined" || !document.addEventListener) return;

    document.addEventListener("click", function (event) {
        const target = event.target && event.target.closest ? event.target.closest("[onclick]") : null;
        if (!target) return;

        const source = target.getAttribute("onclick");
        if (!source) return;

        target.removeAttribute("onclick");

        try {
            const execute = new Function("event", source);
            execute.call(target, event);
        } catch (error) {
            console.error("Error running legacy inline handler:", error);
        }
    }, true);
}

bindLegacyInlineHandlers();

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

function normalizeResidentPhotoUrl(photoUrl) {
    if (!photoUrl) return "";

    let value = String(photoUrl).trim().replace(/\\/g, "/");
    if (!value) return "";
    if (/^https?:\/\//i.test(value) || /^data:/i.test(value) || value.startsWith("blob:")) {
        return value;
    }

    value = value.replace(/^([a-zA-Z]:)/, "");

    const uploadMatch = value.match(/(?:^|\/)(uploads\/.+|residents\/.+)$/i);
    if (uploadMatch) {
        value = `/${uploadMatch[1]}`;
    } else {
        value = value.replace(/^\.\//, "");
        value = value.replace(/^\/+/, "");
        value = value.startsWith("/") ? value : `/${value}`;
    }

    return value;
}

function resolveResidentPhotoUrl(photoUrl) {
    const normalized = normalizeResidentPhotoUrl(photoUrl);
    if (!normalized) return "images/placeholder.svg";

    if (/^https?:\/\//i.test(normalized) || /^data:/i.test(normalized) || normalized.startsWith("blob:")) {
        return normalized;
    }

    return `${API_BASE}${normalized}`;
}

function updateRoleUI() {
    const badge = document.getElementById("currentUserRoleBadge");
    const logoutButton = document.getElementById("logoutButton");
    const dashboardNav = document.getElementById("nav-dashboard");
    const residentsNav = document.getElementById("nav-residents");
    const eventsNav = document.getElementById("nav-events");
    const billNav = document.getElementById("nav-billing");
    const medNav = document.getElementById("nav-meds");
    const medPassNav = document.getElementById("nav-medpass");
    const billingPageDescription = document.getElementById("billingPageDescription");
    const registerNav = document.getElementById("nav-register");
    const addResidentBtn = document.getElementById("addResidentButton");
    const residentBillingTabButton = document.getElementById("residentBillingTabButton");
    const residentAppointmentsTabButton = document.getElementById("residentAppointmentsTabButton");
    const appointmentCalendarTitle = document.getElementById("appointmentCalendarTitle");
    const residentPayInvoiceButton = document.getElementById("residentPayInvoiceButton");
    const residentNewInvoiceButton = document.getElementById("residentNewInvoiceButton");
    const editQuickStatsButton = document.getElementById("editQuickStatsButton");
    const editTodaysFocusButton = document.getElementById("editTodaysFocusButton");
    const employeeActivityCard = document.getElementById("employeeActivityCard");

    if (!currentUser) {
        if (badge) badge.textContent = "";
        if (logoutButton) logoutButton.style.display = "none";
        if (billNav) billNav.style.display = "none";
        if (residentsNav) residentsNav.style.display = "none";
        if (eventsNav) eventsNav.style.display = "none";
        if (medPassNav) medPassNav.style.display = "none";
        if (registerNav) registerNav.style.display = "none";
        if (addResidentBtn) addResidentBtn.style.display = "none";
        if (residentBillingTabButton) residentBillingTabButton.style.display = "none";
        if (residentAppointmentsTabButton) residentAppointmentsTabButton.style.display = "none";
        if (appointmentCalendarTitle) appointmentCalendarTitle.textContent = "Appointments";
        if (residentPayInvoiceButton) residentPayInvoiceButton.style.display = "none";
        if (residentNewInvoiceButton) residentNewInvoiceButton.style.display = "none";
        if (editQuickStatsButton) editQuickStatsButton.style.display = "none";
        if (editTodaysFocusButton) editTodaysFocusButton.style.display = "none";
        if (employeeActivityCard) employeeActivityCard.style.display = "none";
        return;
    }

    if (badge) badge.textContent = `${currentUser.name || "User"} (${currentUser.role})`;
    if (logoutButton) logoutButton.style.display = "inline-block";
    if (employeeActivityCard) employeeActivityCard.style.display = currentUser.role === "admin" ? "block" : "none";

    if (currentUser.role === "admin") {
        if (billNav) billNav.style.display = "block";
        if (medPassNav) medPassNav.style.display = "block";
        if (registerNav) registerNav.style.display = "inline-block";
        if (addResidentBtn) addResidentBtn.style.display = "inline-block";
        if (residentBillingTabButton) residentBillingTabButton.style.display = "inline-block";
        if (residentAppointmentsTabButton) {
            residentAppointmentsTabButton.textContent = "Appointments";
            residentAppointmentsTabButton.style.display = "inline-block";
        }
        if (appointmentCalendarTitle) appointmentCalendarTitle.textContent = "Appointments";
        if (residentPayInvoiceButton) residentPayInvoiceButton.style.display = "inline-block";
        if (residentNewInvoiceButton) residentNewInvoiceButton.style.display = "inline-block";
        if (editQuickStatsButton) editQuickStatsButton.style.display = "inline-block";
        if (editTodaysFocusButton) editTodaysFocusButton.style.display = "inline-block";
        if (medPassNav) medPassNav.style.display = "block";
    } else if (currentUser.role === "poa") {
        if (dashboardNav) dashboardNav.style.display = "none";
        if (residentsNav) residentsNav.style.display = "none";
        if (eventsNav) eventsNav.style.display = "block";
        if (registerNav) registerNav.style.display = "none";
        if (billNav) billNav.style.display = "block";
        if (medNav) medNav.style.display = "none";
        if (medPassNav) medPassNav.style.display = "none";
        if (addResidentBtn) addResidentBtn.style.display = "none";
        if (residentBillingTabButton) residentBillingTabButton.style.display = "inline-block";
        if (residentAppointmentsTabButton) {
            residentAppointmentsTabButton.textContent = "Events";
            residentAppointmentsTabButton.style.display = "inline-block";
        }
        if (appointmentCalendarTitle) appointmentCalendarTitle.textContent = "Events";
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
        const chartTabButton = document.getElementById("resident911ChartTabButton");
        if (medsTabButton) medsTabButton.style.display = "none";
        if (marTabButton) marTabButton.style.display = "none";
        if (chartTabButton) chartTabButton.style.display = "none";
        const medsTab = document.getElementById("medsTab");
        const marTab = document.getElementById("marTab");
        const billingTab = document.getElementById("billingTab");
        const appointmentsTab = document.getElementById("appointmentsTab");
        if (medsTab) medsTab.style.display = "none";
        if (marTab) marTab.style.display = "none";
        if (appointmentsTab) appointmentsTab.style.display = "none";
        if (billingTab) billingTab.style.display = "block";
    } else {
        if (residentsNav) residentsNav.style.display = "block";
        if (eventsNav) eventsNav.style.display = "none";
        if (registerNav) registerNav.style.display = "none";
        if (billNav) billNav.style.display = "none";
        if (medPassNav) medPassNav.style.display = ["medtech", "rn"].includes(currentUser.role) ? "block" : "none";
        if (addResidentBtn) addResidentBtn.style.display = currentUser.role === "medtech" || currentUser.role === "rn" ? "inline-block" : "none";
        if (residentBillingTabButton) residentBillingTabButton.style.display = currentUser.role === "poa" ? "inline-block" : "none";
        if (residentAppointmentsTabButton) {
            residentAppointmentsTabButton.textContent = "Appointments";
            residentAppointmentsTabButton.style.display = "inline-block";
        }
        if (appointmentCalendarTitle) appointmentCalendarTitle.textContent = "Appointments";
        if (residentPayInvoiceButton) residentPayInvoiceButton.style.display = currentUser.role === "poa" ? "inline-block" : "none";
        if (residentNewInvoiceButton) residentNewInvoiceButton.style.display = "none";
        if (editQuickStatsButton) editQuickStatsButton.style.display = "none";
        if (editTodaysFocusButton) editTodaysFocusButton.style.display = "none";
    }
}

async function logout() {
    const token = getToken();
    const sessionId = localStorage.getItem("employeeSessionId");
    if (token && sessionId) {
        try {
            const tenantId = currentUser?.tenantId || parseJwt(token)?.tenantId;
            const response = await fetch(`${API_BASE}/auth/logout`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                    ...(tenantId ? { "X-Tenant-Id": tenantId } : {})
                },
                body: JSON.stringify({ sessionId })
            });
            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                throw new Error(payload.error || payload.message || "Unable to record logout time");
            }
        } catch (err) {
            console.error("Unable to record employee logout:", err);
            window.alert("Your account will be logged out, but the logout time could not be recorded. Please notify an administrator.");
        }
    }
    localStorage.removeItem("authToken");
    localStorage.removeItem("employeeSessionId");
    localStorage.removeItem("employeeLastActivityAt");
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

    const medicationResidentSearch = document.getElementById("medicationResidentSearch");
    if (medicationResidentSearch) {
        medicationResidentSearch.addEventListener("input", renderMedicationResidentCards);
    }

    const medPassResidentSearch = document.getElementById("medPassResidentSearch");
    if (medPassResidentSearch) {
        medPassResidentSearch.addEventListener("input", populateMedPassResidentCards);
    }

    const dashboardEditForm = document.getElementById("dashboardEditForm");
    if (dashboardEditForm) {
        dashboardEditForm.addEventListener("submit", function (e) {
            e.preventDefault();
            saveDashboardSettings();
        });
    }

    const appointmentForm = document.getElementById("appointmentForm");
    if (appointmentForm) {
        appointmentForm.addEventListener("submit", saveResidentAppointment);
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
        const renderVersion = ++residentCardsRenderVersion;
        const data = await authFetch(`${API_BASE}/residents`);
        if (renderVersion !== residentCardsRenderVersion) return;

        residents = Array.isArray(data) ? data : [];
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

        const cards = await Promise.all(residents.map(async resident => {
            const card = document.createElement("div");
            card.classList.add("resident-card");

            const thumbSrc = resolveResidentPhotoUrl(resident.photoUrl);

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
                        <img class="resident-thumb" src="${thumbSrc}" alt="${resident.firstName} ${resident.lastName}" onerror="this.onerror=null;this.src='images/placeholder.svg';">
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
            return card;
        }));

        if (renderVersion !== residentCardsRenderVersion) return;
        cards.forEach(card => container.appendChild(card));
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

async function loadMedicationResidents() {
    const container = document.getElementById("medicationResidentList");
    if (!container) return;

    container.textContent = "Loading residents...";
    try {
        await ensureResidentsLoaded(true);
        renderMedicationResidentCards();

        const selectedResident = residents.find(resident => String(resident._id) === String(selectedMedicationResidentId));
        if (selectedResident) {
            loadResidentDirectoryMedications(selectedResident);
        } else {
            selectedMedicationResidentId = null;
            const heading = document.getElementById("residentMedicationHeading");
            const room = document.getElementById("residentMedicationRoom");
            const prompt = document.getElementById("residentMedicationPrompt");
            const list = document.getElementById("residentMedicationList");
            const printButton = document.getElementById("printResidentMedicationButton");
            if (heading) heading.textContent = "Resident medications";
            if (room) room.textContent = "";
            if (prompt) {
                prompt.textContent = residents.length
                    ? "Select a resident to view their medications."
                    : "No residents are available.";
                prompt.style.display = "block";
            }
            if (list) {
                list.innerHTML = "";
                list.style.display = "none";
            }
            if (printButton) printButton.disabled = true;
        }
    } catch (err) {
        console.error("Error loading residents for medication directory:", err);
        container.textContent = "Unable to load residents. Please try again.";
    }
}

function renderMedicationResidentCards() {
    const container = document.getElementById("medicationResidentList");
    const searchInput = document.getElementById("medicationResidentSearch");
    if (!container) return;

    const query = (searchInput?.value || "").trim().toLocaleLowerCase();
    const matchingResidents = residents.filter(resident => {
        const name = `${resident.firstName || ""} ${resident.lastName || ""}`.toLocaleLowerCase();
        const room = String(resident.roomNumber || "").toLocaleLowerCase();
        const code = String(resident.residentCode || "").toLocaleLowerCase();
        return !query || name.includes(query) || room.includes(query) || code.includes(query);
    });

    container.innerHTML = "";
    if (!matchingResidents.length) {
        const message = document.createElement("p");
        message.className = "muted medication-empty-state";
        message.textContent = residents.length ? "No residents match your search." : "No residents are available.";
        container.appendChild(message);
        return;
    }

    matchingResidents.forEach(resident => {
        const name = `${resident.firstName || ""} ${resident.lastName || ""}`.trim() || "Resident";
        const card = document.createElement("button");
        card.type = "button";
        card.className = "resident-card medication-resident-card";
        card.setAttribute("aria-pressed", String(String(selectedMedicationResidentId) === String(resident._id)));
        if (String(selectedMedicationResidentId) === String(resident._id)) {
            card.classList.add("selected");
        }

        card.innerHTML = `
            <span class="resident-card-row">
                <img class="resident-thumb" src="${escapeHtml(resolveResidentPhotoUrl(resident.photoUrl))}" alt="">
                <span class="resident-card-body">
                    <span class="resident-card-body-name">${escapeHtml(name)}</span>
                    <span class="muted">Room ${escapeHtml(resident.roomNumber || "-")}</span>
                </span>
            </span>
        `;
        const photo = card.querySelector(".resident-thumb");
        if (photo) {
            photo.alt = name;
            photo.addEventListener("error", () => {
                photo.src = "images/placeholder.svg";
            }, { once: true });
        }
        card.addEventListener("click", () => {
            selectedMedicationResidentId = String(resident._id);
            renderMedicationResidentCards();
            const printWindow = window.open("", "_blank");
            if (!printWindow) {
                window.alert("The printable medication list could not open because pop-ups are blocked. Allow pop-ups for this site and select the resident again.");
            } else {
                printWindow.opener = null;
                renderPrintableMedicationPage(printWindow, resident);
            }
            loadResidentDirectoryMedications(resident, printWindow);
        });
        container.appendChild(card);
    });
}

function renderPrintableMedicationPage(printWindow, resident, medications = null, error = null) {
    if (!printWindow || printWindow.closed) return;

    const printDocument = printWindow.document;
    const name = `${resident.firstName || ""} ${resident.lastName || ""}`.trim() || "Resident";
    printDocument.documentElement.lang = "en";
    printDocument.title = `Medication List - ${name}`;

    const style = printDocument.createElement("style");
    style.textContent = `
        @page { margin: 18mm; }
        body { margin: 0; color: #111827; font: 14px Arial, sans-serif; }
        main { max-width: 850px; margin: 32px auto; padding: 0 24px; }
        header { border-bottom: 2px solid #111827; margin-bottom: 20px; padding-bottom: 12px; }
        h1 { margin: 0 0 8px; font-size: 24px; }
        p { margin: 4px 0; }
        ul { list-style: none; margin: 0; padding: 0; }
        li { border: 1px solid #cbd5e1; border-radius: 8px; margin: 0 0 12px; padding: 12px; break-inside: avoid; }
        li strong { display: block; font-size: 16px; margin-bottom: 6px; }
        li p { margin-top: 6px; }
        .print-button { background: #0f172a; border: 0; border-radius: 6px; color: white; cursor: pointer; font: inherit; margin-bottom: 20px; padding: 10px 16px; }
        .status { margin: 16px 0; }
        @media print {
            main { margin: 0; max-width: none; padding: 0; }
            .print-button { display: none; }
        }
    `;
    printDocument.head.replaceChildren(style);

    const main = printDocument.createElement("main");
    const header = printDocument.createElement("header");
    const heading = printDocument.createElement("h1");
    heading.textContent = "Medication List";
    const residentName = printDocument.createElement("p");
    residentName.textContent = name;
    const room = printDocument.createElement("p");
    room.textContent = `Room ${resident.roomNumber || "-"}`;
    const printedDate = printDocument.createElement("p");
    printedDate.textContent = `Prepared ${new Date().toLocaleDateString()}`;
    header.append(heading, residentName, room, printedDate);
    main.appendChild(header);

    const printButton = printDocument.createElement("button");
    printButton.type = "button";
    printButton.className = "print-button";
    printButton.textContent = "Print List";
    printButton.disabled = !Array.isArray(medications) || !!error || medications.length === 0;
    printButton.addEventListener("click", () => window.printResidentMedicationList(String(resident._id)));
    main.appendChild(printButton);

    const status = printDocument.createElement("p");
    status.className = "status";
    if (error) {
        status.textContent = error;
        main.appendChild(status);
    } else if (!Array.isArray(medications)) {
        status.textContent = "Loading medications...";
        main.appendChild(status);
    } else if (!medications.length) {
        status.textContent = "No active medications on file for this resident.";
        main.appendChild(status);
    } else {
        const list = printDocument.createElement("ul");
        medications.forEach(medication => {
            const item = printDocument.createElement("li");
            const medicationName = printDocument.createElement("strong");
            medicationName.textContent = medication.name || "Medication";
            item.appendChild(medicationName);

            const details = [];
            if (medication.dosage) details.push(medication.dosage);
            if (medication.route) details.push(medication.route);
            if (medication.frequency) details.push(medication.frequency);
            if (details.length) {
                const detailText = printDocument.createElement("p");
                detailText.textContent = details.join(" · ");
                item.appendChild(detailText);
            }

            const times = Array.isArray(medication.times) && medication.times.length
                ? medication.times.join(", ")
                : medication.time;
            if (times) {
                const schedule = printDocument.createElement("p");
                schedule.textContent = `Schedule: ${times}`;
                item.appendChild(schedule);
            }
            if (medication.instructions) {
                const instructions = printDocument.createElement("p");
                instructions.textContent = medication.instructions;
                item.appendChild(instructions);
            }
            list.appendChild(item);
        });
        main.appendChild(list);
    }

    printDocument.body.replaceChildren(main);
}

async function loadResidentDirectoryMedications(resident, printWindow = null) {
    const requestVersion = ++medicationResidentRequestVersion;
    const heading = document.getElementById("residentMedicationHeading");
    const room = document.getElementById("residentMedicationRoom");
    const prompt = document.getElementById("residentMedicationPrompt");
    const list = document.getElementById("residentMedicationList");
    const printButton = document.getElementById("printResidentMedicationButton");
    if (!heading || !room || !prompt || !list) return;

    heading.textContent = `${resident.firstName || ""} ${resident.lastName || ""}`.trim() || "Resident";
    room.textContent = `Room ${resident.roomNumber || "-"}`;
    prompt.textContent = "Loading medications...";
    prompt.style.display = "block";
    list.innerHTML = "";
    list.style.display = "none";
    if (printButton) printButton.disabled = true;

    try {
        const medications = await authFetch(`${API_BASE}/medications/${encodeURIComponent(resident._id)}`);
        if (!Array.isArray(medications)) {
            throw new Error("The medication response was not a list.");
        }

        const activeMedications = medications.filter(medication =>
            !medication.status || String(medication.status).toLowerCase() === "active"
        );
        renderPrintableMedicationPage(printWindow, resident, activeMedications);
        if (requestVersion !== medicationResidentRequestVersion) return;
        if (!activeMedications.length) {
            prompt.textContent = "No active medications on file for this resident.";
            return;
        }

        activeMedications.forEach(medication => {
            const item = document.createElement("li");
            const card = document.createElement("div");
            card.className = "med-card medication-directory-card";
            const details = [];
            if (medication.dosage) details.push(medication.dosage);
            if (medication.route) details.push(medication.route);
            if (medication.frequency) details.push(medication.frequency);
            const times = Array.isArray(medication.times) && medication.times.length
                ? medication.times.join(", ")
                : medication.time;

            const content = document.createElement("div");
            content.className = "med-left";
            const name = document.createElement("strong");
            name.textContent = medication.name || "Medication";
            content.appendChild(name);
            if (details.length) {
                const detailText = document.createElement("p");
                detailText.textContent = details.join(" · ");
                content.appendChild(detailText);
            }
            if (times) {
                const timeText = document.createElement("small");
                timeText.textContent = `Schedule: ${times}`;
                content.appendChild(timeText);
            }
            if (medication.instructions) {
                const instructions = document.createElement("p");
                instructions.className = "medication-instructions";
                instructions.textContent = medication.instructions;
                content.appendChild(instructions);
            }
            card.appendChild(content);
            item.appendChild(card);
            list.appendChild(item);
        });

        prompt.style.display = "none";
        list.style.display = "flex";
        if (printButton) printButton.disabled = false;
    } catch (err) {
        console.error("Error loading resident medications:", err);
        const errorMessage = "Unable to load this resident's medications. Please select the resident again to retry.";
        renderPrintableMedicationPage(printWindow, resident, null, errorMessage);
        if (requestVersion !== medicationResidentRequestVersion) return;
        prompt.textContent = errorMessage;
    }
}

function printResidentMedicationList(expectedResidentId = null) {
    const list = document.getElementById("residentMedicationList");
    if (expectedResidentId && String(selectedMedicationResidentId) !== expectedResidentId) {
        window.alert("Please select this resident again before printing their medication list.");
        return;
    }
    if (!selectedMedicationResidentId || !list || !list.children.length) return;
    const clearPrintMode = () => document.body.classList.remove("print-medication-list");
    window.addEventListener("afterprint", clearPrintMode, { once: true });
    document.body.classList.add("print-medication-list");
    window.print();
    window.setTimeout(clearPrintMode, 1000);
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

function isMedicationLateForShift(med, shift, now = new Date()) {
    if (!med) return false;

    const scheduledValues = [];
    const medTimes = Array.isArray(med.times) ? med.times : [];
    medTimes.forEach(timeValue => {
        const minuteValue = parseTimeToMinutes(timeValue);
        if (minuteValue != null && isTimeInSlot(minuteValue, shift)) {
            scheduledValues.push(minuteValue);
        }
    });

    if (med.time) {
        const timeMinutes = parseTimeToMinutes(med.time);
        if (timeMinutes != null && isTimeInSlot(timeMinutes, shift)) {
            scheduledValues.push(timeMinutes);
        }
    }

    if (!scheduledValues.length) return false;

    const latestScheduledMinutes = Math.max(...scheduledValues);
    const scheduledDate = new Date(now);
    scheduledDate.setHours(0, 0, 0, 0);
    scheduledDate.setHours(Math.floor(latestScheduledMinutes / 60), latestScheduledMinutes % 60, 0, 0);

    const oneHourAfter = new Date(scheduledDate.getTime() + (60 * 60 * 1000));
    return now >= oneHourAfter;
}

async function loadMedPassCensus(residentId, shift, dueCount = 0) {
    if (!residentId || !shift) {
        resetMedPassCensus();
        return;
    }

    try {
        const [entries, meds] = await Promise.all([
            authFetch(`${API_BASE}/mar/${residentId}`),
            authFetch(`${API_BASE}/medications/${residentId}`)
        ]);

        const now = new Date();
        const allMeds = Array.isArray(meds) ? meds : [];
        const allEntries = Array.isArray(entries) ? entries : [];
        const dayStart = new Date(now);
        dayStart.setHours(0, 0, 0, 0);

        const todaysShiftEntries = allEntries.filter(entry => {
            const actual = new Date(entry.actualTime || entry.createdAt || 0);
            if (Number.isNaN(actual.getTime())) return false;
            if (actual < dayStart) return false;
            if (entry.status === "prn-followup") return false;
            return marScheduledTimeMatchesShift(entry.scheduledTime, shift);
        });

        const givenMedIds = new Set(
            todaysShiftEntries
                .filter(entry => entry.status === "given")
                .map(entry => String(entry.medicationId?._id || entry.medicationId))
                .filter(Boolean)
        );

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
        const lateCount = allMeds.filter(med => {
            if (!medIsScheduledForSlot(med, shift)) return false;
            if (givenMedIds.has(String(med._id))) return false;

            const medTimes = Array.isArray(med.times) ? med.times : [];
            const scheduledOptions = medTimes.length ? medTimes : [med.time].filter(Boolean);
            const hasLateScheduledTime = scheduledOptions.some(timeValue => {
                const minuteValue = parseTimeToMinutes(timeValue);
                if (minuteValue == null || !isTimeInSlot(minuteValue, shift)) return false;
                const scheduledDate = new Date(now);
                scheduledDate.setHours(0, 0, 0, 0);
                scheduledDate.setHours(Math.floor(minuteValue / 60), minuteValue % 60, 0, 0);
                const oneHourAfter = new Date(scheduledDate.getTime() + (60 * 60 * 1000));
                return now >= oneHourAfter;
            });

            return hasLateScheduledTime;
        }).length;

        updateMedPassCensusUI({
            due: lateCount || dueRemaining,
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

function populateMedPassResidentCards() {
    const dueOnlyToggle = document.getElementById("medPassDueOnlyToggle");
    if (dueOnlyToggle) dueOnlyToggle.checked = medPassDueOnly;

    const residentsForFilter = medPassDueOnly
        ? residents.filter(r => medPassDueResidentIds.has(String(r._id)))
        : residents;

    const residentExists = residentsForFilter.some(r => String(r._id) === String(medPassResidentId));
    if (!residentExists) {
        medPassResidentId = null;
    }

    if (!medPassResidentId && residentsForFilter.length) {
        medPassResidentId = residentsForFilter[0]._id;
    }

    const searchInput = document.getElementById("medPassResidentSearch");
    const query = (searchInput?.value || "").trim().toLocaleLowerCase();
    const matchingResidents = residentsForFilter.filter(resident => {
        const name = `${resident.firstName || ""} ${resident.lastName || ""}`.toLocaleLowerCase();
        const room = String(resident.roomNumber || "").toLocaleLowerCase();
        return !query || name.includes(query) || room.includes(query);
    });

    renderMedPassResidentCards(matchingResidents);
}

function renderMedPassResidentCards(residentsForCards) {
    const container = document.getElementById("medPassResidentCards");
    if (!container) return;

    container.innerHTML = "";

    if (!Array.isArray(residentsForCards) || !residentsForCards.length) {
        const empty = document.createElement("p");
        empty.className = "muted";
        const searchInput = document.getElementById("medPassResidentSearch");
        const hasSearch = Boolean(searchInput?.value.trim());
        empty.textContent = hasSearch
            ? "No residents match your search."
            : medPassDueOnly ? "No residents due in this shift." : "No residents available.";
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

        const thumbSrc = resolveResidentPhotoUrl(resident.photoUrl);
        const dueLabel = isDue ? "Due this shift" : "No meds due this shift";

        card.innerHTML = `
            <div class="resident-card-row">
                <img class="resident-thumb" src="${thumbSrc}" alt="${escapeHtml(`${resident.firstName} ${resident.lastName}`)}" onerror="this.onerror=null;this.src='images/placeholder.svg';">
                <div class="resident-card-body">
                    <h3>${escapeHtml(`${resident.firstName} ${resident.lastName}`)}</h3>
                    <p class="muted">Room ${escapeHtml(resident.roomNumber || "-")}</p>
                    <p class="medpass-card-status">${dueLabel}</p>
                </div>
            </div>
        `;

        card.onclick = () => {
            medPassResidentId = resident._id;
            setPassFinalized(false, "medpass-med-list", "medPassFinalizeButton");
            resetMedPassCensus();
            populateMedPassResidentCards();
            loadMedPassResidentMeds();
            openMedPassResidentPage(resident._id, medPassShift || getCurrentTimeslot());
        };

        container.appendChild(card);
    });
}

function toggleMedPassDueOnly() {
    const checkbox = document.getElementById("medPassDueOnlyToggle");
    medPassDueOnly = Boolean(checkbox?.checked);
    populateMedPassResidentCards();
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

    populateMedPassResidentCards();
    updateMedPassShiftBanner(medPassShift, dueResidents.length);
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

    list.innerHTML = "";
    updateMedPassSummary("");
    resetMedPassCensus();

    if (!medPassResidentId) {
        return;
    }

    // Keep the Med Pass overview screen focused on resident cards only.
    // Medication details load in the resident-specific med pass view instead.
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
    if (pageId === "residentsPage" && currentUser?.role === "poa" && document.getElementById("appointmentsTab")?.style.display !== "none") {
        document.getElementById("nav-events").classList.add("active-nav");
    }
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
        const residentsHeading = document.querySelector("#residentsPage .page-title");
        const residentList = document.getElementById("residentList");
        const residentHeader = document.querySelector("#residentsPage .page-header-row");
        if (currentUser?.role === "poa") {
            if (residentsHeading) residentsHeading.textContent = "Events";
            if (residentHeader) residentHeader.style.display = "none";
            if (residentList) residentList.style.display = "none";
        } else {
            if (residentsHeading) residentsHeading.textContent = "Residents";
            if (residentHeader) residentHeader.style.display = "";
            if (residentList) residentList.style.display = "";
        }
        loadResidentCards();
    } else {
        const residentsHeading = document.querySelector("#residentsPage .page-title");
        const residentHeader = document.querySelector("#residentsPage .page-header-row");
        const residentList = document.getElementById("residentList");
        if (residentsHeading) residentsHeading.textContent = "Residents";
        if (residentHeader) residentHeader.style.display = "";
        if (residentList) residentList.style.display = "";
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
        loadMedicationResidents();
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
        const marDateInput = document.getElementById("marDateFilter");
        if (marDateInput) {
            const today = new Date();
            const defaultDate = new Date(today.getTime() - (today.getTimezoneOffset() * 60000)).toISOString().slice(0, 10);
            if (!marDateInput.value) {
                marDateInput.value = defaultDate;
            }
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

async function openPoaEvents() {
    if (!currentUser || currentUser.role !== "poa" || !currentUser.residentId) {
        window.alert("This Events calendar is only available to a linked POA account.");
        return;
    }

    try {
        await ensureResidentsLoaded(true);
        const resident = residents.find(item => String(item._id) === String(currentUser.residentId));
        if (!resident) {
            throw new Error("The resident linked to this account could not be found.");
        }

        showPage("residentsPage");
        openResidentProfile(String(resident._id));
        showResidentTab("appointmentsTab");
        document.querySelectorAll(".nav-item").forEach(button => button.classList.remove("active-nav"));
        document.getElementById("nav-events")?.classList.add("active-nav");
    } catch (err) {
        console.error("Unable to open POA events calendar:", err);
        window.alert(err.message || "Unable to open the Events calendar.");
    }
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
            if (photoFile && !savedResident.photoUrl) {
                savedResident.photoUrl = URL.createObjectURL(photoFile);
            }

            closeAddResidentModal();

            if (savedResident && savedResident._id && !residents.some(resident => String(resident._id) === String(savedResident._id))) {
                residents.push(savedResident);
            }
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

function getResident911ChartEntry(residentId) {
    try {
        const raw = localStorage.getItem(resident911ChartStorageKey);
        const charts = raw ? JSON.parse(raw) : {};
        const entry = charts[String(residentId)] || {};
        return {
            diagnoses: entry.diagnoses || "Not entered",
            allergies: entry.allergies || "No known allergies",
            poa: entry.poa || "Not entered",
        };
    } catch (err) {
        console.error("Error reading resident 911 chart data:", err);
        return { diagnoses: "Not entered", allergies: "No known allergies", poa: "Not entered" };
    }
}

function persistResident911ChartEntry(residentId, payload) {
    try {
        const raw = localStorage.getItem(resident911ChartStorageKey);
        const charts = raw ? JSON.parse(raw) : {};
        charts[String(residentId)] = {
            ...charts[String(residentId)],
            ...payload
        };
        localStorage.setItem(resident911ChartStorageKey, JSON.stringify(charts));
    } catch (err) {
        console.error("Error saving resident 911 chart data:", err);
    }
}

async function renderResident911Chart() {
    const container = document.getElementById("resident911ChartContainer");
    const editButton = document.getElementById("resident911EditButton");
    if (!container) return;

    if (!currentResidentId) {
        container.innerHTML = `<p class="muted">Select a resident to view the 911 chart.</p>`;
        if (editButton) editButton.style.display = "none";
        return;
    }

    const resident = residents.find(r => String(r._id) === String(currentResidentId));
    const chartData = getResident911ChartEntry(currentResidentId);
    const canEdit = currentUser && currentUser.role === "admin";

    if (editButton) {
        editButton.style.display = canEdit ? "inline-block" : "none";
    }

    try {
        const meds = await authFetch(`${API_BASE}/medications/${currentResidentId}`);
        const medicationList = Array.isArray(meds) && meds.length
            ? meds.map(med => `
                <li>
                    ${med.name || "Medication"} — ${med.dosage || "—"}${med.route ? ` (${med.route})` : ""}
                    ${med.frequency ? ` • ${med.frequency}` : ""}
                    ${Array.isArray(med.times) && med.times.length ? ` • ${med.times.join(", ")}` : med.time ? ` • ${med.time}` : ""}
                    ${med.instructions ? ` • ${med.instructions}` : ""}
                </li>`).join("")
            : "<li>No medications on file.</li>";

        const allergies = resident?.allergies || chartData.allergies || "No known allergies";
        const diagnoses = chartData.diagnoses || "Not entered";
        const poa = chartData.poa || "Not entered";

        container.innerHTML = `
            <div class="resident-911-chart-header">
                <div>
                    <h3>${resident ? `${resident.firstName} ${resident.lastName}` : "Resident"}</h3>
                    <p class="muted">Room ${resident?.roomNumber || "—"}</p>
                </div>
                <div class="muted">Emergency Medical Information</div>
            </div>
            <div class="resident-911-chart-grid">
                <div class="resident-911-chart-section">
                    <h4>Diagnoses</h4>
                    <p>${escapeHtml(diagnoses).replace(/\n/g, "<br>")}</p>
                </div>
                <div class="resident-911-chart-section">
                    <h4>Allergies</h4>
                    <p>${escapeHtml(allergies).replace(/\n/g, "<br>")}</p>
                </div>
                <div class="resident-911-chart-section">
                    <h4>POA / Emergency Contact</h4>
                    <p>${escapeHtml(poa).replace(/\n/g, "<br>")}</p>
                </div>
                <div class="resident-911-chart-section" style="grid-column: 1 / -1;">
                    <h4>Medications</h4>
                    <ul>${medicationList}</ul>
                </div>
            </div>
        `;
    } catch (err) {
        console.error("Error loading 911 chart:", err);
        container.innerHTML = `<p class="muted">Unable to load the 911 chart right now.</p>`;
    }
}

function openResident911ChartEditModal() {
    if (!currentResidentId) return;

    const chartData = getResident911ChartEntry(currentResidentId);
    const diagnosesInput = document.getElementById("resident911Diagnoses");
    const allergiesInput = document.getElementById("resident911Allergies");
    const poaInput = document.getElementById("resident911Poa");
    const modal = document.getElementById("resident911ChartEditModal");

    if (diagnosesInput) diagnosesInput.value = chartData.diagnoses || "";
    if (allergiesInput) allergiesInput.value = chartData.allergies || "";
    if (poaInput) poaInput.value = chartData.poa || "";
    if (modal) modal.style.display = "flex";
}

function closeResident911ChartEditModal() {
    const modal = document.getElementById("resident911ChartEditModal");
    if (modal) modal.style.display = "none";
}

function printResident911Chart() {
    window.print();
}

function openResidentProfile(id) {
    currentResidentId = id;

    const resident = residents.find(r => r._id === id);
    if (!resident) return;
    residentAppointments = [];
    appointmentCalendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    appointmentCalendarMonthManuallyChanged = false;
    renderAppointmentCalendar();

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
        photoEl.src = resolveResidentPhotoUrl(resident.photoUrl);
        photoEl.onerror = () => {
            photoEl.src = "images/placeholder.svg";
        };
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

    renderResident911Chart();

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
    if (currentUser && currentUser.role === "poa" && !["billingTab", "appointmentsTab"].includes(tabId)) {
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

    if (tabId === "marTab" && currentResidentId) {
        loadMarLog(currentResidentId, getSelectedMarDateValue());
    }

    if (tabId === "billingTab" && currentResidentId) {
        loadBilling(currentResidentId);
    }

    if (tabId === "911ChartTab" && currentResidentId) {
        renderResident911Chart();
    }

    if (tabId === "appointmentsTab" && currentResidentId) {
        loadResidentAppointments(currentResidentId);
    }
}

function getLocalDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function renderAppointmentCalendar() {
    const calendar = document.getElementById("appointmentCalendar");
    const monthHeading = document.getElementById("appointmentCalendarMonth");
    if (!calendar || !monthHeading) return;

    const year = appointmentCalendarMonth.getFullYear();
    const month = appointmentCalendarMonth.getMonth();
    monthHeading.textContent = appointmentCalendarMonth.toLocaleDateString(undefined, {
        month: "long",
        year: "numeric"
    });
    calendar.replaceChildren();

    ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].forEach(day => {
        const heading = document.createElement("div");
        heading.className = "appointment-calendar-weekday";
        heading.textContent = day;
        calendar.appendChild(heading);
    });

    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cellCount = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
    const appointmentsByDate = new Map();
    residentAppointments.forEach(appointment => {
        const dateKey = typeof appointment.date === "string"
            ? appointment.date.slice(0, 10)
            : getLocalDateKey(new Date(appointment.date));
        if (!appointmentsByDate.has(dateKey)) appointmentsByDate.set(dateKey, []);
        appointmentsByDate.get(dateKey).push(appointment);
    });

    for (let index = 0; index < cellCount; index += 1) {
        const dayNumber = index - firstWeekday + 1;
        const inCurrentMonth = dayNumber >= 1 && dayNumber <= daysInMonth;
        const cellDate = new Date(year, month, dayNumber);
        const dateKey = getLocalDateKey(cellDate);
        const cell = document.createElement("div");
        cell.className = "appointment-calendar-day";
        if (!inCurrentMonth) cell.classList.add("outside-month");
        if (dateKey === getLocalDateKey(new Date())) cell.classList.add("today");

        const dayHeading = document.createElement("div");
        dayHeading.className = "appointment-calendar-day-heading";
        const dayNumberLabel = document.createElement("span");
        dayNumberLabel.textContent = String(cellDate.getDate());
        dayHeading.appendChild(dayNumberLabel);
        if (inCurrentMonth) {
            const addButton = document.createElement("button");
            addButton.type = "button";
            addButton.className = "appointment-add-button";
            addButton.textContent = "+";
            addButton.title = `Add appointment on ${cellDate.toLocaleDateString()}`;
            addButton.setAttribute("aria-label", `Add appointment on ${cellDate.toLocaleDateString()}`);
            addButton.addEventListener("click", () => openAppointmentModal(dateKey));
            dayHeading.appendChild(addButton);
        }
        cell.appendChild(dayHeading);

        (appointmentsByDate.get(dateKey) || []).forEach(appointment => {
            const item = document.createElement("button");
            item.type = "button";
            item.className = "appointment-calendar-item";
            const canEdit = currentUser?.role !== "poa"
                || String(appointment.createdBy) === String(currentUser.id);
            item.title = canEdit ? "Click to edit event" : "You can only edit or delete events you created.";
            item.setAttribute("aria-label", `${canEdit ? "Edit" : "View"} ${appointment.appointmentType} event at ${appointment.time}`);
            const time = document.createElement("strong");
            time.textContent = appointment.time;
            const type = document.createElement("span");
            type.textContent = appointment.appointmentType;
            item.append(time, type);
            item.addEventListener("click", () => openAppointmentModal(dateKey, appointment, canEdit));
            cell.appendChild(item);
        });
        calendar.appendChild(cell);
    }
}

async function loadResidentAppointments(residentId) {
    const status = document.getElementById("appointmentCalendarStatus");
    if (!status) return;
    status.textContent = "Loading appointments...";

    try {
        const appointments = await authFetch(`${API_BASE}/appointments/${encodeURIComponent(residentId)}`);
        if (String(residentId) !== String(currentResidentId)) return;
        if (!Array.isArray(appointments)) {
            throw new Error("The appointment response was not a list.");
        }
        residentAppointments = appointments;
        const currentMonthKey = `${appointmentCalendarMonth.getFullYear()}-${String(appointmentCalendarMonth.getMonth() + 1).padStart(2, "0")}`;
        const hasAppointmentsThisMonth = appointments.some(appointment => {
            const dateKey = typeof appointment.date === "string"
                ? appointment.date.slice(0, 10)
                : getLocalDateKey(new Date(appointment.date));
            return dateKey.slice(0, 7) === currentMonthKey;
        });
        if (currentUser?.role === "poa" && appointments.length && !hasAppointmentsThisMonth && !appointmentCalendarMonthManuallyChanged) {
            const todayKey = getLocalDateKey(new Date());
            const orderedAppointments = [...appointments].sort((left, right) => {
                const leftDate = typeof left.date === "string" ? left.date.slice(0, 10) : getLocalDateKey(new Date(left.date));
                const rightDate = typeof right.date === "string" ? right.date.slice(0, 10) : getLocalDateKey(new Date(right.date));
                return `${leftDate}T${left.time}`.localeCompare(`${rightDate}T${right.time}`);
            });
            const nearestAppointment = orderedAppointments.find(appointment => {
                const dateKey = typeof appointment.date === "string"
                    ? appointment.date.slice(0, 10)
                    : getLocalDateKey(new Date(appointment.date));
                return dateKey >= todayKey;
            }) || orderedAppointments[orderedAppointments.length - 1];
            const appointmentDate = typeof nearestAppointment.date === "string"
                ? nearestAppointment.date.slice(0, 10)
                : getLocalDateKey(new Date(nearestAppointment.date));
            const [appointmentYear, appointmentMonth] = appointmentDate.split("-").map(Number);
            appointmentCalendarMonth = new Date(appointmentYear, appointmentMonth - 1, 1);
        }
        status.textContent = appointments.length
            ? ""
            : "No appointments scheduled. Select the + on a day to add one.";
        renderAppointmentCalendar();
    } catch (err) {
        console.error("Error loading resident appointments:", err);
        if (String(residentId) !== String(currentResidentId)) return;
        status.textContent = "Unable to load appointments. Please reopen the Appointments tab to retry.";
    }
}

function changeAppointmentCalendarMonth(offset) {
    appointmentCalendarMonthManuallyChanged = true;
    appointmentCalendarMonth = new Date(
        appointmentCalendarMonth.getFullYear(),
        appointmentCalendarMonth.getMonth() + offset,
        1
    );
    renderAppointmentCalendar();
}

function openAppointmentModal(date, appointment = null, canEdit = true) {
    const modal = document.getElementById("appointmentModal");
    const dateInput = document.getElementById("appointmentDate");
    const dateLabel = document.getElementById("appointmentModalHeading");
    const error = document.getElementById("appointmentFormError");
    const form = document.getElementById("appointmentForm");
    if (!modal || !dateInput || !form) return;

    editingAppointmentId = canEdit ? appointment?._id || null : null;
    form.reset();
    dateInput.value = date;
    if (dateLabel) {
        const heading = appointment ? (canEdit ? "Edit Appointment" : "Event Details") : "Add Appointment";
        dateLabel.textContent = `${heading} - ${new Date(`${date}T00:00:00`).toLocaleDateString()}`;
    }
    const typeInput = document.getElementById("appointmentType");
    const descriptionInput = document.getElementById("appointmentDescription");
    const timeInput = document.getElementById("appointmentTime");
    const saveButton = document.getElementById("saveAppointmentButton");
    const cancelButton = form.querySelector(".form-actions button[type='button']");
    typeInput.value = appointment?.appointmentType || "";
    descriptionInput.value = appointment?.description || "";
    timeInput.value = appointment?.time || "";
    [typeInput, descriptionInput, timeInput].forEach(input => {
        input.disabled = !canEdit;
    });
    saveButton.textContent = appointment ? "Save Changes" : "Save Appointment";
    saveButton.style.display = canEdit ? "" : "none";
    if (cancelButton) cancelButton.textContent = canEdit ? "Cancel" : "Close";
    const deleteButton = document.getElementById("deleteAppointmentButton");
    if (deleteButton) deleteButton.style.display = appointment && canEdit ? "inline-block" : "none";
    if (error) {
        error.textContent = "";
        error.style.display = "none";
    }
    modal.style.display = "flex";
    document.getElementById("appointmentType")?.focus();
}

function closeAppointmentModal() {
    const modal = document.getElementById("appointmentModal");
    const form = document.getElementById("appointmentForm");
    if (modal) modal.style.display = "none";
    if (form) form.reset();
    editingAppointmentId = null;
}

async function saveResidentAppointment(event) {
    event.preventDefault();
    const error = document.getElementById("appointmentFormError");
    const saveButton = document.getElementById("saveAppointmentButton");
    if (!currentResidentId) return;
    const residentId = currentResidentId;
    const appointmentId = editingAppointmentId;

    if (error) {
        error.textContent = "";
        error.style.display = "none";
    }
    if (saveButton) saveButton.disabled = true;

    try {
        const isEditing = Boolean(appointmentId);
        await authFetch(isEditing
            ? `${API_BASE}/appointments/${encodeURIComponent(appointmentId)}`
            : `${API_BASE}/appointments`, {
            method: isEditing ? "PATCH" : "POST",
            body: JSON.stringify({
                residentId,
                date: document.getElementById("appointmentDate")?.value || "",
                appointmentType: document.getElementById("appointmentType")?.value || "",
                description: document.getElementById("appointmentDescription")?.value || "",
                time: document.getElementById("appointmentTime")?.value || ""
            })
        });
        closeAppointmentModal();
        await loadResidentAppointments(residentId);
    } catch (err) {
        console.error("Error saving resident appointment:", err);
        if (error) {
            error.textContent = err.message || "Unable to save appointment.";
            error.style.display = "block";
        }
    } finally {
        if (saveButton) saveButton.disabled = false;
    }
}

async function deleteResidentAppointment() {
    if (!editingAppointmentId || !currentResidentId) return;
    if (!window.confirm("Delete this appointment? This cannot be undone.")) return;

    const residentId = currentResidentId;
    const appointmentId = editingAppointmentId;
    const deleteButton = document.getElementById("deleteAppointmentButton");
    const error = document.getElementById("appointmentFormError");
    if (deleteButton) deleteButton.disabled = true;
    if (error) {
        error.textContent = "";
        error.style.display = "none";
    }

    try {
        await authFetch(`${API_BASE}/appointments/${encodeURIComponent(appointmentId)}`, {
            method: "DELETE"
        });
        closeAppointmentModal();
        await loadResidentAppointments(residentId);
    } catch (err) {
        console.error("Error deleting resident appointment:", err);
        if (error) {
            error.textContent = err.message || "Unable to delete appointment.";
            error.style.display = "block";
        }
    } finally {
        if (deleteButton) deleteButton.disabled = false;
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

    const raw = String(timeStr).trim();
    if (!raw) return null;

    const compact = raw.toUpperCase().replace(/\s+/g, "");

    const m24 = compact.match(/^(\d{1,2}):(\d{2})$/);
    if (m24) return Number(m24[1]) * 60 + Number(m24[2]);

    const m12 = compact.match(/^(\d{1,2}):?(\d{2})?(AM|PM)$/);
    if (m12) {
        let h = Number(m12[1]);
        const mm = Number(m12[2] || 0);
        const ampm = m12[3].toUpperCase();
        if (ampm === "PM" && h !== 12) h += 12;
        if (ampm === "AM" && h === 12) h = 0;
        return h * 60 + mm;
    }

    const mNoColon = compact.match(/^(\d{1,2})(AM|PM)$/);
    if (mNoColon) {
        let h = Number(mNoColon[1]);
        const ampm = mNoColon[2];
        if (ampm === "PM" && h !== 12) h += 12;
        if (ampm === "AM" && h === 12) h = 0;
        return h * 60;
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

const resident911ChartEditForm = document.getElementById("resident911ChartEditForm");
if (resident911ChartEditForm) {
    resident911ChartEditForm.addEventListener("submit", function (e) {
        e.preventDefault();
        if (!currentResidentId) return;

        const diagnoses = document.getElementById("resident911Diagnoses")?.value.trim() || "Not entered";
        const allergies = document.getElementById("resident911Allergies")?.value.trim() || "No known allergies";
        const poa = document.getElementById("resident911Poa")?.value.trim() || "Not entered";

        persistResident911ChartEntry(currentResidentId, { diagnoses, allergies, poa });
        closeResident911ChartEditModal();
        renderResident911Chart();
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
            loadGlobalMarLog();
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

            const selectedDate = getSelectedMarDateValue();
            const filteredEntries = entries.filter((entry) => {
                const entryDate = entry.actualTime || entry.createdAt || Date.now();
                return matchesMarDay(selectedDate, entryDate);
            });

            if (!filteredEntries.length) {
                container.innerHTML = `<p class="muted">No MAR entries for ${selectedDate}.</p>`;
                return;
            }

            filteredEntries.forEach(entry => {
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
function getResidentDisplayName(resident) {
    if (!resident) return "Unknown resident";
    if (typeof resident === "string") return resident || "Unknown resident";
    const fullName = `${resident.firstName || ""} ${resident.lastName || ""}`.trim();
    return fullName || "Unknown resident";
}

function getSelectedMarDateValue() {
    const marDateInput = document.getElementById("marDateFilter");
    if (marDateInput && marDateInput.value) {
        return marDateInput.value;
    }

    const today = new Date();
    return new Date(today.getTime() - (today.getTimezoneOffset() * 60000)).toISOString().slice(0, 10);
}

function matchesMarDay(dateValue, entryDate) {
    if (!dateValue || !entryDate) return false;
    const normalized = new Date(entryDate);
    if (Number.isNaN(normalized.getTime())) return false;
    const localDate = new Date(normalized.getTime() - (normalized.getTimezoneOffset() * 60000));
    return localDate.toISOString().slice(0, 10) === dateValue;
}

function loadGlobalMarLog() {
    authFetch(`${API_BASE}/mar`)
        .then(entries => {
            const container = document.getElementById("globalMarContainer");
            if (!container) return;

            container.innerHTML = "";

            const selectedDate = getSelectedMarDateValue();
            const filteredEntries = entries.filter((entry) => {
                const entryDate = entry.actualTime || entry.createdAt || Date.now();
                return matchesMarDay(selectedDate, entryDate);
            });

            if (!filteredEntries.length) {
                container.innerHTML = `<p class="muted">No MAR entries for ${selectedDate}.</p>`;
                return;
            }

            const grouped = new Map();
            filteredEntries.forEach(entry => {
                const residentInfo = entry.residentId || null;
                const residentId = residentInfo && (residentInfo._id || residentInfo);
                const key = String(residentId || "unknown");
                if (!grouped.has(key)) {
                    grouped.set(key, { residentId: residentId || null, residentInfo, entries: [] });
                }
                grouped.get(key).entries.push(entry);
            });

            const grid = document.createElement("div");
            grid.classList.add("mar-resident-grid");

            grouped.forEach(({ residentId, residentInfo, entries }) => {
                const residentName = getResidentDisplayName(residentInfo);
                const roomNumber = residentInfo && residentInfo.roomNumber ? residentInfo.roomNumber : "--";
                const photoUrl = resolveResidentPhotoUrl(residentInfo && residentInfo.photoUrl ? residentInfo.photoUrl : null);

                const card = document.createElement("button");
                card.type = "button";
                card.classList.add("mar-resident-card");
                card.innerHTML = `
                    <img src="${photoUrl}" alt="${residentName}" onerror="this.onerror=null;this.src='images/placeholder.svg';">
                    <div class="mar-resident-card-body">
                        <div class="mar-resident-card-name">${residentName}</div>
                        <div class="mar-resident-card-room">Room ${roomNumber}</div>
                        <div class="mar-resident-card-count">${entries.length} medication(s)</div>
                    </div>
                `;
                card.addEventListener("click", () => {
                    if (residentId) {
                        showPage("residentsPage");
                        openResidentProfile(String(residentId));
                        showResidentTab("marTab");
                    }
                });
                grid.appendChild(card);
            });

            container.appendChild(grid);
        })
        .catch(err => console.error("Error loading global MAR log:", err));
}

const marDateFilter = document.getElementById("marDateFilter");
if (marDateFilter) {
    marDateFilter.addEventListener("change", loadGlobalMarLog);
}
