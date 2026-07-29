// =========================
// GLOBAL STATE
// =========================

const API_BASE = window.location.protocol === "file:" ? "http://localhost:5000" : "";
let residents = [];
let currentResidentId = null;
let currentUser = null;
const medicationDraftStatus = new Map();
let passFinalized = false;

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
    updateRoleUI();
}

function getAuthHeaders() {
    const token = getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
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

function updateRoleUI() {
    const badge = document.getElementById("currentUserRoleBadge");
    const logoutButton = document.getElementById("logoutButton");
    const billNav = document.getElementById("nav-billing");
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
        if (registerNav) registerNav.style.display = "inline-block";
        if (addResidentBtn) addResidentBtn.style.display = "inline-block";
        if (residentBillingTabButton) residentBillingTabButton.style.display = "inline-block";
        if (residentPayInvoiceButton) residentPayInvoiceButton.style.display = "inline-block";
        if (residentNewInvoiceButton) residentNewInvoiceButton.style.display = "inline-block";
        if (editQuickStatsButton) editQuickStatsButton.style.display = "inline-block";
        if (editTodaysFocusButton) editTodaysFocusButton.style.display = "inline-block";
    } else {
        if (registerNav) registerNav.style.display = "none";
        if (billNav) billNav.style.display = "none";
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

function setPassFinalized(value) {
    passFinalized = value;
    const medList = document.getElementById("med-list");
    const finalizeBtn = document.getElementById("finalizePassButton");

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

function loadDashboardSettings() {
    authFetch(`${API_BASE}/dashboard`)
        .then(settings => {
            const quickStatsText = document.getElementById("quickStatsText");
            const todaysFocusText = document.getElementById("todaysFocusText");
            if (quickStatsText) quickStatsText.textContent = settings.quickStats || "";
            if (todaysFocusText) todaysFocusText.textContent = settings.todaysFocus || "";
        })
        .catch(err => {
            console.error("Error loading dashboard settings:", err);
        });
}

function saveDashboardSettings() {
    const quickStatsInput = document.getElementById("dashboardQuickStats");
    const focusInput = document.getElementById("dashboardTodaysFocus");
    if (!quickStatsInput || !focusInput) return;

    authFetch(`${API_BASE}/dashboard`, {
        method: "PATCH",
        body: JSON.stringify({
            quickStats: quickStatsInput.value.trim(),
            todaysFocus: focusInput.value.trim(),
        }),
    })
        .then(settings => {
            const quickStatsText = document.getElementById("quickStatsText");
            const todaysFocusText = document.getElementById("todaysFocusText");
            if (quickStatsText) quickStatsText.textContent = settings.quickStats || "";
            if (todaysFocusText) todaysFocusText.textContent = settings.todaysFocus || "";
            closeDashboardEditModal();
            alert("Dashboard content updated.");
        })
        .catch(err => {
            console.error("Error saving dashboard settings:", err);
            alert(err.message || "Unable to save dashboard content.");
        });
}

function registerNewUser(event) {
    event.preventDefault();
    const name = document.getElementById("regName")?.value.trim();
    const username = document.getElementById("regUsername")?.value.trim();
    const email = document.getElementById("regEmail")?.value.trim();
    const password = document.getElementById("regPassword")?.value.trim();
    const role = document.getElementById("regRole")?.value;
    const residentId = document.getElementById("regResidentId")?.value.trim();
    const errorBox = document.getElementById("adminRegisterError");

    if (errorBox) {
        errorBox.style.display = "none";
        errorBox.textContent = "";
    }

    if (!name || !username || !email || !password || !role) {
        if (errorBox) {
            errorBox.textContent = "All fields except Resident ID are required.";
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
        if (!residentId) {
            if (errorBox) {
                errorBox.textContent = "Resident ID is required for POA users.";
                errorBox.style.display = "block";
            }
            return;
        }
        payload.residentId = residentId;
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

    if (pageId === "billingPage") {
        if (!currentUser || !["admin", "poa"].includes(currentUser.role)) {
            showPage("dashboardPage");
            return;
        }
        loadBillingPage();
    }
    if (pageId === "registerPage") {
        if (!currentUser || currentUser.role !== "admin") {
            showPage("dashboardPage");
            return;
        }
    }
    if (pageId === "marPage") {
        loadGlobalMarLog();
    }
    if (pageId === "alertsPage") {
        loadGlobalAlerts();
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

function loadResidentCards() {
    return authFetch(`${API_BASE}/residents`)
        .then(data => {
            residents = data;
            const container = document.getElementById("residentList");
            if (!container) return;

            container.innerHTML = "";

            if (!residents.length) {
                container.innerHTML = `<p class="muted">No residents yet. Click "Add Resident" to create one.</p>`;
                return;
            }

            residents.forEach(resident => {
                const card = document.createElement("div");
                card.classList.add("resident-card");

                const thumbSrc = resident.photoUrl ? `${API_BASE}${resident.photoUrl}` : "images/placeholder.svg";

                card.innerHTML = `
                    <div class="resident-card-row">
                        <img class="resident-thumb" src="${thumbSrc}" alt="${resident.firstName} ${resident.lastName}">
                        <div class="resident-card-body">
                            <div class="resident-card-header">
                                <h3>${resident.firstName} ${resident.lastName}</h3>
                                <button type="button" class="secondary-btn" onclick="event.stopPropagation(); deleteResident('${resident._id}')">Delete</button>
                            </div>
                            <p class="muted">Room ${resident.roomNumber}</p>
                        </div>
                    </div>
                `;

                card.onclick = () => openResidentProfile(resident._id);
                container.appendChild(card);
            });
        })
        .catch(err => console.error("Error loading residents:", err));
}

// Initial load
loadResidentCards();

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

    const formData = new FormData();
    formData.append("firstName", firstName);
    formData.append("lastName", lastName);
    formData.append("roomNumber", room);

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

    const profile = document.getElementById("residentProfile");
    if (profile) {
        profile.style.display = "block";
        profile.scrollIntoView({ behavior: "smooth" });
    }

    showResidentTab("medsTab");
    setPassFinalized(false);
    loadMedications(id);
    loadMarLog(id);
    loadBilling(id);

    // ensure add-med panel is closed when opening a profile
    closeAddMedPanel();
}

// Side panel controls for Add Medication
function openAddMedPanel() {
    const panel = document.getElementById("addMedPanel");
    if (panel) panel.style.display = "block";
}

function closeAddMedPanel() {
    const panel = document.getElementById("addMedPanel");
    if (panel) panel.style.display = "none";
    const form = document.getElementById("addMedForm");
    if (form) form.reset();
    resetMedTimeRows();
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
                ${invoice.status === "pending" ? `<button type="button" class="primary-btn" onclick="payInvoice('${invoice._id}')">Mark Paid</button>` : ""}
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

function setBillingPendingCount(count) {
    const badge = document.getElementById("billingPendingCount");
    if (!badge) return;
    badge.textContent = count > 0 ? `${count} pending` : "No pending";
    badge.classList.toggle("visible", count > 0 || count === 0);
}

function loadBilling(residentId) {
    if (!residentId) return;

    authFetch(`${API_BASE}/invoices/${residentId}`)
        .then(invoices => {
            renderInvoiceList(Array.isArray(invoices) ? invoices : []);
            setResidentInvoiceCount(Array.isArray(invoices) ? invoices.filter(i => i.status === "pending").length : 0);
        })
        .catch(err => {
            console.error("Error loading invoices:", err);
        });
}

function loadBillingPage() {
    authFetch(`${API_BASE}/invoices`)
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

function loadMedications(residentId) {
    authFetch(`${API_BASE}/medications/${residentId}`)
        .then(res => res.json())
        .then(meds => {
            const medList = document.getElementById("med-list");
            if (!medList) return;

            medList.innerHTML = "";

            if (!meds.length) {
                medList.innerHTML = `<li class="muted">No medications on file.</li>`;
                return;
            }

            meds.forEach(med => {
                const li = document.createElement("li");
                const scheduledTimes = Array.isArray(med.times) && med.times.length ? med.times.join(", ") : "";
                const timeText = scheduledTimes || med.time || med.frequency || "ASAP";
                const scheduledTime = Array.isArray(med.times) && med.times.length ? med.times[0] : med.time || med.frequency || "ASAP";

                li.innerHTML = `
                    <div class="med-card">
                        <label class="med-card-checkbox">
                            <input type="checkbox" class="med-given-checkbox" aria-label="Mark ${med.name} given">
                            <span class="custom-check"></span>
                        </label>
                        <div class="med-left">
                            <strong>${med.name}</strong>
                            <p>${med.dosage} — ${med.route}</p>
                            <small>${timeText}</small><br>
                            <small>${med.instructions || ""}</small>
                        </div>
                    </div>
                `;

                const checkbox = li.querySelector(".med-given-checkbox");
                if (checkbox) {
                    li.dataset.med = JSON.stringify(med);
                    checkbox.dataset.medId = med._id;
                    const draftStatus = medicationDraftStatus.get(med._id);
                    checkbox.checked = draftStatus === "given";

                    checkbox.addEventListener("change", () => {
                        medicationDraftStatus.set(med._id, checkbox.checked ? "given" : "held");
                        const card = checkbox.closest(".med-card");
                        if (card) card.classList.toggle("given", checkbox.checked);
                    });
                }

                medList.appendChild(li);
            });
        })
        .catch(err => console.error("Error loading medications:", err));
}

let heldReasonQueue = [];
let currentHeldReasonIndex = 0;

function finalizeMedicationPass() {
    if (!currentResidentId) {
        alert("Please select a resident before finalizing the medication pass.");
        return;
    }

    const medList = document.getElementById("med-list");
    if (!medList) return;

    const heldItems = [];

    medList.querySelectorAll("li").forEach(item => {
        const checkbox = item.querySelector(".med-given-checkbox");
        const medId = checkbox?.dataset.medId;
        const med = checkbox ? JSON.parse(item.dataset.med) : null;
        if (!med || !medId) return;

        const selectedStatus = medicationDraftStatus.get(medId) || "held";
        if (selectedStatus === "held") {
            heldItems.push({ med, medId });
        }
    });

    heldReasonQueue = heldItems;
    currentHeldReasonIndex = 0;

    if (heldReasonQueue.length) {
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

    const currentMed = heldReasonQueue[currentHeldReasonIndex];
    heldText.textContent = `Why was ${currentMed.med.name} held?`;
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
            alert("Please enter a reason for held medication.");
            return;
        }

        const item = heldReasonQueue[currentHeldReasonIndex];
        item.reason = reason;
        currentHeldReasonIndex += 1;

        if (currentHeldReasonIndex < heldReasonQueue.length) {
            openHeldReasonModal();
        } else {
            cancelHeldReasonPrompt();
            saveMedicationPass();
        }
    });
}

function saveMedicationPass() {
    const medList = document.getElementById("med-list");
    if (!medList) return;

    const promises = [];

    medList.querySelectorAll("li").forEach(item => {
        const checkbox = item.querySelector(".med-given-checkbox");
        const medId = checkbox?.dataset.medId;
        const med = checkbox ? JSON.parse(item.dataset.med) : null;
        if (!med || !medId) return;

        const selectedStatus = medicationDraftStatus.get(medId) || "held";
        const scheduledTime = Array.isArray(med.times) && med.times.length ? med.times[0] : med.time || med.frequency || "ASAP";
        const heldItem = heldReasonQueue.find(entry => entry.medId === medId);
        const reason = heldItem ? heldItem.reason : undefined;

        promises.push(
            fetch(`${API_BASE}/mar`, {
                method: "POST",
                headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
                body: JSON.stringify({
                    residentId: currentResidentId,
                    medicationId: medId,
                    scheduledTime,
                    status: selectedStatus,
                    staffName: "Medication Tech",
                    reason
                })
            })
                .then(async response => {
                    if (!response.ok) {
                        const error = await response.json().catch(() => ({}));
                        throw new Error(error.error || "Failed to finalize medication pass");
                    }
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
            heldReasonQueue = [];
            currentHeldReasonIndex = 0;
            loadMedications(currentResidentId);
            loadMarLog(currentResidentId);
            setPassFinalized(true);
        })
        .catch(err => {
            console.error("Error finalizing medication pass:", err);
            alert("Unable to finalize medication pass. Try again.");
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

        const medData = {
            name: document.getElementById("medName")?.value || "",
            dosage: document.getElementById("medDose")?.value || "",
            route: document.getElementById("medRoute")?.value || "",
            frequency: document.getElementById("medFreq")?.value || "",
            times: medTimes,
            instructions: document.getElementById("medInstr")?.value || "",
            residentId: currentResidentId
        };

        fetch(`${API_BASE}/medications`, {
            method: "POST",
            headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify(medData)
        })
            .then(res => res.json())
            .then(() => {
                loadMedications(currentResidentId);
                addMedForm.reset();
                closeAddMedPanel();
            })
            .catch(err => console.error("Error adding medication:", err));
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
                    ${entry.reason ? `<p>Reason: ${entry.reason}</p>` : ""}
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
                    ${entry.reason ? `<p>Reason: ${entry.reason}</p>` : ""}
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
