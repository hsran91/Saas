// =========================
// GLOBAL STATE
// =========================

const API_BASE = window.location.protocol === "file:" ? "http://localhost:5000" : "";
let residents = [];
let currentResidentId = null;

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

    // Hide resident profile when switching main pages
    const profile = document.getElementById("residentProfile");
    if (profile) profile.style.display = "none";

    // When going to Residents page, refresh list
    if (pageId === "residentsPage") {
        loadResidentCards();
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
    fetch(`${API_BASE}/residents`)
        .then(res => res.json())
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

    fetch(`${API_BASE}/residents`, {
        method: "POST",
        body: formData
    })
        .then(async res => {
            const payload = await res.json().catch(async () => {
                const text = await res.text();
                return { error: text || "Unknown response" };
            });

            if (!res.ok) {
                throw new Error(payload.error || payload.message || "Failed to save resident");
            }

            return payload;
        })
        .then(savedResident => {
            closeAddResidentModal();

            residents.push(savedResident);
            loadResidentCards();
            showPage("residentsPage");
        })
        .catch(err => {
            console.error("Error saving resident:", err);
            alert(`Error saving resident: ${err.message}`);
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
    loadMedications(id);
    loadMarLog(id);

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
}

function deleteResident(id) {
    if (!confirm("Delete this resident?")) return;

    fetch(`http://localhost:5000/residents/${id}`, {
        method: "DELETE"
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
    // try resident-specific endpoint first
    fetch(`${API_BASE}/medications/${residentId}`)
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
                const timeText = scheduledTimes || med.time || med.frequency || "";

                li.innerHTML = `
                    <div class="med-card">
                        <div class="med-left">
                            <strong>${med.name}</strong>
                            <p>${med.dosage} — ${med.route}</p>
                            <small>${timeText}</small><br>
                            <small>${med.instructions || ""}</small>
                        </div>
                    </div>
                `;

                medList.appendChild(li);
            });
        })
        .catch(err => console.error("Error loading medications:", err));
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
            headers: { "Content-Type": "application/json" },
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

// =========================
// LOAD MAR LOG
// =========================

function loadMarLog(residentId) {
    fetch(`http://localhost:5000/mar/${residentId}`)
        .then(res => res.json())
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

                const formattedTime = new Date(entry.time).toLocaleString();

                div.innerHTML = `
                    <strong>${entry.medicationName}</strong>
                    <p>Status: ${entry.status}</p>
                    <p class="muted">${formattedTime}</p>
                `;

                container.appendChild(div);
            });
        })
        .catch(err => console.error("Error loading MAR log:", err));
}
